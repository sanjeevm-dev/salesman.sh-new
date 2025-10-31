import { NextResponse } from 'next/server';
import Browserbase from '@browserbasehq/sdk';

const browserbase = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY!,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    // Get live view debug URLs from Browserbase
    const debugInfo = await browserbase.sessions.debug(sessionId);
    
    // Use debuggerFullscreenUrl for the live view (1024x768 viewport)
    const liveViewUrl = debugInfo.debuggerFullscreenUrl;

    return NextResponse.json({ 
      liveViewUrl,
      sessionId,
    });
  } catch (error) {
    console.error('Error fetching live view URL:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live view URL' },
      { status: 500 }
    );
  }
}
