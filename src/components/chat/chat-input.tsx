import { useState, useRef } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const QUICK_CHIPS = [
  "Feeling sick today",
  "Shift BJJ to evening",
  "Log: Squat 3x5 @ 85kg",
  "Short on time (30 mins)",
];

export default function ChatInput({ onSendMessage, disabled = false }: ChatInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleChipClick = (chipText: string) => {
    if (disabled) return;
    onSendMessage(chipText);
  };

  return (
    <div className="flex flex-col border-t border-zinc-900 bg-zinc-950 p-4">
      {/* Quick Action Chips */}
      <div className="flex w-full overflow-x-auto gap-2 pb-3 no-scrollbar">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(chip)}
            className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-850 active:scale-95 disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask coach / replan your week..."
          className="flex-1 rounded-lg border border-zinc-850 bg-zinc-900/50 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-550 outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || disabled}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 transition-all hover:bg-zinc-200 active:scale-95 disabled:opacity-30"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
