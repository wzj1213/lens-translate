import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/constants";
import { protectMessages } from "@shared/privacy";
import { requestTranslation, requestTranslationStream, requestDocumentGuide } from "@features/translate/background/translator";

afterEach(() => vi.unstubAllGlobals());
const pii = "Email test.user+news@example.org or call +1 (415) 555-0100.";
const settings = { ...DEFAULT_SETTINGS, endpoint: "https://example.test/v1", model: "test" };
const signal = new AbortController().signal;

it("uses a new reversible token map on every request and honors opt-out", () => {
  const source = [{ role: "user" as const, content: pii + " 手机：13800138000。" }];
  const a = protectMessages(source, true), b = protectMessages(source, true);
  expect(a.messages[0].content).not.toMatch(/example|415|13800138000/);
  expect(a.messages[0].content).not.toEqual(b.messages[0].content);
  expect(a.restore(a.messages[0].content)).toBe(source[0].content);
  expect(protectMessages(source, false).messages).toBe(source);
});

it.each(["openai", "anthropic"] as const)("redacts inputs and restores output for %s batches, context and guides", async protocol => {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const raw = String(init.body), body = JSON.parse(raw);
    expect(raw).not.toMatch(/test\.user|example\.org|415|555-0100/);
    const user = body.messages.at(-1).content;
    const data = JSON.parse(user);
    const output = data.items ? JSON.stringify({ items: [{ id: "1", translated: data.items[0].text }] })
      : data.sample ? JSON.stringify({ topic: data.sample, terms: [] }) : data.sentence;
    return Response.json(protocol === "openai" ? { choices: [{ message: { content: output } }] } : { content: [{ type: "text", text: output }] });
  });
  const config = { ...settings, protocol, glossary: "contact=" + pii };
  expect((await requestTranslation([{ id: "a", text: pii }], config, signal, undefined, { title: pii, host: "" }))[0].translated).toBe(pii);
  expect(await requestTranslationStream("contact", config, signal, () => {}, { title: "", host: "", sentence: pii })).toBe(pii);
  expect((await requestDocumentGuide(pii, config, signal)).topic).toBe(pii);
});

it("restores a token split across SSE frames before showing any deltas", async () => {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const text = JSON.parse(String(init.body)).messages.at(-1).content;
    const pos = text.indexOf("__LENS_") + 11;
    const sse = [text.slice(0, pos), text.slice(pos)].map(content => "data: " + JSON.stringify({ choices: [{ delta: { content } }] }) + "\n\n").join("");
    return new Response(sse + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  const chunks: string[] = [];
  expect(await requestTranslationStream(pii, settings, signal, x => chunks.push(x))).toBe(pii);
  expect(chunks.join("")).toBe(pii);
  expect(chunks.every(x => !x.includes("__LENS_"))).toBe(true);
});
