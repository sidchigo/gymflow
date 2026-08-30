"use client";

import { ChevronDown, X } from "lucide-react";
import MessageStream, { type ChatMessage } from "./message-stream";
import ChatInput from "./chat-input";

// ─── Shared prop types ────────────────────────────────────────────────────────

interface CoachPanelProps {
  messages: ChatMessage[];
  executingTool: string | null;
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  isGenerating?: boolean;
}

interface CoachSheetProps extends CoachPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

// ─── Desktop Sidebar Panel ────────────────────────────────────────────────────

export function CoachSidebarPanel({
  messages,
  executingTool,
  onSendMessage,
  disabled = false,
  isGenerating = false,
}: CoachPanelProps) {
  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] overflow-hidden">
      {/* ─── Scrollable Messages ─────────────────────────────────────── */}
      <MessageStream messages={messages} executingTool={executingTool} isGenerating={isGenerating} />

      {/* ─── Sticky Input ────────────────────────────────────────────── */}
      <ChatInput onSendMessage={onSendMessage} disabled={disabled} />
    </div>
  );
}

// ─── Mobile Bottom Sheet ──────────────────────────────────────────────────────

export default function CoachSheet({
  isOpen,
  onClose,
  messages,
  executingTool,
  onSendMessage,
  disabled = false,
  isGenerating = false,
}: Omit<CoachSheetProps, "onOpen">) {
  return (
    <>

      {/* ─── Backdrop ────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={[
          "fixed inset-0 z-40 transition-opacity duration-300",
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      />

      {/* ─── Slide-Up Drawer ─────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI Coach"
        onClick={(e) => e.stopPropagation()}
        className={[
          "fixed bottom-0 left-0 right-0 z-50 flex flex-col",
          "max-w-lg mx-auto",
          "rounded-t-[28px]",
          "h-[82dvh]",
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-y-0" : "translate-y-full",
        ].join(" ")}
        style={{
          background: "linear-gradient(180deg, #0f1420 0%, #0c0f17 100%)",
          borderTop: "1px solid rgba(124,58,237,0.14)",
          borderLeft: "1px solid rgba(63,63,70,0.4)",
          borderRight: "1px solid rgba(63,63,70,0.4)",
          boxShadow: "0 -8px 48px rgba(0,0,0,0.7), 0 0 40px rgba(124,58,237,0.05)",
        }}
      >
        {/* Pull handle */}
        <div className="flex justify-center pt-3.5 pb-1 shrink-0">
          <div
            className="h-1 w-10 rounded-full"
            style={{ background: "rgba(124,58,237,0.28)" }}
          />
        </div>

        {/* Sheet header */}
        <div
          className="flex h-12 shrink-0 items-center justify-between px-4"
          style={{ borderBottom: "1px solid rgba(63,63,70,0.4)" }}
        >
          <button
            id="coach-sheet-minimize-btn"
            onClick={onClose}
            aria-label="Minimize coach"
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <ChevronDown size={14} strokeWidth={2.5} />
            Minimize
          </button>

          <span className="text-sm font-bold text-zinc-300 select-none">
            {/* Mockup matching empty center title */}
          </span>

          <button
            id="coach-sheet-close-btn"
            onClick={onClose}
            aria-label="Close coach"
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
            style={{ background: "rgba(63,63,70,0.6)" }}
          >
            <X size={13} strokeWidth={2.5} className="text-zinc-400" />
          </button>
        </div>

        {/* Messages */}
        <MessageStream messages={messages} executingTool={executingTool} isGenerating={isGenerating} />

        {/* Input */}
        <ChatInput onSendMessage={onSendMessage} disabled={disabled} />
      </div>
    </>
  );
}
