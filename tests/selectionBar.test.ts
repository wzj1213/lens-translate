import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelectionInfo } from "@content/selection-util";
import { SelectionBar } from "@content/selection-bar";

let bar: SelectionBar;
let action: ReturnType<typeof vi.fn>;
const visible = () => document.querySelector('.lens-selbar[data-visible="true"]');

function select(selector = "p"): void {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(selector)!);
  const rect = new DOMRect(100, 220, 140, 24);
  range.getClientRects = () => [rect] as unknown as DOMRectList;
  range.getBoundingClientRect = () => rect;
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function mouseUp(): void {
  document.querySelector("p")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  vi.advanceTimersByTime(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<p>Selected paragraph</p><div contenteditable="true">Editor text</div>';
  action = vi.fn();
  bar = new SelectionBar(action);
  bar.init();
  select();
});

afterEach(() => {
  bar.destroy();
  window.getSelection()!.removeAllRanges();
  vi.useRealTimers();
});

describe("selection toolbar modes", () => {
  it("does not flash before settings load, then shows on selection in auto mode", () => {
    mouseUp();
    expect(visible()).toBeNull();
    bar.setMode("auto");
    mouseUp();
    expect(visible()).not.toBeNull();
  });

  it("stays quiet in manual mode and opens below the selection on explicit request", () => {
    bar.setMode("manual");
    mouseUp();
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    vi.runAllTimers();
    expect(visible()).toBeNull();
    expect(bar.openManually()).toBe(true);
    expect((visible() as HTMLElement).style.top).toBe("252px");
    const buttons = visible()!.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("translateSelection");
    buttons[0].click();
    expect(visible()).toBeNull();
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ text: "Selected paragraph" }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape" }));
    expect(visible()).toBeNull();
  });

  it("off blocks the toolbar while leaving selection available to translation shortcuts", () => {
    bar.setMode("off");
    mouseUp();
    expect(bar.openManually()).toBe(false);
    expect(visible()).toBeNull();
    expect(getSelectionInfo()?.text).toBe("Selected paragraph");
  });

  it("changing the mode cancels pending auto display and hides an open toolbar", () => {
    bar.setMode("auto");
    document.dispatchEvent(new MouseEvent("mouseup"));
    bar.setMode("manual");
    vi.runAllTimers();
    expect(visible()).toBeNull();
    bar.openManually();
    bar.setMode("off");
    expect(visible()).toBeNull();
  });

  it("leaves editor selections alone automatically, with manual actions still available", () => {
    bar.setMode("auto");
    select("[contenteditable]");
    mouseUp();
    expect(visible()).toBeNull();
    expect(bar.openManually()).toBe(true);
    expect(getSelectionInfo()?.text).toBe("Editor text");
  });

  it("rechecks editability after the event delay", () => {
    bar.setMode("auto");
    document.dispatchEvent(new MouseEvent("mouseup"));
    select("[contenteditable]");
    vi.runAllTimers();
    expect(visible()).toBeNull();
  });

  it("does not recreate a toolbar from a timer after teardown", () => {
    bar.setMode("auto");
    document.dispatchEvent(new MouseEvent("mouseup"));
    bar.destroy();
    vi.runAllTimers();
    expect(document.querySelector(".lens-selbar")).toBeNull();
  });

  it("requires a real selection for manual opening", () => {
    bar.setMode("manual");
    window.getSelection()!.removeAllRanges();
    expect(bar.openManually()).toBe(false);
    expect(visible()).toBeNull();
  });
});
