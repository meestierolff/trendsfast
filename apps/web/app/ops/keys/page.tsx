import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { loadEnv } from "@trendsfast/config";

import { OpsApiKeyManager } from "../../../components/ops-api-key-manager";
import { OpsDesignPartnerGrantManager } from "../../../components/ops-design-partner-grant-manager";
import { getRepositories } from "../../../lib/server-database";
import { getOpsPageAuthorization } from "../_auth";

import "../ops.css";

export const metadata: Metadata = {
  title: "API keys · Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OpsKeysPage() {
  const authorization = await getOpsPageAuthorization();
  if (!authorization) redirect("/ops");
  const repositories = getRepositories();
  const [projects, keys, events, grants] = await Promise.all([
    repositories.scanData.listProjects({ activeOnly: true, limit: 200 }),
    repositories.apiKeys.list({ limit: 200 }),
    repositories.apiKeys.listManagementEvents({ limit: 200 }),
    repositories.founderGrants.list({ limit: 200 }),
  ]);
  const environment = loadEnv().PROVIDER_CREDENTIAL_MODE === "fixture" ? "test" : "live";

  return (
    <section className="ops-shell ops-detail-shell section-pad">
      <p className="ops-detail-back">
        <Link href="/ops">← Review queue</Link>
        <span>/</span>
        <Link href="/ops/sources">Source verification</Link>
      </p>
      <div className="ops-detail-hero">
        <div>
          <p className="ops-kicker">PRIVATE / API ACCESS</p>
          <h1>Project API keys.</h1>
          <p>
            Every issued key is project-bound, expiring, scoped, rate-limited, and cost-limited.
          </p>
        </div>
      </div>
      <OpsApiKeyManager
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name ?? new URL(project.url).hostname,
          url: project.url,
        }))}
        keys={keys.map((key) => ({
          ...key,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          expiresAt: key.expiresAt?.toISOString() ?? null,
          revokedAt: key.revokedAt?.toISOString() ?? null,
        }))}
        events={events.map((event) => ({
          id: event.id,
          action: event.action,
          actorId: event.actorId,
          apiKeyId: event.apiKeyId,
          relatedApiKeyId: event.relatedApiKeyId,
          occurredAt: event.occurredAt.toISOString(),
        }))}
        csrfToken={authorization.csrfToken}
        environment={environment}
      />
      <OpsDesignPartnerGrantManager
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name ?? new URL(project.url).hostname,
          url: project.url,
        }))}
        initialGrants={grants.map((grant) => ({
          id: grant.id,
          projectId: grant.projectId,
          issuedBy: grant.issuedBy,
          createdAt: grant.createdAt.toISOString(),
          expiresAt: grant.expiresAt.toISOString(),
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          revokedBy: grant.revokedBy,
        }))}
        csrfToken={authorization.csrfToken}
      />
    </section>
  );
}
