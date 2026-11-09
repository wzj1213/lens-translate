import { describe, expect, it } from "vitest";
import { packBatches } from "@shared/batch";

const item = (text: string) => ({ text });

describe("packBatches", () => {
  it("splits by item count", () => {
    const items = Array.from({ length: 5 }, (_, i) => item(`t${i}`));
    const batches = packBatches(items, { batchMaxItems: 2, batchMaxChars: 10000 });
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("splits by character budget", () => {
    const items = [item("a".repeat(60)), item("b".repeat(60)), item("c".repeat(10))];
    const batches = packBatches(items, { batchMaxItems: 100, batchMaxChars: 100 });
    expect(batches.length).toBe(2);
    expect(batches[0].length).toBe(1);
    expect(batches[1].length).toBe(2);
  });

  it("keeps an oversized item in its own batch rather than dropping it", () => {
    const items = [item("x".repeat(500))];
    const batches = packBatches(items, { batchMaxItems: 10, batchMaxChars: 100 });
    expect(batches.length).toBe(1);
    expect(batches[0][0].text.length).toBe(500);
  });

  it("returns no batches for no items", () => {
    expect(packBatches([], { batchMaxItems: 10, batchMaxChars: 100 })).toEqual([]);
  });
});
