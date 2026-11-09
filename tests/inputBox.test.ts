import { afterEach, expect, it, vi } from "vitest";
import { translateFocusedInput } from "@features/translate/content/inputBox";
import type { SelectionOutbound } from "@shared/types";

afterEach(() => vi.unstubAllGlobals());

it("preserves edits made while an input translation is in flight", () => {
  let receive!: (message: SelectionOutbound) => void;
  const port = {
    onMessage: { addListener: (listener: typeof receive) => { receive = listener; } },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };
  vi.stubGlobal("chrome", { runtime: { id: "test", connect: () => port } });
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus();
  field.value = "Original draft";
  translateFocusedInput();
  expect(port.postMessage).toHaveBeenCalledWith({ type: "TRANSLATE", text: "Original draft" });
  field.value += " with edits";
  receive({ type: "DONE", translated: "旧译文", fromCache: false });
  expect(field.value).toBe("Original draft with edits");
  translateFocusedInput();
  receive({ type: "DONE", translated: "新译文", fromCache: false });
  expect(field.value).toBe("新译文");
});
