import Link from "next/link";
import { SOURCE_CATALOG, productionStatus } from "../lib/source-catalog";

export function SourceStatusStrip() {
  return (
    <div className="source-strip">
      <div className="source-strip-label">
        <span className="live-pulse" />
        LAUNCH PANEL
      </div>
      <div className="source-strip-items" aria-label="Launch source status" tabIndex={0}>
        {SOURCE_CATALOG.slice(0, 8).map((source) => (
          <span key={source.slug} title={`${source.name}: ${productionStatus(source)}`}>
            {source.name}
            <small>{source.fixtureAvailable ? "FIXTURE" : source.status}</small>
          </span>
        ))}
      </div>
      <Link href="/sources">Full status →</Link>
    </div>
  );
}
