import { afterEach, expect, it, vi } from "vitest";
import { openImage } from "../src/background/imageMenu";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const open = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn(), set = vi.fn().mockResolvedValue(undefined), executeScript = vi.fn().mockResolvedValue([]);
  vi.stubGlobal("chrome", { sidePanel: { open }, tabs: { create }, scripting: { executeScript }, storage: { session: { set } },
    runtime: { getURL: (path: string) => "chrome-extension://example/" + path } });
  return { open, create, set, executeScript };
}
const tab = { id: 42 } as chrome.tabs.Tab;
const click = (srcUrl: string) => ({ srcUrl, frameId: 0 }) as chrome.contextMenus.OnClickData;

it("opens the side panel from the menu gesture and scopes the selected image to its tab", async () => {
  const { open, set } = setup();
  const work = openImage(click("https://example.org/diagram.png"), tab);
  expect(open).toHaveBeenCalledWith({ tabId: 42 });
  await work;
  expect(set).toHaveBeenCalledWith({ "lensImage:42": { id: expect.any(String), url: "https://example.org/diagram.png" } });
});

it("falls back to the reader tab and uses captured pixels for blob images", async () => {
  const { open, set, create, executeScript } = setup();
  open.mockRejectedValue(new Error("panel is unavailable"));
  executeScript.mockResolvedValue([{ result: "data:image/png;base64,AAAA" }]);
  await openImage(click("blob:https://example.org/id"), tab);
  expect(create).toHaveBeenCalledWith({ url: expect.stringContaining("reader.html?mode=image&tab=42") });
  expect(set).toHaveBeenCalledWith({ "lensImage:42": { id: expect.any(String), url: "data:image/png;base64,AAAA" } });
});
