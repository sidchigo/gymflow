/**
 * @file src/lib/llm-provider.ts
 * @spec SPEC-004 – AI Coach Engine & Adaptive Planning Workflow
 *
 * Abstract provider interface for LLM completions and function calling.
 * Allows swapping the provider (e.g. Gemini vs. OpenAI/OpenCode) without rewriting
 * the orchestration logic.
 */

import { GoogleGenAI } from "@google/genai";
import { OpenAICompatibleProvider } from "./providers/openai-provider";

// ---------------------------------------------------------------------------
// 1. Interfaces & Types
// ---------------------------------------------------------------------------

export interface LLMMessagePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface LLMMessage {
  role: "user" | "model" | "system" | "function";
  parts: LLMMessagePart[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMResponse {
  text?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface LLMProvider {
  generateCompletion(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    model?: string;
  }): Promise<LLMResponse>;
  generateCompletionStream?(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    model?: string;
  }): AsyncGenerator<{
    text?: string | undefined;
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }> | undefined;
  }>;
}

// ---------------------------------------------------------------------------
// 2. Gemini Implementation
// ---------------------------------------------------------------------------

export class GeminiLLMProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private defaultModel: string;

  constructor(options?: { apiKey?: string; defaultModel?: string }) {
    // GoogleGenAI reads process.env.GEMINI_API_KEY if no apiKey is provided.
    const genaiOptions: { apiKey?: string } = {};
    const apiKey =
      options?.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.LLM_API_KEY;
    if (apiKey) {
      genaiOptions.apiKey = apiKey;
    }
    this.ai = new GoogleGenAI(genaiOptions);
    this.defaultModel =
      options?.defaultModel ||
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash";
  }

  async generateCompletion(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    model?: string;
  }): Promise<LLMResponse> {
    const modelName = params.model || this.defaultModel;

    // 1. Extract system instruction
    const systemMessage = params.messages.find((m) => m.role === "system");
    const systemInstruction = systemMessage?.parts
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n");

    // 2. Filter system message from contents and map other roles
    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        // Gemini expects roles 'user' or 'model'. Function calls and responses
        // are parts inside these roles.
        let role: "user" | "model" = "user";
        if (m.role === "model") {
          role = "model";
        }

        const parts = m.parts.map((p) => {
          if (p.functionCall) {
            return {
              functionCall: {
                name: p.functionCall.name,
                args: p.functionCall.args,
              },
            };
          }
          if (p.functionResponse) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: p.functionResponse.response,
              },
            };
          }
          return { text: p.text || "" };
        });

        return { role, parts };
      });

    // 3. Map tools to functionDeclarations
    const configTools = params.tools
      ? ([
          {
            functionDeclarations: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ] as any)
      : undefined;

    // 4. Invoke model
    const configObj: any = {};
    if (systemInstruction) {
      configObj.systemInstruction = systemInstruction;
    }
    if (configTools) {
      configObj.tools = configTools;
    }

    const response = await this.ai.models.generateContent({
      model: modelName,
      contents,
      config: configObj,
    });

    // 5. Build standard response format
    const text = response.text || undefined;
    const rawCalls = response.functionCalls;
    const toolCalls = rawCalls
      ?.filter((c) => c.name !== undefined)
      .map((c) => ({
        name: c.name!,
        args: (c.args as Record<string, unknown>) || {},
      }));

    const finalResponse: LLMResponse = {};
    if (text !== undefined) {
      finalResponse.text = text;
    }
    if (toolCalls !== undefined) {
      finalResponse.toolCalls = toolCalls;
    }

    return finalResponse;
  }

  async *generateCompletionStream(params: {
    messages: LLMMessage[];
    tools?: LLMToolDefinition[];
    model?: string;
  }): AsyncGenerator<{
    text?: string | undefined;
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }> | undefined;
  }> {
    const modelName = params.model || this.defaultModel;

    const systemMessage = params.messages.find((m) => m.role === "system");
    const systemInstruction = systemMessage?.parts
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n");

    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        let role: "user" | "model" = "user";
        if (m.role === "model") {
          role = "model";
        }

        const parts = m.parts.map((p) => {
          if (p.functionCall) {
            return {
              functionCall: {
                name: p.functionCall.name,
                args: p.functionCall.args,
              },
            };
          }
          if (p.functionResponse) {
            return {
              functionResponse: {
                name: p.functionResponse.name,
                response: p.functionResponse.response,
              },
            };
          }
          return { text: p.text || "" };
        });

        return { role, parts };
      });

    const configTools = params.tools
      ? ([
          {
            functionDeclarations: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ] as any)
      : undefined;

    const configObj: any = {};
    if (systemInstruction) {
      configObj.systemInstruction = systemInstruction;
    }
    if (configTools) {
      configObj.tools = configTools;
    }

    const responseStream = await this.ai.models.generateContentStream({
      model: modelName,
      contents,
      config: configObj,
    });

    for await (const chunk of responseStream) {
      const text = chunk.text || undefined;
      const rawCalls = chunk.functionCalls;
      const toolCalls = rawCalls
        ?.filter((c) => c.name !== undefined)
        .map((c) => ({
          name: c.name!,
          args: (c.args as Record<string, unknown>) || {},
        }));

      yield { text, toolCalls };
    }
  }
}

/**
 * Exposes the factory to resolve the active LLM provider from the environment.
 */
export function getDefaultLLMProvider(): LLMProvider {
  const providerType = process.env.LLM_PROVIDER || "openai";
  if (providerType === "gemini") {
    return new GeminiLLMProvider();
  }
  return new OpenAICompatibleProvider();
}
