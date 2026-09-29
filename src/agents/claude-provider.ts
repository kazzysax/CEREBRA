import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import type { CourtModelProvider } from "./contracts.js";
import { createLlmCourtProvider } from "./llm-court.js";

export type ClaudeProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
};

export function createClaudeCourtProvider(options: ClaudeProviderOptions): CourtModelProvider {
  const claude = createAnthropic({ apiKey: options.apiKey });

  return createLlmCourtProvider({
    name: "claude",
    model: options.model,
    async generate({ schema, name, system, prompt, maxOutputTokens }) {
      const response = await generateText({
        model: claude(options.model),
        system,
        prompt,
        output: Output.object({ name, description: "A validated Cerebra court output.", schema }),
        maxOutputTokens,
        maxRetries: options.maxRetries,
        abortSignal: AbortSignal.timeout(options.timeoutMs),
      });
      return {
        output: schema.parse(response.output),
        provider: "claude",
        model: options.model,
        usage: {
          inputTokens: response.usage.inputTokens ?? null,
          outputTokens: response.usage.outputTokens ?? null,
          totalTokens: response.usage.totalTokens ?? null,
        },
      };
    },
  });
}
