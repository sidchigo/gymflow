import { NextRequest, NextResponse } from "next/server";
import { handleTelegramIncomingMessage } from "@/lib/telegram-service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await handleTelegramIncomingMessage(body);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error("[TelegramWebhook] Error processing update:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to process update" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "online",
    service: "GymFlow Telegram Webhook",
    timestamp: new Date().toISOString(),
  });
}
