"use client";

import { useState, useEffect, useRef } from "react";
import MessageStream, { type ChatMessage } from "@/components/chat/message-stream";
import ChatInput from "@/components/chat/chat-input";

interface CoachClientProps {
  initialPrompt?: string | undefined;
}

export default function CoachClient({ initialPrompt }: CoachClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [executingTool, setExecutingTool] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const initPromptRef = useRef(false);

  const handleSendMessage = async (text: string) => {
    setIsGenerating(true);
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

      if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.error) errMsg = errData.error;
        } catch {}
        throw new Error(errMsg);
      }

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
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (initialPrompt && !initPromptRef.current) {
      initPromptRef.current = true;
      handleSendMessage(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 pt-4 pb-16 lg:py-6">
      <div className="animate-fade-in flex-1 flex flex-col min-h-[calc(100vh-12rem)] overflow-hidden">
        <MessageStream messages={messages} executingTool={executingTool} isGenerating={isGenerating} />
        <ChatInput onSendMessage={handleSendMessage} disabled={isGenerating || !!executingTool} />
      </div>
    </div>
  );
}
