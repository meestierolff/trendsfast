import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "TrendsFast — Know what to distribute next",
    template: "%s · TrendsFast",
  },
  description:
    "One founder-reviewed, evidence-backed distribution move from live conversations, search demand, developer adoption, news, and content signals.",
  openGraph: {
    title: "Know what to distribute next.",
    description: "One evidence-backed move for founders and their agents.",
    type: "website",
    siteName: "TrendsFast",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#171713",
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
