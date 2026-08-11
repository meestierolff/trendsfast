import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getScanStatusByToken } from "@/lib/scan-view-service";
import { ScanStatusPoller } from "../../../../components/scan-status-poller";

import "../../scan.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scan status",
  description: "The private status of a TrendsFast founder-reviewed scan.",
  robots: "noindex, nofollow, noarchive",
};

export default async function RequestedScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const status = await getScanStatusByToken(token);

  if (!status.found) notFound();

  return <ScanStatusPoller token={token} initialStatus={status} />;
}
