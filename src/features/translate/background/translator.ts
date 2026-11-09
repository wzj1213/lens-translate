import { normalizeEndpoint, validateEndpointUrl } from "@shared/endpoint";
import { extractTextContent, normalizeTranslatedItems, parseLooseJson } from "@shared/looseJson";
import { buildBatchMessages, buildSingleMessages, toAnthropicMessages, type ChatMessage } from "@shared/prompt";
import { createItemScanState, scanCompletedItems } from "@shared/streamItems";
import type { ApiProtocol, PageContext, Segment, Settings, TranslatedItem } from "@shared/types";
import { toApiError, type ApiError } from "@features/translate/background/apiError";

// Anthropic Messages API version pin. The request also carries
// `anthropic-dangerous-direct-browser-access: true` so the API accepts the call
// from an extension (browser) origin instead of CORS-blocking it.
const ANTHROPIC_VERSION = "2023-06-01";

interface AbortBundle {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

function makeAbort(timeoutMs: number, parent: AbortSignal): AbortBundle {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

// Validate scheme/URL on every fetch path. Private/loopback hosts are allowed on
// purpose: the endpoint is user-configured, so local LLM servers (Ollama, LM Studio)
// must work. Only malformed or non-http(s) endpoints are rejected here.
function assertValidEndpoint(endpoint: string): void {
  const check = validateEndpointUrl(endpoint, { allowPrivate: true });
  if (!check.ok) throw new Error(check.reason);
}

function authHeaders(settings: Settings): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.protocol === "anthropic") {
    if (settings.apiKey) headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

// Anthropic requires an explicit max_tokens (it is a hard per-response ceiling,
// not a forced output length). Scale the batch cap to the configured chunk size;
// keep it streamable-safe. Temperature is intentionally omitted for Anthropic —
// the current Opus models (4.7/4.8) reject sampling params, and translation does
// not need it.
function anthropicBatchMaxTokens(settings: Settings): number {
  return Math.min(16000, Math.max(2048, Math.round(settings.batchMaxChars * 1.5)));
}

function buildRequestBody(
  messages: ChatMessage[],
  settings: Settings,
  options: { stream: boolean; maxTokens: number },
): unknown {
  if (settings.protocol === "anthropic") {
    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    return {
      model: settings.model,
      max_tokens: options.maxTokens,
      messages: anthropicMessages,
      // Mark the (identical-per-batch) system prompt as cacheable: prompt caching
      // is GA, so within the 5-min TTL repeated batches read it at ~0.1x instead
      // of reprocessing it. Below Anthropic's min cacheable size it's a silent
      // no-op — benefit scales with system-prompt / glossary length.
      ...(system ? { system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] } : {}),
      stream: options.stream,
    };
  }
  return {
    model: settings.model,
    temperature: settings.temperature,
    messages,
    stream: options.stream,
  };
}

function timeoutError(): ApiError {
  const error = new Error("API request timed out.") as ApiError;
  error.retryable = true;
  return error;
}

/**
 * Read a Server-Sent-Events body, feeding every text delta to `onDelta`, and
 * return the full assembled text. Falls back to a plain JSON read when the body
 * is not readable (some proxies buffer the whole response).
 */
async function readSseText(
  response: Response,
  protocol: ApiProtocol,
  onDelta: (chunk: string) => void,
  stream: boolean,
): Promise<string> {
  if (!stream || !response.body || /\bjson\b/i.test(response.headers?.get("content-type") ?? "")) {
    const data = await response.json();
    const full = extractTextContent(data).trim();
    if (full) onDelta(full);
    return full;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return full.trim();
        const delta = extractStreamDelta(payload, protocol);
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return full.trim();
}

/**
 * Endpoints that answered a `stream: true` batch with a hard client error. Some
 * OpenAI-compatible servers simply do not implement streaming; remember them and
 * stop paying a failed round-trip on every batch.
 */
const noStreamEndpoints = new Set<string>();

async function fetchCompletion(
  endpoint: string,
  messages: ChatMessage[],
  settings: Settings,
  signal: AbortSignal,
  wantStream: boolean,
  maxTokens: number,
): Promise<{ response: Response; stream: boolean }> {
  const send = (stream: boolean) => fetch(endpoint, {
    method: "POST",
    headers: authHeaders(settings),
    body: JSON.stringify(buildRequestBody(messages, settings, { stream, maxTokens })),
    signal,
    redirect: "error",
    credentials: "omit",
  });
  let stream = wantStream && !noStreamEndpoints.has(endpoint);
  let response = await send(stream);
  if (stream && [400, 404, 405, 422, 501].includes(response.status)) {
    // Release the rejected response and remember the capability only if the retry works.
    await response.body?.cancel();
    stream = false;
    response = await send(false);
    if (response.ok) noStreamEndpoints.add(endpoint);
  }
  if (!response.ok) throw await toApiError(response, endpoint, settings.apiKey);
  return { response, stream };
}

/** Translate a batch of items, returning [{id, translated}] for the ids that succeeded. */
export async function requestTranslation(
  items: Segment[],
  settings: Settings,
  parentSignal: AbortSignal,
  /**
   * Called with items as soon as they finish streaming, ahead of the final
   * result. Passing it opts this request into streaming — paragraph 1 paints
   * without waiting for paragraph 8. Callers must tolerate the same item
   * appearing again in the resolved value.
   */
  onPartial?: (items: TranslatedItem[]) => void,
  context?: PageContext,
): Promise<TranslatedItem[]> {
  const endpoint = normalizeEndpoint(settings.endpoint, settings.protocol);
  assertValidEndpoint(endpoint);

  // The model has to echo every id back verbatim, so ids are billed as OUTPUT
  // tokens on the critical path. Segment ids are uuid-based (41 chars) — often
  // more tokens than the translation itself, and long enough that models
  // occasionally mis-copy one and silently drop that paragraph. Send short
  // ordinals on the wire and map them back here.
  const wire = items.map((item, index) => ({ id: String(index + 1), text: item.text }));
  const messages = buildBatchMessages(wire, {
    targetLang: settings.targetLang,
    glossary: settings.glossary,
    context,
  });

  const abort = makeAbort(settings.requestTimeoutMs, parentSignal);

  // Map a wire ordinal back to its real segment id, at most once.
  const seen = new Set<string>();
  const resolve = (rows: Array<{ id: string; translated: string }>): TranslatedItem[] => {
    const out: TranslatedItem[] = [];
    for (const row of rows) {
      const source = items[Number(row.id) - 1];
      if (!source || seen.has(source.id)) continue;
      seen.add(source.id);
      out.push({ id: source.id, translated: row.translated });
    }
    return out;
  };

  try {
    const { response, stream } = await fetchCompletion(
      endpoint, messages, settings, abort.signal, Boolean(onPartial), anthropicBatchMaxTokens(settings),
    );

    const delivered: TranslatedItem[] = [];
    let content: string;
    if (stream) {
      const scan = createItemScanState();
      let buffer = "";
      content = await readSseText(response, settings.protocol, (chunk) => {
        buffer += chunk;
        const ready = resolve(scanCompletedItems(buffer, scan));
        if (!ready.length) return;
        delivered.push(...ready);
        onPartial?.(ready);
      }, stream);
    } else {
      content = extractTextContent(await response.json());
    }

    // Authoritative pass over the complete text: catches anything the
    // incremental scan missed (fenced output, a trailing item, a repair).
    const allowed = new Set(wire.map((item) => item.id));
    let rest: TranslatedItem[] = [];
    try {
      rest = resolve(normalizeTranslatedItems(parseLooseJson(content), allowed));
    } catch (error) {
      // Malformed tail (truncated by max_tokens, trailing prose). Anything the
      // stream already produced is still good — only fail if nothing arrived.
      if (!delivered.length) throw error;
    }
    const out = [...delivered, ...rest];
    if (!out.length) {
      throw new Error("Could not parse a translation from the response. Check the endpoint and protocol.");
    }
    return out;
  } catch (error) {
    if (abort.timedOut()) throw timeoutError();
    throw error;
  } finally {
    abort.cleanup();
  }
}

/**
 * Translate a single string with Server-Sent-Events streaming, invoking `onDelta`
 * for each chunk. Falls back to a non-streaming read if the body is not readable.
 * Returns the full translation.
 */
export async function requestTranslationStream(
  text: string,
  settings: Settings,
  parentSignal: AbortSignal,
  onDelta: (chunk: string) => void,
  context?: PageContext,
): Promise<string> {
  const endpoint = normalizeEndpoint(settings.endpoint, settings.protocol);
  assertValidEndpoint(endpoint);
  const abort = makeAbort(settings.requestTimeoutMs, parentSignal);
  const messages = buildSingleMessages(text, {
    targetLang: settings.targetLang,
    glossary: settings.glossary,
    context,
  });

  try {
    const { response, stream } = await fetchCompletion(endpoint, messages, settings, abort.signal, true, 8192);
    const translated = await readSseText(response, settings.protocol, onDelta, stream);
    if (!translated) throw new Error("The model returned an empty translation.");
    return translated;
  } catch (error) {
    if (abort.timedOut()) throw timeoutError();
    throw error;
  } finally {
    abort.cleanup();
  }
}

function extractStreamDelta(payload: string, protocol: ApiProtocol): string {
  try {
    const json = JSON.parse(payload);
    if (protocol === "anthropic") {
      // Anthropic SSE: text arrives as content_block_delta / text_delta events.
      // Other event types (message_start, ping, message_stop, …) carry no text.
      if (json?.type === "content_block_delta" && json?.delta?.type === "text_delta") {
        return json.delta.text ?? "";
      }
      return "";
    }
    const choice = json?.choices?.[0];
    return choice?.delta?.content ?? choice?.text ?? "";
  } catch {
    return "";
  }
}
