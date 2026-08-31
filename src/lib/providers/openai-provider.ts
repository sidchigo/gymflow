/**
 * @file src/lib/providers/openai-provider.ts
 * @spec SPEC-004 – AI Coach Engine & Adaptive Planning Workflow
 *
 * OpenAI Compatible provider implementation for LLM completions.
 */

import {
  type LLMMessage,
  type LLMToolDefinition,
  type LLMResponse,
  type LLMProvider,
} from "../llm-provider";



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

import { safeParseJSON } from "../json-utils";

function parseDSMLToolCalls(text: string): {
  cleanText: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  // Match standard DSML tool_calls block
  const dsmlBlockRegex = /<[｜|]?(?:DSML[｜|]?)?tool_calls[｜|]?>([\s\S]*?)<\/[｜|]?(?:DSML[｜|]?)?tool_calls[｜|]?>/gi;
  let match: RegExpExecArray | null;

  while ((match = dsmlBlockRegex.exec(text)) !== null) {
    const blockContent = match[1] || "";
    const invokeRegex = /<[｜|]?(?:DSML[｜|]?)?invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[｜|]?(?:DSML[｜|]?)?invoke[｜|]?>/gi;
    let invokeMatch: RegExpExecArray | null;

    while ((invokeMatch = invokeRegex.exec(blockContent)) !== null) {
      const toolName = invokeMatch[1];
      const invokeBody = invokeMatch[2] || "";
      const args: Record<string, unknown> = {};

      const paramRegex = /<[｜|]?(?:DSML[｜|]?)?parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[｜|]?(?:DSML[｜|]?)?parameter[｜|]?>/gi;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
        const paramName = paramMatch[1];
        const paramValueRaw = (paramMatch[2] || "").trim();
        if (paramName) {
          try {
            args[paramName] = safeParseJSON(paramValueRaw);
          } catch {
            args[paramName] = paramValueRaw;
          }
        }
      }

      if (toolName) {
        toolCalls.push({ name: toolName, args });
      }
    }
  }

  // Handle unclosed/partial invoke tag if stream was truncated
  if (toolCalls.length === 0) {
    const unclosedInvokeRegex = /<[｜|]?(?:DSML[｜|]?)?invoke\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/[｜|]?(?:DSML[｜|]?)?invoke[｜|]?>|$)/gi;
    let unclosedMatch: RegExpExecArray | null;
    while ((unclosedMatch = unclosedInvokeRegex.exec(text)) !== null) {
      const toolName = unclosedMatch[1];
      const invokeBody = unclosedMatch[2] || "";
      const args: Record<string, unknown> = {};

      const paramRegex = /<[｜|]?(?:DSML[｜|]?)?parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/[｜|]?(?:DSML[｜|]?)?parameter[｜|]?>|$)/gi;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeBody)) !== null) {
        const paramName = paramMatch[1];
        const paramValueRaw = (paramMatch[2] || "").trim();
        if (paramName) {
          try {
            args[paramName] = safeParseJSON(paramValueRaw);
          } catch {
            args[paramName] = paramValueRaw;
          }
        }
      }

      if (toolName && Object.keys(args).length > 0) {
        toolCalls.push({ name: toolName, args });
      }
    }
  }

  // Single tool_call format fallback
  const singleToolCallRegex = /<[｜|]?tool_call[｜|]?>([\s\S]*?)<\/[｜|]?tool_call[｜|]?>/gi;
  while ((match = singleToolCallRegex.exec(text)) !== null) {
    try {
      const parsed = safeParseJSON((match[1] || "").trim());
      if (parsed && typeof parsed === "object" && parsed.name) {
        toolCalls.push({
          name: parsed.name,
          args: typeof parsed.arguments === "string" ? safeParseJSON(parsed.arguments) : (parsed.arguments || parsed.args || {}),
        });
      }
    } catch {
      // Ignore
    }
  }

  const cleanText = text
    .replace(/<[｜|]?(?:DSML[｜|]?)?tool_calls[｜|]?>[\s\S]*?(?:<\/[｜|]?(?:DSML[｜|]?)?tool_calls[｜|]?>|$)/gi, "")
    .replace(/<[｜|]?tool_call[｜|]?>[\s\S]*?(?:<\/[｜|]?tool_call[｜|]?>|$)/gi, "")
    .trim();

  return { cleanText, toolCalls };
}


export class OpenAICompatibleProvider implements LLMProvider {
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
      process.env.OPENROUTER_MODEL ||
      process.env.LLM_MODEL ||
      "google/gemini-2.5-flash-lite";
  }

  async generateCompletion(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[] | undefined;
    model?: string | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    toolChoice?: any | undefined;
    response_format?: any | undefined;
  }): Promise<LLMResponse> {
    const modelName = params.model || this.defaultModel;

    // Map Gemini LLMMessage[] format to OpenAI Chat Completions Messages
    const callIdMap = new Map<string, string>();
    const openAIMessages: any[] = [];

    for (let i = 0; i < params.messages.length; i++) {
      const m = params.messages[i];
      if (!m) continue;

      if (m.role === "tool") {
        openAIMessages.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: m.content || "",
        });
        continue;
      }

      const parts = m.parts || [];
      // Extract function responses first (since host engine might append them under "user" role)
      const funcParts = parts.filter((p) => p.functionResponse);
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
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "system", content: text });
      } else if (m.role === "user") {
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "user", content: text });
      } else if (m.role === "model") {
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        const assistantMsg: any = { role: "assistant", content: text || null };

        const toolParts = parts.filter((p) => p.functionCall);
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
      temperature: params.temperature !== undefined ? params.temperature : 0.2,
      max_tokens: params.maxTokens !== undefined ? params.maxTokens : 3000,
    };

    if (mappedTools && mappedTools.length > 0) {
      body.tools = mappedTools;
      body.tool_choice = params.toolChoice !== undefined ? params.toolChoice : "auto";
    }

    const isDeepSeekOrOpenRouter = modelName.startsWith("deepseek/") || this.baseUrl.includes("openrouter.ai");
    if (isDeepSeekOrOpenRouter) {
      body.reasoning = { enabled: true };
      if (params.response_format !== undefined) {
        body.response_format = params.response_format;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || this.apiKey;
    if (authKey) {
      headers["Authorization"] = `Bearer ${authKey}`;
    }

    console.log('[AGENT_INPUT_MESSAGES]:', openAIMessages.map((m: any) => ({ role: m.role, length: typeof m.content === 'string' ? m.content.length : 'complex' })));

    let response: Response;
    let data: any;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("LLM completion read timeout")), 120000);
    try {
      console.log('[AGENT_LLM] Sending request to OpenRouter model:', modelName);
      const startTime = performance.now();
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      console.log('[AGENT_LLM] Received headers in:', Math.round(performance.now() - startTime), 'ms, status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Provider API returned status ${response.status}: ${errorText}`);
      }

      data = await response.json();
      console.log('[AGENT_LLM] Parsed full JSON body in:', Math.round(performance.now() - startTime), 'ms');
    } catch (err: any) {
      console.error(`[LLM_CALL] Request failed: ${err.message || err}`);
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    console.log('[AGENT_LLM] Choices:', data.choices?.[0]?.message?.tool_calls ? 'Tool Call: ' + JSON.stringify(data.choices[0].message.tool_calls.map((t: any) => t.function.name)) : 'Text Response');

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("Invalid response structure from OpenAI Provider API: no choices returned");
    }

    let resText = choice.message?.content || "";
    let toolCalls = choice.message?.tool_calls?.map((tc: any) => {
      let args = {};
      try {
        args = safeParseJSON(tc.function.arguments);
      } catch (e: any) {
        console.error(`Failed to parse tool call arguments: ${e.message}`);
      }
      return {
        name: tc.function.name,
        args,
      };
    }) || [];

    if (resText.includes("<｜DSML") || resText.includes("<|DSML") || resText.includes("<｜tool_calls") || resText.includes("<tool_call")) {
      const dsml = parseDSMLToolCalls(resText);
      resText = dsml.cleanText;
      if (dsml.toolCalls.length > 0) {
        toolCalls = [...toolCalls, ...dsml.toolCalls];
      }
    }

    const result: LLMResponse = {};
    if (resText) {
      result.text = resText;
    }
    if (toolCalls && toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    return result;
  }

  async *generateCompletionStream(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[] | undefined;
    model?: string | undefined;
    temperature?: number | undefined;
    maxTokens?: number | undefined;
    toolChoice?: any | undefined;
    onToken?: (token: string) => void;
    onStatus?: (message: string) => void;
    response_format?: any | undefined;
  }): AsyncGenerator<{
    text?: string | undefined;
    toolCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> | undefined;
  }> {
    const modelName = params.model || this.defaultModel;

    const callIdMap = new Map<string, string>();
    const openAIMessages: any[] = [];

    for (let i = 0; i < params.messages.length; i++) {
      const m = params.messages[i];
      if (!m) continue;

      if (m.role === "tool") {
        openAIMessages.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: m.content || "",
        });
        continue;
      }

      const parts = m.parts || [];
      const funcParts = parts.filter((p) => p.functionResponse);
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
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "system", content: text });
      } else if (m.role === "user") {
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        openAIMessages.push({ role: "user", content: text });
      } else if (m.role === "model") {
        const text = parts.map((p) => p.text).filter(Boolean).join("\n");
        const assistantMsg: any = { role: "assistant", content: text || null };

        const toolParts = parts.filter((p) => p.functionCall);
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
      stream: true,
      max_tokens: params.maxTokens !== undefined ? params.maxTokens : 3000,
      temperature: params.temperature !== undefined ? params.temperature : 0.2,
    };

    if (mappedTools && mappedTools.length > 0) {
      body.tools = mappedTools;
      body.tool_choice = params.toolChoice !== undefined ? params.toolChoice : "auto";
    }

    const isDeepSeekOrOpenRouter = modelName.startsWith("deepseek/") || this.baseUrl.includes("openrouter.ai");
    if (isDeepSeekOrOpenRouter) {
      body.reasoning = { enabled: true };
      if (params.response_format !== undefined) {
        body.response_format = params.response_format;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || this.apiKey;
    if (authKey) {
      headers["Authorization"] = `Bearer ${authKey}`;
    }

    console.log('[AGENT_INPUT_MESSAGES]:', openAIMessages.map((m: any) => ({ role: m.role, length: typeof m.content === 'string' ? m.content.length : 'complex' })));

    console.log('[AGENT_LLM] Sending streaming request to OpenRouter model:', modelName);
    const startTime = performance.now();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("LLM completion stream read timeout")), 120000);

    let response: Response;
    let streamedTextAccumulator = "";
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      console.log('[AGENT_LLM] Received headers in:', Math.round(performance.now() - startTime), 'ms, status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Provider API returned status ${response.status}: ${errorText}`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }

    if (!response.body) {
      clearTimeout(timeoutId);
      throw new Error("No response body stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const accumulatedToolCalls: Array<{
      id?: string;
      name?: string;
      arguments: string;
    }> = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          const dataStr = trimmed.slice(6).trim();
          try {
            const chunk = JSON.parse(dataStr);
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            const content = delta?.content || "";

            if (content) {
              streamedTextAccumulator += content;

              const dsmlIndex = streamedTextAccumulator.search(/<[｜|]?(?:DSML[｜|]?)?tool_calls|<[｜|]?invoke|<[｜|]?tool_call/i);
              if (dsmlIndex === -1) {
                if (params.onToken) {
                  params.onToken(content);
                }
                yield { text: content };
              } else {
                const toolMatch = streamedTextAccumulator.match(/<[｜|]?(?:DSML[｜|]?)?invoke\s+name=["']([^"']+)["']/i);
                if (toolMatch && toolMatch[1]) {
                  const toolName = toolMatch[1];
                  const statusMsg = toolName === 'replan_week_schedule' 
                    ? 'Updating your 7-day training schedule...' 
                    : `Checking ${toolName.replace(/_/g, ' ')}...`;
                  if (params.onStatus) {
                    params.onStatus(statusMsg);
                  }
                }
              }
            }

            const toolCalls = choice.delta?.tool_calls;
            if (toolCalls && toolCalls.length > 0) {
              console.log('[AGENT_RAW_TOOL_DELTA]:', JSON.stringify(toolCalls));
              for (const tc of toolCalls) {
                const idx = tc.index;
                if (!accumulatedToolCalls[idx]) {
                  accumulatedToolCalls[idx] = { arguments: "" };
                  if (tc.function?.name) {
                    accumulatedToolCalls[idx].name = tc.function.name;
                    const toolName = tc.function.name;
                    const statusMsg = toolName === 'replan_week_schedule' 
                      ? 'Updating your 7-day training schedule...' 
                      : `Checking ${toolName.replace(/_/g, ' ')}...`;
                    if (params.onStatus) {
                      params.onStatus(statusMsg);
                    }
                  }
                }
                if (tc.id) {
                  accumulatedToolCalls[idx].id = tc.id;
                }
                if (tc.function?.name && !accumulatedToolCalls[idx].name) {
                  accumulatedToolCalls[idx].name = tc.function.name;
                  const toolName = tc.function.name;
                  const statusMsg = toolName === 'replan_week_schedule' 
                    ? 'Updating your 7-day training schedule...' 
                    : `Checking ${toolName.replace(/_/g, ' ')}...`;
                  if (params.onStatus) {
                    params.onStatus(statusMsg);
                  }
                }
                if (tc.function?.arguments) {
                  accumulatedToolCalls[idx].arguments += tc.function.arguments;
                }
              }
            }
          } catch (e: any) {
            // Ignore parsing errors for partial or keep-alive lines
          }
        }
      }

      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          const dataStr = line.slice(6).trim();
          try {
            const chunk = JSON.parse(dataStr);
            const choice = chunk.choices?.[0];
            if (choice) {
              const content = choice.delta?.content || "";
              if (content) {
                streamedTextAccumulator += content;
                if (params.onToken) {
                  params.onToken(content);
                }
                yield { text: content };
              }

              const toolCalls = choice.delta?.tool_calls;
              if (toolCalls && toolCalls.length > 0) {
                console.log('[AGENT_RAW_TOOL_DELTA]:', JSON.stringify(toolCalls));
                for (const tc of toolCalls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { arguments: "" };
                    if (tc.function?.name) {
                      accumulatedToolCalls[idx].name = tc.function.name;
                      const toolName = tc.function.name;
                      const statusMsg = toolName === 'replan_week_schedule' 
                        ? 'Updating your 7-day training schedule...' 
                        : `Checking ${toolName.replace(/_/g, ' ')}...`;
                      if (params.onStatus) {
                        params.onStatus(statusMsg);
                      }
                    }
                  }
                  if (tc.id) {
                    accumulatedToolCalls[idx].id = tc.id;
                  }
                  if (tc.function?.name && !accumulatedToolCalls[idx].name) {
                    accumulatedToolCalls[idx].name = tc.function.name;
                    const toolName = tc.function.name;
                    const statusMsg = toolName === 'replan_week_schedule' 
                      ? 'Updating your 7-day training schedule...' 
                      : `Checking ${toolName.replace(/_/g, ' ')}...`;
                    if (params.onStatus) {
                      params.onStatus(statusMsg);
                    }
                  }
                  if (tc.function?.arguments) {
                    accumulatedToolCalls[idx].arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch (e: any) {
            // Ignore
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      reader.releaseLock();
    }



    console.log('[AGENT_FULL_OUTPUT_LENGTH]:', streamedTextAccumulator.length);
    console.log('[AGENT_FULL_OUTPUT_SAMPLE]:', streamedTextAccumulator.slice(0, 500));

    let finalToolCalls = accumulatedToolCalls
      .filter((tc) => tc.name)
      .map((tc) => {
        let args = {};
        try {
          args = safeParseJSON(tc.arguments);
        } catch (e: any) {
          console.error(`Failed to parse streamed tool call arguments: ${e.message}`, tc.arguments);
        }
        const tcObj: { id?: string; name: string; args: Record<string, unknown> } = {
          name: tc.name!,
          args,
        };
        if (tc.id !== undefined) {
          tcObj.id = tc.id;
        }
        return tcObj;
      });

    if (streamedTextAccumulator.includes("<｜DSML") || streamedTextAccumulator.includes("<|DSML") || streamedTextAccumulator.includes("<｜tool_calls") || streamedTextAccumulator.includes("<tool_call")) {
      const dsml = parseDSMLToolCalls(streamedTextAccumulator);
      if (dsml.toolCalls.length > 0) {
        finalToolCalls = [...finalToolCalls, ...dsml.toolCalls];
      }
    }

    console.log('[AGENT_LLM] Parsed full JSON body/stream in:', Math.round(performance.now() - startTime), 'ms');
    console.log('[AGENT_LLM] Choices:', finalToolCalls.length > 0 ? 'Tool Call: ' + JSON.stringify(finalToolCalls.map((t) => t.name)) : 'Text Response');

    if (finalToolCalls.length > 0) {
      yield { toolCalls: finalToolCalls };
    }
  }
}
