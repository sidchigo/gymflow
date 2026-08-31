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

  // Refs for smooth word-by-word streaming animation
  const targetTextRef = useRef("");
  const displayedTextRef = useRef("");
  const activeAgentMsgIdRef = useRef<string | null>(null);
  const isStreamActiveRef = useRef(false);

  // Easing buffer ticker
  useEffect(() => {
    const tick = () => {
      if (!activeAgentMsgIdRef.current) return;

      const target = targetTextRef.current;
      const current = displayedTextRef.current;

      if (current.length < target.length) {
        const remaining = target.slice(current.length);
        let nextChunk = "";
        const spaceIndex = remaining.indexOf(" ");
        if (spaceIndex !== -1) {
          nextChunk = remaining.substring(0, spaceIndex + 1);
        } else {
          nextChunk = remaining;
        }
        displayedTextRef.current += nextChunk;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === activeAgentMsgIdRef.current
              ? { ...m, text: displayedTextRef.current }
              : m
          )
        );
      } else if (!isStreamActiveRef.current) {
        // Stream finished and animation caught up
        setIsGenerating(false);
        setExecutingTool(null);
        activeAgentMsgIdRef.current = null;
      }
    };

    const intervalId = setInterval(tick, 15);
    return () => clearInterval(intervalId);
  }, []);

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 190000);

    // Initialize/Reset refs for the current message
    targetTextRef.current = "";
    displayedTextRef.current = "";
    activeAgentMsgIdRef.current = agentMsgId;
    isStreamActiveRef.current = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: historyPayload }),
        signal: controller.signal,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (!trimmed.startsWith("data: ")) continue;
          
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === "[DONE]") {
            break;
          }

          try {
            const event = JSON.parse(dataStr);
            if (event.error) {
              throw new Error(event.error);
            }
            if (event.type === "token" && event.content) {
              targetTextRef.current += event.content;
            } else if (event.type === "status") {
              setExecutingTool(event.message || null);
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes("timed out")) {
              throw e;
            }
            console.error("Failed to parse SSE token stream:", e);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Stream reader failed:", err);
      
      const isTimeoutOrAbort = 
        message.includes("timed out") || 
        message.includes("Timeout") ||
        message.includes("504") ||
        message.includes("500") ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError") ||
        message.toLowerCase().includes("abort");

      const displayMessage = isTimeoutOrAbort
        ? "Coach response timed out. Please tap 'Sync Gym Schedule' or try again."
        : `[Coach communication interrupted: ${message}]`;

      targetTextRef.current += (targetTextRef.current ? "\n\n" : "") + displayMessage;
    } finally {
      clearTimeout(timeoutId);
      isStreamActiveRef.current = false;
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
