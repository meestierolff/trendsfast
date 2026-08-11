import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, siteOrigin } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: DEFAULT_TITLE,
    template: "%s · TrendsFast",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: "TrendsFast",
  category: "Business",
  keywords: [
    "social media trend API",
    "social media trend detection",
    "trend intelligence for AI agents",
    "content ideas for AI agents",
    "content distribution API",
    "trend spotting for founders",
  ],
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    type: "website",
    siteName: "TrendsFast",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: { index: true, follow: true },
  alternates: {
    types: {
      "application/rss+xml": [
        { url: "/blog/rss.xml", title: "TrendsFast blog" },
        { url: "/news/rss.xml", title: "TrendsFast news" },
      ],
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#070913",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="page-shell">
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
