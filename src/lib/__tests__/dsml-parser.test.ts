import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAICompatibleProvider } from "@/lib/providers/openai-provider";
import { safeParseJSON } from "@/lib/json-utils";

describe("OpenAICompatibleProvider DSML tool parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("successfully parses DSML tool calls with unicode acute accents and stripped clean text", async () => {
    const rawDSMLResponse = `Good question — let me walk you through the logic.
<｜DSML｜tool_calls>
<｜DSML｜invoke name="replan_week_schedule">
<｜DSML｜parameter name="plan" string="false">[{"date": "2026-08-31", "day": "Monday", "focus": "Lower Strength", "modality": "LOWER_STRENGTH", "isGymClass": false, "plannedTime": "18:00", "estimatedDurationMinutes": 60, "exercises": [{"name": "Dumbbell Romanian Deadlift", "sets": ́3, "reps": "12", "restSeconds": 90, "targetRpe": 8}], "nutritionAdvice": "Fuel up properly."}]</｜DSML｜parameter>
<｜DSML｜parameter name="reasoning" string="true">Swapped Friday to respect 20:00 cutoff.</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: rawDSMLResponse,
            },
          },
        ],
      }),
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "deepseek/deepseek-v3",
    });

    const result = await provider.generateCompletion({
      messages: [{ role: "user", parts: [{ text: "Hello" }] }],
    });

    expect(result.text).toBe("Good question — let me walk you through the logic.");
    expect(result.toolCalls).toBeDefined();
    const calls = result.toolCalls || [];
    expect(calls.length).toBe(1);
    expect(calls[0]?.name).toBe("replan_week_schedule");
    expect((calls[0]?.args as any)?.reasoning).toBe("Swapped Friday to respect 20:00 cutoff.");
    expect(Array.isArray((calls[0]?.args as any)?.plan)).toBe(true);
    expect((calls[0]?.args as any)?.plan?.[0]?.exercises?.[0]?.sets).toBe(3);
  });

  it("handles combining diacritics, smart quotes, mathematical symbols, and unescaped characters in safeParseJSON", () => {
    const rawCorruptedJSON = `[
      {
        "date": "2026-08-31",
        "day": "Monday",
        "focus": “Lower Strength – Posterior Chain Emphasis”,
        "modality": "LOWER_STRENGTH",
        "isGymClass": false,
        "plannedTime": "18:00",
        "exercises": [
          {
            "name": "Dumbbell Romanian Deadlift",
            "sets": ́3,
            "reps": "12",
            "restSeconds": 60, ́"targetRpe": 7.5,
            "progressionNote": "+1 kg / +2.5 lbs when RPE ≤ 7"
          }
        ],
        "nutritionAdvice": 'Fuel up properly.'
      },
    ]`;

    const parsed = safeParseJSON(rawCorruptedJSON);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].day).toBe("Monday");
    expect(parsed[0].exercises[0].sets).toBe(3);
    expect(parsed[0].exercises[0].targetRpe).toBe(7.5);
  });

  it("successfully repairs truncated tool call arguments ending mid-string", () => {
    const truncatedJSON = `{"plan":[{"date":"2026-08-31","day":"Monday","focus":"BJJ","modality":"BJJ","isGymClass":true,"plannedTime":"19:00","exercises":[],"nutritionAdvice":"Pre carbs"}],"reasoning":"We locked two combat slots that fit the athlete’s work constraints. Nutrition cues were kept aligned with each session’s`;

    const parsed = safeParseJSON(truncatedJSON);
    expect(parsed).toBeDefined();
    expect(Array.isArray(parsed.plan)).toBe(true);
    expect(parsed.plan[0].day).toBe("Monday");
    expect(typeof parsed.reasoning).toBe("string");
    expect(parsed.reasoning).toContain("We locked two combat slots");
  });
});
