import type { FastifyReply, FastifyRequest } from "fastify";

// Guards the anonymous, no-agent-key path (case creation + the synchronous run
// endpoint) from burning real Bitget/model-provider budget. Authenticated agent
// requests are never limited here — only requests with no bearer key at all.
const WINDOW_MS = 15 * 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;

type Bucket = { count: number; resetAt: number };

// The underlying Fastify instance is constructed with no trustProxy option, so
// request.ip always resolves to the platform's edge/proxy address, not the
// visitor's. Railway's edge reliably sets X-Forwarded-For, so read that instead.
function clientKey(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first?.split(",")[0]?.trim();
  return ip || request.ip;
}

export function createAnonymousRateLimit(options: {
  windowMs?: number | undefined;
  maxRequests?: number | undefined;
  now?: (() => number) | undefined;
} = {}) {
  const windowMs = options.windowMs ?? WINDOW_MS;
  const maxRequests = options.maxRequests ?? MAX_REQUESTS_PER_WINDOW;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  function sweepExpired(currentTime: number) {
    if (buckets.size < 500) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= currentTime) buckets.delete(key);
    }
  }

  return async function anonymousRateLimit(request: FastifyRequest, reply: FastifyReply) {
    if (request.headers.authorization) return;

    const currentTime = now();
    const key = clientKey(request);
    sweepExpired(currentTime);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= currentTime) {
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
      return;
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
      reply.header("retry-after", String(retryAfterSeconds));
      return reply.code(429).send({
        error: "ANONYMOUS_RATE_LIMITED",
        message: "Too many anonymous court requests from this address. Register an agent for unlimited access, or try again later.",
        retryAfterSeconds,
      });
    }
  };
}
