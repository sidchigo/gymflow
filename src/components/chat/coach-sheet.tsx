import { X, MessageSquare, ChevronDown } from "lucide-react";
import MessageStream, { type ChatMessage } from "./message-stream";
import ChatInput from "./chat-input";

interface CoachSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  messages: ChatMessage[];
  executingTool: string | null;
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

export default function CoachSheet({
  isOpen,
  onClose,
  onOpen,
  messages,
  executingTool,
  onSendMessage,
  disabled = false,
}: CoachSheetProps) {
  return (
    <>
      {/* Floating Bottom Bar (Trigger) */}
      <div className="fixed bottom-0 left-0 right-0 z-20 flex h-16 items-center justify-center border-t border-zinc-900 bg-black/80 px-4 backdrop-blur-md lg:hidden">
        <button
          onClick={onOpen}
          className="flex w-full max-w-md items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-bold text-white shadow-lg shadow-indigo-600/20 active:scale-98"
        >
          <MessageSquare size={16} />
          <span>Ask Coach / Replan</span>
        </button>
      </div>

      {/* Slide-up sheet container */}
      <div
        className={`fixed inset-0 z-40 flex flex-col bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      >
        <div
          className={`absolute bottom-0 left-0 right-0 flex h-[82vh] flex-col rounded-t-3xl border-t border-zinc-850 bg-zinc-950 shadow-2xl transition-transform duration-300 ${
            isOpen ? "translate-y-0" : "translate-y-full"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle bar */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-900/60 px-4">
            <button
              onClick={onClose}
              className="flex items-center gap-1 text-xs font-semibold text-zinc-450 hover:text-zinc-200"
            >
              <ChevronDown size={14} />
              <span>Minimize</span>
            </button>
            <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-350">
              Coach AI
            </span>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 hover:bg-zinc-850"
            >
              <X size={14} className="text-zinc-400" />
            </button>
          </div>

          {/* Messages */}
          <MessageStream messages={messages} executingTool={executingTool} />

          {/* Input */}
          <ChatInput onSendMessage={onSendMessage} disabled={disabled} />
        </div>
      </div>

      {/* Desktop progressive enhancement (Sidebar) */}
      <div className="hidden lg:flex lg:w-96 lg:shrink-0 lg:flex-col lg:border-l lg:border-zinc-900 lg:bg-zinc-950">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-900 px-6 bg-black">
          <span className="text-sm font-extrabold uppercase tracking-wider text-zinc-300">
            GymFlow Coach AI
          </span>
        </div>
        <MessageStream messages={messages} executingTool={executingTool} />
        <ChatInput onSendMessage={onSendMessage} disabled={disabled} />
      </div>
    </>
  );
}
