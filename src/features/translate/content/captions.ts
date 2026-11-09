import { t } from "@shared/i18n";
import { translateText } from "@shared/translateText";
import { showToast } from "@content/toast";

export function isYouTubeVideo(url: URL): boolean {
  return /^(?:www\.|m\.)?youtube\.com$/.test(url.hostname) && (url.pathname === "/watch" || url.pathname.startsWith("/shorts/"));
}

export class CaptionTranslator {
  private stopPlayback?: () => void;
  get active(): boolean { return Boolean(this.stopPlayback); }
  stop(): void { this.stopPlayback?.(); this.stopPlayback = undefined; }

  toggle(): boolean {
    if (this.active) { this.stop(); return false; }
    const video = document.querySelector<HTMLVideoElement>(".html5-video-player video, video");
    if (!video || !isYouTubeVideo(new URL(location.href))) throw new Error(t("captionsVideoOnly"));
    const player = video.closest<HTMLElement>(".html5-video-player") ?? video.parentElement!;
    const overlay = document.createElement("div");
    overlay.dataset.lensUi = "captions";
    overlay.className = "lens-captions";
    overlay.hidden = true;
    player.append(overlay);

    const cache = new Map<string, string>();
    const pending = new Map<string, AbortController>();
    const pageUrl = location.href;
    let current = "", source = "", seeking = false, timer = 0;
    let activated: TextTrack | undefined, observedTrack: TextTrack | undefined;
    let previousCaption = "";
    const visibleCaption = () => Array.from(player.querySelectorAll(".ytp-caption-segment"))
      .map(span => span.textContent).join(" ").trim();
    const paint = () => {
      const translated = cache.get(current);
      overlay.textContent = translated ? (source ? source + "\n" : "") + translated : "";
      overlay.hidden = !translated;
    };
    const request = (text: string, lang: string) => {
      if (!text || cache.has(text) || pending.has(text) || pending.size >= 3) return;
      const controller = new AbortController();
      pending.set(text, controller);
      void translateText(text, { sourceHint: lang, signal: controller.signal }).then(output => {
        if (controller.signal.aborted) return;
        if (cache.size >= 400) cache.delete(cache.keys().next().value!);
        cache.set(text, output);
        if (current === text) paint();
      }).catch(error => {
        if (current === text && !controller.signal.aborted) { this.stop(); showToast(error.message, "error", 4500); }
      }).finally(() => {
        if (pending.get(text) === controller) pending.delete(text);
        if (overlay.isConnected && current && !cache.has(current) && !pending.has(current)) schedule();
      });
    };
    const refresh = () => {
      timer = 0;
      if (!video.isConnected || location.href !== pageUrl) { this.stop(); return; }
      if (seeking) return;
      const tracks = Array.from(video.textTracks ?? []).filter(track => ["subtitles", "captions"].includes(track.kind));
      let track = tracks.find(item => item.mode === "showing") ?? tracks.find(item => item.mode === "hidden");
      if (!track && tracks.length) { track = tracks[0]; track.mode = "hidden"; activated = track; }
      if (track !== observedTrack) {
        observedTrack?.removeEventListener("cuechange", schedule);
        observedTrack = track;
        track?.addEventListener("cuechange", schedule);
      }
      const cueText = (cue: TextTrackCue) => typeof (cue as VTTCue).getCueAsHTML === "function"
        ? ((cue as VTTCue).getCueAsHTML().textContent ?? "").trim() : "";
      const visible = visibleCaption();
      if (visible !== previousCaption) previousCaption = "";
      const cues = Array.from(track?.activeCues ?? [])
        .filter(cue => cue.startTime <= video.currentTime && video.currentTime < cue.endTime)
        .map(cueText).filter(Boolean).join(" ");
      // YouTube may leave the old DOM caption in place for a frame after seeked.
      const text = cues || (visible !== previousCaption ? visible : "");
      source = cues && track?.mode === "hidden" && visible !== cues ? cues : "";
      current = text;
      paint();
      request(text, track?.language ?? "");
      if (track?.cues && track.activeCues?.length && pending.size < 2) {
        const next = Array.from(track.cues).find(cue => cue.startTime > video.currentTime && cue.startTime <= video.currentTime + 8);
        if (next) request(cueText(next), track.language);
      }
    };
    const schedule = () => { if (!timer) timer = window.setTimeout(refresh, 80); };
    const onSeek = () => {
      previousCaption = visibleCaption();
      seeking = true; current = ""; paint();
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
    const onSeeked = () => { seeking = false; refresh(); };
    const observer = new MutationObserver(records => {
      if (records.some(record => !overlay.contains(record.target))) schedule();
    });
    observer.observe(player, { subtree: true, childList: true, characterData: true });
    video.textTracks?.addEventListener("change", schedule);
    video.textTracks?.addEventListener("addtrack", schedule);
    video.addEventListener("timeupdate", schedule);
    video.addEventListener("seeking", onSeek);
    video.addEventListener("seeked", onSeeked);
    const onNavigate = () => this.stop();
    document.addEventListener("yt-navigate-start", onNavigate);
    this.stopPlayback = () => {
      observer.disconnect(); clearTimeout(timer); overlay.remove();
      observedTrack?.removeEventListener("cuechange", schedule);
      video.textTracks?.removeEventListener("change", schedule);
      video.textTracks?.removeEventListener("addtrack", schedule);
      video.removeEventListener("timeupdate", schedule);
      video.removeEventListener("seeking", onSeek);
      video.removeEventListener("seeked", onSeeked);
      document.removeEventListener("yt-navigate-start", onNavigate);
      if (activated?.mode === "hidden") activated.mode = "disabled";
      current = "";
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
    refresh();
    showToast(t("captionsOn"), "info", 3000);
    return true;
  }
}
