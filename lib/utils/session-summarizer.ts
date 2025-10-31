import OpenAI from 'openai';
import SessionLog from '@/lib/models/SessionLog';
import mongoose from 'mongoose';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const LOW_LEVEL_ACTIONS = [
  'screenshot',
  'click',
  'page_load',
  'wait',
  'scroll',
  'mouse_move',
  'cursor_position'
];

interface FilteredStep {
  stepNumber: number;
  tool: string;
  instruction: string;
  reasoning?: string;
  output?: string;
}

export async function generateSessionOutcome(sessionId: mongoose.Types.ObjectId): Promise<string> {
  try {
    console.log(`📊 Generating session outcome for session: ${sessionId}`);

    const sessionLogs = await SessionLog.find({ sessionId })
      .sort({ stepNumber: 1 })
      .lean()
      .exec();

    if (!sessionLogs || sessionLogs.length === 0) {
      console.log(`⚠️  No session logs found for session ${sessionId}`);
      return 'No actions were performed in this session.';
    }

    console.log(`   Found ${sessionLogs.length} total steps in session`);

    const filteredSteps: FilteredStep[] = sessionLogs
      .filter(log => {
        const tool = log.tool?.toLowerCase() || '';
        const instruction = log.instruction?.toLowerCase() || '';
        const isLowLevel = LOW_LEVEL_ACTIONS.some(lowLevel => 
          tool.includes(lowLevel) || instruction.includes(lowLevel)
        );
        return !isLowLevel && (log.reasoning || log.output);
      })
      .map(log => ({
        stepNumber: log.stepNumber,
        tool: log.tool || 'unknown',
        instruction: log.instruction || 'unknown',
        reasoning: log.reasoning || undefined,
        output: log.output ? JSON.stringify(log.output) : undefined,
      }));

    console.log(`   Filtered down to ${filteredSteps.length} meaningful steps (removed ${sessionLogs.length - filteredSteps.length} low-level actions)`);

    if (filteredSteps.length === 0) {
      return 'Session completed with only low-level browser actions (clicks, screenshots, page loads). No significant outcomes detected.';
    }

    const stepsContext = filteredSteps.map((step) => {
      let stepText = `Step ${step.stepNumber}: ${step.tool} - ${step.instruction}`;
      if (step.reasoning) {
        stepText += `\n  Reasoning: ${step.reasoning}`;
      }
      if (step.output) {
        stepText += `\n  Output: ${step.output}`;
      }
      return stepText;
    }).join('\n\n');

    const prompt = `You are analyzing an autonomous AI agent session that automated tasks using a browser.

Your goal is to create a concise summary of what the agent actually accomplished in real-world terms.

Focus on:
- Concrete outcomes (e.g., "Published 3 LinkedIn posts", "Connected with 10 people", "Sent 4 follow-up messages")
- Data collected or extracted (e.g., "Scraped 25 contact emails", "Exported company information")
- Tasks completed or attempted
- Any errors or incomplete actions

Ignore:
- Low-level browser actions (clicks, screenshots, page loads) - these have already been filtered out
- Navigation steps unless they're relevant to the outcome
- Technical implementation details

Here are the meaningful steps from this session:

${stepsContext}

Provide a clear, concise summary (2-4 sentences) of what this agent session accomplished. Use concrete numbers and outcomes. If the session failed or was incomplete, mention what was completed before the failure.

Summary:`;

    console.log(`   Sending ${filteredSteps.length} steps to GPT-4 for summarization...`);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'You are an AI that summarizes autonomous agent sessions into concise, outcome-focused summaries. Focus on real-world accomplishments, not technical actions.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const outcome = completion.choices[0]?.message?.content?.trim() || 'Unable to generate session summary.';
    
    console.log(`   ✅ Session outcome generated: "${outcome.substring(0, 100)}..."`);
    
    return outcome;

  } catch (error) {
    console.error('❌ Error generating session outcome:', error);
    return 'Error generating session summary. Session logs are available for review.';
  }
}
