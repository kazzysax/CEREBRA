import { z } from "zod";

const configSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  ALLOWED_HOSTS: z.string().default("127.0.0.1,localhost"),
  AI_PROVIDER: z.enum(["mock", "qwen", "claude"]).default("mock"),
  EVIDENCE_PROVIDER: z.enum(["mock", "bitget"]).default("bitget"),
  STORAGE_DRIVER: z.enum(["memory", "postgres"]).default("memory"),
  AGENT_AUTH_MODE: z.enum(["open", "agent-key"]).default("open"),
  AGENT_API_KEY_PEPPER: z.string().min(32).optional(),
  AGENT_REGISTRATION_TOKEN: z.string().min(32).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.string().default("false").transform((value) => value === "true"),
  QWEN_API_KEY: z.string().min(1).optional(),
  QWEN_BASE_URL: z.string().url().optional(),
  QWEN_MODEL: z.string().min(1).default("qwen-plus"),
  QWEN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(45_000),
  QWEN_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().min(1).default("claude-sonnet-5"),
  CLAUDE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
  CLAUDE_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(env);
  if (parsed.AGENT_AUTH_MODE === "agent-key") {
    if (!parsed.AGENT_API_KEY_PEPPER) {
      throw new Error("AGENT_API_KEY_PEPPER is required when AGENT_AUTH_MODE=agent-key");
    }
    if (!parsed.AGENT_REGISTRATION_TOKEN) {
      throw new Error("AGENT_REGISTRATION_TOKEN is required when AGENT_AUTH_MODE=agent-key");
    }
  }
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    allowedHosts: parsed.ALLOWED_HOSTS.split(",").map((host) => host.trim()).filter(Boolean),
    ai: {
      provider: parsed.AI_PROVIDER,
      qwenApiKey: parsed.QWEN_API_KEY,
      qwenBaseURL: parsed.QWEN_BASE_URL,
      qwenModel: parsed.QWEN_MODEL,
      timeoutMs: parsed.QWEN_TIMEOUT_MS,
      maxRetries: parsed.QWEN_MAX_RETRIES,
      anthropicApiKey: parsed.ANTHROPIC_API_KEY,
      claudeModel: parsed.CLAUDE_MODEL,
      claudeTimeoutMs: parsed.CLAUDE_TIMEOUT_MS,
      claudeMaxRetries: parsed.CLAUDE_MAX_RETRIES,
    },
    evidenceProvider: parsed.EVIDENCE_PROVIDER,
    storage: {
      driver: parsed.STORAGE_DRIVER,
      databaseUrl: parsed.DATABASE_URL,
      databaseSsl: parsed.DATABASE_SSL,
    },
    auth: {
      mode: parsed.AGENT_AUTH_MODE,
      apiKeyPepper: parsed.AGENT_API_KEY_PEPPER ?? "development-only-cerebra-key-pepper",
      registrationToken: parsed.AGENT_REGISTRATION_TOKEN,
    },
  };
}
