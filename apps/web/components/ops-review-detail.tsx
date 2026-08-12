import Link from "next/link";

import {
  OpsActionControls,
  OpsEvidenceControls,
  OpsManualEvidenceControl,
} from "./ops-action-controls";
import { formatOpsDuration } from "./ops-queue";

type OpsDate = string | Date;

export type OpsReviewDetailView = {
  request: {
    id: string;
    publicId: string;
    state: string;
    origin: string;
    submittedUrl: string;
    submittedAt: OpsDate;
    startedAt?: OpsDate | null;
    completedAt?: OpsDate | null;
    failureCode?: string | null;
    failureMessage?: string | null;
  };
  run: {
    id: string;
    attempt: number;
    state: string;
    signalClass?: string | null;
    actualCostUsd: string;
    estimatedCostUsd: string;
    submittedAt?: OpsDate | null;
    startedAt?: OpsDate | null;
    reviewRequiredAt?: OpsDate | null;
    completedAt?: OpsDate | null;
    hardDeadlineAt?: OpsDate | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    sourceCoverage?: Record<string, string> | null;
    queryPlan?: {
      version: string;
      generatedAt: string;
      providers: readonly {
        id: string;
        source: string;
        role: string;
        terms: readonly string[];
        constraints: {
          maxCalls: number;
          maxResults: number;
          lookbackHours?: number;
        };
      }[];
    } | null;
  } | null;
  project: { name?: string | null; url: string } | null;
  context: {
    name: string;
    category: string;
    audience: string;
    problem: string;
    desiredOutcome: string;
    language: string;
    credibleClaims: readonly string[];
    credibleTopics: readonly string[];
    suitableChannels: readonly string[];
    availableFormats: readonly string[];
    assumptions: readonly string[];
  } | null;
  move: {
    id: string;
    publicId: string;
    state: string;
    action: string;
    channel: string;
    topic: string;
    angle: string;
    format: string;
    hook: string;
    outline: readonly string[];
    cta: string;
    priority: number;
    confidence: string;
    confidenceRationale?: string | null;
    whyNow: string;
    signalClass: string;
    independentSourceCount: number;
    saturation: string;
    limitations: readonly string[];
    reviewVersion: number;
    proposalStale: boolean;
    promptVersion: string;
    scoreVersion: string;
    founderReviewed: boolean;
    autoPublish: boolean;
    validUntil: OpsDate;
    approvedAt?: OpsDate | null;
    deliveredAt?: OpsDate | null;
  } | null;
  sourceRuns: readonly {
    id: string;
    source: string;
    provider: string;
    state: string;
    maxCalls: number;
    callsMade: number;
    candidateCount: number;
    actualCostUsd: string;
    estimatedCostUsd: string;
    durationMs?: number | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    startedAt?: OpsDate | null;
    completedAt?: OpsDate | null;
  }[];
  evidence: readonly {
    id: string;
    nextMoveId: string;
    source: string;
    provider: string;
    canonicalUrl: string;
    title?: string | null;
    publishedAt?: OpsDate | null;
    observedAt: OpsDate;
    reason: string;
    bindingRole: "DECISION_SUPPORT" | "SUPPLEMENTAL";
    verified: boolean;
    availability: string;
    reviewedBy?: string | null;
    verifiedAt?: OpsDate | null;
  }[];
  signals: readonly {
    id: string;
    source: string;
    provider: string;
    canonicalUrl: string;
    title?: string | null;
    textExcerpt?: string | null;
    publishedAt?: OpsDate | null;
    observedAt: OpsDate;
    queryId: string;
    metrics: unknown;
    cached: boolean;
  }[];
  clusters: readonly {
    id: string;
    topic: string;
    summary?: string | null;
    signalClass: string;
    independentSourceCount: number;
    saturation: string;
    scoreComponents?: Record<string, number> | null;
  }[];
  deliveryState?: string | null;
};

function parsedDate(value: OpsDate | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatDate(value: OpsDate | null | undefined): string {
  const parsed = parsedDate(value);
  if (!parsed) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(parsed)} UTC`;
}

function dateTime(value: OpsDate | null | undefined): string | undefined {
  return parsedDate(value)?.toISOString();
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function requestLatency(detail: OpsReviewDetailView, now: Date): string {
  const start = parsedDate(detail.request.submittedAt);
  const end = parsedDate(detail.request.completedAt) ?? now;
  return start ? formatOpsDuration(Math.max(0, end.valueOf() - start.valueOf())) : "Unknown";
}

function codeLabel(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "Unavailable";
  }
}

export function OpsReviewDetail({
  detail,
  csrfToken,
  now,
  retryEnabled,
}: {
  detail: OpsReviewDetailView;
  csrfToken: string;
  now: Date;
  retryEnabled: boolean;
}) {
  const name = detail.context?.name ?? detail.project?.name ?? "Product not inferred";
  const productUrl = safeHttpUrl(detail.request.submittedUrl);
  const canReviewEvidence =
    detail.request.state === "REVIEW_REQUIRED" &&
    detail.move?.state === "DRAFT" &&
    detail.move.autoPublish === false;
  const checkpoints: ReadonlyArray<{
    label: string;
    value: OpsDate | null | undefined;
  }> = [
    { label: "Submitted", value: detail.request.submittedAt },
    { label: "Processing started", value: detail.request.startedAt ?? detail.run?.startedAt },
    { label: "Review required", value: detail.run?.reviewRequiredAt },
    { label: "Completed", value: detail.request.completedAt ?? detail.run?.completedAt },
  ];

  return (
    <div className="ops-detail">
      <nav className="ops-detail-back" aria-label="Operations breadcrumb">
        <Link href="/ops">Review queue</Link>
        <span aria-hidden="true">/</span>
        <span>{detail.request.publicId}</span>
      </nav>

      <section className="ops-detail-hero" aria-labelledby="ops-detail-title">
        <div>
          <p className="ops-kicker">PRIVATE / PERSISTED REVIEW RECORD</p>
          <h1 id="ops-detail-title">{name}</h1>
          {productUrl ? (
            <a href={productUrl} rel="noreferrer">
              {detail.request.submittedUrl} ↗
            </a>
          ) : (
            <p>{detail.request.submittedUrl}</p>
          )}
        </div>
        <dl>
          <div>
            <dt>Request state</dt>
            <dd>
              <span className="ops-state-pill" data-state={detail.request.state.toLowerCase()}>
                {codeLabel(detail.request.state)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Total latency</dt>
            <dd>{requestLatency(detail, now)}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>
              {detail.deliveryState ??
                (detail.move?.state === "READY" ? "DELIVERED" : "NOT ISSUED")}
            </dd>
          </div>
          <div>
            <dt>Publishing</dt>
            <dd>
              <code>auto_publish={String(detail.move?.autoPublish ?? false)}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="ops-lifecycle" aria-labelledby="ops-lifecycle-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Lifecycle + latency</p>
            <h2 id="ops-lifecycle-title">Every persisted checkpoint.</h2>
          </div>
          <p>
            Request {detail.request.origin.toLowerCase()} · run attempt{" "}
            {detail.run?.attempt ?? "not claimed"}
          </p>
        </div>
        <dl className="ops-timeline">
          {checkpoints.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {value ? (
                  <time dateTime={dateTime(value)}>{formatDate(value)}</time>
                ) : (
                  "Not reached"
                )}
              </dd>
            </div>
          ))}
        </dl>
        {detail.request.failureCode || detail.run?.failureCode ? (
          <div className="ops-recorded-failure" role="note">
            <span>{detail.request.failureCode ?? detail.run?.failureCode}</span>
            <p>
              {detail.request.failureMessage ??
                detail.run?.failureMessage ??
                "No safe failure message recorded."}
            </p>
          </div>
        ) : null}
      </section>

      <section className="ops-query-plan" aria-labelledby="ops-query-plan-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Persisted query plan</p>
            <h2 id="ops-query-plan-title">What each source was asked to do.</h2>
          </div>
          <p>
            {detail.run?.queryPlan
              ? `Version ${detail.run.queryPlan.version} · generated ${formatDate(detail.run.queryPlan.generatedAt)}`
              : "No query plan persisted."}
          </p>
        </div>
        {detail.run?.queryPlan ? (
          <div className="ops-query-groups">
            {detail.run.queryPlan.providers.map((group) => (
              <article key={group.id}>
                <span>{codeLabel(group.source)}</span>
                <h3>{group.role}</h3>
                <ul>
                  {group.terms.map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
                <small>
                  {group.constraints.maxCalls} call
                  {group.constraints.maxCalls === 1 ? "" : "s"} · {group.constraints.maxResults}{" "}
                  results
                  {group.constraints.lookbackHours
                    ? ` · ${group.constraints.lookbackHours}h lookback`
                    : ""}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="ops-detail-empty">The run has not persisted a query plan.</p>
        )}
      </section>

      <section className="ops-provider-runs" aria-labelledby="ops-provider-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Provider health</p>
            <h2 id="ops-provider-title">Source work, without blending.</h2>
          </div>
          <p>Raw provider payloads and credentials are intentionally not rendered here.</p>
        </div>
        {detail.sourceRuns.length > 0 ? (
          <div className="ops-provider-table-wrap">
            <table className="ops-provider-table">
              <thead>
                <tr>
                  <th>Source / provider</th>
                  <th>State</th>
                  <th>Latency</th>
                  <th>Calls</th>
                  <th>Candidates</th>
                  <th>Cost accounting</th>
                  <th>Failure</th>
                </tr>
              </thead>
              <tbody>
                {detail.sourceRuns.map((sourceRun) => (
                  <tr key={sourceRun.id}>
                    <td>
                      <strong>{codeLabel(sourceRun.source)}</strong>
                      <small>{sourceRun.provider}</small>
                    </td>
                    <td>
                      <span data-source-state={sourceRun.state.toLowerCase()}>
                        {codeLabel(sourceRun.state)}
                      </span>
                    </td>
                    <td>
                      {sourceRun.durationMs === null || sourceRun.durationMs === undefined
                        ? "—"
                        : formatOpsDuration(sourceRun.durationMs)}
                    </td>
                    <td>
                      {sourceRun.callsMade} / {sourceRun.maxCalls}
                    </td>
                    <td>{sourceRun.candidateCount}</td>
                    <td>
                      <strong>
                        ${Number(sourceRun.actualCostUsd).toFixed(4)} reported subtotal
                      </strong>
                      <small>
                        ${Number(sourceRun.estimatedCostUsd).toFixed(4)} reserved · unsettled
                        attempts excluded
                      </small>
                    </td>
                    <td>
                      {sourceRun.failureCode ? (
                        <>
                          <strong>{sourceRun.failureCode}</strong>
                          <small>{sourceRun.failureMessage ?? "No message"}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ops-detail-empty">No source runs have been persisted for this attempt.</p>
        )}
      </section>

      {detail.context ? (
        <section className="ops-context-review" aria-labelledby="ops-context-title">
          <div className="ops-detail-section-heading">
            <div>
              <p className="ops-kicker">Inferred product context</p>
              <h2 id="ops-context-title">Check the premise first.</h2>
            </div>
            <p>
              {detail.context.category} · {detail.context.language}
            </p>
          </div>
          <dl>
            <div>
              <dt>Audience</dt>
              <dd>{detail.context.audience}</dd>
            </div>
            <div>
              <dt>Problem</dt>
              <dd>{detail.context.problem}</dd>
            </div>
            <div>
              <dt>Desired outcome</dt>
              <dd>{detail.context.desiredOutcome}</dd>
            </div>
            <div>
              <dt>Credible claims</dt>
              <dd>
                <ul>
                  {detail.context.credibleClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>Credible topics</dt>
              <dd>
                <ul>
                  {detail.context.credibleTopics.map((topic) => (
                    <li key={topic}>{topic}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>Assumptions</dt>
              <dd>
                <ul>
                  {detail.context.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="ops-signal-review" aria-labelledby="ops-signals-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Candidates + independence</p>
            <h2 id="ops-signals-title">Signals before synthesis.</h2>
          </div>
          <p>
            {detail.signals.length} stored candidate{detail.signals.length === 1 ? "" : "s"} ·{" "}
            {detail.clusters.length} cluster{detail.clusters.length === 1 ? "" : "s"}
          </p>
        </div>
        {detail.clusters.length > 0 ? (
          <div className="ops-cluster-list">
            {detail.clusters.map((cluster) => (
              <article key={cluster.id}>
                <span>{codeLabel(cluster.signalClass)}</span>
                <h3>{cluster.topic}</h3>
                <p>{cluster.summary ?? "No cluster summary supplied."}</p>
                <dl>
                  <div>
                    <dt>Independent sources</dt>
                    <dd>{cluster.independentSourceCount}</dd>
                  </div>
                  <div>
                    <dt>Saturation</dt>
                    <dd>{codeLabel(cluster.saturation)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : null}
        <div className="ops-signal-list">
          {detail.signals.length > 0 ? (
            detail.signals.map((signal) => {
              const signalUrl = safeHttpUrl(signal.canonicalUrl);
              return (
                <article key={signal.id}>
                  <div>
                    <span>{codeLabel(signal.source)}</span>
                    <small>
                      {signal.provider} · query {signal.queryId}
                    </small>
                  </div>
                  <h3>{signal.title ?? "Untitled stored signal"}</h3>
                  <p>{signal.textExcerpt ?? "No excerpt stored."}</p>
                  <dl>
                    <div>
                      <dt>Published</dt>
                      <dd>{formatDate(signal.publishedAt)}</dd>
                    </div>
                    <div>
                      <dt>Observed</dt>
                      <dd>{formatDate(signal.observedAt)}</dd>
                    </div>
                    <div>
                      <dt>Cache</dt>
                      <dd>{signal.cached ? "Cached response" : "Provider response"}</dd>
                    </div>
                  </dl>
                  <code>{compactJson(signal.metrics)}</code>
                  {signalUrl ? (
                    <a href={signalUrl} rel="noreferrer">
                      Open candidate source ↗
                    </a>
                  ) : (
                    <span>Invalid candidate URL</span>
                  )}
                </article>
              );
            })
          ) : (
            <p className="ops-detail-empty">No candidate signals were persisted for this run.</p>
          )}
        </div>
      </section>

      {detail.move ? (
        <section className="ops-move-review" aria-labelledby="ops-move-title">
          <div className="ops-move-topline">
            <div>
              <p className="ops-kicker">Draft Next Move</p>
              <span>{detail.move.action}</span>
              <span>{detail.move.channel}</span>
              <span>{detail.move.format}</span>
            </div>
            <div>
              <span>{detail.move.state}</span>
              <span>{detail.move.founderReviewed ? "FOUNDER REVIEWED" : "REVIEW PENDING"}</span>
            </div>
          </div>
          <h2 id="ops-move-title">{detail.move.topic}</h2>
          <blockquote>“{detail.move.hook}”</blockquote>
          <div className="ops-move-copy-grid">
            <div>
              <span>Angle</span>
              <p>{detail.move.angle}</p>
            </div>
            <div>
              <span>Why now</span>
              <p>{detail.move.whyNow}</p>
            </div>
            <div>
              <span>CTA</span>
              <p>{detail.move.cta}</p>
            </div>
            <div>
              <span>Confidence rationale</span>
              <p>{detail.move.confidenceRationale ?? "Not supplied"}</p>
            </div>
          </div>
          <ol className="ops-move-outline">
            {detail.move.outline.map((item, index) => (
              <li key={`${index}-${item}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
          <dl className="ops-move-stats">
            <div>
              <dt>Priority</dt>
              <dd>{detail.move.priority}/100</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{Math.round(Number(detail.move.confidence) * 100)}%</dd>
            </div>
            <div>
              <dt>Signal</dt>
              <dd>{codeLabel(detail.move.signalClass)}</dd>
            </div>
            <div>
              <dt>Independent sources</dt>
              <dd>{detail.move.independentSourceCount}</dd>
            </div>
            <div>
              <dt>Saturation</dt>
              <dd>{codeLabel(detail.move.saturation)}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>
                <time dateTime={dateTime(detail.move.validUntil)}>
                  {formatDate(detail.move.validUntil)}
                </time>
              </dd>
            </div>
          </dl>
          <div className="ops-move-limitations">
            <span>LIMITATIONS</span>
            {detail.move.limitations.length ? (
              <ul>
                {detail.move.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : (
              <p>None supplied.</p>
            )}
          </div>
        </section>
      ) : (
        <p className="ops-detail-empty">No Next Move draft has been persisted.</p>
      )}

      <section className="ops-evidence-review" aria-labelledby="ops-evidence-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Evidence verification</p>
            <h2 id="ops-evidence-title">Open the originals. Check the binding.</h2>
          </div>
          <p>
            {detail.evidence.length} stored receipt{detail.evidence.length === 1 ? "" : "s"}
          </p>
        </div>
        <OpsManualEvidenceControl
          scanId={detail.request.publicId}
          csrfToken={csrfToken}
          canReview={canReviewEvidence}
        />
        <div className="ops-evidence-list">
          {detail.evidence.length ? (
            detail.evidence.map((receipt, index) => {
              const evidenceUrl = safeHttpUrl(receipt.canonicalUrl);
              return (
                <article key={receipt.id}>
                  <div className="ops-evidence-number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="ops-evidence-body">
                    <div className="ops-evidence-topline">
                      <span>{codeLabel(receipt.source)}</span>
                      <span>{codeLabel(receipt.bindingRole)}</span>
                      <span>{receipt.provider}</span>
                      <span data-verified={receipt.verified}>
                        {receipt.verified ? "VERIFIED" : "NOT VERIFIED"}
                      </span>
                      <span>{receipt.availability}</span>
                    </div>
                    <h3>{receipt.title ?? "Original source receipt"}</h3>
                    <p>{receipt.reason}</p>
                    <dl>
                      <div>
                        <dt>Published</dt>
                        <dd>{formatDate(receipt.publishedAt)}</dd>
                      </div>
                      <div>
                        <dt>Observed</dt>
                        <dd>{formatDate(receipt.observedAt)}</dd>
                      </div>
                      <div>
                        <dt>Reviewed by</dt>
                        <dd>{receipt.reviewedBy ?? "Not reviewed"}</dd>
                      </div>
                      <div>
                        <dt>Verified at</dt>
                        <dd>{formatDate(receipt.verifiedAt)}</dd>
                      </div>
                    </dl>
                    <code>{receipt.canonicalUrl}</code>
                    {evidenceUrl ? (
                      <a href={evidenceUrl} rel="noreferrer">
                        Open original evidence ↗
                      </a>
                    ) : (
                      <span>Invalid original URL</span>
                    )}
                    <OpsEvidenceControls
                      scanId={detail.request.publicId}
                      csrfToken={csrfToken}
                      receiptId={receipt.id}
                      reviewVersion={detail.move?.reviewVersion ?? 1}
                      canReview={canReviewEvidence}
                      verified={receipt.verified}
                      availability={receipt.availability}
                    />
                  </div>
                </article>
              );
            })
          ) : (
            <p className="ops-detail-empty">No evidence receipts are bound to this move.</p>
          )}
        </div>
      </section>

      <OpsActionControls
        scanId={detail.request.publicId}
        csrfToken={csrfToken}
        requestState={detail.request.state}
        retryEnabled={retryEnabled}
        {...(detail.run ? { runState: detail.run.state } : {})}
        {...(detail.move
          ? {
              moveState: detail.move.state,
              moveAction: detail.move.action,
              founderReviewed: detail.move.founderReviewed,
              autoPublish: detail.move.autoPublish,
              editableMove: {
                reviewVersion: detail.move.reviewVersion,
                proposalStale: detail.move.proposalStale,
                topic: detail.move.topic,
                angle: detail.move.angle,
                channel: detail.move.channel,
                format: detail.move.format,
                hook: detail.move.hook,
                outline: detail.move.outline,
                cta: detail.move.cta,
                whyNow: detail.move.whyNow,
                limitations: detail.move.limitations,
                validUntil: new Date(detail.move.validUntil).toISOString(),
                confidenceRationale: detail.move.confidenceRationale ?? "",
              },
            }
          : {})}
        {...(detail.context
          ? {
              editableContext: {
                productName: detail.context.name,
                audience: detail.context.audience,
                problem: detail.context.problem,
                desiredOutcome: detail.context.desiredOutcome,
                credibleClaims: detail.context.credibleClaims,
                credibleTopics: detail.context.credibleTopics,
                suitableChannels: detail.context.suitableChannels,
                availableFormats: detail.context.availableFormats,
                assumptions: detail.context.assumptions,
              },
            }
          : {})}
      />
    </div>
  );
}
