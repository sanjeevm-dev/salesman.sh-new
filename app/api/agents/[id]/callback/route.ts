import { NextRequest, NextResponse } from "next/server";
import AgentSession from "@/lib/models/AgentSession";
import AgentModel from "@/lib/models/Agent";
import SessionLog from "@/lib/models/SessionLog";
import { sessionStateManager } from "@/app/api/cua/agent/session_state";
import { connectDB } from "@/lib/mongodb";
import { generateSessionOutcome } from "@/lib/utils/session-summarizer";
import mongoose from "mongoose";

const MICROSERVICE_SECRET = process.env.MICROSERVICE_CALLBACK_SECRET || "dev-secret-change-in-prod";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = req.headers.get("x-microservice-secret");
    if (authHeader !== MICROSERVICE_SECRET) {
      console.error("❌ Invalid microservice secret in callback");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const params = await context.params;
    const agentId = params.id;

    const body = await req.json();
    const { type, sessionId, status, error } = body;

    console.log(`📞 Callback received for agent ${agentId}, session ${sessionId}, type: ${type || status}`);

    const session = await AgentSession.findById(sessionId);
    if (!session) {
      console.error(`❌ Session ${sessionId} not found`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.agentId.toString() !== agentId) {
      console.error(`❌ Session ${sessionId} agentId mismatch: expected ${agentId}, got ${session.agentId}`);
      return NextResponse.json({ error: "Agent ID mismatch" }, { status: 400 });
    }

    // Handle step-level callbacks from microservice
    if (type === "step") {
      const { stepNumber, tool, instruction, reasoning, output, screenshotUrl } = body;
      
      console.log(`📝 Creating SessionLog for step ${stepNumber}: ${tool}`);
      
      try {
        await SessionLog.create({
          userId: session.userId,
          sessionId: sessionId,
          stepNumber,
          tool,
          instruction,
          reasoning: reasoning || null,
          output: output || null,
          screenshotUrl: screenshotUrl || null,
        });
        
        console.log(`✅ SessionLog created for step ${stepNumber}`);
        return NextResponse.json({ success: true });
      } catch (error) {
        console.error(`❌ Failed to create SessionLog for step ${stepNumber}:`, error);
        return NextResponse.json(
          { error: "Failed to create session log" },
          { status: 500 }
        );
      }
    }

    // Handle completion/failure callbacks
    if (status === "completed") {
      await AgentSession.findByIdAndUpdate(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });

      // Generate AI-powered session outcome summary
      try {
        const sessionOutcome = await generateSessionOutcome(new mongoose.Types.ObjectId(sessionId));
        await AgentSession.findByIdAndUpdate(sessionId, { sessionOutcome });
        console.log(`✅ Session outcome generated for microservice completion`);
      } catch (outcomeError) {
        console.error('⚠️ Failed to generate session outcome:', outcomeError);
        // Don't fail the entire callback if outcome generation fails
      }

      const agent = await AgentModel.findById(agentId);
      if (agent) {
        await AgentModel.findByIdAndUpdate(agentId, {
          isDeployed: false,
        });
      }

      sessionStateManager.clearSession(sessionId);
      console.log(`✅ Session ${sessionId} completed and cleaned up`);

    } else if (status === "failed") {
      await AgentSession.findByIdAndUpdate(sessionId, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: error || "Execution failed",
      });

      // Generate AI-powered session outcome summary (even for failed sessions to capture partial progress)
      try {
        const sessionOutcome = await generateSessionOutcome(new mongoose.Types.ObjectId(sessionId));
        await AgentSession.findByIdAndUpdate(sessionId, { sessionOutcome });
        console.log(`✅ Session outcome generated for microservice failure (captures partial progress)`);
      } catch (outcomeError) {
        console.error('⚠️ Failed to generate session outcome:', outcomeError);
        // Don't fail the entire callback if outcome generation fails
      }

      const agent = await AgentModel.findById(agentId);
      if (agent) {
        await AgentModel.findByIdAndUpdate(agentId, {
          isDeployed: false,
        });
      }

      sessionStateManager.clearSession(sessionId);
      console.log(`❌ Session ${sessionId} failed and cleaned up`);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("Error in callback handler:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
