import Link from "next/link";
import { SITE_GITHUB_URL } from "../lib/site";
import { BrandMark } from "./brand-mark";

const productLinks = [
  ["AI Agents", "/agents"],
  ["Channels", "/channels"],
  ["Pricing", "/pricing"],
  ["Sources", "/sources"],
] as const;

const resourceLinks = [
  ["Dev docs", "/docs"],
  ["Blog", "/blog"],
  ["News", "/news"],
  ["Open metrics", "/open"],
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <Link className="brand" href="/">
          <BrandMark />
          <span>TrendsFast</span>
        </Link>
        <p>The social and search trend intelligence API for founders and their AI agents.</p>
        <span>Founder-reviewed · No auto-posting · Open source</span>
      </div>
      <div className="footer-column">
        <strong>Product</strong>
        {productLinks.map(([label, href]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </div>
      <div className="footer-column">
        <strong>Resources</strong>
        {resourceLinks.map(([label, href]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </div>
      <div className="footer-column">
        <strong>Company</strong>
        <Link href="/open-source">Open source</Link>
        <a href={SITE_GITHUB_URL} rel="noreferrer" target="_blank">
          GitHub ↗
        </a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </div>
      <p className="footer-note">AGPL-3.0 · Built in Amsterdam</p>
    </footer>
  );
}
