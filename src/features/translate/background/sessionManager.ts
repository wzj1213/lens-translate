import { packBatches } from "@shared/batch";
import { createCacheKey } from "@shared/cacheKey";
import { t } from "@shared/i18n";
import { getRetryDelayMs, isRetryable, type ApiErrorLike } from "@shared/retry";
import { loadSettings, publicSettings } from "@shared/settings";
import type { PageContext, PortOutbound, Segment, Settings, TranslatedItem } from "@shared/types";
import { createId, normalizeText, toUserMessage } from "@shared/util";
import { sanitizeSecrets } from "@features/translate/background/apiError";
import type { PersistentCache } from "@features/translate/background/persistentCache";
import { parseGlossary } from "@shared/prompt";
import { requestDocumentGuide, requestTranslation, type DocumentGuide } from "@features/translate/background/translator";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const documentGuides = new Map<string, DocumentGuide>();
/** Size of the carved first batch — small so the first visible paragraphs paint fast. */
const FIRST_PAINT_ITEMS = 3;

interface PendingItem {
  id: string;
  text: string;
  cacheKey: string;
  fanoutIds: string[];
}

interface Job {
  id: string;
  items: PendingItem[];
  attempt: number;
}

/**
 * Owns one translation run for one port connection. ALL queue/concurrency state
 * lives here — there are no module-level globals — so concurrent tabs never
 * interfere and a cancel reliably aborts only this run.
 */
export class TranslationSession {
  readonly id = createId("session");
  private settings: Settings | null = null;
  private cancelled = false;
  private finished = false;
  private total = 0;
  private completed = 0;
  private failed = 0;
  private readonly controllers = new Set<AbortController>();
  /** cacheKey -> item currently queued or in flight, so later waves can share it. */
  private readonly inflight = new Map<string, PendingItem>();
  private queue: Job[] = [];
  private active = 0;
  private concurrency = 4;
  private consecutiveSuccesses = 0;
  private pumpScheduled = false;
  private lastProgress = -1;
  private lastTotal = -1;
  /** Ingest calls are async; serialize them so jobs queue in submission order. */
  private ingestChain: Promise<void> = Promise.resolve();
  /** Appends that arrived before start() finished loading settings. */
  private buffered: Segment[] = [];
  private waves = 0;

  /** Where this run's text comes from, for terminology disambiguation. */
  private readonly context: PageContext;

  constructor(
    private readonly port: chrome.runtime.Port,
    private readonly cache: PersistentCache,
  ) {
    this.context = pageContextOf(port);
  }

  async start(rawSegments: Segment[], sample = ""): Promise<void> {
    const settings = await loadSettings();
    if (settings.engine === "model" && settings.endpoint && settings.consistentTerms && sample.length >= 1600 && !this.cancelled) {
      const excerpt = sample.slice(0, 5500);
      const identity = this.port.sender?.documentId || this.port.sender?.tab?.id;
      const key = JSON.stringify([identity, this.context.title, settings.endpoint, settings.model, settings.protocol, settings.targetLang, settings.maskSensitive, excerpt]);
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        const guide = documentGuides.get(key) ?? await requestDocumentGuide(excerpt, settings, controller.signal);
        if (this.cancelled) return;
        if (documentGuides.size >= 16) documentGuides.delete(documentGuides.keys().next().value!);
        documentGuides.set(key, guide);
        this.context.topic = guide.topic;
        const preferred = new Set(parseGlossary(settings.glossary).map(term => term.from.toLowerCase()));
        const generated = parseGlossary(guide.glossary).filter(term => !preferred.has(term.from.toLowerCase()));
        settings.glossary += generated.map(term => "\n" + term.from + "=" + term.to).join("");
      } catch { /* A failed analysis must not prevent ordinary translation. */ }
      finally { this.controllers.delete(controller); }
    }
    if (this.cancelled) return;
    this.settings = settings;
    this.concurrency = settings.maxConcurrency;
    this.cache.setMaxEntries(settings.cacheMaxEntries);
    const segments = sanitizeSegments(rawSegments);
    this.total = segments.length + this.buffered.length;

    this.post({
      type: "SESSION_STARTED",
      sessionId: this.id,
      total: this.total,
      settings: publicSettings(settings),
    });

    if (settings.engine !== "model" || !settings.endpoint || !settings.model) {
      this.fatal(t("toastNeedConfig"));
      return;
    }
    if (this.cancelled) return;

    const first = [...segments, ...this.buffered.splice(0)];
    if (first.length === 0) {
      this.complete();
      return;
    }
    await this.ingest(first);
  }

  /**
   * Add more segments to a run that is already in flight. This is what lets the
   * page keep feeding newly-scrolled paragraphs into the SAME pool of in-flight
   * requests instead of waiting for the previous batch to finish end-to-end.
   */
  append(rawSegments: Segment[]): void {
    if (this.cancelled) return;
    const segments = sanitizeSegments(rawSegments);
    if (!segments.length) return;
    // A COMPLETE may already be in flight toward the page when this arrives;
    // reviving beats dropping the work (the page also re-submits as a backstop).
    this.finished = false;
    if (!this.settings) {
      // start() hasn't resolved its settings load yet — hand these to it (it
      // counts them into `total` itself, so don't double-count here).
      this.buffered.push(...segments);
      return;
    }
    this.total += segments.length;
    void this.ingest(segments);
  }

  /** Hash + dedupe + cache-check + enqueue one wave of segments. */
  private ingest(segments: Segment[]): Promise<void> {
    this.ingestChain = this.ingestChain
      .then(() => (this.cancelled || !this.settings ? undefined : this.prepareJobs(segments)))
      .then(() => {
        if (!this.cancelled) this.schedulePump();
      })
      .catch(() => undefined);
    return this.ingestChain;
  }

  cancel(reason: string): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.queue = [];
    if (!this.finished) {
      this.finished = true;
      this.post({ type: "SESSION_CANCELLED", reason });
    }
  }

  private async prepareJobs(segments: Segment[]): Promise<void> {
    const settings = this.settings!;
    const keyInput = {
      endpoint: settings.endpoint,
      protocol: settings.protocol,
      model: settings.model,
      targetLang: settings.targetLang,
      glossary: settings.glossary,
      context: JSON.stringify(this.context),
    };

    // Normalize once, then hash all cache keys in parallel. This was a serial
    // `await createCacheKey` per segment — a measurable stall before the first
    // request could even be queued on large pages (hundreds of SHA-256 + await
    // hops). crypto.subtle.digest is async, so Promise.all overlaps them.
    const normalized = segments
      .map((segment) => ({ id: segment.id, text: normalizeText(segment.text) }))
      .filter((segment) => segment.text);
    const keys = await Promise.all(normalized.map((segment) => createCacheKey(keyInput, segment.text)));
    if (this.cancelled) return;

    const byKey = new Map<string, PendingItem>();
    normalized.forEach((segment, index) => {
      const cacheKey = keys[index];
      // Identical text already requested by an EARLIER wave (repeated nav labels,
      // headings, boilerplate): ride along on that request instead of paying for
      // a second one. Safe because fanoutIds are read only when the response
      // lands, and the entry is dropped in the same synchronous step.
      const running = this.inflight.get(cacheKey);
      if (running) {
        running.fanoutIds.push(segment.id);
        return;
      }
      const existing = byKey.get(cacheKey);
      if (existing) existing.fanoutIds.push(segment.id);
      else byKey.set(cacheKey, { id: segment.id, text: segment.text, cacheKey, fanoutIds: [segment.id] });
    });
    if (this.cancelled) return;

    const uniqueItems = [...byKey.values()];
    let cached = new Map<string, string>();
    if (settings.cacheEnabled) {
      cached = await this.cache.getMany(
        uniqueItems.map((item) => item.cacheKey),
        settings.cacheTtlDays * DAY_MS,
      );
    }
    if (this.cancelled) return;

    const cachedItems: TranslatedItem[] = [];
    const pending: PendingItem[] = [];
    for (const item of uniqueItems) {
      const hit = cached.get(item.cacheKey);
      if (hit) {
        cachedItems.push(...fanout(item, hit));
      } else {
        pending.push(item);
        this.inflight.set(item.cacheKey, item);
      }
    }
    this.postResults(cachedItems, true);

    // Carve a small FIRST batch so the most-visible paragraphs (segments arrive
    // viewport-prioritized) paint quickly, instead of all waiting on a full
    // batchMaxItems request. Only on the first wave, and only when there's
    // clearly more than one batch to carve from.
    const enqueue = (items: PendingItem[]) => this.queue.push({ id: createId("job"), items, attempt: 0 });
    const firstWave = this.waves === 0;
    this.waves += 1;
    if (firstWave && pending.length > FIRST_PAINT_ITEMS * 2) {
      for (const batch of packBatches(pending.slice(0, FIRST_PAINT_ITEMS), {
        batchMaxItems: FIRST_PAINT_ITEMS,
        batchMaxChars: settings.batchMaxChars,
      })) {
        enqueue(batch);
      }
      for (const batch of packBatches(pending.slice(FIRST_PAINT_ITEMS), settings)) enqueue(batch);
    } else {
      for (const batch of packBatches(pending, settings)) enqueue(batch);
    }
    this.postProgress();
    this.maybeComplete();
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.tick();
    });
  }

  private tick(): void {
    if (this.cancelled || !this.settings) return;
    const limit = Math.max(1, Math.min(this.concurrency, this.settings.maxConcurrency));
    while (this.active < limit && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active += 1;
      this.processJob(job).finally(() => {
        this.active -= 1;
        this.schedulePump();
      });
    }
  }

  private async processJob(job: Job): Promise<void> {
    if (this.cancelled) return;
    const settings = this.settings!;
    const controller = new AbortController();
    this.controllers.add(controller);
    let requeued = false;

    const byId = new Map(job.items.map((item) => [item.id, item]));
    const cacheWrites: Array<{ key: string; translated: string }> = [];
    const done = new Set<string>();

    /**
     * Deliver items the moment they are known. With streaming this runs while
     * the request is still open, so paragraph 1 paints without waiting for
     * paragraph 8. Idempotent — the final result repeats what was streamed.
     */
    const deliver = (rows: TranslatedItem[]): void => {
      if (this.cancelled) return;
      const out: TranslatedItem[] = [];
      for (const row of rows) {
        const item = byId.get(row.id);
        if (!item || done.has(row.id)) continue;
        done.add(row.id);
        out.push(...fanout(item, row.translated));
        cacheWrites.push({ key: item.cacheKey, translated: row.translated });
        // Released here rather than in `finally`: fanoutIds are read now, so a
        // later wave must not attach ids to an item that has already fanned out.
        if (this.inflight.get(item.cacheKey) === item) this.inflight.delete(item.cacheKey);
      }
      if (!out.length) return;
      this.postResults(out, false);
      this.postProgress();
    };

    try {
      const results = await requestTranslation(job.items, settings, controller.signal, deliver, this.context);
      if (this.cancelled) return;
      deliver(results);

      const failedIds = job.items.filter((item) => !done.has(item.id)).flatMap((item) => item.fanoutIds);
      this.postFailed(failedIds, t("toastFailed"));
      this.recordSuccess();
    } catch (error) {
      if (this.cancelled || controller.signal.aborted) return;
      this.recordFailure();
      const safeMessage = sanitizeSecrets(toUserMessage(error), settings.apiKey);

      // A stream can break after delivering part of the batch. Everything below
      // works on the REMAINING items only: re-requesting delivered ones wastes
      // tokens, and marking them failed would double-count them as done.
      const remaining = job.items.filter((item) => !done.has(item.id));
      if (!remaining.length) {
        this.recordSuccess();
        return;
      }

      if (job.attempt < MAX_ATTEMPTS - 1 && isRetryable(error as ApiErrorLike)) {
        const delay = getRetryDelayMs(error as ApiErrorLike, job.attempt);
        requeued = true; // keep the inflight entries so a retry is not duplicated
        this.post({ type: "RETRYING", message: safeMessage });
        setTimeout(() => {
          if (this.cancelled) return;
          this.queue.unshift({ id: job.id, items: remaining, attempt: job.attempt + 1 });
          this.schedulePump();
        }, delay);
        return;
      }
      this.postFailed(remaining.flatMap((item) => item.fanoutIds), safeMessage);
    } finally {
      this.controllers.delete(controller);
      // Flush here, not in the success branch: a stream that broke half way
      // still produced real translations, and they should not be re-paid for.
      if (settings.cacheEnabled && cacheWrites.length) {
        void this.cache.setMany(cacheWrites, settings.cacheTtlDays * DAY_MS);
      }
      if (!requeued) {
        for (const item of job.items) {
          if (this.inflight.get(item.cacheKey) === item) this.inflight.delete(item.cacheKey);
        }
      }
      this.postProgress();
      this.maybeComplete();
    }
  }

  private recordSuccess(): void {
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= 4 && this.settings) {
      this.concurrency = Math.min(this.settings.maxConcurrency, this.concurrency + 1);
      this.consecutiveSuccesses = 0;
    }
  }

  private recordFailure(): void {
    this.consecutiveSuccesses = 0;
    this.concurrency = Math.max(1, this.concurrency - 1);
  }

  private post(message: PortOutbound): void {
    try {
      this.port.postMessage(message);
    } catch {
      // The tab may have navigated away or closed.
    }
  }

  private postResults(items: TranslatedItem[], fromCache: boolean): void {
    if (!items.length) return;
    this.completed += items.length;
    this.post({ type: "TRANSLATION_RESULT", items, fromCache });
  }

  private postFailed(ids: string[], message: string): void {
    if (!ids.length) return;
    this.failed += ids.length;
    this.post({ type: "TRANSLATION_ERROR", ids, message });
  }

  private postProgress(): void {
    const done = this.completed + this.failed;
    if (done === this.lastProgress && this.total === this.lastTotal) return;
    this.lastProgress = done;
    this.lastTotal = this.total;
    const max = this.settings?.maxConcurrency ?? this.concurrency;
    this.post({
      type: "PROGRESS",
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      concurrency: Math.max(1, Math.min(this.concurrency, max)),
    });
  }

  private maybeComplete(): void {
    if (this.cancelled || this.finished) return;
    if (this.completed + this.failed >= this.total) this.complete();
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.post({
      type: "SESSION_COMPLETE",
      total: this.total,
      completed: this.completed,
      failed: this.failed,
    });
  }

  private fatal(message: string): void {
    if (this.finished) return;
    this.finished = true;
    this.post({ type: "FATAL_ERROR", message });
  }
}

/**
 * Read the page identity from the PORT's sender rather than from a message the
 * page could craft. Available because the extension holds host permissions.
 */
export function pageContextOf(port: chrome.runtime.Port): PageContext {
  const tab = port.sender?.tab;
  let host = "";
  try {
    const url = tab?.url ?? port.sender?.url ?? "";
    if (url && !/^https?:/i.test(url)) return { title: "", host: "" };
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  return { title: normalizeText(tab?.title ?? "").slice(0, 120), host };
}

function fanout(item: PendingItem, translated: string): TranslatedItem[] {
  return item.fanoutIds.map((id) => ({ id, translated }));
}

function sanitizeSegments(segments: Segment[]): Segment[] {
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => ({ id: String(segment?.id ?? ""), text: String(segment?.text ?? "") }))
    .filter((segment) => segment.id && normalizeText(segment.text));
}
