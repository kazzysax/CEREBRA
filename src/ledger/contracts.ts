import type { HashedFields } from "./hash.js";

export type LedgerStatus = "RULED" | "MISSED";
export type LedgerSource = "SCHEDULED" | "BACKFILL";

// How a ruling fared once its horizon passed, computed from Bitget candles by
// code (never entered by hand). SIGNAL scores an ACTIONABLE recommendation;
// REJECTION scores the plan the court declined, as a counterfactual, so a
// rejection that missed a winner is recorded as a miss.
export type LedgerScore = {
  kind: "SIGNAL" | "REJECTION" | "NOT_SCORABLE";
  result: "WIN" | "LOSS" | "FLAT" | "REJECTION_CORRECT" | "REJECTION_MISSED" | "NOT_SCORABLE";
  thesisOutcome: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE" | null;
  direction: "LONG" | "SHORT" | null;
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  realizedReturnPct: number | null;
  // How the result was decided: a stop or target actually touched, or only the
  // drift in the plan's favour (or against it) by the end of the horizon.
  basis?: "TARGET" | "STOP" | "DRIFT" | null | undefined;
  horizon: string;
  note: string;
  resolvedAt: string;
};

export type LedgerEntry = HashedFields & {
  entryHash: string;
  score: LedgerScore | null;
};

export type LedgerAppend = {
  slotKey: string;
  status: LedgerStatus;
  source: LedgerSource;
  asset: string | null;
  timeframe: string | null;
  riskLevel: string | null;
  model: string | null;
  runId: string | null;
  ruledAt: string;
  report: unknown | null;
  missedReason: string | null;
  createdAt: string;
};

export interface LedgerRepository {
  readonly name: string;
  // Assigns seq and hashes atomically. Returns null when the slot already has an entry.
  append(input: LedgerAppend): Promise<LedgerEntry | null>;
  // Newest first.
  list(limit: number, offset: number): Promise<LedgerEntry[]>;
  get(seq: number): Promise<{ entry: LedgerEntry; report: unknown | null } | null>;
  // Oldest first, with snapshots, for verification and the track record.
  listAll(): Promise<Array<{ entry: LedgerEntry; report: unknown | null }>>;
  hasSlot(slotKey: string): Promise<boolean>;
  hasRun(runId: string): Promise<boolean>;
  setScore(seq: number, score: LedgerScore): Promise<void>;
  listUnscored(limit: number): Promise<Array<{ entry: LedgerEntry; report: unknown }>>;
  close(): Promise<void>;
}
