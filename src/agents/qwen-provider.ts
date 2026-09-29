import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import type { CourtModelProvider } from "./contracts.js";
import type { z } from "zod";
import type { ModelCall } from "./contracts.js";
import { createLlmCourtProvider, type StructuredGenerator } from "./llm-court.js";

export type QwenProviderOptions = {
  apiKey: string;
  baseURL: string;
  model: string;
  // Tried in order when a model is refused for quota or credit (free-model
  // daily limits, an unfunded OpenRouter account).
  fallbackModels?: string[] | undefined;
  timeoutMs: number;
  maxRetries: number;
};

// Refusals worth moving to the next model for: quota and credit limits, and
// free-tier upstreams that are overloaded ("Provider returned error").
function isQuotaRefusal(error: unknown): boolean {
  return error instanceof Error
    && /more credits|afford|402|free-models-per-day|daily limit|rate limit|429|quota|provider returned error|upstream|temporarily unavailable|overloaded/i
      .test(error.message + " " + String((error as { lastError?: unknown }).lastError ?? ""));
}

// "You requested up to 1400 tokens, but can only afford 621."
export function affordableTokens(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /can only afford (\d+)/i.exec(error.message);
  return match ? Number(match[1]) : null;
}

export function createQwenCourtProvider(options: QwenProviderOptions): CourtModelProvider {
  const qwen = createOpenAICompatible({
    name: "qwen",
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    supportsStructuredOutputs: true,
  });

  const models = [options.model, ...(options.fallbackModels ?? [])];

  return createLlmCourtProvider({
    name: "qwen",
    model: options.model,
    async generate(request) {
      let lastError: unknown;
      for (const model of models) {
        try {
          return await generateWith(model, request, request.maxOutputTokens);
        } catch (error) {
          lastError = error;
          if (!isQuotaRefusal(error)) throw error;
          // Squeeze into the remaining allowance once before moving on.
          const affordable = affordableTokens(error);
          if (affordable !== null && affordable >= 400) {
            try {
              return await generateWith(model, request, affordable - 32);
            } catch (retryError) {
              lastError = retryError;
              if (!isQuotaRefusal(retryError)) throw retryError;
            }
          }
        }
      }
      // Every model in the chain refused for quota: say so plainly rather than
      // surfacing a raw provider error to the portal or agent.
      throw new Error(
        "MODEL_QUOTA_EXHAUSTED: every configured court model refused this request for quota or credit " +
        "(" + models.join(", ") + "). On OpenRouter's free tier that is 50 model calls a day, about 10 court runs; " +
        "the quota resets at 00:00 UTC. Last provider message: " +
        (lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError)),
      );
    },
  });

  async function generateWith<T>(
    model: string,
    { schema, name, system, prompt }: Parameters<StructuredGenerator>[0] & { schema: z.ZodType<T> },
    maxOutputTokens: number,
  ): Promise<ModelCall<T>> {
    const response = await generateText({
      model: qwen(model),
      system,
      prompt,
      output: Output.object({ name, description: "A validated Cerebra court output.", schema }),
      // A court needs concise, inspectable findings rather than a hidden long-form
      // reasoning trace. This also keeps OpenRouter runs within the provider timeout.
      maxOutputTokens,
      temperature: 0.2,
      providerOptions: { qwen: { reasoning: { effort: "none" } } },
      maxRetries: options.maxRetries,
      abortSignal: AbortSignal.timeout(options.timeoutMs),
    });
    return {
      output: schema.parse(response.output),
      provider: "qwen",
      model,
      usage: {
        inputTokens: response.usage.inputTokens ?? null,
        outputTokens: response.usage.outputTokens ?? null,
        totalTokens: response.usage.totalTokens ?? null,
      },
    };
  }
}
