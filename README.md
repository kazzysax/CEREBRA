# Cerebra

Cerebra is a multi-agent decision court. An Analyst builds a case, a Challenger attacks it, and three equal voting judges independently evaluate risk, evidence, and strategy. Every ruling preserves each judge's reasoning and explicitly identifies dissent.

## Implemented foundations

The current vertical slice provides:

- a strict, versioned ruling-report contract;
- deterministic 3-judge vote aggregation;
- explicit majority, dissent, abstention, unavailable, and separate opinions;
- evidence-reference and policy-gate integrity checks;
- HTTP health and topology endpoints;
- a modern streamable HTTP MCP endpoint with status and synthetic ruling tools;
- tests for dissent and failure paths.
- a complete Analyst to Challenger to three-Judge court runner;
- concurrent, independent Judge calls;
- a zero-credit deterministic mock provider;
- a live Qwen Model Studio adapter with strict Zod-validated output;
- a live Claude Messages API adapter with strict Zod-validated output;
- model timeout, retry, token usage, and failure tracing;
- a court-run HTTP API;
- public Bitget ticker, order-book, and candle evidence through the official Agent SDK;
- in-memory development storage plus production PostgreSQL persistence;
- durable cases, court runs, individual agent outputs, reports, and dissent;
- case creation, evidence refresh, court-run, and report-retrieval APIs;
- a responsive decision-chamber frontend with case creation, judge opinions,
  explicit dissent, evidence provenance, history, and report export.

Private frontend preview: https://cerebra-decision-court.web3kingley.chatgpt.site

The preview tool is intentionally synthetic. It never represents itself as live Qwen, Bitget, or market research.

## Run locally

Start the backend:

~~~powershell
npm install
npm run dev
~~~

In a second terminal, start the frontend (Node.js 22.13 or newer):

~~~powershell
npm run frontend:install
npm run frontend:dev
~~~

Open http://localhost:3000. The frontend proxies Cerebra requests to
http://127.0.0.1:3100 by default. Set `CEREBRA_API_URL` in `frontend/.env`
when the backend runs elsewhere.

Then inspect:

- GET http://127.0.0.1:3100/health/ready
- GET http://127.0.0.1:3100/v1/meta
- POST http://127.0.0.1:3100/v1/court/runs
- POST http://127.0.0.1:3100/v1/cases
- GET http://127.0.0.1:3100/v1/cases
- POST http://127.0.0.1:3100/v1/cases/:id/evidence/refresh
- POST http://127.0.0.1:3100/v1/cases/:id/run
- GET http://127.0.0.1:3100/v1/runs/:id
- GET http://127.0.0.1:3100/v1/runs/:id/report
- POST http://127.0.0.1:3100/mcp

## Run the managed case flow

Bitget public market evidence does not require an API key. With
`EVIDENCE_PROVIDER=bitget`, creating a `BITGET` case collects a ticker,
order-book snapshot, and recent candles before saving the case.

~~~powershell
$caseBody = @{
  proposal = @{
    asset = "BTCUSDT"
    market = "spot"
    timeframe = "4h"
    summary = "Evaluate a provisional BTC long thesis over the next four hours."
  }
  riskLevel = "MEDIUM"
  evidenceMode = "BITGET"
} | ConvertTo-Json -Depth 8

$case = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/v1/cases -ContentType application/json -Body $caseBody
$run = Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:3100/v1/cases/" + $case.id + "/run") -ContentType application/json -Body "{}"
Invoke-RestMethod -Uri ("http://127.0.0.1:3100/v1/runs/" + $run.runId + "/report")
~~~

## Enable PostgreSQL persistence

The default `memory` driver is useful for local development and tests. For a
deployed instance, configure PostgreSQL and run the idempotent migration once:

~~~dotenv
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://user:password@host:5432/cerebra
DATABASE_SSL=true
~~~

~~~powershell
npm run db:migrate
npm run dev
~~~

PostgreSQL stores cases, run status, the complete court result, all five agent
outputs, usage/error traces, the three judge opinions, and rendered reports.

## Run a complete mock court

Mock mode is the default and does not spend model credits.

~~~powershell
$body = @{
  proposal = @{
    id = "btc-long-4h"
    asset = "BTCUSDT"
    market = "spot"
    timeframe = "4h"
    summary = "Evaluate a provisional BTC long thesis over the next four hours."
  }
  riskLevel = "MEDIUM"
  evidence = @(
    @{
      id = "market-snapshot-1"
      title = "BTC market snapshot"
      source = "manual-demo"
      observedAt = "2026-09-17T10:00:00.000Z"
      digest = "sha256:replace-with-source-digest"
    }
  )
} | ConvertTo-Json -Depth 8

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3100/v1/court/runs -ContentType application/json -Body $body
~~~

## Enable live Claude

Copy the ignored environment template and add your key locally:

~~~powershell
Copy-Item .env.example .env
notepad .env
~~~

Set these values in the .env file:

~~~dotenv
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your-anthropic-api-key
CLAUDE_MODEL=claude-sonnet-5
CLAUDE_TIMEOUT_MS=60000
CLAUDE_MAX_RETRIES=2
~~~

Do not paste the key into chat or commit it. Cerebra loads the .env file
automatically when the server starts. A live court run makes five Claude calls:
one Analyst, one Challenger, and three independent Judges.

## Enable live Qwen

Create a Model Studio API key and use the OpenAI-compatible base URL belonging
to the same region and workspace. Then start Cerebra with:

~~~powershell
$env:AI_PROVIDER = "qwen"
$env:QWEN_API_KEY = "your-model-studio-key"
$env:QWEN_BASE_URL = "https://YOUR_WORKSPACE_ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
$env:QWEN_MODEL = "qwen-plus"
npm run dev
~~~

Never commit the API key.

## Verify

~~~powershell
npm run typecheck
npm test
npm run build
npm run frontend:check
npm run frontend:build
~~~

## MCP tools

- cerebra_status
- court_tally_preview

## Planned next slices

1. Optional Bitget Signal MCP evidence when a stable programmatic interface is available.
2. Playbook-compatible export artifacts.
3. Authentication and tenant ownership.
4. Deploy the backend and PostgreSQL, then connect the hosted frontend.
