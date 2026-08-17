"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function DashboardNewProjectForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice("Reading the public website and preparing a context draft…");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/dashboard/projects", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_url: String(form.get("product_url") ?? "").trim() }),
      });
      const body = (await response.json().catch(() => null)) as {
        destination?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.destination) {
        throw new Error(body?.error ?? "The product website could not be prepared.");
      }
      router.push(body.destination);
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The product website could not be prepared.",
      );
      setPending(false);
    }
  }

  return (
    <form className="dashboard-form" onSubmit={submit}>
      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Public website</p>
        <h2>Where can we understand the product?</h2>
        <p>
          Enter the canonical public URL. Access is limited to an approved Founder or design-partner
          workspace. This step does not call model, trend, social, or paid research providers. You
          will review every saved inference next.
        </p>
        <label>
          Product URL
          <input
            autoComplete="url"
            defaultValue={initialUrl}
            disabled={pending}
            inputMode="url"
            maxLength={2_048}
            name="product_url"
            placeholder="https://example.com"
            required
            type="url"
          />
        </label>
      </section>
      <button disabled={pending} type="submit">
        {pending ? "Reading website…" : "Continue to context review"}
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </form>
  );
}
