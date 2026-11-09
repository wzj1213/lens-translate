import { describe, expect, it } from "vitest";
import { getRetryDelayMs, isRetryable } from "@shared/retry";

describe("isRetryable", () => {
  it("retries on 408/425/429 and 5xx", () => {
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 408 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
  });
  it("does not retry on 4xx (other than the throttling codes)", () => {
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
  });
  it("retries explicit flags and aborts/timeouts", () => {
    expect(isRetryable({ retryable: true })).toBe(true);
    expect(isRetryable({ name: "AbortError" })).toBe(true);
  });
  it("does not retry unknown errors", () => {
    expect(isRetryable({})).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});

describe("getRetryDelayMs", () => {
  it("honors a numeric Retry-After header", () => {
    expect(getRetryDelayMs({ retryAfter: "3" }, 0, () => 0)).toBe(3000);
  });
  it("uses exponential backoff with deterministic jitter", () => {
    expect(getRetryDelayMs({}, 0, () => 0)).toBe(800);
    expect(getRetryDelayMs({}, 1, () => 0)).toBe(1600);
    expect(getRetryDelayMs({}, 2, () => 0.999)).toBe(3200 + 299);
  });
});
