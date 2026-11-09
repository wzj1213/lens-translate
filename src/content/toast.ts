import { injectStyles } from "@content/styles";

export type ToastTone = "info" | "success" | "warning" | "error";

let toastEl: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(message: string, tone: ToastTone = "info", duration = 3500): void {
  injectStyles();
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "lens-toast";
    toastEl.dataset.lensUi = "toast";
    toastEl.setAttribute("role", "status");
    document.documentElement.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.dataset.tone = tone;
  if (timer) clearTimeout(timer);
  timer = setTimeout(hideToast, duration);
}

export function hideToast(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  toastEl?.remove();
  toastEl = null;
}
