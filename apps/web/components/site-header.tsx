"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE_GITHUB_URL } from "../lib/site";
import { BrandMark } from "./brand-mark";

const links = [
  { href: "/agents", label: "AI Agents" },
  { href: "/docs", label: "Dev Docs" },
  { href: "/channels", label: "Channels" },
  { href: "/news", label: "News" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="site-header" data-open={open}>
      <div className="site-header-inner">
        <Link
          className="brand"
          href="/"
          aria-label="TrendsFast home"
          onClick={() => setOpen(false)}
        >
          <BrandMark />
          <span>TrendsFast</span>
        </Link>

        <button
          className="nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen((value) => !value)}
        >
          <span />
          <span />
        </button>

        <nav id="primary-navigation" aria-label="Primary navigation">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <a href={SITE_GITHUB_URL} rel="noreferrer" target="_blank" onClick={() => setOpen(false)}>
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </nav>

        <Link className="header-cta" href="/#scan" onClick={() => setOpen(false)}>
          Run a free scan <span aria-hidden="true">→</span>
        </Link>
      </div>
    </header>
  );
}
