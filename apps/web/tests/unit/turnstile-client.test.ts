import { describe, expect, it, vi } from "vitest";

import {
  getBrowserTurnstile,
  removeTurnstileWidget,
  resetTurnstileWidget,
  type BrowserTurnstile,
} from "../../lib/turnstile-client";

function client(): BrowserTurnstile {
  return {
    render: vi.fn(() => "widget-2"),
    reset: vi.fn(),
    remove: vi.fn(),
  };
}

describe("Turnstile browser lifecycle", () => {
  it("resolves only a complete browser client", () => {
    const complete = client();
    expect(getBrowserTurnstile({ turnstile: complete })).toBe(complete);
    expect(getBrowserTurnstile({ turnstile: { reset: vi.fn() } })).toBeNull();
    expect(getBrowserTurnstile(undefined)).toBeNull();
  });

  it("resets and removes the exact submitted widget", () => {
    const turnstile = client();
    resetTurnstileWidget(turnstile, "widget-2");
    removeTurnstileWidget(turnstile, "widget-2");
    expect(turnstile.reset).toHaveBeenCalledWith("widget-2");
    expect(turnstile.remove).toHaveBeenCalledWith("widget-2");
  });

  it("does not replace a submission error with a third-party lifecycle error", () => {
    const turnstile = client();
    vi.mocked(turnstile.reset).mockImplementation(() => {
      throw new Error("reset failed");
    });
    vi.mocked(turnstile.remove).mockImplementation(() => {
      throw new Error("remove failed");
    });
    expect(() => resetTurnstileWidget(turnstile, "widget-2")).not.toThrow();
    expect(() => removeTurnstileWidget(turnstile, "widget-2")).not.toThrow();
  });
});
