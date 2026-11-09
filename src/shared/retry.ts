export interface ApiErrorLike {
  name?: string;
  status?: number;
  retryAfter?: string | null;
  retryable?: boolean;
}

export function isRetryable(error: ApiErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.retryable) return true;
  if (error.name === "AbortError") return true;
  if (typeof error.status === "number") {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  return false;
}

/**
 * Backoff with jitter. Honors a numeric `Retry-After` (seconds) when present.
 * `rand` is injectable for deterministic tests.
 */
export function getRetryDelayMs(
  error: ApiErrorLike | null | undefined,
  attempt: number,
  rand: () => number = Math.random,
): number {
  const retryAfter = error?.retryAfter;
  if (retryAfter != null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(500, seconds * 1000);
  }
  const base = 800 * 2 ** attempt;
  return base + Math.floor(rand() * 300);
}
