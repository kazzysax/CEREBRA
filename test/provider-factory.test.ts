import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredCourtProvider } from "../src/agents/provider-factory.js";
import { loadConfig } from "../src/config.js";

test("creates a Claude provider without making a network request", () => {
  const config = loadConfig({
    AI_PROVIDER: "claude",
    ANTHROPIC_API_KEY: "test-key-not-used",
    CLAUDE_MODEL: "claude-sonnet-5",
  });
  const provider = createConfiguredCourtProvider(config.ai);
  assert.equal(provider.name, "claude");
  assert.equal(provider.model, "claude-sonnet-5");
});

test("refuses to start Claude mode without an API key", () => {
  const config = loadConfig({ AI_PROVIDER: "claude" });
  assert.throws(
    () => createConfiguredCourtProvider(config.ai),
    /ANTHROPIC_API_KEY is required/,
  );
});
