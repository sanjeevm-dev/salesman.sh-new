export const MISSION_MEMORY_CONFIG = {
  ENABLE_MISSION_MEMORY: true,
  ENABLE_STEP_GENERATION: true,
  MAX_PLAN_STEPS: 200,
  MAX_COMPLETED_STEPS_TRACKED: 200,
  STEP_GENERATION_MODEL: "gpt-4o-mini",
  STEP_GENERATION_TEMPERATURE: 0.3,
  STEP_GENERATION_MAX_TOKENS: 2500,
};

export const HALLUCINATION_CONFIG = {
  MAX_CONSECUTIVE_WAITS: 3,
  MAX_IDENTICAL_CLICKS: 2,
  MAX_REPEATED_TEXT: 2,
  MAX_URL_REVISITS: 3,
  MAX_INACTIVITY_MS: 60000,
  ACTION_HISTORY_SIZE: 10,
  ENABLE_STALL_DETECTION: true,
  ENABLE_AUTO_RECOVERY: true,
  RECOVERY_PROMPT_PREFIX: "⚠️ IMPORTANT: ",
};

export const RECOVERY_PROMPTS: Record<string, string> = {
  repeated_wait: "You've waited multiple times without making progress. The page is likely ready. Stop waiting and take a concrete action toward your goal: {goal}. Analyze the current page state and make a decisive move.",
  same_click: "Clicking the same location repeatedly isn't working. The element may not be responsive or may have already been clicked. Analyze what elements are actually on the page and try a different approach to achieve: {goal}",
  repeated_typing: "You've already typed that exact text. It's time to submit the form, click a button, or move to the next step of your goal: {goal}",
  circular_nav: "You're revisiting pages you've already been to, creating a loop. Step back and reconsider your strategy for achieving: {goal}. Try a completely different approach.",
  stuck_inactivity: "You appear to be stuck without making meaningful progress. Take a fresh screenshot, carefully read the current page state, and identify the next concrete action needed to achieve: {goal}",
  general_stuck: "Your recent actions suggest you may be stuck in a loop. Remember your goal: {goal}. Take a moment to assess the current page state and choose a new, different action that moves you toward completion."
};
