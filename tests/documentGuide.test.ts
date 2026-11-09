import { afterEach, expect, it, vi } from "vitest";
import { TranslationSession } from "@features/translate/background/sessionManager";
import { PersistentCache } from "@features/translate/background/persistentCache";

afterEach(() => vi.unstubAllGlobals());

it("reuses the page guide, keeps manual terminology and falls back if the analysis fails", async () => {
  const options = { endpoint: "https://guide.test/v1", glossary: "Star=用户译法", cacheEnabled: false };
  vi.stubGlobal("chrome", { storage: { local: { get: async () => ({ lensSettings: options }) } } });
  const prompts: string[] = [];
  let analyses = 0;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const messages = JSON.parse(String(init.body)).messages;
    const input = JSON.parse(messages.at(-1).content);
    let content: string;
    if (input.sample) {
      analyses++;
      if (input.sample.startsWith("Failure")) throw new Error("temporary issue");
      content = JSON.stringify({ topic: "night sky", terms: [{ from: "star", to: "automatic" }, { from: "orbit", to: "轨道" }] });
    } else {
      prompts.push(messages[0].content);
      content = JSON.stringify({ items: [{ id: "1", translated: "正文" }] });
    }
    return Response.json({ choices: [{ message: { content } }] });
  });
  const run = async (sample: string) => {
    const post = vi.fn();
    const port = { sender: { documentId: "doc", tab: { url: "https://example.test", title: "Field notes" } }, postMessage: post };
    const session = new TranslationSession(port as unknown as chrome.runtime.Port, new PersistentCache({ maxEntries: 10 }));
    await session.start([{ id: "paragraph", text: "The orbit of a star." }], sample);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "TRANSLATION_RESULT" })));
  };
  const sample = "Astrophysics. ".repeat(180);
  await run(sample); await run(sample);
  expect(analyses).toBe(1);
  for (const prompt of prompts) {
    expect(prompt).toContain("Star => 用户译法");
    expect(prompt).toContain("orbit => 轨道");
    expect(prompt).toContain("night sky");
    expect(prompt).not.toContain("automatic");
  }
  await run("Failure " + sample);
  expect(prompts.at(-1)).not.toContain("night sky");
  expect(prompts.at(-1)).toContain("Star => 用户译法");
});
