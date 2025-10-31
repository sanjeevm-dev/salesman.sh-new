"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcwIcon } from "lucide-react";
import Tooltip from "./Tooltip";

interface BrowserSessionContainerProps {
  sessionUrl: string | null;
  isVisible: boolean;
  isCompleted: boolean;
  initialMessage: string | undefined;
  onRestart?: () => void;
}

const containerVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.98,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 30,
      mass: 1,
      delay: 0.2,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.98,
    transition: {
      duration: 0.3,
      ease: "easeInOut",
    },
  },
};

const leftCurtainVariants = {
  hidden: { x: "-100%" },
  visible: {
    x: "-100%",
    transition: {
      duration: 0,
    },
  },
  open: {
    x: "-100%",
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 20,
      delay: 0.2,
    },
  },
  close: {
    x: "0%",
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 20,
    },
  },
};

const rightCurtainVariants = {
  hidden: { x: "100%" },
  visible: {
    x: "100%",
    transition: {
      duration: 0,
    },
  },
  open: {
    x: "100%",
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 20,
      delay: 0.2,
    },
  },
  close: {
    x: "0%",
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 20,
    },
  },
};

const BrowserSessionContainer: React.FC<BrowserSessionContainerProps> = ({
  sessionUrl,
  isVisible,
  isCompleted,
  initialMessage,
  onRestart = () => {},
}) => {
  // Track the animation state of curtains
  const [curtainState, setCurtainState] = useState<
    "closed" | "opening" | "open" | "closing"
  >("closed");

  // Handle curtain animation based on session state
  useEffect(() => {
    if (isVisible) {
      if (!sessionUrl && !isCompleted) {
        // Session is starting, curtains closed initially
        setCurtainState("closed");
      } else if (sessionUrl && !isCompleted) {
        // Session URL is available, but wait 1 second before opening the curtains
        const openTimer = setTimeout(() => {
          setCurtainState("opening");
          // After animation delay, set to fully open
          const openCompleteTimer = setTimeout(
            () => setCurtainState("open"),
            800
          );
          return () => clearTimeout(openCompleteTimer);
        }, 1000); // Wait 1 second before starting to open

        return () => clearTimeout(openTimer);
      } else if (isCompleted) {
        // Session is completed, close the curtains
        setCurtainState("closing");
      }
    }
  }, [isVisible, sessionUrl, isCompleted]);

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          className="w-full flex flex-col md:justify-center"
          style={{ minHeight: "auto" }}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          key={isCompleted ? "completed" : "active"}
        >
          {/* Browser frame */}
          <div
            className="w-full h-[250px] md:h-[600px] flex items-center justify-center overflow-hidden border border-white/[0.08] shadow-2xl relative rounded-2xl"
            style={{
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(12px)",
            }}
          >
            {/* Left Curtain */}
            <motion.div
              className="absolute top-0 left-0 w-1/2 h-full z-10"
              style={{
                backgroundColor: "#000000",
              }}
              variants={leftCurtainVariants}
              initial="visible"
              animate={
                curtainState === "opening" || curtainState === "open"
                  ? "open"
                  : "close"
              }
            />

            {/* Right Curtain */}
            <motion.div
              className="absolute top-0 right-0 w-1/2 h-full z-10"
              style={{
                backgroundColor: "#000000",
              }}
              variants={rightCurtainVariants}
              initial="visible"
              animate={
                curtainState === "opening" || curtainState === "open"
                  ? "open"
                  : "close"
              }
            />
            {/* Browser Content */}
            {!isCompleted ? (
              sessionUrl ? (
                <iframe
                  key={sessionUrl}
                  src={sessionUrl}
                  className="w-full h-full border-none"
                  sandbox="allow-same-origin allow-scripts allow-forms"
                  allow="clipboard-read; clipboard-write"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  title="Browser Session"
                />
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center"
                  style={{ backgroundColor: "rgba(0, 0, 0, 0.4)" }}
                >
                  {/* Simple loading animation that will always show when session URL is not available */}
                  <div className="flex flex-col items-center space-y-6 w-full animate-in fade-in slide-in-from-bottom-5 duration-500">
                    <h2 className="text-2xl font-semibold text-white z-10 animate-in fade-in duration-700 delay-500">
                      Starting CUA Browser
                    </h2>
                    <div className="flex flex-col items-center space-y-4 w-full animate-in fade-in duration-700 delay-500">
                      <div className="mt-4 flex justify-center">
                        <div className="bg-white/[0.1] h-16 w-16 animate-pulse rounded"></div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : null}

            {/* Completion Message with AnimatePresence for fade in/out */}
            <AnimatePresence>
              {isCompleted && (
                <motion.div
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center p-3 md:p-8"
                  style={{
                    backdropFilter: "blur(8px)",
                    backgroundColor: "rgba(0, 0, 0, 0.3)",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="flex flex-col items-center space-y-3 md:space-y-6 w-full max-w-[95%] md:max-w-[80%] text-center bg-black/[0.8] border border-white/[0.08] p-6 rounded-2xl backdrop-blur-xl"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.6, delay: 0.2 }}
                  >
                    <motion.span
                      className="text-lg md:text-3xl font-semibold text-white"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                    >
                      Task completed
                    </motion.span>
                    <motion.span
                      className="text-sm md:text-xl italic text-white break-words max-h-[150px] md:max-h-none overflow-y-auto px-2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6 }}
                    >
                      &quot;{initialMessage}&quot;
                    </motion.span>

                    <motion.a
                      href="https://www.browserbase.com/sign-up"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 md:px-6 py-2 md:py-3 text-white text-base md:text-lg font-medium mt-4 md:mt-8 inline-block text-center"
                      style={{
                        background: "#F14A1C",
                        backdropFilter: "blur(12px)",
                        border: "1px solid rgba(255, 255, 255, 0.3)",
                      }}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.8 }}
                      whileHover={{
                        scale: 0.95,
                        background: "#F14A1C",
                      }}
                      whileTap={{ scale: 0.98 }}
                    >
                      Want to try Browserbase?
                    </motion.a>
                    <Tooltip content="Restart the browser session">
                      <motion.button
                        type="button"
                        onClick={onRestart}
                        className="flex gap-x-2 text-white px-2 py-1 items-center"
                      >
                        <RotateCcwIcon className="size-4" />
                        Restart
                      </motion.button>
                    </Tooltip>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BrowserSessionContainer;
