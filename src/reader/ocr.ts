import { createWorker, OEM } from "tesseract.js";
import { t } from "@shared/i18n";

const betweenCjkCharacters = /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[ \t]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;

export function recognizedText(text: string, language: string): string {
  return (language === "eng" ? text : text.replace(betweenCjkCharacters, "")).trim();
}

export async function recognize(blob: Blob, language: string, signal: AbortSignal, progress: (message: string) => void): Promise<string> {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(blob);
  try {
    signal.throwIfAborted();
    const ratio = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const base = chrome.runtime.getURL("vendor/ocr/");
    let fail!: (reason: unknown) => void;
    const interrupted = new Promise<never>((_, reject) => { fail = reject; });
    const abort = () => fail(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const starting = createWorker(language === "eng" ? "eng" : [language, "eng"], OEM.LSTM_ONLY, {
      workerPath: base + "worker.min.js",
      corePath: base + "tesseract-core-lstm.wasm.js",
      langPath: base,
      workerBlobURL: false,
      errorHandler: fail,
      logger: event => {
        if (!signal.aborted && event.status === "recognizing text") {
          progress(t("ocrProgress", String(Math.round(event.progress * 100))));
        }
      },
    });
    try {
      const worker = await Promise.race([starting, interrupted]);
      const result = await Promise.race([worker.recognize(canvas), interrupted]);
      return recognizedText(result.data.text, language);
    } finally {
      signal.removeEventListener("abort", abort);
      // Initialization may finish after a different image has been chosen.
      void starting.then(worker => worker.terminate()).catch(() => {});
    }
  } finally {
    bitmap.close();
  }
}
