import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSingleMessages } from "@shared/prompt";
import { createCacheKey } from "@shared/cacheKey";
import { nativeTranslate, sourceLanguage } from "@shared/nativeTranslator";
import { profileFor } from "@features/translate/content/siteProfile";
import { isYouTubeVideo } from "@features/translate/content/captions";
import { recognizedText } from "../src/reader/ocr";
import { paragraphs } from "../src/reader/pdf";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("separates homonyms in two sentences and in the persistent cache", async () => {
  const input = { endpoint: "https://example.test", model: "test", targetLang: "Chinese" };
  const river = "We sat on the river bank.", money = "The bank approved the loan.";
  const msg = buildSingleMessages("bank", { ...input, context: { title: "", host: "", sentence: river } });
  expect(JSON.parse(msg[1].content)).toEqual({ selection: "bank", sentence: river });
  expect(msg[0].content).toMatch(/Explain.*sentence/);
  expect(await createCacheKey({ ...input, context: river }, "bank")).not.toBe(await createCacheKey({ ...input, context: money }, "bank"));
});

describe("on-device translation", () => {
  it("reuses a ready translator for the same language pair", async () => {
    const translate = vi.fn(async (text: string) => "local " + text);
    const api = { availability: vi.fn().mockResolvedValue("available"), create: vi.fn().mockResolvedValue({ translate }) };
    vi.stubGlobal("Translator", api);
    expect(await nativeTranslate("Hello world", "de", "en")).toBe("local Hello world");
    await nativeTranslate("Next page", "de", "en");
    expect(api.create).toHaveBeenCalledExactlyOnceWith({ sourceLanguage: "en", targetLanguage: "de" });
  });
  it("uses Chrome's supported Chinese language-pack identifiers", async () => {
    const create = vi.fn().mockResolvedValue({ translate: async () => "译文" });
    vi.stubGlobal("Translator", { availability: async () => "available", create });
    await nativeTranslate("winter sky", "简体中文", "en-US");
    await nativeTranslate("winter sky", "zh-TW", "en");
    expect(create.mock.calls.map(([pair]) => pair.targetLanguage)).toEqual(["zh", "zh-Hant"]);
  });
  it("presents a downloadable pair for consent and cleans up on abort", async () => {
    const create = vi.fn();
    vi.stubGlobal("Translator", { availability: async () => "downloadable", create });
    const c = new AbortController();
    const work = nativeTranslate("Hello", "fr", "en", c.signal);
    await vi.waitFor(() => expect(document.querySelector("[data-lens-ui=language-pack]")).not.toBeNull());
    (document.querySelector("[data-lens-ui=language-pack] button") as HTMLElement).click();
    expect(create).not.toHaveBeenCalled();
    c.abort(); await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(document.querySelector("[data-lens-ui=language-pack]")).toBeNull();
  });
  it("reports unsupported pairs and uses a Latin fallback on a Chinese site", async () => {
    vi.stubGlobal("Translator", { availability: async () => "unavailable" });
    await expect(nativeTranslate("Good day", "it", "en")).rejects.toThrow();
    expect(await sourceLanguage("keyboard", "zh-CN")).toBe("en");
    expect(await sourceLanguage("今日は", "en")).toBe("ja");
  });
});

it("limits the GitHub reading profile to issue and pull-request details", () => {
  const rule = profileFor(new URL("https://github.com/alpha/beta/pull/3/files"))!;
  document.body.innerHTML = "<main><h1>Title</h1><section class='markdown-body'><p>Comment</p><pre>source</pre></section><div class='diff-table'>patch</div></main>";
  expect(document.querySelector("p")!.closest(rule.include)).toBeTruthy();
  expect(document.querySelector("pre")!.closest(rule.exclude)).toBeTruthy();
  expect(document.querySelector(".diff-table")!.matches(rule.exclude)).toBe(true);
  expect(profileFor(new URL("https://github.com/alpha/beta/tree/main"))).toBeUndefined();
  expect(profileFor(new URL("https://github.com.example/alpha/beta/issues/4"))).toBeUndefined();
});

it("keeps PDF columns apart while merging consecutive lines", () => {
  const box = (text: string, x: number, y: number) => ({ text, x, y, w: 65, h: 10 });
  expect(paragraphs([box("First line", 12, 20), box("second line", 12, 32), box("Other column", 230, 20)])
    .map(block => block.text)).toEqual(["First line second line", "Other column"]);
});

it("enables captions only for YouTube videos and Shorts", () => {
  expect(isYouTubeVideo(new URL("https://www.youtube.com/watch?v=123"))).toBe(true);
  expect(isYouTubeVideo(new URL("https://m.youtube.com/shorts/123"))).toBe(true);
  expect(isYouTubeVideo(new URL("https://www.youtube.com/feed/history"))).toBe(false);
  expect(isYouTubeVideo(new URL("https://youtube.com.example/watch?v=123"))).toBe(false);
});

it("removes OCR spacing between CJK characters and retains English spaces and line breaks", () => {
  expect(recognizedText(" 中 文 图 片 API Key\n日 本 語 の 文字 ", "jpn")).toBe("中文图片 API Key\n日本語の文字");
  expect(recognizedText("OPEN THE READING ROOM", "eng")).toBe("OPEN THE READING ROOM");
});
