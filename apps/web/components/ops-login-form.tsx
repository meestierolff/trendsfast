"use client";

import { useState, type FormEvent } from "react";

export function OpsLoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: form.get("token") }),
    });
    if (response.ok) {
      window.location.reload();
      return;
    }
    setError(
      response.status === 429
        ? "Too many attempts. Try again later."
        : "That operations token is not valid.",
    );
    setPending(false);
  }

  return (
    <form className="ops-login" onSubmit={submit}>
      <label htmlFor="ops-token">Operations token</label>
      <input id="ops-token" type="password" name="token" autoComplete="current-password" required />
      <button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Enter operations"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
