import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { runCoachAgentStream } from "@/lib/agent-engine";
import { type LLMMessage } from "@/lib/llm-provider";

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Authenticate user
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { userId } = session;

  // 2. Parse request body
  let body: { message?: string; history?: LLMMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { message, history = [] } = body;
  if (!message) {
    return NextResponse.json({ error: "MESSAGE_REQUIRED" }, { status: 400 });
  }

  // 3. Set up streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Timeout")), 45000);
      });

      try {
        await Promise.race([
          runCoachAgentStream({
            userId,
            userMessage: message,
            chatHistory: history,
            onEvent: (event) => {
              if (event.type === "text" && event.text) {
                const data = `data: ${JSON.stringify({ type: "token", content: event.text })}\n\n`;
                controller.enqueue(encoder.encode(data));
              } else if (event.type === "tool_start") {
                let msg = "Analyzing request...";
                if (event.name === "replan_week_schedule") msg = "Syncing schedule...";
                else if (event.name === "log_lift_performance") msg = "Logging workout...";
                else if (event.name === "log_athlete_event") msg = "Saving event...";
                const data = `data: ${JSON.stringify({ type: "status", message: msg })}\n\n`;
                controller.enqueue(encoder.encode(data));
              } else if (event.type === "tool_end") {
                const data = `data: ${JSON.stringify({ type: "status", message: "" })}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
            },
          }),
          timeoutPromise,
        ]);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err: any) {
        console.error(`[api/chat] error in agent stream for userId=${userId}:`, err);
        
        let displayError = "An unexpected error occurred during execution.";
        const rawMessage = err?.message || "";
        
        if (err.message === "Timeout") {
          const timeoutEvent = `data: ${JSON.stringify({
            error: "Generation timed out. Please try a more specific request.",
            planUpdated: false,
          })}\n\n`;
          controller.enqueue(encoder.encode(timeoutEvent));
          return;
        }

        if (
          rawMessage.includes("RESOURCE_EXHAUSTED") || 
          rawMessage.includes("quota exceeded") || 
          rawMessage.includes("429")
        ) {
          displayError = "Rate limit or API quota exceeded. Please try again in a few moments.";
        } else {
          try {
            // Attempt to parse JSON error structure if returned as a string
            const parsed = JSON.parse(rawMessage);
            if (parsed?.error?.message) {
              displayError = parsed.error.message;
            } else if (parsed?.message) {
              displayError = parsed.message;
            }
          } catch {
            if (typeof rawMessage === "string" && rawMessage.trim()) {
              displayError = rawMessage;
            }
          }
        }

        const errEvent = `data: ${JSON.stringify({
          error: displayError,
        })}\n\n`;
        controller.enqueue(encoder.encode(errEvent));
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
