import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getReadyResultByToken } from "@/lib/scan-view-service";
import { ScanResultView } from "../../../components/scan-result-view";

import "../scan.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Next Move",
  description: "A private, founder-reviewed TrendsFast Next Move with evidence receipts.",
  robots: "noindex, nofollow, noarchive",
};

export default async function ScanResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getReadyResultByToken(token);

  if (!result) notFound();

  return <ScanResultView token={token} result={result} />;
}
