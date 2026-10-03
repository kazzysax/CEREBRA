import { randomUUID } from "node:crypto";
import { caseSubmissionSchema, type CourtModelProvider } from "../agents/contracts.js";
import { executeCase } from "../cases/execute-case.js";
import type { AgentMemoryRepository } from "../memory/contracts.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { LedgerRepository } from "./contracts.js";
import { appendRunToLedger } from "./service.js";

// The tickers the portal offers. Three consecutive ones are taken per day, so
// every ticker is covered every four days.
export const SLOT_ASSETS = [
  "TSLAUSDT", "AAPLUSDT", "NVDAUSDT", "MSFTUSDT", "AMZNUSDT", "GOOGLUSDT",
  "METAUSDT", "NFLXUSDT", "AMDUSDT", "COINUSDT", "JPMUSDT", "DISUSDT",
] as const;

export type Slot = { index: number; label: string; hour: number; minute: number };

export function parseSlots(csv: string): Slot[] {
  return csv.split(",").map((part) => part.trim()).filter(Boolean).map((label, index) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(label);
    const hour = Number(match?.[1]);
    const minute = Number(match?.[2]);
    if (!match || hour > 23 || minute > 59) throw new Error("Invalid ledger slot time: " + label);
    return { index, label: String(hour).padStart(2, "0") + ":" + match[2], hour, minute };
  });
}

export function assetForSlot(day: Date, slot: Slot, slotsPerDay: number): string {
  const dayNumber = Math.floor(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) / 86_400_000);
  return SLOT_ASSETS[(dayNumber * slotsPerDay + slot.index) % SLOT_ASSETS.length]!;
}

export type DueSlot = { key: string; dueAt: Date; asset: string; slot: Slot };

// Today's slots whose time has passed and that started after the ledger was
// switched on, so enabling it mid-day never invents "missed" slots.
export function dueSlots(now: Date, slots: Slot[], scheduleStart: Date | null): DueSlot[] {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const date = day.toISOString().slice(0, 10);
  return slots
    .map((slot) => ({
      key: date + "#" + slot.label,
      dueAt: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), slot.hour, slot.minute)),
      asset: assetForSlot(day, slot, slots.length),
      slot,
    }))
    .filter((due) => due.dueAt <= now && (!scheduleStart || due.dueAt >= scheduleStart));
}

export function createLedgerScheduler(options: {
  ledger: LedgerRepository;
  cases: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
  memory?: AgentMemoryRepository | undefined;
  slots: Slot[];
  scheduleStart: Date | null;
  intervalMs?: number | undefined;
  retryDelayMs?: number | undefined;
  windowMs?: number | undefined;
  maxAttempts?: number | undefined;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
  log?: ((message: string, detail?: unknown) => void) | undefined;
}) {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const intervalMs = options.intervalMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 10 * 60_000;
  const windowMs = options.windowMs ?? 3 * 3_600_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const attempts = new Map<string, { count: number; nextAt: number; lastError: string }>();
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;

  async function runSlot(due: DueSlot): Promise<void> {
    const caseId = idFactory();
    const timestamp = now().toISOString();
    const proposal = {
      id: "proposal-" + caseId,
      asset: due.asset,
      market: "usdt-futures",
      timeframe: "4h",
      direction: "EITHER" as const,
      summary: `Scheduled public record, ${due.key}: advise on the best trade for ${due.asset} on current data. Pick the side the measured market supports, or none.`,
    };
    const evidence = await options.evidenceProvider.collect(proposal);
    const submission = caseSubmissionSchema.parse({ proposal, riskLevel: "MEDIUM", evidence });
    await options.cases.createCase({
      id: caseId, agentId: null, submission, evidenceMode: "BITGET", status: "READY", createdAt: timestamp, updatedAt: timestamp,
    });
    const result = await executeCase({
      caseId, agentId: null, refreshEvidence: false,
      repository: options.cases, evidenceProvider: options.evidenceProvider, courtProvider: options.courtProvider,
      memory: options.memory, now,
    });
    await appendRunToLedger({ ledger: options.ledger, cases: options.cases }, { runId: result.runId, slotKey: due.key, source: "SCHEDULED", now });
  }

  async function tick(): Promise<void> {
    const current = now();
    for (const due of dueSlots(current, options.slots, options.scheduleStart)) {
      if (await options.ledger.hasSlot(due.key)) continue;
      const state = attempts.get(due.key) ?? { count: 0, nextAt: 0, lastError: "" };
      const expired = current.getTime() > due.dueAt.getTime() + windowMs;
      if (state.count >= maxAttempts || expired) {
        // Say so publicly rather than silently skipping a slot.
        await options.ledger.append({
          slotKey: due.key, status: "MISSED", source: "SCHEDULED", asset: due.asset, timeframe: "4h", riskLevel: "MEDIUM",
          model: null, runId: null, ruledAt: due.dueAt.toISOString(), report: null,
          missedReason: (state.lastError || "No attempt completed inside the slot window.").slice(0, 240),
          createdAt: current.toISOString(),
        });
        continue;
      }
      if (current.getTime() < state.nextAt) continue;
      try {
        await runSlot(due);
        attempts.delete(due.key);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.set(due.key, { count: state.count + 1, nextAt: current.getTime() + retryDelayMs, lastError: message });
        options.log?.("scheduled ledger run failed", { slot: due.key, attempt: state.count + 1, error: message.slice(0, 300) });
      }
    }
  }

  const guardedTick = (): Promise<void> => {
    if (running) return running;
    running = tick()
      .catch((error) => options.log?.("ledger scheduler tick failed", error instanceof Error ? error.message : error))
      .finally(() => { running = null; });
    return running;
  };

  return {
    tick: guardedTick,
    start() { if (timer) return; timer = setInterval(() => void guardedTick(), intervalMs); void guardedTick(); },
    async stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; },
  };
}
