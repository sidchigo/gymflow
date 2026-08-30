import {
  type LLMMessage,
  type LLMToolDefinition,
  type LLMResponse,
  type LLMProvider,
} from "../llm-provider";

export class OpenCodeZenProvider implements LLMProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options?: { apiKey?: string; baseUrl?: string; defaultModel?: string }) {
    this.apiKey =
      options?.apiKey ||
      process.env.LLM_API_KEY ||
      process.env.OPENCODE_API_KEY ||
      "";
    this.baseUrl =
      options?.baseUrl ||
      process.env.LLM_BASE_URL ||
      process.env.OPENCODE_BASE_URL ||
      "https://opencode.ai/zen/v1";
    this.defaultModel =
      options?.defaultModel ||
      process.env.LLM_MODEL ||
      "opencode-zen-1";
  }

  async generateCompletion(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    model?: string;
  }): Promise<LLMResponse> {
    const modelName = params.model || this.defaultModel;

    // Map Gemini LLMMessage[] format to OpenAI Chat Completions Messages
    const callIdMap = new Map<string, string>();
    const openAIMessages: any[] = [];

    for (let i = 0; i < params.messages.length; i++) {
      const m = params.messages[i];
      if (!m) continue;

      // Extract function responses first (since host engine might append them under "user" role)
      const funcParts = m.parts.filter((p) => p.functionResponse);
      if (funcParts.length > 0) {
        for (const p of funcParts) {
          if (p.functionResponse) {
            const fr = p.functionResponse;
            const callId = callIdMap.get(fr.name) || `call_fallback_${fr.name}`;
            openAIMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: JSON.stringify(fr.response),
            });
          }
        }
        continue;
      }

      if (m.role === "system") {
        const text = m.parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "system", content: text });
      } else if (m.role === "user") {
        const text = m.parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "user", content: text });
      } else if (m.role === "model") {
        const text = m.parts.map((p) => p.text).filter(Boolean).join("\n");
        const assistantMsg: any = { role: "assistant" };
        if (text) {
          assistantMsg.content = text;
        }

        const toolParts = m.parts.filter((p) => p.functionCall);
        if (toolParts.length > 0) {
          assistantMsg.tool_calls = toolParts.map((p, idx) => {
            const fc = p.functionCall!;
            const callId = `call_${i}_${idx}`;
            callIdMap.set(fc.name, callId);
            return {
              id: callId,
              type: "function",
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args),
              },
            };
          });
        }
        openAIMessages.push(assistantMsg);
      }
    }

function lowercaseSchemaTypes(schema: any): any {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(lowercaseSchemaTypes);
  }
  const result: any = {};
  for (const key of Object.keys(schema)) {
    if (key === "type" && typeof schema[key] === "string") {
      result[key] = schema[key].toLowerCase();
    } else {
      result[key] = lowercaseSchemaTypes(schema[key]);
    }
  }
  return result;
}

    // Map LLMToolDefinition[] format to OpenAI Tools
    const mappedTools = params.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: lowercaseSchemaTypes(t.parameters),
      },
    }));

    const body: any = {
      model: modelName,
      messages: openAIMessages,
    };

    if (mappedTools && mappedTools.length > 0) {
      body.tools = mappedTools;
      body.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenCode Zen API returned status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Invalid response structure from OpenCode Zen API: no choices returned");
    }

    const resText = choice.message?.content || "";
    const toolCalls = choice.message?.tool_calls?.map((tc: any) => {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch (e: any) {
        console.error(`Failed to parse tool call arguments: ${e.message}`);
      }
      return {
        name: tc.function.name,
        args,
      };
    });

    const result: LLMResponse = {};
    if (resText) {
      result.text = resText;
    }
    if (toolCalls && toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    return result;
  }
}
