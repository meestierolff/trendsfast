import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand" href="/">
          <BrandMark />
          <span>TrendsFast</span>
        </Link>
        <p>One evidence-backed distribution move. No auto-posting.</p>
      </div>
      <div className="footer-links">
        <Link href="/sources">Sources</Link>
        <Link href="/docs">API docs</Link>
        <Link href="/open">Open metrics</Link>
        <Link href="/open-source">Open source</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </div>
      <p className="footer-note">Founder-reviewed alpha · AGPL-3.0 · Built in Amsterdam</p>
    </footer>
  );
}
