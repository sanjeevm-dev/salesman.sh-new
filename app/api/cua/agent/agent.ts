import { BrowserbaseBrowser } from "./browserbase";
import OpenAI from "openai";
import {
  InputItem,
  Item,
  Message,
  FunctionToolCall,
  ComputerToolCall,
  ComputerCallOutput,
  FunctionOutput,
  Tool,
  RequestOptions,
} from "./types";
import { AxiosError } from "axios";
import axios from "axios";
import axiosRetry from 'axios-retry';
import { sessionStateManager } from "./session_state";
import { StallGuard } from "./stall_guard";
import { extractionEnabled } from "../../../lib/feature-flags";

type AcknowledgeSafetyCheckCallback = (message: string) => boolean;

// Configure axios retry globally (once) with enhanced error handling
axiosRetry(axios, {
  retries: 5, // Increased from 3 to handle more transient failures
  retryDelay: (retryCount, error) => {
    const status = (error as AxiosError).response?.status;
    
    // Special handling for 429 rate limit errors - use longer delays
    if (status === 429) {
      // For rate limits, use aggressive exponential backoff: 5s, 15s, 30s, 60s, 120s
      const rateLimitDelays = [5000, 15000, 30000, 60000, 120000];
      const delay = rateLimitDelays[retryCount - 1] || 120000; // Default to 120s for retries beyond 5
      console.log(`⏳ Rate limit (429) detected - waiting ${delay/1000}s before retry ${retryCount}`);
      return delay;
    }
    
    // For other errors, use standard exponential delay
    const delay = axiosRetry.exponentialDelay(retryCount, error);
    console.log(`⏳ Retry attempt ${retryCount} after ${delay}ms delay due to: ${error.message}`);
    return delay;
  },
  retryCondition: (error: AxiosError): boolean => {
    // Retry on network errors and idempotent request errors
    if (axiosRetry.isNetworkOrIdempotentRequestError(error)) {
      return true;
    }
    
    // Retry on specific status codes
    const status = error.response?.status;
    if (status) {
      // 429: Rate limit - CRITICAL to retry these with longer delays
      // 408: Request timeout
      // 409: Conflict (can happen with Browserbase sessions)
      // 5xx: Server errors
      const retryableStatuses = [408, 409, 429, 500, 502, 503, 504];
      if (retryableStatuses.includes(status)) {
        console.log(`🔄 Retrying due to ${status} status code${status === 429 ? ' (Rate Limit - using extended backoff)' : ''}`);
        return true;
      }
    }
    
    return false;
  },
  onRetry: (retryCount, error, requestConfig) => {
    const status = (error as AxiosError).response?.status;
    const statusText = status === 429 ? ' [RATE LIMIT - Extended backoff]' : '';
    console.log(`🔄 Retry ${retryCount}/5 for ${requestConfig.url} (Status: ${status || 'Network Error'}${statusText})`);
  }
});

export class Agent {
  private client: OpenAI;
  private model: string;
  private computer: BrowserbaseBrowser;
  private tools: Tool[];
  private printSteps: boolean = true;
  private acknowledgeSafetyCheckCallback: AcknowledgeSafetyCheckCallback;
  public lastResponseId: string | undefined = undefined;
  private sessionId: string | null = null;

  constructor(
    model: string = "computer-use-preview",
    computer: BrowserbaseBrowser,
    acknowledgeSafetyCheckCallback: AcknowledgeSafetyCheckCallback = () => true,
    sessionId: string | null = null
  ) {
    this.client = new OpenAI();
    this.model = model;
    this.computer = computer;
    this.acknowledgeSafetyCheckCallback = acknowledgeSafetyCheckCallback;
    this.sessionId = sessionId;

    this.tools = [
      {
        type: "computer_use_preview",
        display_width: computer.dimensions[0],
        display_height: computer.dimensions[1],
        environment: computer.environment,
      },
      {
        type: "function",
        name: "back",
        description: "Go back to the previous page.",
        parameters: {},
        strict: false,
      },
      {
        type: "function",
        name: "goto",
        description: "Go to a specific URL.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Fully qualified URL to navigate to.",
            },
          },
          additionalProperties: false,
          required: ["url"],
        },
        strict: false,
      },
    ];
    // Add extraction tool as optional function tool (feature-flagged)
    if (extractionEnabled()) {
      this.tools.push({
        type: "function",
        name: "extract_data",
        description: "Extract structured data from the current page using structured selectors or smart mode.",
        parameters: {
          type: "object",
          properties: {
            config: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["structured", "smart"] },
                dataType: { type: "string" },
                selectors: {
                  type: "object",
                  properties: {
                    container: { type: "string" },
                    fields: { type: "object", additionalProperties: { type: "string" } },
                  },
                },
                keywords: { type: "array", items: { type: "string" } },
                maxRecords: { type: "number" },
                validate: { type: "boolean" },
                save: { type: "boolean" },
              },
              required: ["mode", "dataType"],
              additionalProperties: false,
            },
          },
          required: ["config"],
          additionalProperties: false,
        },
        strict: false,
      });
    }
    /* Some additional tools, disabled as they seem to slow down model performance
      {
        type: "function",
        name: "refresh",
        description: "Refresh the current page.",
        parameters: {},
        strict: false,
      },
      {
        type: "function",
        name: "listTabs",
        description: "Get the list of tabs, including the current tab.",
        parameters: {},
        strict: false,
      },
      {
        type: "function",
        name: "changeTab",
        description: "Change to a specific tab.",
        parameters: {
          type: "object",
          properties: {
            tab: {
              type: "string",
              description: "The URL of the tab to change to.",
            },
          },
          additionalProperties: false,
          required: ["tab"],
        },
        strict: false,
      },
      */
  }

  private async createResponse(options: RequestOptions): Promise<Response> {
    const url = "https://api.openai.com/v1/responses";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'Openai-beta': 'responses=v1',
    };
  
    const openaiOrg = process.env.OPENAI_ORG;
    if (openaiOrg) {
      headers['Openai-Organization'] = openaiOrg;
    }

    // Note: Retry behavior is configured globally at module level
    // Handles 429 rate limits, 5xx errors, and network failures automatically
  
    try {
      const response = await axios.post(url, options, { headers });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      console.error(`❌ API Error: ${axiosError.response?.status} ${axiosError.response?.data || axiosError.message}`);
      console.error(`Response data: ${JSON.stringify(axiosError.response?.data)}`);
      throw error;
    }
  } 

  async getAction(
    inputItems: InputItem[],
    previousResponseId: string | undefined
  ): Promise<{
    output: Item[];
    responseId: string;
  }> {
    // === MISSION MEMORY INJECTION ===
    // Prepend mission context to provide explicit progress tracking
    if (this.sessionId) {
      const missionContext = sessionStateManager.formatMissionForPrompt(this.sessionId);
      
      if (missionContext) {
        console.log('\n' + '='.repeat(80));
        console.log('📋 MISSION MEMORY CONTEXT INJECTION');
        console.log('='.repeat(80));
        console.log(missionContext);
        console.log('='.repeat(80) + '\n');
        
        // Prepend as developer message (highest priority system context)
        inputItems = [
          {
            role: "developer",
            content: missionContext
          } as InputItem,
          ...inputItems
        ];
      }
    }
    
    // Log complete input being sent to CUA model
    console.log('\n' + '='.repeat(80));
    console.log('🤖 COMPLETE CUA MODEL INPUT (what the model sees)');
    console.log('='.repeat(80));
    console.log(`Model: ${this.model}`);
    console.log(`Previous Response ID: ${previousResponseId || 'none (first call)'}`);
    console.log(`\nInput Items (${inputItems.length} total):`);
    inputItems.forEach((item, idx) => {
      console.log(`\n--- Item ${idx + 1} ---`);
      const itemData = item as Record<string, unknown>;
      console.log(`Role: ${itemData.role || 'N/A'}`);
      console.log(`Type: ${itemData.type || 'N/A'}`);
      if (itemData.content) {
        const contentPreview = typeof itemData.content === 'string' 
          ? itemData.content.substring(0, 500) + (itemData.content.length > 500 ? '...' : '')
          : JSON.stringify(itemData.content).substring(0, 500);
        console.log(`Content: ${contentPreview}`);
      }
    });
    console.log('\n' + '='.repeat(80) + '\n');
    
    const response = await this.createResponse({
      model: this.model,
      input: inputItems,
      tools: this.tools,
      truncation: "auto",
      ...(previousResponseId
        ? { previous_response_id: previousResponseId }
        : {}),
    });

    console.log("response", response);

    return {
      output: response.output as Item[],
      responseId: response.id as string,
    };
  }

  async takeAction(
    output: Item[]
  ): Promise<(Message | ComputerCallOutput | FunctionOutput)[]> {
    const results: (Message | ComputerCallOutput | FunctionOutput)[] = [];
    
    // Execute actions sequentially to avoid conflicts (e.g., multiple goto calls)
    for (const item of output) {
      if (item.type === "message") {
        // Do nothing - messages don't need execution
        continue;
      }
      if (item.type === "computer_call") {
        const result = await this.takeComputerAction(item as ComputerToolCall);
        results.push(result);
      }
      if (item.type === "function_call") {
        const result = await this.takeFunctionAction(item as FunctionToolCall);
        results.push(result);
      }
    }

    return results;
  }

  async takeMessageAction(messageItem: Message): Promise<Message> {
    if (this.printSteps && messageItem.content?.[0]) {
      console.log(messageItem.content[0]);
    }
    return messageItem;
  }

  async takeComputerAction(
    computerItem: ComputerToolCall
  ): Promise<ComputerCallOutput> {
    const action = computerItem.action;
    const actionType = action.type;
    const actionArgs = Object.fromEntries(
      Object.entries(action).filter(([key]) => key !== "type")
    );

    if (this.printSteps) {
      console.log(`${actionType}(${JSON.stringify(actionArgs)})`);
    }

    if (!this.computer) {
      throw new Error("Computer not initialized");
    }

    const method = (this.computer as unknown as Record<string, unknown>)[
      actionType
    ] as (...args: unknown[]) => unknown;
    await method.apply(this.computer, Object.values(actionArgs));

    // 🛡️ RECORD ACTION TO HISTORY (for StallGuard)
    if (this.sessionId) {
      const actionRecord = StallGuard.recordAction(actionType, actionArgs);
      sessionStateManager.logAction(this.sessionId, actionRecord);
    }

    // PERFORMANCE OPTIMIZATION: Smart screenshot strategy
    // Actions that DON'T change visual state can use cached screenshots (5s cache)
    // Actions that DO change visual state require fresh screenshots
    const nonVisualActions = ['mouse_move']; // Only mouse movements don't change visual state
    const requiresFreshScreenshot = !nonVisualActions.includes(actionType);
    
    // Force fresh screenshot for state-changing actions (click, type, scroll, drag, wait, keypress)
    // Use cache only for non-visual actions (mouse_move)
    const screenshot = await this.computer.screenshot(requiresFreshScreenshot);

    // Handle safety checks
    const pendingChecks = computerItem.pending_safety_checks || [];
    for (const check of pendingChecks) {
      const message = check.message;
      if (!this.acknowledgeSafetyCheckCallback(message)) {
        throw new Error(
          `Safety check failed: ${message}. Cannot continue with unacknowledged safety checks.`
        );
      }
    }

    return {
      type: "computer_call_output",
      call_id: computerItem.call_id,
      acknowledged_safety_checks: pendingChecks,
      output: {
        type: "input_image",
        image_url: `data:image/png;base64,${screenshot}`,
      },
    };
  }

  async takeFunctionAction(
    functionItem: FunctionToolCall
  ): Promise<FunctionOutput> {
    const name = functionItem.name;
    const args = JSON.parse(functionItem.arguments);
    if (this.printSteps) {
      console.log(`${name}(${JSON.stringify(args)})`);
    }

    let _result: unknown = undefined;
    if (
      this.computer &&
      typeof (this.computer as unknown as Record<string, unknown>)[name] ===
        "function"
    ) {
      const method = (this.computer as unknown as Record<string, unknown>)[
        name
      ] as (...args: unknown[]) => unknown;
      _result = await method.apply(this.computer, Object.values(args));
      
      // 🛡️ RECORD ACTION TO HISTORY (for StallGuard)
      if (this.sessionId) {
        const actionRecord = StallGuard.recordAction(name, args);
        sessionStateManager.logAction(this.sessionId, actionRecord);
      }
      
      // PERFORMANCE OPTIMIZATION: Navigation actions (goto, back) change page state completely
      // Invalidate cache to force fresh screenshot on next agent iteration
      if (name === 'goto' || name === 'back') {
        console.log(`🗑️ Invalidating screenshot cache after navigation: ${name}`);
        this.computer.invalidateScreenshotCache();
      }
    }

    return {
      type: "function_call_output",
      call_id: functionItem.call_id,
      output: (typeof _result === 'string') ? _result : JSON.stringify(_result ?? { status: 'success' }),
    };
  }
}
