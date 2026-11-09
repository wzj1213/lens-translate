import { openImage } from "./imageMenu";
import { createCacheKey } from "@shared/cacheKey";
import { normalizeEndpoint, validateEndpointUrl } from "@shared/endpoint";
import { t } from "@shared/i18n";
import { sendCommandToTab, SELECTION_PORT_NAME, SESSION_PORT_NAME } from "@shared/messaging";
import { loadSettings, normalizeSettings } from "@shared/settings";
import type {
  ContentCommand,
  RuntimeRequest,
  SelectionInbound,
  PageContext,
  SelectionOutbound,
  Settings,
} from "@shared/types";
import { normalizeText, toUserMessage } from "@shared/util";
import { sanitizeSecrets } from "@features/translate/background/apiError";
import { PersistentCache } from "@features/translate/background/persistentCache";
import { pageContextOf, TranslationSession } from "@features/translate/background/sessionManager";
import { requestTranslation, requestTranslationStream } from "@features/translate/background/translator";

const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new PersistentCache({ maxEntries: 8000 });
const sessions = new Map<string, TranslationSession>();

const COMMAND_MAP: Record<string, ContentCommand> = {
  "toggle-translate-page": "TOGGLE_PAGE",
  "translate-selection": "TRANSLATE_SELECTION",
  "toggle-auto-translate": "TOGGLE_AUTO",
  "translate-input": "TRANSLATE_INPUT",
  "restore-original": "RESTORE_ORIGINAL",
  "show-selection-toolbar": "SHOW_SELECTION_TOOLBAR",
};

// --- Context menus ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "lens-image", title: t("imageMenu"), contexts: ["image"] });
    chrome.contextMenus.create({ id: "lens-write", title: t("cmdInput"), contexts: ["editable"] });
    chrome.contextMenus.create({ id: "lens-undo", title: t("undoWriting"), contexts: ["editable"] });
    chrome.contextMenus.create({ id: "lens-page", title: t("cmdTogglePage"), contexts: ["page"] });
    chrome.contextMenus.create({
      id: "lens-selection",
      title: t("cmdSelection"),
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "lens-selection-toolbar",
      title: t("cmdSelectionToolbar"),
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "lens-image") {
    void openImage(info, tab).catch(error => console.warn("Could not open image reader", error));
    return;
  }
  const command = ({
    "lens-write": "TRANSLATE_INPUT",
    "lens-undo": "UNDO_INPUT",
    "lens-page": "TOGGLE_PAGE",
    "lens-selection": "TRANSLATE_SELECTION",
    "lens-selection-toolbar": "SHOW_SELECTION_TOOLBAR",
  } as Record<string, ContentCommand>)[info.menuItemId];
  if (command) void dispatchToTab(tab.id, command);
});

chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove("lensImage:" + id); });

// --- Keyboard shortcuts ---

chrome.commands.onCommand.addListener((name) => {
  const command = COMMAND_MAP[name];
  if (!command) return;
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId) void dispatchToTab(tabId, command);
  });
});

async function dispatchToTab(tabId: number, command: ContentCommand): Promise<void> {
  try {
    await sendCommandToTab(tabId, command);
  } catch {
    // Content scripts are absent on chrome:// pages, the Web Store, and PDFs.
  }
}

// --- One-shot messages (options / popup / content bubble) ---

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  if (message?.type === "TEST_CONNECTION") {
    testConnection(message.settings)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }
  if (message?.type === "BROADCAST_COMMAND") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab." });
      return false;
    }
    dispatchToTab(tabId, message.command)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }
  if (message?.type === "GET_CACHE_STATS") {
    cache.stats()
      .then((stats) => sendResponse({ ok: true, ...stats }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }
  if (message?.type === "CLEAR_CACHE") {
    cache.clear()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: toUserMessage(error) }));
    return true;
  }
  return false;
});

async function testConnection(overrides: Partial<Settings>): Promise<string> {
  const settings = normalizeSettings(overrides);
  if (!settings.endpoint) throw new Error(t("toastNeedConfig"));
  if (!settings.model) throw new Error(t("toastNeedConfig"));

  const check = validateEndpointUrl(normalizeEndpoint(settings.endpoint, settings.protocol), { allowPrivate: true });
  if (!check.ok) throw new Error(check.reason);

  const items = await requestTranslation(
    [{ id: "test", text: "Hello, this is a connection test." }],
    settings,
    new AbortController().signal,
  );
  return items[0]?.translated ?? "";
}

// --- Ports: page sessions + streaming selection ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === SESSION_PORT_NAME) {
    handleSessionPort(port);
  } else if (port.name === SELECTION_PORT_NAME) {
    handleSelectionPort(port);
  }
});

function handleSessionPort(port: chrome.runtime.Port): void {
  const session = new TranslationSession(port, cache);
  sessions.set(session.id, session);

  port.onMessage.addListener((message) => {
    if (message?.type === "START_TRANSLATION") {
      session.start(message.segments ?? [], typeof message.sample === "string" ? message.sample : "").catch((error) => {
        try {
          port.postMessage({ type: "FATAL_ERROR", message: toUserMessage(error) });
        } catch {
          /* tab gone */
        }
      });
    } else if (message?.type === "APPEND_SEGMENTS") {
      session.append(message.segments ?? []);
    } else if (message?.type === "CANCEL_TRANSLATION") {
      session.cancel("User cancelled");
    }
  });

  port.onDisconnect.addListener(() => {
    session.cancel("Port disconnected");
    sessions.delete(session.id);
  });
}

function handleSelectionPort(port: chrome.runtime.Port): void {
  const controller = new AbortController();
  const context = pageContextOf(port);
  let active = false;

  port.onMessage.addListener((message: SelectionInbound) => {
    if (message?.type !== "TRANSLATE" || active) return;
    active = true;
    void runSelection(port, message, controller.signal, context).finally(() => {
      active = false;
    });
  });

  port.onDisconnect.addListener(() => controller.abort());
}

async function runSelection(
  port: chrome.runtime.Port,
  request: SelectionInbound,
  signal: AbortSignal,
  context: PageContext,
): Promise<void> {
  const send = (message: SelectionOutbound) => {
    try {
      port.postMessage(message);
    } catch {
      /* panel closed */
    }
  };
  try {
    const settings = await loadSettings();
    const text = normalizeText(request.text);
    if (request.targetLang) settings.targetLang = String(request.targetLang).slice(0, 80);
    if (request.sentence) context = { ...context, sentence: normalizeText(String(request.sentence)).slice(0, 650) };
    if (settings.engine !== "model" || !settings.endpoint || !settings.model) throw new Error(t("toastNeedConfig"));
    if (!text) throw new Error(t("toastNoText"));

    cache.setMaxEntries(settings.cacheMaxEntries);
    const keyInput = {
      endpoint: settings.endpoint,
      protocol: settings.protocol,
      model: settings.model,
      targetLang: settings.targetLang,
      glossary: settings.glossary,
      context: JSON.stringify(context),
    };
    const cacheKey = await createCacheKey(keyInput, text);

    if (settings.cacheEnabled) {
      const cached = await cache.getMany([cacheKey], settings.cacheTtlDays * DAY_MS);
      const hit = cached.get(cacheKey);
      if (hit) {
        send({ type: "DONE", translated: hit, fromCache: true });
        return;
      }
    }

    const translated = await requestTranslationStream(
      text,
      settings,
      signal,
      (chunk) => send({ type: "DELTA", chunk }),
      context,
    );
    if (!translated) throw new Error(t("toastFailed"));

    if (settings.cacheEnabled) {
      void cache.setMany([{ key: cacheKey, translated }], settings.cacheTtlDays * DAY_MS);
    }
    send({ type: "DONE", translated, fromCache: false });
  } catch (error) {
    if (signal.aborted) return;
    const settings = await loadSettings().catch(() => null);
    send({ type: "ERROR", message: sanitizeSecrets(toUserMessage(error), settings?.apiKey) });
  }
}
