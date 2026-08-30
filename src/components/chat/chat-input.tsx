"use client";

import { useState } from "react";
import { SendHorizontal } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const QUICK_CHIPS: readonly { label: string }[] = [
  { label: "Sync Gym Schedule" },
  { label: "Log Lift Performance" },
  { label: "Time Crunch (30m)" },
  { label: "Report Illness / Rest" },
  { label: "Pre-Sparring Fuel" },
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || disabled) return;
      onSendMessage(trimmed);
      setInput("");
      e.currentTarget.style.height = "auto";
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
  };

  const handleChipClick = (label: string) => {
    if (disabled) return;
    onSendMessage(label);
  };

  return (
    <div
      className="flex flex-col shrink-0 gap-3 px-4 pt-3 pb-0 pb-safe"
    >
      {/* ─── Quick Action Chips ───────────────────────────────────────── */}
      <div className="flex w-full overflow-x-auto no-scrollbar gap-2">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(chip.label)}
            className="shrink-0 flex items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:text-zinc-100 active:scale-95 disabled:opacity-40 outline-none backdrop-blur-md bg-zinc-950/40 border border-zinc-800/30"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* ─── Input + Send ────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2.5">
        <div className="relative flex-1 flex items-center bg-white/5 backdrop-blur-md border border-zinc-800/40 rounded-[24px] overflow-hidden">
          <textarea
            id="coach-chat-input"
            disabled={disabled}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Type here"
            rows={1}
            className="flex-1 bg-transparent px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none resize-none no-scrollbar max-h-[240px] leading-relaxed align-middle"
          />
        </div>

        {/* Circular send button */}
        <button
          type="submit"
          id="coach-send-btn"
          disabled={disabled || !input.trim()}
          aria-label="Send message"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white bg-zinc-900/60 border border-zinc-800/80 transition-all active:scale-90 outline-none disabled:opacity-40"
        >
          <SendHorizontal size={16} className="text-white" strokeWidth={2.5} />
        </button>
      </form>
    </div>
  );
}
