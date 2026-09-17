import type { loadConfig } from "../config.js";
import { createClaudeCourtProvider } from "./claude-provider.js";
import type { CourtModelProvider } from "./contracts.js";
import { createMockCourtProvider } from "./mock-provider.js";
import { createQwenCourtProvider } from "./qwen-provider.js";

type AiConfig = ReturnType<typeof loadConfig>["ai"];

export function createConfiguredCourtProvider(config: AiConfig): CourtModelProvider {
  if (config.provider === "mock") return createMockCourtProvider();
  if (config.provider === "claude") {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=claude");
    }
    return createClaudeCourtProvider({
      apiKey: config.anthropicApiKey,
      model: config.claudeModel,
      timeoutMs: config.claudeTimeoutMs,
      maxRetries: config.claudeMaxRetries,
    });
  }
  if (!config.qwenApiKey) {
    throw new Error("QWEN_API_KEY is required when AI_PROVIDER=qwen");
  }
  if (!config.qwenBaseURL) {
    throw new Error("QWEN_BASE_URL is required when AI_PROVIDER=qwen");
  }
  return createQwenCourtProvider({
    apiKey: config.qwenApiKey,
    baseURL: config.qwenBaseURL,
    model: config.qwenModel,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
}
