# Cerebra

Cerebra is a stock-decision court for autonomous agents. A connected agent files a market case, an Analyst gathers and organizes evidence, a Challenger attacks the thesis, and three independent judges evaluate risk, evidence quality, and strategy. The resulting **Decision Kit** preserves the full intelligence trail: sources, claims, objections, every ballot, the majority rationale, and the losing judge's dissent.

Frontend: https://cerebra-decision-court.web3kingley.chatgpt.site  
Agent guide: https://cerebra-decision-court.web3kingley.chatgpt.site/docs/agents

## What is implemented

- Five-agent court: Analyst, Challenger, Risk Judge, Evidence Judge, Strategy Judge
- Equal-weight majority voting with explicit dissent, abstention, unavailable, and invalid states
- Live Bitget public ticker, order-book, and candle evidence
- Claude and Qwen adapters with validated structured output, retries, timeouts, and usage traces
- PostgreSQL persistence for identities, cases, runs, all agent outputs, reports, and dissent
- Agent registration, bearer-key authentication, rotation, revocation, and tenant isolation
- Immutable strategy versions, timestamped impressions, memory recall, and recovery checkpoints
- Durable court jobs with idempotency keys, leases, fencing generations, retries, progress, and cancellation
- Post-trade outcome recording with a judge calibration feedback loop: an agent reports what actually happened after a ruling, and each judge's own resolved accuracy then tempers (or reinforces) its stated confidence on every future ruling for that agent
- REST API plus full Streamable HTTP MCP tools
- Stock-first responsive frontend, case history, full report view, and Markdown export
- Deterministic mock mode for free local development and judging demos

## Local development

Requirements: Node.js 22.13 or newer and npm.

~~~powershell
npm install
Copy-Item .env.example .env
npm run dev
~~~

In a second terminal:

~~~powershell
npm run frontend:install
npm run frontend:dev
~~~

Open http://localhost:3000. The frontend proxies to `http://127.0.0.1:3100` by default.

## Agent identity

Production should use:

~~~dotenv
AGENT_AUTH_MODE=agent-key
AGENT_API_KEY_PEPPER=replace-with-a-random-secret-at-least-32-characters
AGENT_REGISTRATION_TOKEN=replace-with-a-different-random-secret-at-least-32-characters
~~~

Register an agent. The API key is returned once; store it securely.

~~~bash
curl -X POST http://127.0.0.1:3100/v1/agents/register \
  -H "Content-Type: application/json" \
  -H "X-Cerebra-Registration-Token: $CEREBRA_REGISTRATION_TOKEN" \
  -d '{"name":"Research Agent","capabilities":["stock-research","risk-analysis"]}'
~~~

Authenticate subsequent REST and MCP requests with:

~~~text
Authorization: Bearer cba_live_...
~~~

Identity endpoints:

- `POST /v1/agents/register`
- `GET /v1/agents/me`
- `POST /v1/agents/me/keys/rotate`
- `POST /v1/agents/me/revoke`

## Managed stock-case API

- `POST /v1/cases` — create a manual or Bitget-backed case
- `GET /v1/cases` — list the authenticated agent's cases
- `GET /v1/cases/:id` — retrieve an owned case
- `POST /v1/cases/:id/evidence/refresh` — refresh Bitget evidence
- `POST /v1/cases/:id/run` — run the five-agent court
- `POST /v1/cases/:id/jobs` — enqueue a durable court run
- `GET /v1/jobs/:id` — poll progress and retrieve the final run ID
- `POST /v1/jobs/:id/cancel` — cancel a queued job
- `GET /v1/runs/:id` — retrieve run state and trace
- `GET /v1/runs/:id/report` — retrieve the full Decision Kit and Markdown report
- `POST /v1/runs/:id/outcomes` — record a later observed outcome for post-ruling review; feeds the judge calibration feedback loop
- `GET /v1/runs/:id/outcomes` — list recorded outcomes for a run
- `GET /v1/judges/calibration` — each judge's accuracy from recorded outcomes (resolved, correct, incorrect, accuracy)
- `POST /v1/memory/strategies` — save an immutable strategy version
- `GET /v1/memory/strategies` — list strategy lineage
- `POST /v1/memory/impressions` — store a timestamped market belief
- `GET /v1/memory/recall` — recall beliefs with expiration labels
- `POST /v1/memory/checkpoints` — store safe restart state
- `GET /v1/memory/checkpoints/latest` — restore the latest checkpoint

Example:

~~~bash
curl -X POST http://127.0.0.1:3100/v1/cases \
  -H "Authorization: Bearer $CEREBRA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"proposal":{"asset":"BTCUSDT","market":"spot","timeframe":"4h","summary":"Evaluate a provisional BTC long thesis over four hours."},"riskLevel":"MEDIUM","evidenceMode":"BITGET"}'
~~~

Bitget public market evidence does not require a Bitget API key.

## MCP

Connect any Streamable HTTP MCP client to `POST /mcp` and provide the same bearer key.

Tools:

- `cerebra_status`
- `cerebra_create_case`
- `cerebra_run_court`
- `cerebra_enqueue_court`
- `cerebra_get_job`
- `cerebra_get_report`
- `cerebra_save_strategy`
- `cerebra_recall_memory`
- `cerebra_save_checkpoint`
- `court_tally_preview`

## Models

Mock mode is the default and consumes no credits. For Claude:

~~~dotenv
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your-key
CLAUDE_MODEL=claude-sonnet-5
CLAUDE_TIMEOUT_MS=60000
CLAUDE_MAX_RETRIES=2
~~~

For Qwen:

~~~dotenv
AI_PROVIDER=qwen
QWEN_API_KEY=your-model-studio-key
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
~~~

Never commit model keys or Cerebra agent keys.

## PostgreSQL

~~~dotenv
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://user:password@host:5432/cerebra
DATABASE_SSL=true
~~~

Run all numbered idempotent migrations with `npm run db:migrate`. Production startup runs migrations before starting the service.

## Verify

~~~powershell
npm run typecheck
npm test
npm run build
npm run frontend:check
npm run frontend:lint
npm run frontend:build
~~~

Cerebra is advisory decision infrastructure. It does not execute trades, hold funds, or promise returns.
