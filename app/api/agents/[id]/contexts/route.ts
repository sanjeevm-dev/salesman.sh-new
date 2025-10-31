import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { connectDB, Agent, BrowserbaseContext } from '@/server/db';
import Browserbase from "@browserbasehq/sdk";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: agentId } = await params;

    await connectDB();

    // Verify agent ownership
    const agent = await Agent.findOne({ _id: agentId, userId: user.id });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Get all contexts for this agent
    const contexts = await BrowserbaseContext.find({
      userId: user.id,
      agentId: agentId,
      isActive: true,
    })
    .sort({ lastUsedAt: -1 })
    .lean()
    .exec();

    const formattedContexts = contexts.map(ctx => ({
      id: ctx._id.toString(),
      platform: ctx.platform,
      contextId: ctx.contextId,
      authenticationStatus: ctx.authenticationStatus,
      firstLoginAt: ctx.firstLoginAt,
      lastLoginAt: ctx.lastLoginAt,
      lastUsedAt: ctx.lastUsedAt,
      loginAttempts: ctx.loginAttempts,
      createdAt: ctx.createdAt,
      updatedAt: ctx.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      contexts: formattedContexts,
    });
  } catch (error) {
    console.error('Error fetching contexts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contexts' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: agentId } = await params;
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform');
    const contextId = searchParams.get('contextId');

    if (!platform && !contextId) {
      return NextResponse.json(
        { error: 'Either platform or contextId must be provided' },
        { status: 400 }
      );
    }

    await connectDB();

    // Verify agent ownership
    const agent = await Agent.findOne({ _id: agentId, userId: user.id });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Build query
    const query: Record<string, unknown> = {
      userId: user.id,
      agentId: agentId,
    };
    
    if (contextId) {
      query.contextId = contextId;
    } else if (platform) {
      query.platform = platform;
    }

    // Delete context from Browserbase if contextId is available
    if (contextId) {
      try {
        // Note: Browserbase SDK might not have delete method exposed, we'll use fetch instead
        await fetch(`https://api.browserbase.com/v1/contexts/${contextId}`, {
          method: 'DELETE',
          headers: {
            'X-BB-API-Key': process.env.BROWSERBASE_API_KEY!,
          },
        });
        console.log(`🗑️  Deleted context from Browserbase: ${contextId}`);
      } catch (error) {
        console.error('Failed to delete context from Browserbase:', error);
        // Continue with database deletion even if Browserbase deletion fails
      }
    }

    // Mark as inactive in database (soft delete)
    const result = await BrowserbaseContext.updateMany(
      query,
      {
        $set: {
          isActive: false,
          authenticationStatus: 'expired',
          updatedAt: new Date(),
        },
      }
    ).exec();

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.modifiedCount} context(s)`,
      deletedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error('Error deleting context:', error);
    return NextResponse.json(
      { error: 'Failed to delete context' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: agentId } = await params;
    const body = await request.json();
    const { platform, action } = body;

    if (!platform || !action) {
      return NextResponse.json(
        { error: 'platform and action are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Verify agent ownership
    const agent = await Agent.findOne({ _id: agentId, userId: user.id });
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (action === 'refresh') {
      // Invalidate existing context and create new one
      const existingContext = await BrowserbaseContext.findOne({
        userId: user.id,
        agentId: agentId,
        platform: platform,
        isActive: true,
      });

      if (existingContext) {
        // Delete from Browserbase
        try {
          await fetch(`https://api.browserbase.com/v1/contexts/${existingContext.contextId}`, {
            method: 'DELETE',
            headers: {
              'X-BB-API-Key': process.env.BROWSERBASE_API_KEY!,
            },
          });
          console.log(`🗑️  Deleted old context from Browserbase: ${existingContext.contextId}`);
        } catch (error) {
          console.error('Failed to delete context from Browserbase:', error);
        }

        // Mark as inactive
        await BrowserbaseContext.updateOne(
          { _id: existingContext._id },
          {
            $set: {
              isActive: false,
              authenticationStatus: 'expired',
              updatedAt: new Date(),
            },
          }
        );
      }

      // Create new context
      const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
      const newContext = await bb.contexts.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
      });

      // Save to database
      const contextDoc = await BrowserbaseContext.create({
        userId: user.id,
        agentId: agentId,
        platform: platform,
        contextId: newContext.id,
        authenticationStatus: 'pending',
        loginAttempts: 0,
        isActive: true,
      });

      return NextResponse.json({
        success: true,
        message: 'Context refreshed successfully',
        context: {
          id: contextDoc._id.toString(),
          platform: contextDoc.platform,
          contextId: contextDoc.contextId,
          authenticationStatus: contextDoc.authenticationStatus,
          createdAt: contextDoc.createdAt,
        },
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Supported actions: refresh' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error managing context:', error);
    return NextResponse.json(
      { error: 'Failed to manage context' },
      { status: 500 }
    );
  }
}
