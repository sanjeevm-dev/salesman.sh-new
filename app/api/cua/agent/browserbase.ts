import * as dotenv from "dotenv";
import { Browser, Page, chromium } from "playwright";
import { BasePlaywrightComputer } from "./base_playwright";
import Browserbase from "@browserbasehq/sdk";
import axios from "axios";
import BrowserbaseContext from "@/lib/models/BrowserbaseContext";
import connectDB from "@/lib/mongodb";

dotenv.config();

// Define a custom type that includes all necessary properties
interface BrowserbaseSession {
  id?: string;
  connectUrl: string;
}

// Define the type for session creation parameters
interface SessionCreateParams {
  projectId: string;
  browserSettings: {
    viewport: {
      width: number;
      height: number;
    };
    blockAds: boolean;
    solveCaptchas?: boolean;
    context?: {
      id: string;
      persist: boolean;
    };
    fingerprint?: {
      browserListQuery?: string;
      httpVersion?: 1 | 2;
      locales?: string[];
      operatingSystems?: string[];
      screen?: {
        maxHeight?: number;
        maxWidth?: number;
        minHeight?: number;
        minWidth?: number;
      };
    };
  };
  region: "us-west-2" | "us-east-1" | "eu-central-1" | "ap-southeast-1";
  proxies: boolean | object[];
  keepAlive: boolean;
  timeout?: number; // Session timeout in seconds
}

export class BrowserbaseBrowser extends BasePlaywrightComputer {
  /**
   * Browserbase is a headless browser platform that offers a remote browser API. You can use it to control thousands of browsers from anywhere.
   * With Browserbase, you can watch and control a browser in real-time, record and replay sessions, and use built-in proxies for more reliable browsing.
   * You can find more information about Browserbase at https://docs.browserbase.com/ or view our OpenAI CUA Quickstart at https://docs.browserbase.com/integrations/openai-cua/introduction.
   */

  private bb: Browserbase;
  private projectId: string;
  private session: BrowserbaseSession | null = null;
  private region: string;
  private proxies: boolean | object[];
  private sessionId: string | null;
  private agentId: string | null;
  private platform: string | null;
  private contextId: string | null;
  private enableFingerprinting: boolean;
  private userId: string | null;
  private lastScreenshot: { data: string; timestamp: number } | null = null;
  private screenshotCacheDuration = 5000; // Cache screenshots for 5 seconds (OPTIMIZED - reduced from 10s per architect review)
  private reconnectionAttempts = 0; // Track CDP reconnection attempts
  private maxReconnectionAttempts = 3; // Maximum reconnection attempts
  private heartbeatInterval: NodeJS.Timeout | null = null; // Heartbeat monitoring interval
  private sessionStartTime: number | null = null; // Track when session started

  constructor(
    width: number = 1024,
    height: number = 768,
    region: string = "us-east-1",
    proxies: boolean | object[] = true,
    sessionId: string | null = null,
    agentId: string | null = null,
    platform: string | null = null,
    contextId: string | null = null,
    enableFingerprinting: boolean = true,
    userId: string | null = null
  ) {
    /**
     * Initialize the Browserbase instance with authentication persistence support.
     * 
     * @param width - The width of the browser viewport. Default is 1024.
     * @param height - The height of the browser viewport. Default is 768.
     * @param region - The region for the Browserbase session. Default is "us-east-1".
     * @param proxies - Whether to use a proxy or proxy configuration. Default is true.
     * @param sessionId - Optional. If provided, use an existing session instead of creating a new one.
     * @param agentId - Optional. Agent ID (MongoDB ObjectId string) for context persistence.
     * @param platform - Optional. Platform name (linkedin, twitter, etc.) for context persistence.
     * @param contextId - Optional. Existing context ID to reuse authentication state.
     * @param enableFingerprinting - Optional. Enable stealth mode fingerprinting. Default is true.
     * @param userId - Optional. User ID for context ownership.
     */
    super();
    this.bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY});
    this.projectId = process.env.BROWSERBASE_PROJECT_ID!;
    this.session = null;
    this.dimensions = [width, height];
    this.region = region;
    this.proxies = proxies;
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.platform = platform;
    this.contextId = contextId;
    this.enableFingerprinting = enableFingerprinting;
    this.userId = userId;
  }

  /**
   * Create a new Browserbase context explicitly for this agent/platform combination
   */
  private async createNewContext(): Promise<string> {
    console.log(`🆕 Creating new Browserbase context for ${this.platform}...`);
    
    try {
      const context = await this.bb.contexts.create({
        projectId: this.projectId,
      });
      
      console.log(`✅ Context created: ${context.id}`);
      return context.id;
    } catch (error) {
      console.error('❌ Failed to create Browserbase context:', error);
      throw error;
    }
  }

  /**
   * Fetch existing context from database or create a new one
   * Uses direct database operations instead of HTTP requests (proper serverless pattern)
   */
  private async getOrCreateContext(): Promise<string | null> {
    if (!this.agentId || !this.platform || !this.userId) {
      console.log('⏭️  Skipping context management (missing agentId, platform, or userId)');
      return null;
    }

    // Check database for existing context using direct database query
    try {
      await connectDB();
      
      const existingContext = await BrowserbaseContext.findOne({
        userId: this.userId,
        agentId: this.agentId,
        platform: this.platform,
        isActive: true
      }).lean().exec();
      
      if (existingContext && existingContext.contextId) {
        console.log(`🔍 Found existing context for ${this.platform}: ${existingContext.contextId}`);
        console.log(`   Last used: ${existingContext.lastUsedAt ? new Date(existingContext.lastUsedAt).toLocaleString() : 'never'}`);
        console.log(`✅ Reusing existing context - Browserbase will automatically restore login state`);
        return existingContext.contextId;
      }
    } catch (error) {
      console.log('No existing context found:', error);
    }

    // No existing context found - create a new one explicitly
    const newContextId = await this.createNewContext();
    
    // Save to database immediately
    await this.saveContextToDatabase(newContextId);
    
    return newContextId;
  }

  /**
   * Save context to database
   * Uses direct database operations instead of HTTP requests (proper serverless pattern)
   * Browserbase handles authentication persistence automatically via contextId + persist flag
   */
  private async saveContextToDatabase(contextId: string, markLoginComplete: boolean = false): Promise<void> {
    if (!this.agentId || !this.platform || !this.userId) {
      return;
    }

    try {
      await connectDB();
      
      const now = new Date();
      const updateFields: Record<string, unknown> = {
        userId: this.userId,
        contextId,
        lastUsedAt: now,
        isActive: true,
        metadata: {
          sessionId: this.session?.id,
          createdAt: new Date().toISOString(),
        },
      };

      // Only track login timing when explicitly marking login as complete (from disconnect())
      if (markLoginComplete) {
        const existing = await BrowserbaseContext.findOne({ 
          userId: this.userId, 
          agentId: this.agentId, 
          platform: this.platform 
        }).lean().exec();
        
        if (!existing || !existing.firstLoginAt) {
          updateFields.firstLoginAt = now;
        }
        updateFields.lastLoginAt = now;
      }

      await BrowserbaseContext.findOneAndUpdate(
        { userId: this.userId, agentId: this.agentId, platform: this.platform },
        {
          $set: updateFields,
          $inc: { loginAttempts: 1 }
        },
        { upsert: true, new: true, runValidators: true }
      ).lean().exec();

      console.log(`💾 Saved context to database: ${contextId}${markLoginComplete ? ' (login complete)' : ''}`);
    } catch (error) {
      console.error('Failed to save context to database:', error);
    }
  }

  protected async _getBrowserAndPage(): Promise<[Browser, Page]> {
    /**
     * Create a Browserbase session with EXPLICIT context creation and persistence support.
     * This ensures autonomous login state is saved and reused across deployments.
     */
    if (this.sessionId) {
      const response = await axios.get(
        `https://api.browserbase.com/v1/sessions/${this.sessionId}`,
        {
          headers: {
            "X-BB-API-Key": process.env.BROWSERBASE_API_KEY,
          },
        }
      );
      this.session = {
        connectUrl: response.data.connectUrl,
      } as unknown as BrowserbaseSession;
    } else {
      // Get existing context or create new one explicitly
      const contextId = this.contextId || await this.getOrCreateContext();

      const [width, height] = this.dimensions;
      const sessionParams: SessionCreateParams = {
        projectId: this.projectId,
        browserSettings: {
          blockAds: true,
          solveCaptchas: true,
          viewport: {
            width,
            height,
          },
        },
        region: this.region as
          | "us-west-2"
          | "us-east-1"
          | "eu-central-1"
          | "ap-southeast-1",
        proxies: this.proxies,
        keepAlive: true, // Enable keepAlive for long-running sales automation
        timeout: 3600, // Set explicit 60-minute timeout for long-running sales tasks
      };

      // CRITICAL: Always use context with persist: true to save autonomous login state
      if (contextId) {
        sessionParams.browserSettings.context = {
          id: contextId,
          persist: true, // Ensures login credentials are saved after first authentication
        };
        console.log(`🔐 Session using context ${contextId} with persist: true (autonomous login will be saved)`);
      }

      if (this.enableFingerprinting) {
        sessionParams.browserSettings.fingerprint = {
          browserListQuery: 'path>50 && share>0.5',
          httpVersion: 2,
          locales: ['en-US', 'en'],
          operatingSystems: ['windows'],
          screen: {
            minWidth: 1024,
            maxWidth: 1920,
            minHeight: 768,
            maxHeight: 1080,
          },
        } as unknown as typeof sessionParams.browserSettings.fingerprint;
      }

      this.session = (await this.bb.sessions.create(
        sessionParams as unknown as Parameters<typeof this.bb.sessions.create>[0]
      )) as unknown as BrowserbaseSession;
      
      console.log(`✅ Browserbase session created: ${this.session.id}`);
      console.log(`   View live: https://browserbase.com/sessions/${this.session.id}`);
      
      // Store the context ID for use in disconnect() method
      this.contextId = contextId;
    }

    if (!this.session) {
      throw new Error("Failed to create or retrieve session");
    }

    // Connect to the remote session with increased timeout for reliability
    const browser = await chromium.connectOverCDP(this.session.connectUrl, {
      timeout: 1000 * 180, // Increased to 180 seconds for initial CDP connection resilience
    });
    const context = browser.contexts()[0];
    
    // Add comprehensive browser event handlers to log WHY disconnections happen
    browser.on('disconnected', () => {
      console.error('🔴 BROWSER DISCONNECTED: CDP connection to Browserbase lost. Possible reasons: network interruption, session timeout, or Browserbase service issue.');
    });
    
    context.on('close', () => {
      console.warn('⚠️ BROWSER CONTEXT CLOSED: Browser context closed unexpectedly. Session may have ended or been terminated.');
    });
    
    context.on('page', (newPage) => {
      // Add event handlers to any new pages created
      newPage.on('crash', () => {
        console.error(`💥 PAGE CRASHED: Page ${newPage.url()} crashed unexpectedly. This may be due to memory issues, infinite loops, or browser bugs.`);
      });
      
      newPage.on('close', () => {
        console.log(`📄 PAGE CLOSED: Page ${newPage.url()} was closed.`);
      });
      
      newPage.on('pageerror', (error) => {
        console.error(`❌ PAGE ERROR on ${newPage.url()}: ${error.message}`);
      });
    });
    
    // Inject inline cursor-rendering script globally for every page
    const pages = context.pages();
    const page = pages[pages.length - 1];
    
    // Add event handlers to the initial page
    page.on('crash', () => {
      console.error(`💥 PAGE CRASHED: Main page ${page.url()} crashed unexpectedly. This may be due to memory issues, infinite loops, or browser bugs.`);
    });
    
    page.on('close', () => {
      console.log(`📄 PAGE CLOSED: Main page was closed.`);
    });
    
    page.on('pageerror', (error) => {
      console.error(`❌ PAGE ERROR on ${page.url()}: ${error.message}`);
    });
    
    // Set up CAPTCHA solving event listeners
    page.on("console", (msg) => {
      if (msg.text() === "browserbase-solving-started") {
        console.log("🔐 CAPTCHA detected - solving automatically (may take 5-30 seconds)...");
      } else if (msg.text() === "browserbase-solving-finished") {
        console.log("✅ CAPTCHA solved successfully");
      }
    });
    
    // Inject cursor script with error handling for navigation interruptions
    try {
      await page.evaluate(() => {
        const CURSOR_ID = "__cursor__";

        // Check if cursor element already exists
        if (document.getElementById(CURSOR_ID)) return;

        const cursor = document.createElement("div");
        cursor.id = CURSOR_ID;
        Object.assign(cursor.style, {
          position: "fixed",
          top: "0px",
          left: "0px",
          width: "20px",
          height: "20px",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round' stroke-linecap='round'><polygon points='2,2 2,22 8,16 14,22 17,19 11,13 20,13'/></svg>\")",
          backgroundSize: "cover",
          pointerEvents: "none",
          zIndex: "99999",
          transform: "translate(-2px, -2px)",
        });

        document.body.appendChild(cursor);

        document.addEventListener("mousemove", (e) => {
          cursor.style.top = `${e.clientY}px`;
          cursor.style.left = `${e.clientX}px`;
        });
        document.addEventListener("mousedown", (e) => {
          cursor.style.top = `${e.clientY}px`;
          cursor.style.left = `${e.clientX}px`;
        });
      });
    } catch (error) {
      // Silently ignore navigation-related errors as they're expected during page transitions
      if (!(error instanceof Error && error.message.includes('Execution context was destroyed'))) {
        console.warn("Error injecting cursor-rendering script:", error);
      }
    }

    // Only navigate to Brave Search if it's a new session
    if (!this.sessionId) {
      await page.goto("https://search.brave.com");
    }

    // Start heartbeat monitoring for session resilience
    this.startHeartbeatMonitoring();

    return [browser, page];
  }

  /**
   * Attempt to reconnect to CDP session with exponential backoff
   * Handles network interruptions gracefully for long-running sessions
   */
  private async attemptCDPReconnection(): Promise<boolean> {
    if (!this.session?.connectUrl) {
      console.error('🔴 Cannot reconnect: No session connect URL available');
      return false;
    }

    this.reconnectionAttempts++;
    
    if (this.reconnectionAttempts > this.maxReconnectionAttempts) {
      console.error(`🔴 CDP Reconnection failed after ${this.maxReconnectionAttempts} attempts. Session may need to be restarted.`);
      return false;
    }

    // Exponential backoff: 2s, 4s, 8s
    const backoffDelay = Math.pow(2, this.reconnectionAttempts) * 1000;
    console.log(`🔄 Attempting CDP reconnection (attempt ${this.reconnectionAttempts}/${this.maxReconnectionAttempts}) after ${backoffDelay}ms delay...`);
    
    await new Promise(resolve => setTimeout(resolve, backoffDelay));

    try {
      const browser = await chromium.connectOverCDP(this.session.connectUrl, {
        timeout: 1000 * 180,
      });
      
      this._browser = browser;
      const context = browser.contexts()[0];
      const pages = context.pages();
      this._page = pages[pages.length - 1];
      
      console.log('✅ CDP reconnection successful!');
      this.reconnectionAttempts = 0; // Reset counter on success
      return true;
    } catch (error) {
      console.error(`❌ CDP reconnection attempt ${this.reconnectionAttempts} failed:`, error);
      return false;
    }
  }

  /**
   * Start heartbeat monitoring to detect session timeouts and maintain connection
   * Pings the session every 5 minutes and warns when approaching timeout
   */
  private startHeartbeatMonitoring(): void {
    this.sessionStartTime = Date.now();
    const sessionTimeoutMs = 3600 * 1000; // 60 minutes in milliseconds
    const heartbeatIntervalMs = 5 * 60 * 1000; // 5 minutes
    const warningThresholdMs = 50 * 60 * 1000; // Warn at 50 minutes (10 min before timeout)

    console.log('💓 Starting session heartbeat monitoring (ping every 5 minutes, 60-minute timeout)');

    this.heartbeatInterval = setInterval(async () => {
      const elapsedTime = Date.now() - (this.sessionStartTime || 0);
      const remainingTime = sessionTimeoutMs - elapsedTime;
      const minutesRemaining = Math.floor(remainingTime / 60000);

      try {
        // Heartbeat: Take a quick screenshot to verify session is still alive
        if (this._page) {
          await this._page.screenshot({ type: 'png' });
          console.log(`💓 Heartbeat OK - Session alive (${minutesRemaining} minutes remaining)`);
        }

        // Warning when approaching timeout
        if (remainingTime < warningThresholdMs && remainingTime > 0) {
          console.warn(`⚠️ SESSION TIMEOUT WARNING: Only ${minutesRemaining} minutes remaining! Consider wrapping up soon.`);
        }

        // Session expired
        if (remainingTime <= 0) {
          console.error('🔴 SESSION TIMEOUT: 60-minute limit reached. Session will terminate soon.');
          this.stopHeartbeatMonitoring();
        }
      } catch (error) {
        console.error('💔 Heartbeat failed - session may be disconnected:', error);
        // Attempt reconnection if heartbeat fails
        await this.attemptCDPReconnection();
      }
    }, heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat monitoring
   * Called during disconnect/cleanup
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('💓 Heartbeat monitoring stopped');
    }
  }


  async disconnect(): Promise<void> {
    /**
     * Clean up resources when exiting the context manager.
     * CRITICAL: Properly closes browser sessions to prevent memory leaks and resource exhaustion.
     * CONTEXT PERSISTENCE: Trusts Browserbase's automatic context persistence via contextId.
     */
    try {
      // Stop heartbeat monitoring first
      this.stopHeartbeatMonitoring();

      if (this._page) {
        await this._page.close().catch(err => 
          console.warn('Error closing page:', err.message)
        );
      }
      if (this._browser) {
        await this._browser.close().catch(err => 
          console.warn('Error closing browser:', err.message)
        );
      }
      
      if (this.session) {
        console.log(`✅ Session completed. View replay at https://browserbase.com/sessions/${this.session.id}`);
      }

      // CRITICAL: Wait for Browserbase to sync context state
      // After a session with persist: true closes, Browserbase needs ~5 seconds to save the context
      // Per docs: "there will be a brief delay before the updated context state is ready for use"
      if (this.contextId && this.agentId && this.platform) {
        console.log('⏳ Waiting 5 seconds for Browserbase to persist context state...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Save context with login complete marker - Browserbase handles cookie/auth persistence automatically
        // markLoginComplete=true sets firstLoginAt, enabling task planner to skip login steps next time
        await this.saveContextToDatabase(this.contextId, true);
        console.log(`✅ Context synchronized to database (login completed)`);
        console.log(`📌 Next deployment will automatically restore login state via contextId: ${this.contextId}`);
      }
    } catch (error) {
      console.error('Error during browser disconnect:', error);
      // Don't throw - ensure cleanup completes even if there are errors
    }
  }

  invalidateScreenshotCache(): void {
    /**
     * Invalidate the screenshot cache to force a fresh capture on next screenshot() call.
     * Called after actions that change visual state (navigation, clicks, etc.)
     */
    this.lastScreenshot = null;
  }

  async screenshot(forceRefresh: boolean = false): Promise<string> {
    /**
     * Capture a screenshot of the current viewport using CDP with intelligent caching.
     * PERFORMANCE: Caches screenshots for 5s to avoid redundant captures during rapid-fire actions.
     * Use forceRefresh=true for actions that change visual state.
     *
     * @param forceRefresh - If true, bypass cache and capture fresh screenshot
     * @returns A base64 encoded string of the screenshot.
     */
    if (!this._page) {
      throw new Error("Page not initialized");
    }

    // Return cached screenshot if available, fresh, and not forced refresh
    const now = Date.now();
    if (!forceRefresh && this.lastScreenshot && (now - this.lastScreenshot.timestamp) < this.screenshotCacheDuration) {
      console.log(`⚡ Using cached screenshot (age: ${now - this.lastScreenshot.timestamp}ms)`);
      return this.lastScreenshot.data;
    }

    try {
      // Get CDP session from the page
      const cdpSession = await this._page.context().newCDPSession(this._page);

      // Capture screenshot using CDP (faster than Playwright screenshot)
      const { data } = await cdpSession.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });

      // Cache the screenshot
      this.lastScreenshot = { data, timestamp: now };
      console.log(`📸 Captured fresh screenshot${forceRefresh ? ' (forced)' : ''}`);
      
      return data; // CDP already returns base64 encoded string
    } catch (error) {
      console.warn(
        "CDP screenshot failed, falling back to standard screenshot:",
        error
      );
      // Fall back to standard Playwright screenshot
      const buffer = await this._page.screenshot({ type: "png" });
      const data = buffer.toString("base64");
      
      // Cache fallback screenshot too
      this.lastScreenshot = { data, timestamp: now };
      
      return data;
    }
  }

  async refresh(): Promise<void> {
    /**
     * Refresh the current page.
     */
    if (!this._page) {
      throw new Error("Page not initialized");
    }

    await this._page.reload();
  }

  async listTabs(): Promise<string[]> {
    /**
     * Get the list of tabs, including the current tab.
     */
    if (!this._page) {
      throw new Error("Page not initialized");
    }

    const tabs = await this._page.context().pages();
    const tabUrls = tabs.map((tab) => tab.url());
    const currentTab = this._page.url();
    return [...tabUrls, currentTab];
  }

  async changeTab(tabUrl: string): Promise<void> {
    /**
     * Change to a specific tab.
     */
    if (!this._page) {
      throw new Error("Page not initialized");
    }

    const tabs = await this._page.context().pages();
    const tab = tabs.find((t) => t.url() === tabUrl);
    if (!tab) {
      throw new Error(`Tab with URL ${tabUrl} not found`);
    }
    await tab.bringToFront();
    this._page = tab;
  }

  async saveCookies(): Promise<void> {
    /**
     * Save current browser cookies to the database (encrypted) for authentication persistence.
     */
    if (!this._page || !this.agentId || !this.platform || !this.userId) {
      console.warn('Cannot save cookies: missing page, agentId, platform, or userId');
      return;
    }

    try {
      const context = this._page.context();
      const cookies = await context.cookies();
      const realContextId = (this.session as unknown as { contextId?: string })?.contextId || this.contextId;
      
      if (!realContextId) {
        console.warn('Cannot save cookies: no valid context ID');
        return;
      }
      
      await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000'}/api/agents/browserbase-context`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-internal-api-key': process.env.INTERNAL_API_KEY || '',
        },
        body: JSON.stringify({
          userId: this.userId,
          agentId: this.agentId,
          platform: this.platform,
          contextId: realContextId,
          cookies: cookies,
          metadata: {
            savedAt: new Date().toISOString(),
            cookieCount: cookies.length,
          },
        }),
      });
      
      console.log(`🍪 Saved ${cookies.length} encrypted cookies for ${this.platform}`);
    } catch (error) {
      console.error('Failed to save cookies:', error);
    }
  }

  async loadCookies(): Promise<void> {
    /**
     * Load saved cookies from database and apply them to the browser context.
     */
    if (!this._page || !this.agentId || !this.platform || !this.userId) {
      console.warn('Cannot load cookies: missing page, agentId, platform, or userId');
      return;
    }

    try {
      const contextResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000'}/api/agents/browserbase-context?agentId=${this.agentId}&platform=${this.platform}&userId=${this.userId}`,
        {
          headers: {
            'x-internal-api-key': process.env.INTERNAL_API_KEY || '',
          },
        }
      );
      const contextData = await contextResponse.json();
      
      if (contextData.success && contextData.contexts?.cookies) {
        const context = this._page.context();
        await context.addCookies(contextData.contexts.cookies);
        console.log(`🍪 Loaded ${contextData.contexts.cookies.length} cookies for ${this.platform}`);
      }
    } catch (error) {
      console.error('Failed to load cookies:', error);
    }
  }

  getSessionLiveUrl(): string | null {
    /**
     * Get the live view URL for manual interaction (e.g., for 2FA completion).
     * This allows users to take control of the session through the browser.
     */
    if (!this.session?.id) {
      return null;
    }
    return `https://www.browserbase.com/sessions/${this.session.id}`;
  }
}
