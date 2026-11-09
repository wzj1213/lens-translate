import { describe, expect, it } from "vitest";
import { looksUntranslatable } from "@shared/util";

describe("looksUntranslatable", () => {
  it("skips model / version / product identifiers (chart labels)", () => {
    for (const name of [
      "GPT-5.5",
      "Claude Opus 4.8 (max)",
      "Gemini 3.1 Pro Preview",
      "Grok 4.3 (high)",
      "Kimi K2.6",
      "MiniMax-M3",
      "gpt-oss-120b",
      "gpt-oss-120b (high)",
      "DeepSeek V2.5-Pro",
      "Nemotron 3 Ultra",
      "v1.2.0",
      "COVID-19",
    ]) {
      expect(looksUntranslatable(name), name).toBe(true);
    }
  });

  it("translates real UI labels and prose", () => {
    for (const label of [
      "Intelligence",
      "Speed",
      "Price",
      "Models",
      "Coding Agents",
      "Hardware",
      "Leaderboards",
      "About",
      "AI Trends",
      "Arenas",
      "Log in",
      "Changelog",
      "Personalized model recommender",
      "Speech, Image, Video, Music",
      "Top 10 models",
      "What is the Artificial Analysis Intelligence Index?",
      "NVIDIA Nemotron 3 Ultra released: fast, intelligent, and open",
    ]) {
      expect(looksUntranslatable(label), label).toBe(false);
    }
  });

  it("ignores empty / symbol-only / long text", () => {
    expect(looksUntranslatable("")).toBe(false);
    expect(looksUntranslatable("123")).toBe(false); // no letters
    expect(looksUntranslatable("a".repeat(60))).toBe(false); // too long -> prose
  });
});
