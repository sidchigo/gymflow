"use client";

import { useEffect, useRef } from "react";
import ToolIndicator from "./tool-indicator";

export interface ChatMessage {
  id: string;
  sender: "user" | "coach";
  text: string;
  executingTool?: string | null;
}

interface MessageStreamProps {
  messages: ChatMessage[];
  executingTool?: string | null;
  isGenerating?: boolean;
}

function parseMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, lineIndex) => {
    const isBullet = line.trim().startsWith("* ") || line.trim().startsWith("- ");
    let content = line;
    if (isBullet) {
      content = line.replace(/^\s*[\*\-]\s+/, "");
    }

    const elements: React.ReactNode[] = [];
    const inlinePattern = /(\*\*.*?\*\*|\*.*?\*)/g;
    const parts = content.split(inlinePattern);

    parts.forEach((part, partIndex) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const boldText = part.slice(2, -2);
        elements.push(
          <strong key={`${lineIndex}-${partIndex}`} className="font-bold text-violet-300">
            {boldText}
          </strong>
        );
      } else if (part.startsWith("*") && part.endsWith("*")) {
        const italicText = part.slice(1, -1);
        elements.push(
          <em key={`${lineIndex}-${partIndex}`} className="italic text-zinc-400">
            {italicText}
          </em>
        );
      } else {
        elements.push(part);
      }
    });

    if (isBullet) {
      return (
        <li key={lineIndex} className="list-disc ml-4 mt-0.5 text-zinc-300">
          {elements}
        </li>
      );
    }

    return (
      <p key={lineIndex} className="min-h-[0.875rem] text-zinc-200 mt-1 first:mt-0">
        {elements}
      </p>
    );
  });
}

const TypingIndicator = () => (
  <div className="flex items-center gap-1.5 py-1.5 px-1 select-none">
    <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "0ms" }} />
    <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "150ms" }} />
    <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: "300ms" }} />
  </div>
);

export default function MessageStream({ messages, executingTool, isGenerating = false }: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, executingTool]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto no-scrollbar px-4 pt-5 pb-32 space-y-3"
    >
      {/* ─── Message bubbles ───────────────────────────────────────────── */}
      {messages.map((msg, idx) => {
        const isUser = msg.sender === "user";
        const isLast = idx === messages.length - 1;
        return (
          <div
            key={msg.id}
            className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={[
                "max-w-[82%] rounded-2xl px-4 py-3 text-[11.5px] leading-relaxed",
                isUser ? "rounded-tr-sm" : "rounded-tl-sm",
              ].join(" ")}
              style={
                isUser
                  ? {
                      // User: high-contrast dark capsule matching mockup
                      background: "#0d0d0e",
                      color: "#ffffff",
                      fontWeight: 500,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    }
                  : {
                      // Coach: dark warm violet accent bubble
                      background: "linear-gradient(135deg, #120b22 0%, #0c0817 100%)",
                      border: "1px solid rgba(139, 92, 246, 0.15)",
                      color: "#e2e8f0",
                      fontWeight: 500,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                    }
              }
            >
              {msg.text ? (
                <div className="select-text space-y-1">{parseMarkdown(msg.text)}</div>
              ) : isGenerating && isLast ? (
                <TypingIndicator />
              ) : (
                <div className="select-text text-zinc-400 italic">
                  I have updated and synchronized your weekly schedule.
                </div>
              )}

              {msg.executingTool && (
                <div
                  className="mt-2 pt-2"
                  style={{ borderTop: "1px solid rgba(63,63,70,0.5)" }}
                >
                  <ToolIndicator toolName={msg.executingTool} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* ─── Active tool loader bubble ─────────────────────────────────── */}
      {executingTool && (
        <div className="flex w-full justify-start">
          <div
            className="max-w-[82%] rounded-2xl rounded-tl-sm px-4 py-3 text-[11.5px]"
            style={{
              background: "linear-gradient(135deg, #120b22 0%, #0c0817 100%)",
              border: "1px solid rgba(139, 92, 246, 0.15)",
            }}
          >
            <ToolIndicator toolName={executingTool} />
          </div>
        </div>
      )}
    </div>
  );
}
