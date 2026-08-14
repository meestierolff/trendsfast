export type BrowserTurnstile = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "dark" | "light" | "auto";
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

export function getBrowserTurnstile(
  scope: unknown = typeof window === "undefined" ? undefined : window,
): BrowserTurnstile | null {
  if (!scope || typeof scope !== "object" || !("turnstile" in scope)) return null;
  const candidate = (scope as { turnstile?: Partial<BrowserTurnstile> }).turnstile;
  return candidate &&
    typeof candidate.render === "function" &&
    typeof candidate.reset === "function" &&
    typeof candidate.remove === "function"
    ? (candidate as BrowserTurnstile)
    : null;
}

export function resetTurnstileWidget(
  client: BrowserTurnstile | null,
  widgetId: string | null,
): void {
  if (!client || !widgetId) return;
  try {
    client.reset(widgetId);
  } catch {
    // A failed UI reset must not hide the original submission error.
  }
}

export function removeTurnstileWidget(
  client: BrowserTurnstile | null,
  widgetId: string | null,
): void {
  if (!client || !widgetId) return;
  try {
    client.remove(widgetId);
  } catch {
    // The third-party script can disappear during navigation or hot reload.
  }
}
