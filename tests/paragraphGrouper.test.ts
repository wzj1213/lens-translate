import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectUnits,
  collectUnitsIn,
  groupParagraphs,
  isTranslatableTextValue,
  setTranslateUiText,
  toUnit,
} from "@features/translate/content/paragraphGrouper";

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe("isTranslatableTextValue", () => {
  it("accepts real prose", () => {
    expect(isTranslatableTextValue("Hello world")).toBe(true);
  });
  it("rejects whitespace, single chars, urls and symbols", () => {
    expect(isTranslatableTextValue("   ")).toBe(false);
    expect(isTranslatableTextValue("a")).toBe(false);
    expect(isTranslatableTextValue("https://example.com/page")).toBe(false);
    expect(isTranslatableTextValue("=== >>> ###")).toBe(false);
  });
});

describe("groupParagraphs", () => {
  beforeEach(() => setBody(""));

  it("groups inline text nodes under one block into a single unit", () => {
    setBody("<p>This is <a href='#'>a link</a> and <strong>bold</strong> text.</p>");
    const groups = groupParagraphs(document.body);
    expect(groups.size).toBe(1);
    const [block, nodes] = [...groups.entries()][0];
    expect(block.tagName).toBe("P");
    const unit = toUnit(block, nodes);
    expect(unit?.text).toBe("This is a link and bold text.");
    expect(unit?.renderMode).toBe("block");
  });

  it("separates nested blocks into distinct units", () => {
    setBody("<div><p>First paragraph here.</p><p>Second paragraph here.</p></div>");
    const groups = groupParagraphs(document.body);
    expect(groups.size).toBe(2);
    for (const block of groups.keys()) expect(block.tagName).toBe("P");
  });

  it("skips code, script and style content", () => {
    setBody("<p>Run <code>npm install now</code></p><script>var x = 'hello world'</script>");
    const groups = groupParagraphs(document.body);
    const texts = [...groups.entries()].map(([b, n]) => toUnit(b, n)?.text);
    expect(texts).toContain("Run");
    expect(texts.join(" ")).not.toContain("npm install");
    expect(texts.join(" ")).not.toContain("var x");
  });

  it("skips hidden subtrees", () => {
    setBody("<p style='display:none'>Hidden paragraph text</p><p>Visible paragraph text</p>");
    const groups = groupParagraphs(document.body);
    const texts = [...groups.entries()].map(([b, n]) => toUnit(b, n)?.text);
    expect(texts).toEqual(["Visible paragraph text"]);
  });

  // Table CELLS render a real, visible translation: hiding a whole table's
  // translation in tooltips was a top bilingual-mode complaint. Only containers
  // that cannot legally hold a <span> fall back to attribute mode.
  it("renders long table-cell text as a block", () => {
    setBody("<table><tr><td>Some cell content here that is fairly long</td></tr></table>");
    const groups = groupParagraphs(document.body);
    const [block, nodes] = [...groups.entries()][0];
    expect(toUnit(block, nodes)?.renderMode).toBe("block");
  });

  it("keeps short table-cell text inline so rows do not jump", () => {
    setBody("<table><tr><td>Total cost</td></tr></table>");
    const groups = groupParagraphs(document.body);
    const [block, nodes] = [...groups.entries()][0];
    expect(toUnit(block, nodes)?.renderMode).toBe("inline");
  });

  it("uses attribute mode for containers that cannot hold a child node", () => {
    setBody("<div role='row'>Some row level content here</div>");
    const groups = groupParagraphs(document.body);
    const [block, nodes] = [...groups.entries()][0];
    expect(toUnit(block, nodes)?.renderMode).toBe("attribute");
  });
});

describe("collectUnitsIn (subtree scans drive scroll passes)", () => {
  beforeEach(() => setBody(""));

  it("collects only the requested subtrees", () => {
    setBody("<div id='a'><p>Inside the scanned subtree.</p></div><p>Outside the subtree entirely.</p>");
    const units = collectUnitsIn([document.getElementById("a") as HTMLElement]);
    expect(units.map((u) => u.text)).toEqual(["Inside the scanned subtree."]);
  });

  it("re-groups the whole paragraph when the added node sits inside one", () => {
    setBody("<p id='p'>Start of the paragraph <span id='s'>and the added tail here</span></p>");
    const units = collectUnitsIn([document.getElementById("s") as HTMLElement]);
    expect(units).toHaveLength(1);
    // Must translate the paragraph as a whole, not just the inserted fragment.
    expect(units[0].block.id).toBe("p");
    expect(units[0].text).toBe("Start of the paragraph and the added tail here");
  });

  it("skips roots that are no longer in the document", () => {
    setBody("<div id='a'><p>Some detached paragraph text.</p></div>");
    const root = document.getElementById("a") as HTMLElement;
    root.remove();
    expect(collectUnitsIn([root])).toEqual([]);
  });
});

describe("page chrome uses swap mode (replaced in place, never bilingual)", () => {
  beforeEach(() => {
    setTranslateUiText(true);
    setBody("");
  });
  afterEach(() => setTranslateUiText(true));

  /** [text, renderMode] for every collected unit, sorted by text. */
  const modes = () =>
    collectUnits(document.body)
      .map((u) => [u.text, u.renderMode])
      .sort((a, b) => a[0].localeCompare(b[0]));

  it("swaps nav, aside and role-based chrome, keeps content bilingual", () => {
    setBody(`
      <nav><a href='#'>Models overview</a></nav>
      <aside><a href='#'>Model deprecations</a></aside>
      <div role='toolbar'><button>Copy page</button></div>
      <main><p>Claude Opus 5 is a step-change improvement.</p></main>`);
    expect(modes()).toEqual([
      ["Claude Opus 5 is a step-change improvement.", "block"],
      ["Copy page", "swap"],
      ["Model deprecations", "swap"],
      ["Models overview", "swap"],
    ]);
  });

  it("swaps a page-level header/footer but keeps an article's own header bilingual", () => {
    setBody(`
      <header><p>Site wide banner text here.</p></header>
      <article><header><h1>The article title goes here</h1></header>
        <p>The body of the article.</p></article>
      <footer><p>Copyright notice text here.</p></footer>`);
    expect(modes()).toEqual([
      ["Copyright notice text here.", "swap"],
      ["Site wide banner text here.", "swap"],
      ["The article title goes here", "block"],
      ["The body of the article.", "block"],
    ]);
  });

  it("swaps short pure link labels anywhere (sidebars are plain divs)", () => {
    setBody(`
      <div class='sidebar'><a href='#'>Model IDs and versioning</a></div>
      <main><p>Real prose that should absolutely be translated here.</p></main>`);
    expect(modes()).toEqual([
      ["Model IDs and versioning", "swap"],
      ["Real prose that should absolutely be translated here.", "block"],
    ]);
  });

  it("swaps LONG table-of-contents entries via link density", () => {
    setBody(`
      <div class='toc'><ul>
        <li><a href='#a'>Mid-conversation tool changes (beta)</a></li>
        <li><a href='#b'>Disabling thinking requires effort high or below</a></li>
        <li><a href='#c'>Model behavior differences</a></li>
      </ul></div>`);
    expect(modes().map((m) => m[1])).toEqual(["swap", "swap", "swap"]);
  });

  it("keeps a long standalone content link bilingual (low link density)", () => {
    setBody(`<main><p><a href='#'>Read the full technical report on scaling laws</a></p>
      <p>Plenty of surrounding prose so the container is not a link list at all.</p></main>`);
    expect(modes()).toEqual([
      ["Plenty of surrounding prose so the container is not a link list at all.", "block"],
      ["Read the full technical report on scaling laws", "block"],
    ]);
  });

  it("still translates a content card whose link wraps more than a label", () => {
    setBody(`<main><a href='#'>
      <h3>Streaming</h3>
      <p>Learn how to stream responses from the Messages API in real time.</p>
    </a></main>`);
    expect(modes()).toEqual([
      ["Learn how to stream responses from the Messages API in real time.", "block"],
      ["Streaming", "block"],
    ]);
  });

  it("leaves chrome untouched entirely when UI text translation is off", () => {
    setBody("<nav><a href='#'>Models overview</a></nav><main><p>Body text here.</p></main>");
    setTranslateUiText(false);
    expect(modes()).toEqual([["Body text here.", "block"]]);
  });
});
