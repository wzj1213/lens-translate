// Thin wrapper over chrome.i18n with a DOM helper for static markup.

export function t(key: string, substitutions?: string | string[]): string {
  try {
    const message = chrome.i18n.getMessage(key, substitutions as string | string[] | undefined);
    return message || key;
  } catch {
    return key;
  }
}

/**
 * Fill localized strings into static markup:
 *   data-i18n="key"             -> textContent
 *   data-i18n-title="key"       -> title attribute
 *   data-i18n-placeholder="key" -> placeholder attribute
 *   data-i18n-aria="key"        -> aria-label attribute
 */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });
  applyAttr(root, "i18nTitle", "data-i18n-title", "title");
  applyAttr(root, "i18nPlaceholder", "data-i18n-placeholder", "placeholder");
  applyAttr(root, "i18nAria", "data-i18n-aria", "aria-label");
}

function applyAttr(root: ParentNode, datasetKey: string, selectorAttr: string, attr: string): void {
  root.querySelectorAll<HTMLElement>(`[${selectorAttr}]`).forEach((el) => {
    const key = el.dataset[datasetKey];
    if (key) el.setAttribute(attr, t(key));
  });
}

export function uiLanguage(): string {
  try {
    return chrome.i18n.getUILanguage();
  } catch {
    return "en";
  }
}
