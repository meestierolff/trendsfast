"use client";

export function BillingCanceledReturn() {
  return (
    <button type="button" onClick={() => window.history.go(-2)}>
      Return to my private result
    </button>
  );
}
