import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { runCoachAgentStream } from "@/lib/agent-engine";
import { type LLMMessage } from "@/lib/llm-provider";

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
      try {
        await runCoachAgentStream({
          userId,
          userMessage: message,
          chatHistory: history,
          onEvent: (event) => {
            const data = JSON.stringify(event) + "\n";
            controller.enqueue(encoder.encode(data));
          },
        });
      } catch (err: any) {
        console.error(`[api/chat] error in agent stream for userId=${userId}:`, err);
        const errEvent = JSON.stringify({
          type: "text",
          text: `\n\n[Coach System Error: ${err.message || "An unexpected error occurred during execution."}]`,
        }) + "\n";
        controller.enqueue(encoder.encode(errEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
