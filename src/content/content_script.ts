import { formatContentError } from "@content/env";
import { TranslatorApp } from "@features/translate/content/app";
import type { CommandEnvelope } from "@shared/types";

declare global {
  interface Window {
    __lensLoaded?: boolean;
  }
}

if (!window.__lensLoaded) {
  window.__lensLoaded = true;
  const app = new TranslatorApp();
  const ready = app.init();

  chrome.runtime.onMessage.addListener((message: CommandEnvelope, _sender, respond) => {
    if (message?.type !== "LENS_COMMAND") return false;
    // The popup can send a command immediately after injecting the script.
    ready.then(() => app.handleCommand(message.command))
      .then((status) => respond({ ok: true, ...status }))
      .catch((error) => respond({ ok: false, error: formatContentError(error) }));
    return true;
  });
}
