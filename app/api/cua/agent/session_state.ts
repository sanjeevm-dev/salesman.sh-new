import { MISSION_MEMORY_CONFIG, HALLUCINATION_CONFIG } from "./config";
import { ActionRecord } from "./stall_guard";

export interface MissionMemory {
  sessionId: string;
  originalGoal: string;
  currentPlan: string[];
  actionCount: number;
  createdAt: number;
  lastUpdated: number;
}

interface SessionState {
  missionMemory?: MissionMemory;
  lastActionTime?: number;
  actionHistory: ActionRecord[];
}

class SessionStateManager {
  private sessionStates: Map<string, SessionState>;

  constructor() {
    this.sessionStates = new Map();
  }

  private ensureSessionState(sessionId: string): SessionState {
    if (!this.sessionStates.has(sessionId)) {
      this.sessionStates.set(sessionId, {
        actionHistory: []
      });
    }
    return this.sessionStates.get(sessionId)!;
  }

  // === MISSION MEMORY METHODS ===

  setMissionMemory(sessionId: string, goal: string, plan: string[] = []): void {
    const state = this.ensureSessionState(sessionId);
    state.missionMemory = {
      sessionId,
      originalGoal: goal,
      currentPlan: plan,
      actionCount: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    
    console.log(`📝 Mission memory initialized for session ${sessionId}`);
    console.log(`   Goal: ${goal}`);
    console.log(`   Plan steps: ${plan.length}`);
  }

  getMissionMemory(sessionId: string): MissionMemory | null {
    const state = this.sessionStates.get(sessionId);
    return state?.missionMemory || null;
  }

  incrementActionCount(sessionId: string): void {
    const state = this.sessionStates.get(sessionId);
    if (!state?.missionMemory) return;

    state.missionMemory.actionCount++;
    state.missionMemory.lastUpdated = Date.now();
  }


  // === CRITICAL: FORMAT FOR PROMPT INJECTION ===
  
  formatMissionForPrompt(sessionId: string): string | null {
    if (!MISSION_MEMORY_CONFIG.ENABLE_MISSION_MEMORY) {
      return null;
    }

    const memory = this.getMissionMemory(sessionId);
    if (!memory || memory.currentPlan.length === 0) {
      return null;
    }

    let formattedContext = `
═══════════════════════════════════════════════════════════════
MISSION CONTEXT
═══════════════════════════════════════════════════════════════

🎯 Original Goal: ${memory.originalGoal}

📋 Full Plan:
`;

    memory.currentPlan.forEach((step, idx) => {
      formattedContext += `   ${idx + 1}. ${step}\n`;
    });

    formattedContext += `
═══════════════════════════════════════════════════════════════

⚡ INSTRUCTIONS:
   
   1. Look at what's currently on the screen
   2. Consult the Full Plan above to understand the overall goal
   3. Based on what you SEE, determine which step makes sense to execute next
   4. Take the appropriate action to move forward
   5. The plan is a guide - use your vision to navigate adaptively

`;

    return formattedContext;
  }

  // === SESSION CLEANUP ===

  clearSession(sessionId: string): void {
    this.sessionStates.delete(sessionId);
    console.log(`🗑️  Cleared session state for ${sessionId}`);
  }

  clearAllSessions(): void {
    const count = this.sessionStates.size;
    this.sessionStates.clear();
    console.log(`🗑️  Cleared ${count} session states`);
  }

  // === ACTION HISTORY METHODS (for StallGuard) ===

  logAction(sessionId: string, action: ActionRecord): void {
    const state = this.ensureSessionState(sessionId);
    state.actionHistory.push(action);
    
    if (state.actionHistory.length > HALLUCINATION_CONFIG.ACTION_HISTORY_SIZE) {
      state.actionHistory = state.actionHistory.slice(-HALLUCINATION_CONFIG.ACTION_HISTORY_SIZE);
    }
  }

  getActionHistory(sessionId: string): ActionRecord[] {
    const state = this.sessionStates.get(sessionId);
    return state?.actionHistory || [];
  }

  clearActionHistory(sessionId: string): void {
    const state = this.sessionStates.get(sessionId);
    if (state) {
      state.actionHistory = [];
      console.log(`🔄 Cleared action history for session ${sessionId}`);
    }
  }

  // === DEBUGGING ===

  getSessionStats(sessionId: string): object {
    const memory = this.getMissionMemory(sessionId);
    if (!memory) {
      return { exists: false };
    }

    return {
      exists: true,
      goal: memory.originalGoal,
      totalSteps: memory.currentPlan.length,
      actionCount: memory.actionCount,
      sessionAge: Date.now() - memory.createdAt,
    };
  }
}

export const sessionStateManager = new SessionStateManager();
