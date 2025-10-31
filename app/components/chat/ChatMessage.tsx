"use client";

import { motion } from "framer-motion";
import { BrowserStep } from "../ChatFeed";

interface ChatMessageProps {
  step: BrowserStep;
  index: number;
  steps: BrowserStep[];
}

const messageVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

export default function ChatMessage({ step, index, steps }: ChatMessageProps) {
  const isSystemMessage =
    step.tool === "MESSAGE" && step.reasoning === "Processing message";
  const isUserInput =
    step.tool === "MESSAGE" && step.reasoning === "User input";

  return (
    <motion.div
      variants={messageVariants}
      className={`p-3 md:p-4 rounded-lg md:rounded-xl ${
        isUserInput
          ? "bg-black/[0.5] backdrop-blur-xl"
          : isSystemMessage
          ? "bg-blue-600/20 backdrop-blur-xl text-white"
          : "bg-black/[0.3] backdrop-blur-xl"
      } border border-white/[0.08] font-ppsupply space-y-2`}
    >
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <span
          className={`text-sm md:text-base font-semibold ${
            isSystemMessage ? "text-white/90" : "text-white/80"
          }`}
        >
          Step {step.stepNumber}
        </span>
        <span
          className={`px-3 py-1.5 ${
            isSystemMessage ? "text-white/90 bg-blue-500/20" : "text-white/80 bg-white/[0.08]"
          } border border-white/[0.15] text-xs md:text-sm font-bold rounded uppercase tracking-wide whitespace-nowrap`}
        >
          {step.tool}
        </span>
      </div>
      
      <div className="space-y-3">
        {/* Main Action Text */}
        <div className="text-sm md:text-base text-white/90 leading-relaxed break-words">
          {isSystemMessage && step.tool === "MESSAGE" ? (
            <>
              {(() => {
                if (step.text.includes("?")) {
                  const sentences = step.text.match(/[^.!?]+[.!?]+/g) || [
                    step.text,
                  ];

                  const questions = sentences.filter((s) => s.trim().endsWith("?"));
                  const nonQuestions = sentences.filter(
                    (s) => !s.trim().endsWith("?")
                  );

                  const answerText = nonQuestions.join(" ").trim();
                  const questionText = questions.join(" ").trim();

                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const isOnlyQuestion = step.text.trim() === questionText;

                  let displayAnswerText = answerText;

                  if (!displayAnswerText && questionText) {
                    if (step.text.includes("ANSWER:")) {
                      const answerParts = step.text.split("ANSWER:");
                      if (answerParts.length > 1) {
                        let extractedAnswer = answerParts[1].trim();
                        if (extractedAnswer.includes("QUESTION")) {
                          extractedAnswer = extractedAnswer
                            .split("QUESTION")[0]
                            .trim();
                        }
                        if (extractedAnswer) {
                          displayAnswerText = extractedAnswer;
                        }
                      }
                    }

                    if (!displayAnswerText) {
                      const previousSteps = steps.slice(0, index);

                      const firstMessageStep = previousSteps.find(
                        (s) =>
                          s.tool === "MESSAGE" &&
                          s.reasoning === "Processing message" &&
                          !s.text.includes("?")
                      );

                      if (firstMessageStep) {
                        displayAnswerText = firstMessageStep.text;
                      } else {
                        displayAnswerText =
                          "I've found the information you requested.";
                      }
                    }
                  }

                  if (displayAnswerText && questionText) {
                    return <span className="break-words">{displayAnswerText}</span>;
                  } else if (questionText && !displayAnswerText) {
                    return null;
                  } else {
                    return <span className="break-words">{step.text}</span>;
                  }
                } else {
                  return <span className="break-words">{step.text}</span>;
                }
              })()}
            </>
          ) : (
            <span className="break-words">{step.text}</span>
          )}
        </div>

        {/* Reasoning Section */}
        {step.reasoning && (!isSystemMessage || index < steps.length - 1) && (
          <div className="text-xs md:text-sm text-white/70 leading-relaxed break-words">
            <span className="font-bold text-white/80">Reasoning: </span>
            {step.reasoning}
          </div>
        )}
      </div>
    </motion.div>
  );
}
