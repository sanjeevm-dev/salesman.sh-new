import { HALLUCINATION_CONFIG, RECOVERY_PROMPTS } from "./config";
import { sessionStateManager } from "./session_state";

export interface ActionRecord {
  timestamp: number;
  type: 'click' | 'type' | 'wait' | 'goto' | 'keypress' | 'scroll' | 'double_click' | 'screenshot' | 'mouse_move' | 'drag' | 'back';
  details: {
    coordinates?: [number, number];
    text?: string;
    url?: string;
    keys?: string[];
  };
}

export type StallPattern = 
  | 'repeated_wait'
  | 'same_click'
  | 'repeated_typing'
  | 'circular_nav'
  | 'stuck_inactivity'
  | 'general_stuck'
  | null;

export interface StallCheckResult {
  isStuck: boolean;
  pattern: StallPattern;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

export class StallGuard {
  static checkForStall(
    actionHistory: ActionRecord[],
    currentTime: number = Date.now()
  ): StallCheckResult {
    if (!HALLUCINATION_CONFIG.ENABLE_STALL_DETECTION || actionHistory.length === 0) {
      return { isStuck: false, pattern: null, reason: '', severity: 'low' };
    }

    const recentActions = actionHistory.slice(-HALLUCINATION_CONFIG.ACTION_HISTORY_SIZE);

    const waitCheck = this.checkRepeatedWaits(recentActions);
    if (waitCheck.isStuck) return waitCheck;

    const clickCheck = this.checkSameClicks(recentActions);
    if (clickCheck.isStuck) return clickCheck;

    const typingCheck = this.checkRepeatedTyping(recentActions);
    if (typingCheck.isStuck) return typingCheck;

    const navCheck = this.checkCircularNavigation(recentActions);
    if (navCheck.isStuck) return navCheck;

    const inactivityCheck = this.checkInactivity(recentActions, currentTime);
    if (inactivityCheck.isStuck) return inactivityCheck;

    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  private static checkRepeatedWaits(actions: ActionRecord[]): StallCheckResult {
    const recentWaits = actions.filter(a => a.type === 'wait').slice(-5);
    
    if (recentWaits.length >= HALLUCINATION_CONFIG.MAX_CONSECUTIVE_WAITS) {
      let consecutiveWaits = 0;
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i].type === 'wait') {
          consecutiveWaits++;
        } else {
          break;
        }
      }
      
      if (consecutiveWaits >= HALLUCINATION_CONFIG.MAX_CONSECUTIVE_WAITS) {
        return {
          isStuck: true,
          pattern: 'repeated_wait',
          reason: `Detected ${consecutiveWaits} consecutive wait actions`,
          severity: 'high'
        };
      }
    }
    
    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  private static checkSameClicks(actions: ActionRecord[]): StallCheckResult {
    const recentClicks = actions
      .filter(a => a.type === 'click' || a.type === 'double_click')
      .slice(-5);
    
    if (recentClicks.length < 2) return { isStuck: false, pattern: null, reason: '', severity: 'low' };

    const clicks = recentClicks.map(c => c.details.coordinates);
    
    for (let i = 0; i < clicks.length - 1; i++) {
      if (!clicks[i] || !clicks[i + 1]) continue;
      
      const [x1, y1] = clicks[i]!;
      const [x2, y2] = clicks[i + 1]!;
      
      const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      
      if (distance < 10) {
        let identicalCount = 1;
        for (let j = i + 1; j < clicks.length; j++) {
          if (!clicks[j]) continue;
          const [xj, yj] = clicks[j]!;
          const distJ = Math.sqrt(Math.pow(xj - x1, 2) + Math.pow(yj - y1, 2));
          if (distJ < 10) identicalCount++;
        }
        
        if (identicalCount >= HALLUCINATION_CONFIG.MAX_IDENTICAL_CLICKS) {
          return {
            isStuck: true,
            pattern: 'same_click',
            reason: `Clicked same location (${x1}, ${y1}) ${identicalCount} times`,
            severity: 'high'
          };
        }
      }
    }
    
    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  private static checkRepeatedTyping(actions: ActionRecord[]): StallCheckResult {
    const recentTyping = actions
      .filter(a => a.type === 'type' && a.details.text)
      .slice(-4);
    
    if (recentTyping.length < 2) return { isStuck: false, pattern: null, reason: '', severity: 'low' };

    const texts = recentTyping.map(t => t.details.text?.toLowerCase().trim());
    
    for (let i = 0; i < texts.length - 1; i++) {
      const text1 = texts[i];
      if (!text1 || text1.length === 0) continue;
      
      let repeatCount = 1;
      for (let j = i + 1; j < texts.length; j++) {
        if (texts[j] === text1) {
          repeatCount++;
        }
      }
      
      if (repeatCount >= HALLUCINATION_CONFIG.MAX_REPEATED_TEXT) {
        return {
          isStuck: true,
          pattern: 'repeated_typing',
          reason: `Typed "${text1}" ${repeatCount} times`,
          severity: 'medium'
        };
      }
    }
    
    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  private static checkCircularNavigation(actions: ActionRecord[]): StallCheckResult {
    const recentNavs = actions
      .filter(a => a.type === 'goto' && a.details.url)
      .slice(-6);
    
    if (recentNavs.length < 3) return { isStuck: false, pattern: null, reason: '', severity: 'low' };

    const urls = recentNavs.map(n => n.details.url);
    const urlCounts = new Map<string, number>();
    
    urls.forEach(url => {
      if (url) {
        urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
      }
    });
    
    for (const [url, count] of urlCounts.entries()) {
      if (count >= HALLUCINATION_CONFIG.MAX_URL_REVISITS) {
        return {
          isStuck: true,
          pattern: 'circular_nav',
          reason: `Visited ${url} ${count} times`,
          severity: 'high'
        };
      }
    }
    
    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  private static checkInactivity(actions: ActionRecord[], currentTime: number): StallCheckResult {
    if (actions.length === 0) return { isStuck: false, pattern: null, reason: '', severity: 'low' };

    const meaningfulActions = actions.filter(a => 
      a.type !== 'wait' && a.type !== 'screenshot' && a.type !== 'mouse_move'
    );
    
    if (meaningfulActions.length === 0) {
      if (actions.length > 0) {
        const lastAction = actions[actions.length - 1];
        const inactiveTime = currentTime - lastAction.timestamp;
        
        if (inactiveTime > HALLUCINATION_CONFIG.MAX_INACTIVITY_MS) {
          return {
            isStuck: true,
            pattern: 'stuck_inactivity',
            reason: `No meaningful actions for ${Math.round(inactiveTime / 1000)}s`,
            severity: 'high'
          };
        }
      }
    }
    
    return { isStuck: false, pattern: null, reason: '', severity: 'low' };
  }

  static getRecoveryPrompt(pattern: StallPattern, originalGoal: string): string {
    if (!pattern || !HALLUCINATION_CONFIG.ENABLE_AUTO_RECOVERY) {
      return '';
    }

    const template = RECOVERY_PROMPTS[pattern] || RECOVERY_PROMPTS.general_stuck;
    const prompt = template.replace('{goal}', originalGoal);
    
    return `${HALLUCINATION_CONFIG.RECOVERY_PROMPT_PREFIX}${prompt}`;
  }

  static recordAction(
    actionType: string,
    actionDetails: Record<string, unknown>
  ): ActionRecord {
    const record: ActionRecord = {
      timestamp: Date.now(),
      type: actionType as ActionRecord['type'],
      details: {}
    };

    if ('x' in actionDetails && 'y' in actionDetails) {
      record.details.coordinates = [
        Number(actionDetails.x),
        Number(actionDetails.y)
      ];
    }

    if ('text' in actionDetails) {
      record.details.text = String(actionDetails.text);
    }

    if ('url' in actionDetails) {
      record.details.url = String(actionDetails.url);
    }

    if ('keys' in actionDetails && Array.isArray(actionDetails.keys)) {
      record.details.keys = actionDetails.keys.map(String);
    }

    return record;
  }
}

export function resetActionHistory(sessionId: string): void {
  sessionStateManager.clearActionHistory(sessionId);
  console.log(`🔄 Action history reset for session ${sessionId}`);
}
