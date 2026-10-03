import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CaseRepository } from "../storage/contracts.js";
import type { LedgerRepository } from "./contracts.js";
import { appendRunToLedger, summariseTrackRecord, toPublicEntry, verifyChain, type ChainVerification } from "./service.js";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(5),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const seqParams = z.object({ seq: z.coerce.number().int().min(1) });
const backfillBody = z.object({ runIds: z.array(z.string().trim().min(1)).min(1).max(20) }).strict();

const digest = (value: string) => createHash("sha256").update(value).digest();

// Everything under /v1/public is read-only and anonymous, except the two admin
// routes, which exist only when LEDGER_ADMIN_TOKEN is configured.
export function registerLedgerRoutes(app: FastifyInstance, options: {
  ledger: LedgerRepository;
  cases: CaseRepository;
  adminToken?: string | undefined;
  tick?: (() => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}) {
  const now = options.now ?? Date.now;
  let cache: { at: number; verification: ChainVerification; summary: ReturnType<typeof summariseTrackRecord> } | null = null;
  async function snapshot() {
    if (cache && now() - cache.at < 15_000) return cache;
    const rows = await options.ledger.listAll();
    const verification = await verifyChain(options.ledger);
    cache = { at: now(), verification, summary: summariseTrackRecord(rows, verification) };
    return cache;
  }

  app.get("/v1/public/ledger", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_QUERY" });
    const entries = await options.ledger.list(parsed.data.limit, parsed.data.offset);
    const full = await Promise.all(entries.map(async (entry) => toPublicEntry(entry, (await options.ledger.get(entry.seq))?.report ?? null)));
    return { entries: full, limit: parsed.data.limit, offset: parsed.data.offset };
  });

  app.get("/v1/public/ledger/verify", async () => (await snapshot()).verification);

  app.get("/v1/public/ledger/:seq", async (request, reply) => {
    const parsed = seqParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_SEQ" });
    const found = await options.ledger.get(parsed.data.seq);
    if (!found) return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
    return { entry: toPublicEntry(found.entry, found.report), report: found.report, canonicalization: "JSON with object keys sorted recursively and no whitespace; digest = sha256 of that text" };
  });

  app.get("/v1/public/track-record", async () => (await snapshot()).summary);

  const authorised = (header: unknown): boolean => {
    if (!options.adminToken || typeof header !== "string") return false;
    return timingSafeEqual(digest(header), digest(options.adminToken));
  };

  if (options.adminToken) {
    app.post("/v1/public/admin/backfill", async (request, reply) => {
      if (!authorised(request.headers["x-ledger-admin-token"])) return reply.code(401).send({ error: "UNAUTHORIZED" });
      const parsed = backfillBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_BODY" });
      // Oldest first, so the chain order follows when each ruling happened.
      const runs = await Promise.all(parsed.data.runIds.map((id) => options.cases.getRun(id, null)));
      const ordered = runs
        .filter((run): run is NonNullable<typeof run> => Boolean(run && run.status === "COMPLETED" && run.completedAt))
        .sort((left, right) => (left.completedAt! < right.completedAt! ? -1 : 1));
      const appended: number[] = [];
      const skipped: string[] = parsed.data.runIds.filter((id) => !ordered.some((run) => run.id === id));
      for (const run of ordered) {
        const entry = await appendRunToLedger({ ledger: options.ledger, cases: options.cases }, { runId: run.id, slotKey: "backfill:" + run.id, source: "BACKFILL" });
        if (entry) appended.push(entry.seq); else skipped.push(run.id);
      }
      cache = null;
      return { appended, skipped };
    });

    app.post("/v1/public/admin/tick", async (request, reply) => {
      if (!authorised(request.headers["x-ledger-admin-token"])) return reply.code(401).send({ error: "UNAUTHORIZED" });
      await options.tick?.();
      cache = null;
      return { ok: true, scheduler: Boolean(options.tick) };
    });
  }
}
