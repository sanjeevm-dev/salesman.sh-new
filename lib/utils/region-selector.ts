/**
 * Timezone-based Browserbase Region Selector
 * 
 * Automatically selects the nearest Browserbase region based on user timezone
 * to optimize browser automation performance and reduce latency.
 */

export type BrowserbaseRegion = 
  | 'us-west-2'      // Oregon, USA
  | 'us-east-1'      // Virginia, USA
  | 'eu-central-1'   // Frankfurt, Germany
  | 'ap-southeast-1'; // Singapore

/**
 * Maps UTC offset to nearest Browserbase region
 * 
 * Region Distribution:
 * - Americas West (UTC-8 to UTC-7): us-west-2 (Oregon)
 * - Americas East (UTC-6 to UTC-4): us-east-1 (Virginia) 
 * - Europe/Africa (UTC-1 to UTC+3): eu-central-1 (Frankfurt)
 * - Asia/Pacific (UTC+4 to UTC+12): ap-southeast-1 (Singapore)
 * 
 * @param utcOffset - UTC offset in hours (e.g., -8 for PST, +1 for CET)
 * @returns Optimal Browserbase region code
 */
function selectRegionByUTCOffset(utcOffset: number): BrowserbaseRegion {
  // Americas - West Coast (Pacific, Mountain timezones)
  if (utcOffset >= -8 && utcOffset <= -7) {
    return 'us-west-2';
  }
  
  // Americas - East Coast (Central, Eastern timezones)
  if (utcOffset >= -6 && utcOffset <= -4) {
    return 'us-east-1';
  }
  
  // Europe, Middle East, Africa
  if (utcOffset >= -1 && utcOffset <= 3) {
    return 'eu-central-1';
  }
  
  // Asia, Pacific, Oceania
  if (utcOffset >= 4 && utcOffset <= 12) {
    return 'ap-southeast-1';
  }
  
  // Default to us-east-1 for edge cases
  return 'us-east-1';
}

/**
 * Detects optimal Browserbase region from timezone string
 * 
 * @param timezone - IANA timezone identifier (e.g., "America/Los_Angeles", "Europe/London")
 * @returns Optimal Browserbase region code
 */
export function getOptimalRegionFromTimezone(timezone?: string): BrowserbaseRegion {
  if (!timezone) {
    return 'us-east-1'; // Default fallback
  }

  try {
    // Get current UTC offset for the timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    });
    
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(part => part.type === 'timeZoneName');
    
    if (offsetPart?.value) {
      // Parse offset string like "GMT-8" or "GMT+5:30"
      const offsetMatch = offsetPart.value.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (offsetMatch) {
        const hours = parseInt(offsetMatch[1], 10);
        const minutes = offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0;
        const totalOffset = hours + (minutes / 60) * Math.sign(hours);
        
        return selectRegionByUTCOffset(totalOffset);
      }
    }
  } catch (error) {
    console.warn(`⚠️ Failed to parse timezone "${timezone}", using default region:`, error);
  }

  // Fallback to geographic region mapping if offset parsing fails
  return getRegionByGeography(timezone);
}

/**
 * Geographic fallback mapping for common timezone patterns
 */
function getRegionByGeography(timezone: string): BrowserbaseRegion {
  const tz = timezone.toLowerCase();
  
  // Americas - West
  if (tz.includes('america/los_angeles') || 
      tz.includes('america/vancouver') ||
      tz.includes('america/phoenix') ||
      tz.includes('america/denver') ||
      tz.includes('pacific') ||
      tz.includes('mountain')) {
    return 'us-west-2';
  }
  
  // Americas - East
  if (tz.includes('america/new_york') ||
      tz.includes('america/chicago') ||
      tz.includes('america/toronto') ||
      tz.includes('eastern') ||
      tz.includes('central')) {
    return 'us-east-1';
  }
  
  // Europe, Middle East, Africa
  if (tz.includes('europe/') ||
      tz.includes('africa/') ||
      tz.includes('middle') ||
      tz.startsWith('utc') ||
      tz.startsWith('gmt')) {
    return 'eu-central-1';
  }
  
  // Asia, Pacific, Oceania
  if (tz.includes('asia/') ||
      tz.includes('pacific/') ||
      tz.includes('australia/') ||
      tz.includes('japan') ||
      tz.includes('singapore') ||
      tz.includes('hong_kong')) {
    return 'ap-southeast-1';
  }
  
  // Default fallback
  return 'us-east-1';
}

/**
 * Gets user timezone from request headers or browser
 * 
 * @param request - Optional Request object to extract timezone from headers
 * @returns Detected timezone string or undefined
 */
export function getUserTimezoneFromRequest(request?: Request): string | undefined {
  if (!request) {
    return undefined;
  }

  // Try to get timezone from custom header (if client sends it)
  const timezoneHeader = request.headers.get('x-timezone');
  if (timezoneHeader) {
    return timezoneHeader;
  }

  // Fallback: Try to infer from other headers (not reliable, but better than nothing)
  // Most reliable method is client-side detection sent via header
  return undefined;
}

/**
 * Main function: Get optimal Browserbase region for a user
 * 
 * Priority order:
 * 1. Explicit timezone from request headers
 * 2. System timezone (server-side fallback)
 * 3. Default to us-east-1
 * 
 * @param request - Optional Request object
 * @returns Optimal Browserbase region code
 */
export function getOptimalBrowserbaseRegion(request?: Request): BrowserbaseRegion {
  // Try to get timezone from request
  const timezone = getUserTimezoneFromRequest(request);
  
  if (timezone) {
    const region = getOptimalRegionFromTimezone(timezone);
    console.log(`🌍 Auto-selected region: ${region} (timezone: ${timezone})`);
    return region;
  }

  // Try to get system timezone as fallback
  try {
    const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (systemTimezone) {
      const region = getOptimalRegionFromTimezone(systemTimezone);
      console.log(`🌍 Auto-selected region: ${region} (system timezone: ${systemTimezone})`);
      return region;
    }
  } catch (error) {
    console.warn('⚠️ Failed to detect system timezone:', error);
  }

  // Ultimate fallback
  console.log('🌍 Using default region: us-east-1 (timezone detection failed)');
  return 'us-east-1';
}
