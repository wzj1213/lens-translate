import type { ContentCommand, RuntimeRequest } from "./types";

export const SESSION_PORT_NAME = "lens-session";
export const SELECTION_PORT_NAME = "lens-selection";

/** Send a one-shot message to the service worker. Resolves with its response. */
export function sendToRuntime<T = unknown>(message: RuntimeRequest): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

/** Send a command envelope to a specific tab's content script. */
export function sendCommandToTab<T = unknown>(tabId: number, command: ContentCommand): Promise<T> {
  return chrome.tabs.sendMessage(tabId, { type: "LENS_COMMAND", command }) as Promise<T>;
}
