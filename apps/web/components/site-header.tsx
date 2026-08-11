import Link from "next/link";
import { BrandMark } from "./brand-mark";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="TrendsFast home">
        <BrandMark />
        <span>TrendsFast</span>
      </Link>
      <nav aria-label="Primary navigation">
        <Link href="/sources">Sources</Link>
        <Link href="/docs">API</Link>
        <Link href="/open">Open metrics</Link>
        <Link href="/open-source">Open source</Link>
      </nav>
      <a className="header-cta" href="#scan">
        Run a scan
      </a>
    </header>
  );
}
