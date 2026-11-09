import type { ApiProtocol } from "./types";

// Endpoint resolution. Preserves the original extension's forgiving behavior for
// the OpenAI Chat Completions protocol:
//   ""                              -> ""        (treated as unconfigured)
//   https://x.com                   -> https://x.com/v1/chat/completions
//   https://x.com/v1                -> https://x.com/v1/chat/completions
//   https://x.com/v3                -> https://x.com/v3/chat/completions
//   https://x.com/v1/chat/completions (unchanged)
//   .../openai (Gemini compat)      -> .../openai/chat/completions
//
// The Anthropic Messages protocol uses a different path (/v1/messages):
//   https://api.anthropic.com       -> https://api.anthropic.com/v1/messages
//   https://api.anthropic.com/v1    -> https://api.anthropic.com/v1/messages
//   https://x.com/v1/messages       (unchanged)

export function normalizeEndpoint(
  endpoint: string | null | undefined,
  protocol: ApiProtocol = "openai",
): string {
  const raw = String(endpoint ?? "").trim();
  const result = validateEndpointUrl(raw, { allowPrivate: true });
  if (!result.ok) return raw;
  const url = result.url;
  const path = url.pathname.replace(/\/+$/, "");
  const method = protocol === "anthropic" ? "/messages" : "/chat/completions";
  if (path.toLowerCase().endsWith(method)) url.pathname = path;
  else if (/\/v\d+$/i.test(path) || (protocol === "openai" && /\/openai$/i.test(path))) {
    url.pathname = path + method;
  } else {
    url.pathname = path + "/v1" + method;
  }
  url.hash = "";
  return url.href;
}

export function httpOrigin(value: string | undefined): string {
  const result = validateEndpointUrl(value ?? "", { allowPrivate: true });
  return result.ok ? result.url.origin : "";
}

/**
 * Validate a user-entered endpoint before any network call. Blocks non-URLs and
 * (by default) SSRF targets — loopback and private ranges — unless explicitly allowed.
 */
export function validateEndpointUrl(
  raw: string,
  options: { allowPrivate?: boolean } = {},
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Endpoint is not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Endpoint must use http or https." };
  }
  if (url.username || url.password) return { ok: false, reason: "Put credentials in the API Key field." };
  if (!options.allowPrivate && isPrivateHost(url.hostname)) {
    return { ok: false, reason: "Endpoint points to a private or loopback address." };
  }
  return { ok: true, url };
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0" || host === "::" || host === "0:0:0:0:0:0:0:0") return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d, possibly compressed to ::ffff:7f00:1).
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    let tail = mapped[1];
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      tail = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    }
    return isPrivateHost(tail);
  }
  // IPv4 ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 unique-local / link-local
  if (/^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith("fe80:")) return true;
  return false;
}
