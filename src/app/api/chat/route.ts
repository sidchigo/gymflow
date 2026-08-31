import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { runCoachAgentStream } from "@/lib/agent-engine";
import { type LLMMessage } from "@/lib/llm-provider";
import { safeParseJSON } from "@/lib/json-utils";

export const maxDuration = 300;
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
      // Send 2KB padding of comment lines to bypass Vercel/Next.js/browser chunk buffering
      const padding = ":" + " ".repeat(2048) + "\n\n";
      controller.enqueue(encoder.encode(padding));

      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Timeout")), 180000);
      });

      let tokenCount = 0;
      try {
        const result = await Promise.race([
          runCoachAgentStream({
            userId,
            userMessage: message,
            chatHistory: history,
            controller,
            onToken: (token) => {
              tokenCount++;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "token", content: token })}\n\n`)
              );
            },
            onEvent: (event) => {
              if (event.type === "tool_start") {
                let msg = "Analyzing request...";
                if (event.name === "replan_week_schedule") {
                  let plan = event.args?.plan;
                  if (typeof plan === "string") {
                    try {
                      plan = safeParseJSON(plan);
                    } catch {
                      plan = undefined;
                    }
                  }
                  if (Array.isArray(plan) && plan.length > 0) {
                    const modalities = Array.from(
                      new Set(
                        plan
                          .map((p: any) => p?.modality)
                          .filter((m: any) => typeof m === "string" && m !== "REST" && m !== "MOBILITY_RECOVERY")
                      )
                    );
                    msg = modalities.length > 0
                      ? `Updating weekly schedule split (${modalities.join(", ")})...`
                      : "Syncing and updating weekly schedule split...";
                  } else {
                    msg = "Syncing and updating weekly schedule split...";
                  }
                } else if (event.name === "log_lift_performance") {
                  const exercise = event.args?.exerciseName || "workout";
                  const setsCount = (event.args?.sets as any[])?.length || 0;
                  msg = `Logging workout: ${exercise} (${setsCount} sets)...`;
                } else if (event.name === "log_athlete_event") {
                  const eventType = (event.args?.type as string) || "constraint";
                  msg = `Logging constraint event: ${eventType.toLowerCase()}...`;
                }
                const data = `data: ${JSON.stringify({ type: "status", message: msg })}\n\n`;
                controller.enqueue(encoder.encode(data));
              } else if (event.type === "tool_end") {
                const data = `data: ${JSON.stringify({ type: "status", message: "" })}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
            },
          }),
          timeoutPromise,
        ]) as any;

        // Safety fallback: if no tokens were streamed but result text exists
        if (result?.text && tokenCount === 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "token", content: result.text })}\n\n`)
          );
          tokenCount = 1;
        }

        console.log('[SSE_EMIT] Total tokens streamed:', tokenCount);
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
