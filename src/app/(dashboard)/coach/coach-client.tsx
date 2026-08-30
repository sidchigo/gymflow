"use client";

import { useState } from "react";
import MessageStream, { type ChatMessage } from "@/components/chat/message-stream";
import ChatInput from "@/components/chat/chat-input";

export default function CoachClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [executingTool, setExecutingTool] = useState<string | null>(null);

  const handleSendMessage = async (text: string) => {
    const userMsgId = Math.random().toString();
    setMessages((prev) => [...prev, { id: userMsgId, sender: "user", text }]);

    const agentMsgId = Math.random().toString();
    setMessages((prev) => [...prev, { id: agentMsgId, sender: "coach", text: "" }]);

    const historyPayload = messages.map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.text }],
    }));

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyPayload }),
      });

      if (!response.body) throw new Error("No response stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "text" && event.text) {
              accumulatedText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, text: accumulatedText } : m
                )
              );
            } else if (event.type === "tool_start") {
              setExecutingTool(event.name);
            } else if (event.type === "tool_end") {
              setExecutingTool(null);
            }
          } catch (e) {
            console.error("Failed to parse NDJSON token stream:", e);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Stream reader failed:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, text: m.text + `\n\n[Coach communication interrupted: ${message}]` }
            : m
        )
      );
    } finally {
      setExecutingTool(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 pt-4 pb-28 lg:py-6">
      <div className="animate-fade-in flex-1 flex flex-col min-h-[calc(100vh-12rem)] rounded-3xl overflow-hidden bg-zinc-950/20 border border-zinc-800/30 backdrop-blur-md">
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-zinc-800/40">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] tracking-widest text-zinc-500 uppercase">Coach Chat</span>
            <span className="text-sm font-bold text-zinc-200">S&amp;C Intelligence</span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-violet-300 bg-violet-950/20 border border-violet-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
            ONLINE
          </span>
        </div>
        <MessageStream messages={messages} executingTool={executingTool} />
        <ChatInput onSendMessage={handleSendMessage} disabled={!!executingTool} />
      </div>
    </div>
  );
}
