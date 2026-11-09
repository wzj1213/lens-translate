// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=example"}
import { afterEach, expect, it, vi } from "vitest";
import { CaptionTranslator } from "@features/translate/content/captions";
import { translateText } from "@shared/translateText";

vi.mock("@shared/translateText", () => ({ translateText: vi.fn() }));
vi.mock("@content/toast", () => ({ showToast: vi.fn() }));

const player = new CaptionTranslator();
afterEach(() => { player.stop(); vi.clearAllMocks(); document.body.replaceChildren(); });

function setup(tracks: TextTrack[] = []) {
  document.body.innerHTML = "<div class='html5-video-player'><video></video><span class='ytp-caption-segment'></span></div>";
  const list = Object.assign(new EventTarget(), tracks, { length: tracks.length });
  const video = document.querySelector("video")!;
  Object.defineProperty(video, "textTracks", { value: list });
  return { video, caption: document.querySelector(".ytp-caption-segment")!, overlay: () => document.querySelector<HTMLElement>(".lens-captions")! };
}

it("discards late translations across a seek and waits for the displayed line to change", async () => {
  const { video, caption, overlay } = setup();
  let stale!: (result: string) => void;
  vi.mocked(translateText).mockImplementationOnce(() => new Promise(resolve => { stale = resolve; })).mockResolvedValue("second translation");
  caption.textContent = "first"; player.toggle();
  video.dispatchEvent(new Event("seeking")); video.dispatchEvent(new Event("seeked"));
  stale("stale translation");
  await Promise.resolve();
  expect(overlay().hidden).toBe(true);
  expect(translateText).toHaveBeenCalledTimes(1);
  caption.textContent = "second";
  await vi.waitFor(() => expect(overlay().textContent).toBe("second translation"));
  player.stop();
  expect(overlay()).toBeNull();
});

it("uses timed cues when no DOM captions exist and restores the original track mode", async () => {
  const cue = {
    startTime: 0, endTime: 3,
    getCueAsHTML: () => { const node = document.createDocumentFragment(); node.append("original"); return node; },
  };
  const track = Object.assign(new EventTarget(), { mode: "disabled", kind: "subtitles", language: "en", cues: [cue], activeCues: [cue] });
  const { overlay } = setup([track as unknown as TextTrack]);
  vi.mocked(translateText).mockResolvedValue("translation");
  player.toggle();
  await vi.waitFor(() => expect(overlay().textContent).toBe("original\ntranslation"));
  expect(track.mode).toBe("hidden");
  player.stop();
  expect(track.mode).toBe("disabled");
});
