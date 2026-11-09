import { beforeEach, describe, expect, it } from "vitest";
import { Renderer } from "@features/translate/content/render";
import type { ParaUnit } from "@features/translate/content/paragraphGrouper";

function unitOf(block: HTMLElement, text: string, renderMode: ParaUnit["renderMode"] = "block"): ParaUnit {
  const nodes: Text[] = [];
  for (const node of block.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? "").trim()) nodes.push(node as Text);
  }
  return { block, nodes, text, renderMode };
}

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.getElementById("b") as HTMLElement;
}

describe("Renderer placement", () => {
  beforeEach(() => setBody(""));

  it("inserts the translation right after the source text, not after later content", () => {
    const block = setBody("<div id='b'>Intro sentence.<ul><li>item</li></ul></div>");
    const r = new Renderer();
    r.register("a", unitOf(block, "Intro sentence."));
    r.applyTranslation("a", "介绍句。");

    const kids = [...block.childNodes];
    const trIndex = kids.findIndex((n) => (n as HTMLElement).dataset?.lensUi === "tr");
    const ulIndex = kids.findIndex((n) => (n as HTMLElement).tagName === "UL");
    expect(trIndex).toBeGreaterThan(-1);
    // The translation must sit between the source text and the nested list.
    expect(trIndex).toBeLessThan(ulIndex);
    expect(kids[trIndex].textContent).toBe("介绍句。");
  });

  it("appends when the source text is the last child", () => {
    const block = setBody("<p id='b'><em>Hi</em> there friend.</p>");
    const r = new Renderer();
    r.register("a", unitOf(block, "Hi there friend."));
    r.applyTranslation("a", "你好朋友。");
    expect((block.lastElementChild as HTMLElement).textContent).toBe("你好朋友。");
  });

  it("drops the injected line when the model returned the source unchanged", () => {
    const block = setBody("<p id='b'>Anthropic</p>");
    const r = new Renderer();
    r.register("a", unitOf(block, "Anthropic"));
    r.applyTranslation("a", "anthropic ");
    expect(block.querySelector("[data-lens-ui]")).toBeNull();
  });
});

describe("Renderer display mode", () => {
  it("switches bilingual <-> translation-only in place, without re-translating", () => {
    const block = setBody("<p id='b'>Original text.</p>");
    const r = new Renderer();
    r.register("a", unitOf(block, "Original text."));
    r.applyTranslation("a", "原文。");

    const tr = block.querySelector<HTMLElement>("[data-lens-ui='tr']")!;
    expect(tr.className).toBe("lens-block");
    expect(block.firstChild?.nodeValue).toBe("Original text.");

    r.setDisplayMode("replace");
    expect(tr.className).toBe("lens-replace");
    expect(block.firstChild?.nodeValue).toBe("");
    expect(tr.textContent).toBe("原文。");

    r.setDisplayMode("bilingual");
    expect(tr.className).toBe("lens-block");
    expect(block.firstChild?.nodeValue).toBe("Original text.");
  });

  it("renders straight into translation-only mode when that is the active mode", () => {
    const block = setBody("<p id='b'>Original text.</p>");
    const r = new Renderer();
    r.setDisplayMode("replace");
    r.register("a", unitOf(block, "Original text."));
    r.applyTranslation("a", "原文。");
    expect(block.firstChild?.nodeValue).toBe("");
    expect(block.textContent).toBe("原文。");
  });
});

describe("Renderer unresolved items", () => {
  it("reports pending segments and can clear their placeholders", () => {
    const block = setBody("<p id='b'>One.</p><p id='c'>Two.</p>");
    const second = document.getElementById("c") as HTMLElement;
    const r = new Renderer();
    r.register("a", unitOf(block, "One."));
    r.register("b", unitOf(second, "Two."));
    r.applyTranslation("a", "一。");

    expect(r.unresolvedSegments()).toEqual([{ id: "b", text: "Two." }]);

    r.dropUnresolved();
    expect(second.querySelector("[data-lens-ui]")).toBeNull();
    expect(second.dataset.lens).toBeUndefined();
    expect(r.unresolvedSegments()).toEqual([]);
    // The resolved one is untouched.
    expect(block.querySelector("[data-lens-ui]")?.textContent).toBe("一。");
  });

  it("counts an errored item as resolved so it is not re-submitted forever", () => {
    const block = setBody("<p id='b'>One.</p>");
    const r = new Renderer();
    r.register("a", unitOf(block, "One."));
    r.markError("a", "boom");
    expect(r.unresolvedSegments()).toEqual([]);
  });
});

describe("Renderer restore", () => {
  it("removes every injected node and restores hidden source text", () => {
    const block = setBody("<p id='b'>Original text.</p>");
    const html = block.outerHTML;
    const r = new Renderer();
    r.setDisplayMode("replace");
    r.register("a", unitOf(block, "Original text."));
    r.applyTranslation("a", "原文。");
    r.restoreAll();
    expect(block.outerHTML).toBe(html);
    expect(r.size).toBe(0);
  });
});

describe("Renderer regressions", () => {
  it("does not blank a paragraph whose translation matched the source", () => {
    const block = setBody("<p id='b'>Anthropic</p>");
    const r = new Renderer();
    r.register("a", unitOf(block, "Anthropic"));
    r.applyTranslation("a", "Anthropic"); // no-op translation -> the line is dropped
    r.setDisplayMode("replace");
    expect(block.textContent).toBe("Anthropic");
  });
});

describe("Renderer swap mode (page chrome)", () => {
  it("replaces the label in place and keeps the original in a tooltip", () => {
    const block = setBody("<a id='b' href='#'>Models overview</a>");
    const r = new Renderer();
    r.register("a", { ...unitOf(block, "Models overview"), renderMode: "swap" });

    // No placeholder while in flight — a nav row must not jitter.
    expect(block.querySelector("[data-lens-ui]")).toBeNull();

    r.applyTranslation("a", "模型概览");
    expect(block.textContent).toBe("模型概览");
    expect(block.title).toBe("Models overview");
    // Nothing is injected at all — the element's own box is left untouched.
    expect(block.querySelector("[data-lens-ui]")).toBeNull();
  });

  it("keeps the label INSIDE its button when the block is a wrapper", () => {
    // The real failure: <div><a class="btn">Console</a></div> put the
    // translation after the <a>, leaving an empty button with text beside it.
    const wrapper = setBody("<div id='b'><a class='btn' href='#'><span>Console</span></a></div>");
    const link = wrapper.querySelector("a") as HTMLElement;
    const textNode = link.querySelector("span")!.firstChild as Text;
    const r = new Renderer();
    r.register("a", { block: wrapper, nodes: [textNode], text: "Console", renderMode: "swap" });
    r.applyTranslation("a", "控制台");

    expect(link.textContent).toBe("控制台");
    // The wrapper must contain nothing but the link — no escaped text node.
    expect(wrapper.childElementCount).toBe(1);
    expect(normalizeSpace(wrapper.textContent)).toBe("控制台");
  });

  it("ignores the bilingual/translation-only switch", () => {
    const block = setBody("<a id='b' href='#'>Pricing</a>");
    const r = new Renderer();
    r.register("a", { ...unitOf(block, "Pricing"), renderMode: "swap" });
    r.applyTranslation("a", "定价");
    r.setDisplayMode("replace");
    r.setDisplayMode("bilingual");
    // Still swapped: chrome never gets a second line.
    expect(block.textContent).toBe("定价");
  });

  it("restores the original text and removes the tooltip it added", () => {
    const block = setBody("<a id='b' href='#'>Model cards</a>");
    const html = block.outerHTML;
    const r = new Renderer();
    r.register("a", { ...unitOf(block, "Model cards"), renderMode: "swap" });
    r.applyTranslation("a", "模型卡片");
    r.restoreAll();
    expect(block.outerHTML).toBe(html);
  });

  it("does not clobber a tooltip the page already had", () => {
    const block = setBody("<a id='b' href='#' title='Go to pricing'>Pricing</a>");
    const r = new Renderer();
    r.register("a", { ...unitOf(block, "Pricing"), renderMode: "swap" });
    r.applyTranslation("a", "定价");
    expect(block.title).toBe("Go to pricing");
  });
});

function normalizeSpace(text: string | null): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}
