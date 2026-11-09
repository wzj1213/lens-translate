import { SESSION_PORT_NAME } from "@shared/messaging";
import type { PortOutbound, PublicSettings, Segment } from "@shared/types";
import { ensureExtensionContext } from "@content/env";
import type { Renderer } from "@features/translate/content/render";

export interface SessionHandlers {
  onBusy(busy: boolean): void;
  onProgress(progress: { completed: number; total: number; failed: number; concurrency: number }): void;
  onRetry(message: string): void;
  onComplete(result: { completed: number; total: number; failed: number }): void;
  onCancelled(): void;
  /** The port died before the run finished (service worker restart, reload). */
  onDropped(): void;
  onFatal(message: string): void;
  onSettings(settings: PublicSettings): void;
}

/** Client side of a page-translation session: drives the renderer via the SW port. */
export class PageSession {
  private port: chrome.runtime.Port | null = null;
  private writes = new Map<string, string>();
  private errors = new Map<string, string>();
  private flushScheduled = false;
  private finished = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly segments: Segment[],
    private readonly handlers: SessionHandlers,
    private readonly options: { targetLang: string; sample: string },
  ) {}

  start(): void {
    ensureExtensionContext();
    this.port = chrome.runtime.connect({ name: SESSION_PORT_NAME });
    this.port.onMessage.addListener((message) => this.onMessage(message as PortOutbound));
    this.port.onDisconnect.addListener(() => this.onDisconnect());
    this.handlers.onBusy(true);
    this.port.postMessage({ type: "START_TRANSLATION", segments: this.segments, sample: this.options.sample });
  }

  /**
   * Feed more segments into this live run. Returns false when the run is no
   * longer accepting work, so the caller can open a fresh session instead of
   * silently losing the segments.
   */
  append(segments: Segment[]): boolean {
    if (!this.port || this.finished || !segments.length) return false;
    try {
      this.port.postMessage({ type: "APPEND_SEGMENTS", segments });
      return true;
    } catch {
      return false;
    }
  }

  cancel(): void {
    // Mark finished BEFORE tearing down: a disconnect that races in afterwards
    // must not be reported as "dropped" and re-submitted — the user said stop.
    this.finished = true;
    if (this.port) {
      try {
        this.port.postMessage({ type: "CANCEL_TRANSLATION" });
      } catch {
        /* service worker already gone */
      }
    }
    this.teardown();
  }

  get active(): boolean {
    return Boolean(this.port) && !this.finished;
  }

  private onMessage(message: PortOutbound): void {
    switch (message.type) {
      case "SESSION_STARTED":
        this.handlers.onSettings(message.settings);
        break;
      case "TRANSLATION_RESULT":
        for (const item of message.items) this.queueWrite(item.id, item.translated);
        break;
      case "TRANSLATION_ERROR":
        for (const id of message.ids) this.queueError(id, message.message);
        break;
      case "PROGRESS":
        this.handlers.onProgress(message);
        break;
      case "RETRYING":
        this.handlers.onRetry(message.message);
        break;
      // Tear down BEFORE notifying: a handler may immediately open a follow-up
      // session, and teardown's onBusy(false) must not clobber its onBusy(true).
      case "SESSION_COMPLETE":
        this.flush();
        this.finished = true;
        this.teardown();
        this.handlers.onComplete(message);
        break;
      case "SESSION_CANCELLED":
        this.finished = true;
        this.teardown();
        this.handlers.onCancelled();
        break;
      case "FATAL_ERROR":
        this.finished = true;
        this.teardown();
        this.handlers.onFatal(message.message);
        break;
    }
  }

  private onDisconnect(): void {
    this.port = null;
    if (!this.finished) {
      // A disconnect before SESSION_COMPLETE is the SW going away, not a user cancel.
      this.finished = true;
      this.flush();
      this.handlers.onBusy(false);
      this.handlers.onDropped();
    }
  }

  private teardown(): void {
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {
        /* already gone */
      }
      this.port = null;
    }
    this.handlers.onBusy(false);
  }

  private queueWrite(id: string, text: string): void {
    if (!text) return;
    this.writes.set(id, text);
    this.scheduleFlush();
  }

  private queueError(id: string, message: string): void {
    this.errors.set(id, message);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.writes.size) {
      const writes = this.writes;
      this.writes = new Map();
      for (const [id, text] of writes) this.renderer.applyTranslation(id, text);
    }
    if (this.errors.size) {
      const errors = this.errors;
      this.errors = new Map();
      for (const [id, message] of errors) this.renderer.markError(id, message);
    }
  }
}
