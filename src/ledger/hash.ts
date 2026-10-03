import { createHash } from "node:crypto";

// Canonical JSON: object keys sorted recursively, no whitespace, undefined
// dropped. Anyone can recompute a digest from the published report with this
// rule alone.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalJson(item === undefined ? null : item)).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}";
}

export function sha256(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

export const GENESIS_HASH = sha256("cerebra-public-ledger-genesis");

export type HashedFields = {
  seq: number;
  prevHash: string;
  slotKey: string;
  status: "RULED" | "MISSED";
  source: "SCHEDULED" | "BACKFILL";
  asset: string | null;
  timeframe: string | null;
  riskLevel: string | null;
  model: string | null;
  runId: string | null;
  ruledAt: string;
  reportDigest: string | null;
  missedReason: string | null;
  createdAt: string;
};

export function computeEntryHash(fields: HashedFields): string {
  return sha256(canonicalJson(fields));
}

export function digestReport(report: unknown): string {
  return sha256(canonicalJson(report));
}
