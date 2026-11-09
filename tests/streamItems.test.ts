import { describe, expect, it } from "vitest";
import { createItemScanState, scanCompletedItems } from "@shared/streamItems";

/** Feed a payload in arbitrary slices, collecting everything the scanner emits. */
function feed(chunks: string[]): Array<{ id: string; translated: string }> {
  const state = createItemScanState();
  const out: Array<{ id: string; translated: string }> = [];
  let buffer = "";
  for (const chunk of chunks) {
    buffer += chunk;
    out.push(...scanCompletedItems(buffer, state));
  }
  return out;
}

const FULL = '{"items":[{"id":"1","translated":"你好。"},{"id":"2","translated":"再见。"}]}';

describe("scanCompletedItems", () => {
  it("emits each item as soon as it closes, not at the end", () => {
    const state = createItemScanState();
    const head = '{"items":[{"id":"1","translated":"你好。"},{"id":"2","transl';
    expect(scanCompletedItems(head, state)).toEqual([{ id: "1", translated: "你好。" }]);
    expect(scanCompletedItems(FULL, state)).toEqual([{ id: "2", translated: "再见。" }]);
  });

  it("emits nothing when re-scanned with an unchanged buffer", () => {
    const state = createItemScanState();
    expect(scanCompletedItems(FULL, state)).toHaveLength(2);
    expect(scanCompletedItems(FULL, state)).toEqual([]);
  });

  it("is independent of how the stream is chopped up", () => {
    const expected = [
      { id: "1", translated: "你好。" },
      { id: "2", translated: "再见。" },
    ];
    expect(feed(FULL.split(""))).toEqual(expected); // one character at a time
    expect(feed([FULL.slice(0, 30), FULL.slice(30)])).toEqual(expected);
    expect(feed([FULL])).toEqual(expected);
  });

  it("ignores braces and quotes inside string values", () => {
    const payload = '{"items":[{"id":"1","translated":"这是 {\\"a\\": 1} 的说明 \\\\"}]}';
    expect(feed([payload])).toEqual([{ id: "1", translated: '这是 {"a": 1} 的说明 \\' }]);
  });

  it("rejects the wrapper object and incomplete items", () => {
    expect(feed(['{"items":[]}'])).toEqual([]);
    expect(feed(['{"items":[{"id":"1"}]}'])).toEqual([]);
    expect(feed(['{"items":[{"id":"1","translated":""}]}'])).toEqual([]);
  });

  it("accepts numeric ids, a bare array, and alternate value keys", () => {
    expect(feed(['[{"id":1,"translation":"你好。"}]'])).toEqual([{ id: "1", translated: "你好。" }]);
  });

  it("tolerates markdown fences and prose around the JSON", () => {
    expect(feed(['Sure!\n```json\n{"items":[{"id":"1","translated":"你好。"}]}\n```'])).toEqual([
      { id: "1", translated: "你好。" },
    ]);
  });
});
