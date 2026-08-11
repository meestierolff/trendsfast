import Link from "next/link";
import { listPublicSourceStatuses } from "../lib/source-projection-service";

export async function SourceStatusStrip() {
  const sources = await listPublicSourceStatuses();
  return (
    <div className="source-strip section-pad">
      <div className="source-strip-label">
        <span className="live-pulse" />
        SOURCE COVERAGE
      </div>
      <div className="source-strip-items" aria-label="Public source status" tabIndex={0}>
        {sources.slice(0, 8).map((source) => (
          <span key={source.slug} title={`${source.name}: ${source.publicLabel}`}>
            {source.name}
            <small data-status={source.publicLabel.toLowerCase().replaceAll(" ", "-")}>
              {source.publicLabel}
            </small>
          </span>
        ))}
      </div>
      <Link href="/sources">Source truth →</Link>
    </div>
  );
}
