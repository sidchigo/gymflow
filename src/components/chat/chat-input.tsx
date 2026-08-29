"use client";

import { useState } from "react";
import { SendHorizontal } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const QUICK_CHIPS: readonly { label: string; icon: string }[] = [
  { label: "Replan Week", icon: "↺" },
  { label: "Log Lift", icon: "+" },
  { label: "Fever / Sick", icon: "!" },
  { label: "30m Crunch", icon: "⚡" },
  { label: "BJJ Swapped", icon: "↔" },
] as const;

export default function ChatInput({ onSendMessage, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleChipClick = (label: string) => {
    if (disabled) return;
    onSendMessage(label);
  };

  return (
    <div
      className="flex flex-col shrink-0 gap-3 px-4 pt-3 pb-5 pb-safe"
      style={{ borderTop: "1px solid rgba(63,63,70,0.4)" }}
    >
      {/* ─── Quick Action Chips ───────────────────────────────────────── */}
      <div className="flex w-full overflow-x-auto no-scrollbar gap-2">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(chip.label)}
            className="shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:text-zinc-100 active:scale-95 disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            style={{
              background: "#111520",
              border: "1px solid rgba(63,63,70,0.7)",
            }}
          >
            <span
              className="text-violet-400 text-[10px] font-mono leading-none"
              aria-hidden="true"
            >
              {chip.icon}
            </span>
            {chip.label}
          </button>
        ))}
      </div>

      {/* ─── Input + Send ────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
        <input
          id="coach-chat-input"
          type="text"
          disabled={disabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask coach or describe your situation..."
          className="flex-1 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none transition-all disabled:opacity-40"
          style={{
            background: "#111520",
            border: "1px solid rgba(63,63,70,0.7)",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "rgba(124,58,237,0.45)";
            (e.currentTarget as HTMLInputElement).style.boxShadow =
              "0 0 0 3px rgba(124,58,237,0.10)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "rgba(63,63,70,0.7)";
            (e.currentTarget as HTMLInputElement).style.boxShadow = "none";
          }}
        />

        {/* Circular send button */}
        <button
          type="submit"
          id="coach-send-btn"
          disabled={!input.trim() || disabled}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-all active:scale-90 disabled:opacity-30 outline-none"
          style={{
            background: input.trim()
              ? "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)"
              : "#111520",
            border: input.trim()
              ? "1px solid rgba(124,58,237,0.45)"
              : "1px solid rgba(63,63,70,0.6)",
            boxShadow: input.trim()
              ? "0 0 16px rgba(124,58,237,0.35), 0 0 6px rgba(124,58,237,0.18)"
              : "none",
          }}
        >
          <SendHorizontal size={15} strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
