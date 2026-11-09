import type { TranslatedItem } from "./types";

/** Extract the assistant text from the many response shapes we may encounter. */
export function extractTextContent(data: unknown): string {
  const d = data as any;
  if (typeof d?.choices?.[0]?.message?.content === "string") return d.choices[0].message.content;
  if (typeof d?.choices?.[0]?.text === "string") return d.choices[0].text;
  if (typeof d?.output_text === "string") return d.output_text;
  // Anthropic Messages API: { content: [{ type: "text", text: "..." }, ...] }
  if (Array.isArray(d?.content)) {
    const parts: string[] = [];
    for (const c of d.content) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
    if (parts.length) return parts.join("");
  }
  if (Array.isArray(d?.output)) {
    const parts: string[] = [];
    for (const item of d.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join("\n");
  }
  return typeof d === "string" ? d : "";
}

/** Parse JSON that may be wrapped in markdown fences or surrounded by prose. */
export function parseLooseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let trimmed = value.trim();
  // Strip ```json ... ``` fences if present.
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) trimmed = fence[1].trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const objStart = trimmed.indexOf("{");
    const objEnd = trimmed.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      try {
        return JSON.parse(trimmed.slice(objStart, objEnd + 1));
      } catch {
        /* fall through */
      }
    }
    const arrStart = trimmed.indexOf("[");
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      return JSON.parse(trimmed.slice(arrStart, arrEnd + 1));
    }
    throw new SyntaxError("Response was not valid JSON.");
  }
}

/**
 * Normalize parsed model output into { id, translated } items. When `allowedIds`
 * is given, items whose id is not requested are dropped (guards against the
 * loose parser picking up unrelated JSON from the page/markdown).
 */
export function normalizeTranslatedItems(parsed: unknown, allowedIds?: Set<string>): TranslatedItem[] {
  const rows = toRows(parsed);
  const out: TranslatedItem[] = [];
  for (const row of rows) {
    if (row.id == null) continue;
    const id = String(row.id);
    const translated = row.translated;
    if (typeof translated !== "string" || !translated) continue;
    if (allowedIds && !allowedIds.has(id)) continue;
    out.push({ id, translated });
  }
  return out;
}

function toRows(parsed: unknown): Array<{ id: unknown; translated: unknown }> {
  const pick = (item: any) => ({
    id: item?.id,
    translated: item?.translated ?? item?.translation ?? item?.text,
  });
  if (Array.isArray(parsed)) return parsed.map(pick);
  const p = parsed as any;
  if (Array.isArray(p?.items)) return p.items.map(pick);
  if (p && typeof p === "object") {
    return Object.entries(p)
      .filter(([key, value]) => key !== "items" && typeof value === "string")
      .map(([id, translated]) => ({ id, translated }));
  }
  return [];
}
