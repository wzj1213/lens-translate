import type { ApiProtocol } from "./types";
import { CACHE_PREFIX } from "./constants";
import { normalizeEndpoint } from "./endpoint";
import { parseGlossary } from "./prompt";
import { normalizeText } from "./util";

export interface CacheKeyInput {
  endpoint: string;
  protocol?: ApiProtocol;
  model: string;
  targetLang: string;
  glossary?: string;
  context?: string;
}

/**
 * The glossary changes the translation, so it has to be part of the key —
 * otherwise editing a term keeps serving the pre-glossary translation forever.
 * Fingerprinted from the PARSED entries (comments/whitespace edits don't
 * invalidate), and only appended when there are entries, so users without a
 * glossary keep every cache entry they already have.
 */
function glossaryPart(glossary: string | undefined): string {
  const entries = parseGlossary(glossary);
  if (!entries.length) return "";
  return `\ng:${entries.map((e) => `${e.from}=>${e.to}`).join("|")}`;
}

/**
 * Stable cache key: SHA-256 over the normalized endpoint, model, target language,
 * glossary and normalized text. Normalizing at both read and write means equivalent
 * endpoint forms (base vs full path) and whitespace variants collide intentionally.
 */
export async function createCacheKey(input: CacheKeyInput, text: string): Promise<string> {
  const material =
    [
      normalizeEndpoint(input.endpoint, input.protocol),
      String(input.model || "").trim(),
      String(input.targetLang || "").trim(),
      normalizeText(text),
    ].join("\n") + glossaryPart(input.glossary) + (input.context ? "\nc:" + input.context : "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return CACHE_PREFIX + toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
