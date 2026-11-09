import { nativeTranslate } from "@shared/nativeTranslator";
import type { Segment } from "@shared/types";
import type { Renderer } from "./render";
import type { SessionHandlers } from "./session";

export class NativePageSession {
  private readonly controller = new AbortController();
  private readonly queue: Segment[];
  private total: number;
  active = false;
  constructor(private renderer: Renderer, segments: Segment[], private handlers: SessionHandlers,
      private options: { targetLang: string }) {
    this.queue = [...segments];
    this.total = segments.length;
  }
  start(): void { this.active = true; this.handlers.onBusy(true); void this.run(); }
  append(segments: Segment[]): boolean {
    if (!this.active) return false;
    this.queue.push(...segments);
    this.total += segments.length;
    return true;
  }
  cancel(): void {
    this.active = false;
    this.controller.abort();
    this.handlers.onBusy(false);
  }
  private async run(): Promise<void> {
    let completed = 0;
    try {
      while (this.active && this.queue.length) {
        const item = this.queue.shift()!;
        const result = await nativeTranslate(item.text, this.options.targetLang, document.documentElement.lang, this.controller.signal);
        if (!this.active) return;
        this.renderer.applyTranslation(item.id, result);
        completed++;
        this.handlers.onProgress({ completed, total: this.total, failed: 0, concurrency: 1 });
      }
      if (!this.active) return;
      this.active = false;
      this.handlers.onBusy(false);
      this.handlers.onComplete({ completed, total: this.total, failed: 0 });
    } catch (error) {
      if (!this.active) return;
      this.active = false;
      this.handlers.onBusy(false);
      this.handlers.onFatal(error instanceof Error ? error.message : String(error));
    }
  }
}
