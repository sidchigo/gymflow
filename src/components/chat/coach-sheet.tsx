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
}: CoachPanelProps) {
  return (
    <div
      className="flex flex-col h-[calc(100dvh-3rem)] rounded-3xl overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #0f1420 0%, #0c0f17 60%, #0a0d14 100%)",
        border: "1px solid rgba(63,63,70,0.5)",
        boxShadow:
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 64px rgba(0,0,0,0.6)",
      }}
    >
      {/* ─── Panel Header ────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center justify-between px-5 py-4"
        style={{ borderBottom: "1px solid rgba(63,63,70,0.4)" }}
      >
        <div className="flex flex-col gap-0.5">
          {/* Section label: mono accent */}
          <span className="font-mono text-[10px] tracking-widest text-zinc-600 uppercase">
            Coach Copilot
          </span>
          {/* Title: display font */}
          <span className="text-sm font-bold text-zinc-200 leading-tight">
            S&amp;C &amp; Combat Intelligence
          </span>
        </div>

        {/* Glowing ACTIVE status pill */}
        <span
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold text-violet-300"
          style={{
            background: "rgba(124,58,237,0.12)",
            border: "1px solid rgba(124,58,237,0.32)",
            boxShadow:
              "0 0 12px rgba(124,58,237,0.28), 0 0 4px rgba(124,58,237,0.16)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse"
            style={{ boxShadow: "0 0 6px rgba(167,139,250,0.8)" }}
          />
          ACTIVE
        </span>
      </div>

      {/* ─── Scrollable Messages ─────────────────────────────────────── */}
      <MessageStream messages={messages} executingTool={executingTool} />

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

          {/* Title: display font not mono */}
          <span className="text-sm font-bold text-zinc-300 select-none">
            Coach AI
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
        <MessageStream messages={messages} executingTool={executingTool} />

        {/* Input */}
        <ChatInput onSendMessage={onSendMessage} disabled={disabled} />
      </div>
    </>
  );
}
