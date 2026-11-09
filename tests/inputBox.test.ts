import { afterEach, expect, it, vi } from "vitest";
import { translateFocusedInput, undoInput } from "@features/translate/content/inputBox";
import { translateText } from "@shared/translateText";
import { DEFAULT_SETTINGS } from "@shared/constants";

vi.mock("@shared/settings", () => ({ loadSettings: async () => ({ ...DEFAULT_SETTINGS, writingLang: "French" }) }));
vi.mock("@shared/translateText", () => ({ translateText: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); });

function draft(value: string) {
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus(); field.value = value;
  return field;
}

it("preserves edits made while an input translation is in flight", async () => {
  let finish!: (text: string) => void;
  vi.mocked(translateText).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const field = draft("Original draft");
  const work = translateFocusedInput();
  field.value += " with edits";
  finish("ancienne traduction"); await work;
  expect(field.value).toBe("Original draft with edits");
  expect(undoInput()).toBe(false);
});

it("uses the independent writing target and restores the exact draft", async () => {
  const field = draft("  Hello there!  ");
  vi.mocked(translateText).mockResolvedValueOnce("Bonjour !");
  await translateFocusedInput();
  expect(translateText).toHaveBeenCalledWith("Hello there!", expect.objectContaining({ targetLang: "French" }));
  expect(field.value).toBe("Bonjour !");
  expect(undoInput()).toBe(true);
  expect(field.value).toBe("  Hello there!  ");
});

it("uses a one-shot language override without overwriting subsequent typing", async () => {
  const field = draft("/ja See you tomorrow");
  vi.mocked(translateText).mockResolvedValueOnce("また明日");
  await translateFocusedInput();
  expect(translateText).toHaveBeenCalledWith("See you tomorrow", expect.objectContaining({ targetLang: "ja" }));
  field.value += "!";
  expect(undoInput()).toBe(false);
});
