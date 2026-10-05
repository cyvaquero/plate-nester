export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}
