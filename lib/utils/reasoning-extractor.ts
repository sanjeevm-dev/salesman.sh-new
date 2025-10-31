/**
 * Reasoning Extraction Utility
 * 
 * Extracts actual AI reasoning from OpenAI Computer Use API responses.
 * Used by both deploy routes and the microservice to pair reasoning with actions.
 */

import { Item } from "@/app/api/cua/agent/types";

// Based on actual OpenAI Computer Use API response structure
// The AI's reasoning appears in message items (type: "message")
// with content array containing text objects
interface MessageItem {
  type: "message";
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  role?: string;
}

/**
 * Extracts the reasoning text that precedes a specific action in the OpenAI response.
 * 
 * OpenAI Computer Use API outputs reasoning items before actions like this:
 * - reasoning item (AI's thought process)
 * - computer_call or function_call (the action)
 * 
 * This function searches backwards from the action to find its paired reasoning.
 * 
 * @param actionItem - The action item (computer_call or function_call) to find reasoning for
 * @param allOutput - The complete output array from the OpenAI response
 * @returns The reasoning text, or null if no reasoning found
 */
export function extractReasoningForAction(
  actionItem: Item | undefined,
  allOutput: Item[]
): string | null {
  if (!actionItem || !allOutput || allOutput.length === 0) {
    return null;
  }

  // Find the index of this action in the output array
  const actionIndex = allOutput.findIndex(item => item === actionItem);
  if (actionIndex === -1) {
    return null;
  }

  // Search backwards from the action to find the nearest message item with reasoning
  for (let i = actionIndex - 1; i >= 0; i--) {
    const item = allOutput[i];
    
    // Check if this is a message item (contains AI's reasoning/thoughts)
    if (item.type === "message" && "content" in item) {
      const message = item as unknown as MessageItem;
      
      if (!message.content || message.content.length === 0) {
        continue;
      }
      
      // Extract text from content array
      // Content typically has structure: [{ type: "output_text", text: "..." }]
      const reasoningTexts: string[] = [];
      
      for (const contentItem of message.content) {
        if (contentItem.text && contentItem.text.trim()) {
          reasoningTexts.push(contentItem.text.trim());
        }
      }
      
      if (reasoningTexts.length > 0) {
        return reasoningTexts.join(' ');
      }
    }
    
    // Stop if we hit another action (message is typically right before its action)
    if (
      item.type === "computer_call" ||
      item.type === "function_call"
    ) {
      break;
    }
  }

  return null;
}

/**
 * Extracts all reasoning-action pairs from an OpenAI response output array.
 * 
 * @param output - The complete output array from the OpenAI response
 * @returns Array of {action, reasoning} pairs
 */
export function extractAllReasoningPairs(output: Item[]): Array<{
  action: Item;
  reasoning: string | null;
}> {
  const pairs: Array<{ action: Item; reasoning: string | null }> = [];

  for (const item of output) {
    // Only process action items
    if (item.type === "computer_call" || item.type === "function_call") {
      const reasoning = extractReasoningForAction(item, output);
      pairs.push({ action: item, reasoning });
    }
  }

  return pairs;
}
