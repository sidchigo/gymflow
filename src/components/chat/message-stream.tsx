"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
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
}

export default function MessageStream({ messages, executingTool }: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, executingTool]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto no-scrollbar px-4 py-5 space-y-3"
    >
      {/* ─── Empty state ───────────────────────────────────────────────── */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(124,58,237,0.10)",
              border: "1px solid rgba(124,58,237,0.22)",
              boxShadow: "0 0 20px rgba(124,58,237,0.12)",
            }}
          >
            <Sparkles
              size={22}
              strokeWidth={1.5}
              className="text-violet-400"
              style={{ filter: "drop-shadow(0 0 6px rgba(124,58,237,0.5))" }}
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-bold text-zinc-300">GymFlow Coach AI</p>
            <p className="text-xs text-zinc-600 max-w-[200px] leading-relaxed">
              Ask about progressive overload, replanning, or any training context.
            </p>
          </div>
        </div>
      )}

      {/* ─── Message bubbles ───────────────────────────────────────────── */}
      {messages.map((msg) => {
        const isUser = msg.sender === "user";
        return (
          <div
            key={msg.id}
            className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={[
                "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                isUser ? "rounded-tr-sm" : "rounded-tl-sm",
              ].join(" ")}
              style={
                isUser
                  ? {
                      // User: high-contrast white bubble
                      background:
                        "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
                      color: "#0f172a",
                      fontWeight: 600,
                      boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
                    }
                  : {
                      // Coach: dark card with subtle green tint
                      background:
                        "linear-gradient(135deg, #141a28 0%, #111520 100%)",
                      border: "1px solid rgba(63,63,70,0.6)",
                      color: "#cbd5e1",
                      fontWeight: 500,
                      boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
                    }
              }
            >
              <div className="whitespace-pre-wrap select-text">{msg.text}</div>

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
            className="max-w-[82%] rounded-2xl rounded-tl-sm px-4 py-3"
            style={{
              background: "linear-gradient(135deg, #141a28 0%, #111520 100%)",
              border: "1px solid rgba(63,63,70,0.6)",
            }}
          >
            <ToolIndicator toolName={executingTool} />
          </div>
        </div>
      )}
    </div>
  );
}
