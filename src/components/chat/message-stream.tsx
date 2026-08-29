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
}

export default function MessageStream({ messages, executingTool }: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or updates
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, executingTool]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-4 no-scrollbar bg-zinc-950/30"
    >
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
          <span className="text-3xl">💬</span>
          <p className="mt-4 text-xs font-bold uppercase tracking-wider text-zinc-400">
            GymFlow Coach AI
          </p>
          <p className="mt-1 text-xs text-zinc-550 max-w-[220px]">
            Say hi to plan your week or ask for advice on progressive overload.
          </p>
        </div>
      )}

      {messages.map((msg) => {
        const isUser = msg.sender === "user";
        return (
          <div
            key={msg.id}
            className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-md ${
                isUser
                  ? "bg-zinc-100 text-zinc-950 font-semibold rounded-tr-none"
                  : "bg-zinc-900 border border-zinc-850 text-zinc-200 rounded-tl-none font-medium"
              }`}
            >
              {/* Message text with line break support */}
              <div className="whitespace-pre-wrap select-text">{msg.text}</div>

              {/* Tool Execution status within a message if applicable */}
              {msg.executingTool && (
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <ToolIndicator toolName={msg.executingTool} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Global active tool loader */}
      {executingTool && (
        <div className="flex w-full justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-tl-none bg-zinc-900 border border-zinc-850 px-4 py-3 shadow-md">
            <ToolIndicator toolName={executingTool} />
          </div>
        </div>
      )}
    </div>
  );
}
