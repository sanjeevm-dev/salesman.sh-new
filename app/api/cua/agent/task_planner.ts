import OpenAI from "openai";
import { MISSION_MEMORY_CONFIG } from "./config";
import { connectDB } from "@/server/db";
import BrowserbaseContext from "@/lib/models/BrowserbaseContext";

const TASK_PLANNING_PROMPT = `You are an expert at breaking down user tasks into concrete, actionable browser steps.

Your job is to convert high-level execution prompts into COMPLETE, COMPREHENSIVE step-by-step plans that fully accomplish the task.

🚨 CRITICAL REQUIREMENT - COMPLETENESS OVER BREVITY:
Generate as many steps as needed to complete the ENTIRE task. Do NOT skip or abbreviate steps to meet a step limit. Complex tasks often require 20-50 steps - this is expected and correct.

FORMAT YOUR RESPONSE AS A NUMBERED LIST OF PRECISE STEPS:

Each step should be:
- Concrete and specific (e.g., "Click the 'Sign In' button in the top right")
- Action-oriented (use verbs: click, type, scroll, navigate, etc.)
- Sequential (one step leads naturally to the next)
- Realistic for browser automation (avoid vague instructions)
- Atomic (one clear action per step)

GOOD EXAMPLES:

Execution Prompt: "Authenticate on LinkedIn and send 10 connection requests"
1. Navigate to linkedin.com
2. Click the "Sign in" button
3. Type the email address in the email field
4. Click "Next"
5. Type the password in the password field
6. Click "Next" to sign in
7. Wait for feed to load and verify successful login
8. Click on "My Network" tab in the top navigation
9. Wait for the My Network page to load
10. Scroll down to find connection suggestions
11. Click "See all" under connection suggestions
12. Wait for the full suggestions list to load
13. Click "Connect" button on the 1st suggested profile
14. Click "Connect" button on the 2nd suggested profile
15. Click "Connect" button on the 3rd suggested profile
16. Click "Connect" button on the 4th suggested profile
17. Click "Connect" button on the 5th suggested profile
18. Click "Connect" button on the 6th suggested profile
19. Click "Connect" button on the 7th suggested profile
20. Click "Connect" button on the 8th suggested profile
21. Click "Connect" button on the 9th suggested profile
22. Click "Connect" button on the 10th suggested profile
23. Wait for all connection requests to be sent
24. Verify 10 connection requests were successfully sent

IMPORTANT RULES - COMPLETENESS FIRST:
✅ Generate ALL steps needed to complete the task fully
✅ Cover EVERY item mentioned in the WORKFLOW section
✅ Do NOT skip steps or combine multiple actions into one step
✅ Include verification/confirmation steps after important actions
✅ Include wait/page load steps between navigation actions
✅ Each step should be a single, clear, executable action
✅ Use specific UI elements when possible (buttons, links, fields, tabs)
✅ Include navigation steps with direct URLs for well-known sites
✅ If credentials are needed, assume they'll be provided separately
✅ Typical range: Simple tasks = 10-20 steps, Complex tasks = 30-100+ steps
✅ Safety maximum: ${MISSION_MEMORY_CONFIG.MAX_PLAN_STEPS} steps (extremely high cap to ensure no task is ever truncated)

❌ DO NOT:
❌ Skip steps to keep the plan short
❌ Combine multiple actions into vague steps like "Complete the form" (break it down!)
❌ Abbreviate workflows to fit a step count
❌ Leave out important verification or wait steps
❌ Assume steps are obvious and can be skipped
❌ Include logout, sign-out, or "end session" steps at the end
❌ Add steps to close the browser or clear cookies
❌ The browser session MUST remain authenticated for future runs (context persistence)

CRITICAL - AUTONOMY RULES:
- NEVER include steps that ask the user to complete authentication, login, or verification
- NEVER include steps like "ask user to...", "wait for user to...", or "user should..."
- The agent will handle ALL login, authentication, and verification steps automatically
- If login is needed, include steps like "Enter email", "Enter password", "Click Sign In" - NOT "Ask user to sign in"
- If 2FA appears, include "Wait for 2FA verification to complete automatically" - NOT "Ask user to complete 2FA"

WORKFLOW EXTRACTION - COMPREHENSIVE COVERAGE:
- If the prompt contains a "WORKFLOW:" section, EVERY numbered item must become multiple detailed steps
- If the prompt contains "AUTHENTICATION:" steps, include those first with full detail
- Break down high-level workflow items into granular browser actions
- Example: "Search for prospects" → Navigate to search, enter search criteria, apply filters, click search button, wait for results, scroll through results, etc.
- Combine authentication + workflow into a single comprehensive sequential plan
- Preserve ALL actions mentioned in the execution prompt

VERIFICATION & COMPLETION:
- Include verification steps after critical actions (e.g., "Verify login was successful")
- Add confirmation steps for data collection (e.g., "Confirm all 30 profiles are saved")
- End with a final verification that the complete task was accomplished

Now convert this execution prompt into a COMPLETE browser action plan with ALL necessary steps:`;

export class TaskPlanner {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Check if there's an existing Browserbase context for the given agent/platform combination
   * If a context has been used before, Browserbase will automatically restore the login state
   * 
   * AUTHENTICATION DETECTION LOGIC:
   * We check for EITHER firstLoginAt OR lastUsedAt as evidence of prior authentication:
   * 
   * - firstLoginAt: Explicit marker that login completed successfully and was saved
   * - lastUsedAt: Context was used in a previous session (likely has saved auth cookies)
   * 
   * Why accept lastUsedAt?
   * - Browserbase persists auth state immediately via persist: true
   * - firstLoginAt only gets set AFTER the session completes (disconnect())
   * - So a session that IS logged in might not have firstLoginAt set yet
   * - But it WILL have lastUsedAt from being used in the current/previous session
   * 
   * Why not just check contextId existence?
   * - Brand new contexts get contextId immediately when created
   * - But they have no auth cookies yet (never been used)
   * - Skipping login for unused contexts would break authentication entirely
   */
  private async checkAuthenticationContext(
    agentId: string | null,
    platform: string | null,
    userId: string | null
  ): Promise<{ isAuthenticated: boolean; platform: string | null }> {
    if (!agentId || !platform || !userId) {
      return { isAuthenticated: false, platform: null };
    }

    try {
      await connectDB();
      
      const context = await BrowserbaseContext.findOne({
        agentId,
        platform,
        userId,
        isActive: true,
      }).lean().exec();

      // Check if context has been authenticated at least once
      // We accept EITHER firstLoginAt OR lastUsedAt as evidence:
      // - firstLoginAt: Explicit marker that login completed successfully
      // - lastUsedAt: Context was used in a previous session (likely has saved auth)
      // This prevents skipping login for brand-new contexts that were just created
      const hasBeenUsed = context?.firstLoginAt || context?.lastUsedAt;
      
      if (context?.contextId && hasBeenUsed) {
        console.log(`✅ Found existing authenticated context for ${platform} (${context.contextId}) - login steps will be skipped`);
        console.log(`   Context created: ${context.createdAt ? new Date(context.createdAt).toLocaleString() : 'unknown'}`);
        console.log(`   Last used: ${context.lastUsedAt ? new Date(context.lastUsedAt).toLocaleString() : 'never'}`);
        console.log(`   First login: ${context.firstLoginAt ? new Date(context.firstLoginAt).toLocaleString() : 'not yet completed'}`);
        console.log(`   Browserbase will automatically restore authentication state from this context`);
        return { isAuthenticated: true, platform };
      }
      
      if (context && context.contextId && !hasBeenUsed) {
        console.log(`⚠️  Found context for ${platform} but it hasn't been used yet - including login steps`);
      }

      console.log(`ℹ️  No existing context found for ${platform} - including login steps in plan`);
      return { isAuthenticated: false, platform };
    } catch (error) {
      console.error('Error checking authentication context:', error);
      return { isAuthenticated: false, platform: null };
    }
  }

  async generateBrowserSteps(
    executionPrompt: string,
    agentId?: string | null,
    platform?: string | null,
    userId?: string | null
  ): Promise<string[]> {
    if (!MISSION_MEMORY_CONFIG.ENABLE_STEP_GENERATION) {
      console.log("⏭️  Step generation disabled, using original prompt as single step");
      return [executionPrompt.substring(0, 200)];
    }

    try {
      console.log(`🧠 Generating browser steps from execution prompt...`);
      
      // Check for existing authentication context
      const authContext = await this.checkAuthenticationContext(agentId || null, platform || null, userId || null);
      
      // Modify prompt if already authenticated
      let contextAwarePrompt = executionPrompt;
      if (authContext.isAuthenticated && authContext.platform) {
        const authNotice = `\n\n🔐 AUTHENTICATION STATUS - CRITICAL INSTRUCTION:
You are ALREADY LOGGED IN to ${authContext.platform} via a persistent browser session.
Your authentication cookies, tokens, and session data are pre-loaded.

DO NOT INCLUDE ANY LOGIN STEPS in your plan. This includes:
- DO NOT navigate to login pages
- DO NOT enter email/username
- DO NOT enter passwords
- DO NOT click "Sign In" or "Log In" buttons
- DO NOT handle 2FA or verification steps

INSTEAD:
- Start your plan by navigating directly to the main ${authContext.platform} page
- Assume you are already authenticated and on the homepage
- Proceed immediately to the actual task steps
- Skip all authentication-related actions

Example: If the task is "Send 10 LinkedIn connection requests", your plan should start with:
1. Navigate to linkedin.com (you will already be logged in)
2. Click on "My Network" tab
3. [continue with actual task...]

NOT with:
1. Navigate to linkedin.com/login ❌
2. Enter email ❌
3. Enter password ❌
4. Click Sign In ❌

Begin planning the task assuming authentication is ALREADY COMPLETE:`;

        contextAwarePrompt = authNotice + "\n\n" + executionPrompt;
        console.log(`🔐 Injected authentication skip notice for ${authContext.platform}`);
      }
      
      const startTime = Date.now();
      
      const response = await this.client.chat.completions.create({
        model: MISSION_MEMORY_CONFIG.STEP_GENERATION_MODEL,
        messages: [
          {
            role: "system",
            content: TASK_PLANNING_PROMPT
          },
          {
            role: "user",
            content: contextAwarePrompt
          }
        ],
        temperature: MISSION_MEMORY_CONFIG.STEP_GENERATION_TEMPERATURE,
        max_completion_tokens: MISSION_MEMORY_CONFIG.STEP_GENERATION_MAX_TOKENS,
      });

      const planText = response.choices[0]?.message?.content || "";
      const steps = this.extractStepsFromResponse(planText);
      
      const duration = Date.now() - startTime;
      console.log(`✅ Generated ${steps.length} steps in ${duration}ms`);
      
      // Apply safety cap only (not a target - we want complete plans!)
      const finalSteps = steps.slice(0, MISSION_MEMORY_CONFIG.MAX_PLAN_STEPS);
      
      if (steps.length > MISSION_MEMORY_CONFIG.MAX_PLAN_STEPS) {
        console.warn(`⚠️  Plan truncated: ${steps.length} steps generated, capped at ${MISSION_MEMORY_CONFIG.MAX_PLAN_STEPS} for safety`);
      }
      
      if (finalSteps.length > 0) {
        console.log(`📋 Complete Mission Plan (${finalSteps.length} steps):`);
        finalSteps.forEach((step, index) => {
          console.log(`   ${index + 1}. ${step}`);
        });
      }
      
      return finalSteps;
    } catch (error) {
      console.error("❌ Error generating browser steps:", error);
      // Fallback to simple extraction from prompt
      return this.fallbackStepExtraction(executionPrompt);
    }
  }

  private extractStepsFromResponse(response: string): string[] {
    const lines = response.split('\n');
    const steps: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Match numbered steps like "1. " or "1) "
      const numberMatch = trimmed.match(/^(\d+)[\.\)]\s*(.+)$/);
      if (numberMatch) {
        steps.push(numberMatch[2].trim());
      } else if (trimmed.startsWith('-')) {
        steps.push(trimmed.substring(1).trim());
      }
    }
    
    if (steps.length === 0 && response.trim()) {
      return [response.trim()];
    }
    
    return steps;
  }

  private fallbackStepExtraction(prompt: string): string[] {
    // Try to extract from WORKFLOW section
    const workflowMatch = prompt.match(/WORKFLOW:?\s*([\s\S]*?)(?=\n\n|$)/i);
    if (workflowMatch) {
      const workflowText = workflowMatch[1];
      const steps = this.extractStepsFromResponse(workflowText);
      if (steps.length > 0) {
        console.log(`📋 Extracted ${steps.length} steps from WORKFLOW section (fallback)`);
        return steps;
      }
    }
    
    // Last resort: use first 200 chars of prompt
    return [prompt.substring(0, 200) + "..."];
  }
}

export const taskPlanner = new TaskPlanner();
