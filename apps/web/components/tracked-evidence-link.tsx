"use client";

import type { ReactNode } from "react";

export function TrackedEvidenceLink({
  href,
  analyticsPath,
  children,
}: {
  href: string;
  analyticsPath: string;
  children: ReactNode;
}) {
  function record() {
    try {
      void fetch(analyticsPath, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // The direct evidence navigation must remain independent from analytics.
    }
  }

  return (
    <a href={href} rel="noreferrer" onClick={record}>
      {children}
    </a>
  );
}
