import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTranslation } from "@features/translate/background/translator";
import { DEFAULT_SETTINGS } from "@shared/constants";
import type { Settings } from "@shared/types";

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  endpoint: "https://api.example.com/v1",
  model: "test-model",
  apiKey: "sk-test",
};

/** Capture the outgoing request body and reply with a canned assistant message. */
function stubFetch(reply: string): { body: () => any } {
  let sent: any;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
    } as unknown as Response;
  });
  return { body: () => sent };
}

afterEach(() => vi.unstubAllGlobals());

describe("requestTranslation wire protocol", () => {
  const items = [
    { id: "seg_9f1c0e7a-1111-4f0a-9b6d-2b3c4d5e6f70", text: "Hello there." },
    { id: "seg_9f1c0e7a-2222-4f0a-9b6d-2b3c4d5e6f70", text: "Goodbye now." },
  ];

  it("sends short ordinal ids instead of the long segment ids", async () => {
    const captured = stubFetch('{"items":[{"id":"1","translated":"你好。"},{"id":"2","translated":"再见。"}]}');
    await requestTranslation(items, settings, new AbortController().signal);

    const user = JSON.parse(captured.body().messages.at(-1).content);
    expect(user.items.map((i: { id: string }) => i.id)).toEqual(["1", "2"]);
    // The uuid-based ids must never reach the model.
    expect(JSON.stringify(captured.body())).not.toContain("seg_");
  });

  it("maps ordinals back to the real segment ids", async () => {
    stubFetch('{"items":[{"id":"2","translated":"再见。"},{"id":"1","translated":"你好。"}]}');
    const out = await requestTranslation(items, settings, new AbortController().signal);
    expect(out).toEqual([
      { id: items[1].id, translated: "再见。" },
      { id: items[0].id, translated: "你好。" },
    ]);
  });

  it("accepts numeric ids and ignores unknown / duplicate ones", async () => {
    stubFetch('{"items":[{"id":1,"translated":"你好。"},{"id":1,"translated":"重复"},{"id":9,"translated":"不存在"}]}');
    const out = await requestTranslation(items, settings, new AbortController().signal);
    expect(out).toEqual([{ id: items[0].id, translated: "你好。" }]);
  });

  it("throws when nothing usable came back", async () => {
    stubFetch("sorry, I cannot do that");
    await expect(requestTranslation(items, settings, new AbortController().signal)).rejects.toThrow();
  });
});

/** Minimal SSE Response stub that hands the reader one chunk at a time. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined },
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe("streaming batches", () => {
  const items = [
    { id: "seg_a", text: "Hello there." },
    { id: "seg_b", text: "Goodbye now." },
  ];
  const body = '{"items":[{"id":"1","translated":"你好。"},{"id":"2","translated":"再见。"}]}';

  it("delivers each item as it completes and never duplicates it in the result", async () => {
    const streaming = { ...settings, endpoint: "https://stream.example.com/v1" };
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      // Split mid-way through the first item so a partial object is seen too.
      return sseResponse([sse(body.slice(0, 28)), sse(body.slice(28, 46)), sse(body.slice(46)), "data: [DONE]\n\n"]);
    });

    const partial: string[][] = [];
    const out = await requestTranslation(items, streaming, new AbortController().signal, (rows) =>
      partial.push(rows.map((r) => r.id)),
    );

    expect(sent[0].stream).toBe(true);
    // Item 1 was handed over before item 2 finished streaming.
    expect(partial).toEqual([["seg_a"], ["seg_b"]]);
    expect(out).toEqual([
      { id: "seg_a", translated: "你好。" },
      { id: "seg_b", translated: "再见。" },
    ]);
  });

  it("does not stream when no partial callback is given", async () => {
    const captured = stubFetch(body);
    await requestTranslation(items, { ...settings, endpoint: "https://plain.example.com/v1" }, new AbortController().signal);
    expect(captured.body().stream).toBe(false);
  });

  it("falls back to a non-streaming request when the server rejects streaming", async () => {
    const picky = { ...settings, endpoint: "https://picky.example.com/v1" };
    const sent: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(String(init.body));
      sent.push(parsed);
      if (parsed.stream) {
        return {
          ok: false,
          status: 400,
          headers: new Headers(),
          text: async () => "stream unsupported",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: body } }] }),
      } as unknown as Response;
    });

    const out = await requestTranslation(items, picky, new AbortController().signal, () => undefined);
    expect(sent.map((s) => s.stream)).toEqual([true, false]);
    expect(out).toHaveLength(2);

    // The endpoint is remembered, so the next batch goes straight to non-streaming.
    sent.length = 0;
    await requestTranslation(items, picky, new AbortController().signal, () => undefined);
    expect(sent.map((s) => s.stream)).toEqual([false]);
  });
});
