"use client";

import { useEffect, useRef, useState } from "react";

type ClaimState = "WAITING_FOR_WEBHOOK" | "READY_TO_ISSUE" | "KEY_ALREADY_ISSUED";

export function BillingSuccessClient({
  sessionId,
  initialState,
}: {
  sessionId: string;
  initialState: ClaimState;
}) {
  const [state, setState] = useState<ClaimState | "KEY_ISSUED" | "ERROR">(initialState);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const issuing = useRef(false);

  useEffect(() => {
    if (state !== "WAITING_FOR_WEBHOOK") return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/billing/claim?session_id=${encodeURIComponent(sessionId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        const body = (await response.json()) as { state?: ClaimState };
        if (!active) return;
        if (body.state === "READY_TO_ISSUE" || body.state === "KEY_ALREADY_ISSUED") {
          setState(body.state);
        }
      } catch {
        // Keep the honest pending state; a later poll can recover.
      }
    };
    const timer = window.setInterval(() => void poll(), 3_000);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionId, state]);

  async function issueKey() {
    if (issuing.current) return;
    issuing.current = true;
    setMessage(null);
    try {
      const response = await fetch(
        `/api/billing/claim?session_id=${encodeURIComponent(sessionId)}`,
        { method: "POST", credentials: "same-origin", cache: "no-store" },
      );
      const body = (await response.json()) as {
        state?: ClaimState | "KEY_ISSUED";
        rawKey?: string;
        guidance?: string;
      };
      if (body.state === "KEY_ISSUED" && body.rawKey) {
        setRawKey(body.rawKey);
        setState("KEY_ISSUED");
        setMessage(body.guidance ?? null);
      } else if (body.state === "KEY_ALREADY_ISSUED") {
        setState("KEY_ALREADY_ISSUED");
        setMessage(body.guidance ?? null);
      } else if (body.state === "WAITING_FOR_WEBHOOK") {
        setState("WAITING_FOR_WEBHOOK");
      } else {
        setState("ERROR");
      }
    } catch {
      setState("ERROR");
    } finally {
      issuing.current = false;
    }
  }

  if (state === "WAITING_FOR_WEBHOOK") {
    return <p role="status">Waiting for Stripe’s signed webhook before activating monitoring…</p>;
  }
  if (state === "READY_TO_ISSUE") {
    return (
      <div>
        <p>Your webhook-authoritative entitlement is active.</p>
        <button type="button" onClick={() => void issueKey()}>
          Reveal my project API key
        </button>
      </div>
    );
  }
  if (state === "KEY_ISSUED" && rawKey) {
    return (
      <div role="status">
        <h2>Copy your key now.</h2>
        <p>{message}</p>
        <input readOnly value={rawKey} onFocus={(event) => event.currentTarget.select()} />
      </div>
    );
  }
  if (state === "KEY_ALREADY_ISSUED") {
    return (
      <div role="status">
        <h2>This claim has already issued its one key.</h2>
        <p>
          The raw key cannot be recovered. Use the authenticated founder operations flow to rotate
          it if it was lost.
        </p>
      </div>
    );
  }
  return <p role="alert">The key could not be issued. Nothing was activated by this page.</p>;
}
