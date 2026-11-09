import { describe, expect, it } from "vitest";
import { detectBaseLang, shouldSkipTranslation, targetLangToCode } from "@shared/langDetect";

describe("detectBaseLang", () => {
  it("detects Chinese Han text", () => {
    expect(detectBaseLang("这是一段中文文本")).toBe("zh");
  });
  it("detects Japanese (kana wins over Han)", () => {
    expect(detectBaseLang("これは日本語のテキストです")).toBe("ja");
  });
  it("detects Korean before Han", () => {
    expect(detectBaseLang("이것은 한국어 문장입니다")).toBe("ko");
  });
  it("detects Latin / Cyrillic", () => {
    expect(detectBaseLang("This is plain english text")).toBe("latin");
    expect(detectBaseLang("Это русский текст")).toBe("ru");
  });
});

describe("targetLangToCode", () => {
  it("maps common target labels", () => {
    expect(targetLangToCode("简体中文")).toBe("zh");
    expect(targetLangToCode("English")).toBe("en");
    expect(targetLangToCode("日本語")).toBe("ja");
  });
});

describe("shouldSkipTranslation", () => {
  it("skips Chinese text when target is Chinese", () => {
    expect(shouldSkipTranslation("已经是中文了", "简体中文")).toBe(true);
  });
  it("does not skip English when target is Chinese", () => {
    expect(shouldSkipTranslation("This is english", "简体中文")).toBe(false);
  });
  it("skips obvious English when target is English", () => {
    expect(shouldSkipTranslation("This is the text that we want to read", "English")).toBe(true);
  });
  it("does not skip French when target is English", () => {
    expect(shouldSkipTranslation("Bonjour ceci provient du journal matinal", "English")).toBe(false);
  });
});
