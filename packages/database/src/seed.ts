import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  digestNextMoveRequest,
  hashApiKeySecret,
  hashOpaqueToken,
  parseApiKey,
} from "@trendsfast/core";
import { loadEnv } from "@trendsfast/config";
import {
  ActionDetailsSchema,
  BreakoutPotentialSchema,
  NEXT_MOVE_CONTRACT_VERSION,
  TrendWindowSchema,
  type ProjectContext,
  type QueryPlan,
} from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "./client";
import { createDatabaseFromEnv } from "./client";
import {
  FIXTURE_API_KEY,
  FIXTURE_DELIVERY_TOKEN,
  FIXTURE_IDS,
  FIXTURE_MOVE_PUBLIC_ID,
  FIXTURE_SCAN_PUBLIC_ID,
} from "./fixtures";
import {
  analyticsEvents,
  apiKeys,
  clusterMembers,
  clusters,
  deliveryTokens,
  evidenceReceipts,
  nextMoves,
  opportunities,
  projectContextVersions,
  projects,
  providerCostLedger,
  reviewEvents,
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
} from "./schema";
import { loadCliEnvironment } from "./load-cli-env";

const observedAt = new Date("2026-08-11T10:00:00.000Z");
const publishedAt = new Date("2026-08-10T15:00:00.000Z");
const completedAt = new Date("2026-08-11T10:00:08.000Z");
const expiresAt = new Date("2036-08-11T10:00:00.000Z");
const fixtureValidUntil = new Date("2036-08-14T10:00:00.000Z");

const fixtureTrendWindow = TrendWindowSchema.parse({
  state: "EVERGREEN",
  basis: "CORROBORATED_INFERENCE",
  observed_since: publishedAt.toISOString(),
  last_confirmed_at: observedAt.toISOString(),
  recommended_action_by: fixtureValidUntil.toISOString(),
  valid_until: fixtureValidUntil.toISOString(),
  recheck_at: fixtureValidUntil.toISOString(),
  confidence: 0.82,
  explanation:
    "Three independent fixture source classes illustrate an evergreen product example; this is deterministic product evidence, not a live trend claim or duration estimate.",
});

const fixtureBreakoutPotential = BreakoutPotentialSchema.parse({
  level: "medium",
  basis: "HEURISTIC",
  factors: {
    audience_relevance: 0.91,
    timing: 0.72,
    novelty: 0.78,
    product_credibility: 0.94,
    format_fit: 0.8,
    saturation_risk: 0.25,
  },
  explanation:
    "The heuristic reflects fixture relevance, novelty, format fit, and saturation; it is not a probability or promised outcome.",
});

const fixtureOutline = [
  "Describe the fragmented source-research loop.",
  "Show how evidence is stored and independently corroborated.",
  "Explain why one PUBLISH, REPLY, REMIX, or WAIT decision beats a feed.",
];

const fixtureActionDetails = ActionDetailsSchema.parse({
  action: "PUBLISH",
  content_type: "founder_text",
  blueprint: {
    content_premise:
      "Show why founders need one evidence-backed distribution decision instead of another feed.",
    audience_tension:
      "Technical founders can ship quickly but still lose time deciding what is credible and timely enough to distribute.",
    product_role:
      "TrendsFast narrows bounded research to one founder-reviewed PUBLISH, REPLY, REMIX, or WAIT decision.",
    format_family: "founder_text",
    format_basis: "PRODUCT_FIT",
    hook_family: "shipping-speed-versus-distribution-confidence",
    hook_variants: [
      {
        style: "direct",
        text: "Shipping software got faster. Deciding what to distribute did not.",
      },
      {
        style: "contrarian",
        text: "Founders do not need another trend feed; they need permission to wait when evidence is thin.",
      },
      {
        style: "proof",
        text: "Three independent evidence classes can change one distribution decision without pretending to predict virality.",
      },
    ],
    tone: ["specific", "technical", "founder-led"],
    structure: fixtureOutline,
    cta: "Offer a founder-reviewed scan and ask founders whether they would use the move.",
    asset_requirements: ["One product screenshot", "Three redacted evidence receipts"],
    channel_instructions: ["Keep the opening self-contained", "Link only to the product result"],
    production_options: ["FOUNDER_TEXT", "SCREEN_RECORDING"],
  },
  publish_by: fixtureValidUntil.toISOString(),
});

export const FIXTURE_PROJECT_CONTEXT: ProjectContext = {
  name: "TrendsFast",
  url: "https://trendsfast.com",
  category: "distribution intelligence API",
  audience: "Technical solo founders and small teams building AI tools and B2B SaaS.",
  problem:
    "Founders spend hours checking fragmented sources and still do not know what is worth saying now.",
  desiredOutcome: "One timely, credible, evidence-backed distribution move.",
  credibleClaims: [
    "Returns exactly one PUBLISH, REPLY, REMIX, or WAIT decision",
    "Binds recommendations to stored evidence receipts",
  ],
  alternatives: ["manual source research", "generic LLM content prompts"],
  competitors: [],
  markets: ["US", "Europe"],
  language: "en",
  suitableChannels: ["x", "hacker_news", "github"],
  availableFormats: ["founder_text", "technical_post", "screen_recording"],
  credibleTopics: ["distribution research", "trend evidence", "founder-led distribution"],
  assumptions: [
    "The founder can share an implementation-oriented build story",
    "Fixture evidence demonstrates product behavior and is not a live trend claim",
  ],
};

export const FIXTURE_QUERY_PLAN: QueryPlan = {
  id: "qplan_fixture_trendsfast",
  projectContextVersionId: FIXTURE_IDS.context,
  version: "query-plan-v1",
  generatedAt: observedAt.toISOString(),
  providers: [
    {
      id: "qgrp_fixture_trends",
      source: "google_trends",
      role: "external demand direction",
      terms: ["distribution strategy", "founder marketing"],
      constraints: {
        maxCalls: 1,
        maxResults: 10,
        lookbackHours: 720,
        market: "US",
        language: "en",
      },
    },
    {
      id: "qgrp_fixture_hn",
      source: "hacker_news",
      role: "developer pain and current technical conversation",
      terms: ["founder distribution", "developer marketing"],
      constraints: { maxCalls: 2, maxResults: 30, lookbackHours: 168 },
    },
    {
      id: "qgrp_fixture_github",
      source: "github",
      role: "developer adoption and ecosystem context",
      terms: ["open source marketing analytics"],
      constraints: { maxCalls: 1, maxResults: 20, lookbackHours: 720 },
    },
  ],
};

export async function seedFixtureDatabase(
  db: TrendsFastDatabase,
  options: { apiKeyPepper?: string } = {},
) {
  const parsedFixtureKey = parseApiKey(FIXTURE_API_KEY);
  if (!parsedFixtureKey) throw new Error("Fixture API key constant is malformed");
  const fixtureApiKeyHash = await hashApiKeySecret(parsedFixtureKey.secret, options.apiKeyPepper);
  const deliveryTokenHash = hashOpaqueToken(FIXTURE_DELIVERY_TOKEN);

  await db.transaction(async (tx) => {
    await tx
      .insert(projects)
      .values({
        id: FIXTURE_IDS.project,
        publicId: "project_fixture_trendsfast",
        name: "TrendsFast",
        url: "https://trendsfast.com",
        normalizedUrl: "https://trendsfast.com/",
        status: "ACTIVE",
        publicCaseStudyConsent: false,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: { normalizedUrl: "https://trendsfast.com/" },
      });

    await tx
      .insert(projectContextVersions)
      .values({
        id: FIXTURE_IDS.context,
        projectId: FIXTURE_IDS.project,
        version: 1,
        isCurrent: true,
        inferredName: FIXTURE_PROJECT_CONTEXT.name,
        category: FIXTURE_PROJECT_CONTEXT.category,
        audience: FIXTURE_PROJECT_CONTEXT.audience,
        problem: FIXTURE_PROJECT_CONTEXT.problem,
        language: FIXTURE_PROJECT_CONTEXT.language,
        credibleTopics: FIXTURE_PROJECT_CONTEXT.credibleTopics,
        assumptions: FIXTURE_PROJECT_CONTEXT.assumptions,
        context: FIXTURE_PROJECT_CONTEXT,
        entityType: "PRODUCT",
        contextProvenance: {
          observed_facts: [
            {
              field: "product_name",
              value: "TrendsFast",
              source_url: "https://trendsfast.com",
            },
          ],
          inferred_context: [
            {
              field: "audience",
              value: FIXTURE_PROJECT_CONTEXT.audience,
              rationale: "Deterministic fixture context for local product verification.",
            },
          ],
          assumptions: FIXTURE_PROJECT_CONTEXT.assumptions,
        },
        voiceProfile: {
          traits: ["specific", "technical", "restrained"],
          preferred_phrases: ["one evidence-backed distribution move"],
          avoid_phrases: ["guaranteed viral"],
          sample_texts: [],
          sample_urls: ["https://trendsfast.com"],
        },
        contentCapabilities: {
          founder_text: true,
          founder_on_camera: false,
          screen_recording: true,
          ai_avatar: false,
          carousel: false,
          product_demo: false,
          long_form: false,
        },
        sourceContentHash: "sha256:fixture-website-content",
        promptVersion: "fixture-context-v1",
        model: "fixture",
        createdBy: "fixture-seed",
        createdAt: observedAt,
      })
      .onConflictDoUpdate({
        target: projectContextVersions.id,
        set: {
          entityType: "PRODUCT",
          contextProvenance: {
            observed_facts: [
              {
                field: "product_name",
                value: "TrendsFast",
                source_url: "https://trendsfast.com",
              },
            ],
            inferred_context: [
              {
                field: "audience",
                value: FIXTURE_PROJECT_CONTEXT.audience,
                rationale: "Deterministic fixture context for local product verification.",
              },
            ],
            assumptions: FIXTURE_PROJECT_CONTEXT.assumptions,
          },
          voiceProfile: {
            traits: ["specific", "technical", "restrained"],
            preferred_phrases: ["one evidence-backed distribution move"],
            avoid_phrases: ["guaranteed viral"],
            sample_texts: [],
            sample_urls: ["https://trendsfast.com"],
          },
          contentCapabilities: {
            founder_text: true,
            founder_on_camera: false,
            screen_recording: true,
            ai_avatar: false,
            carousel: false,
            product_demo: false,
            long_form: false,
          },
        },
      });

    await tx
      .insert(apiKeys)
      .values({
        id: FIXTURE_IDS.apiKey,
        projectId: FIXTURE_IDS.project,
        name: "Local fixture design-partner key",
        visiblePrefix: parsedFixtureKey.prefix,
        secretHash: fixtureApiKeyHash,
        scopes: ["next_move:read", "next_move:write"],
        environment: "test",
        status: "ACTIVE",
        rateLimitPerHour: 100,
        providerCostLimitUsd: "0.0000",
        createdAt: observedAt,
      })
      .onConflictDoUpdate({
        target: apiKeys.id,
        set: { secretHash: fixtureApiKeyHash },
      });

    await tx
      .insert(scanRequests)
      .values({
        id: FIXTURE_IDS.scanRequest,
        publicId: FIXTURE_SCAN_PUBLIC_ID,
        projectId: FIXTURE_IDS.project,
        origin: "FIXTURE",
        state: "READY",
        submittedUrl: "https://trendsfast.com",
        normalizedUrl: "https://trendsfast.com/",
        goal: "qualified_signups",
        market: "US",
        language: "en",
        preferredChannels: ["x", "hacker_news", "github"],
        availableFormats: ["founder_text", "technical_post"],
        generationLevel: "brief",
        requestedContentCapabilities: ["founder_text", "screen_recording"],
        requestPayloadHash: digestNextMoveRequest({
          product_url: "https://trendsfast.com",
          goal: "qualified_signups",
          market: "US",
          language: "en",
          preferred_channels: ["x", "hacker_news", "github"],
          available_formats: ["founder_text", "technical_post"],
          content_capabilities: ["founder_text", "screen_recording"],
          generation_level: "brief",
        }),
        createdAt: observedAt,
        updatedAt: completedAt,
        submittedAt: observedAt,
        startedAt: observedAt,
        completedAt,
      })
      .onConflictDoUpdate({
        target: scanRequests.id,
        set: {
          normalizedUrl: "https://trendsfast.com/",
          generationLevel: "brief",
          requestedContentCapabilities: ["founder_text", "screen_recording"],
          requestPayloadHash: digestNextMoveRequest({
            product_url: "https://trendsfast.com",
            goal: "qualified_signups",
            market: "US",
            language: "en",
            preferred_channels: ["x", "hacker_news", "github"],
            available_formats: ["founder_text", "technical_post"],
            content_capabilities: ["founder_text", "screen_recording"],
            generation_level: "brief",
          }),
        },
      });

    await tx
      .insert(scanRuns)
      .values({
        id: FIXTURE_IDS.scanRun,
        scanRequestId: FIXTURE_IDS.scanRequest,
        projectContextVersionId: FIXTURE_IDS.context,
        attempt: 1,
        state: "READY",
        queryPlan: FIXTURE_QUERY_PLAN,
        queryPlanVersion: FIXTURE_QUERY_PLAN.version,
        scoreVersion: "opportunity-score-v1",
        promptVersion: "fixture-synthesis-v1",
        sourceCoverage: {
          website: "SUCCEEDED",
          google_trends: "SUCCEEDED",
          hacker_news: "SUCCEEDED",
          github: "SUCCEEDED",
          x: "SKIPPED_FIXTURE",
          tavily: "SKIPPED_FIXTURE",
          youtube: "SKIPPED_FIXTURE",
        },
        signalClass: "CORROBORATED_SIGNAL",
        estimatedCostUsd: "0",
        actualCostUsd: "0",
        createdAt: observedAt,
        updatedAt: completedAt,
        startedAt: observedAt,
        reviewRequiredAt: new Date("2026-08-11T10:00:06.000Z"),
        completedAt,
      })
      .onConflictDoNothing();

    await tx
      .insert(sourceRuns)
      .values([
        {
          id: FIXTURE_IDS.websiteRun,
          scanRunId: FIXTURE_IDS.scanRun,
          source: "website",
          provider: "fixture_website",
          state: "SUCCEEDED",
          maxCalls: 1,
          callsMade: 1,
          candidateCount: 1,
          durationMs: 25,
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUsed: "0",
          startedAt: observedAt,
          completedAt,
          createdAt: observedAt,
          updatedAt: completedAt,
        },
        {
          id: FIXTURE_IDS.trendsRun,
          scanRunId: FIXTURE_IDS.scanRun,
          source: "google_trends",
          provider: "fixture_dataforseo_google_trends",
          state: "SUCCEEDED",
          maxCalls: 1,
          callsMade: 1,
          candidateCount: 1,
          durationMs: 25,
          providerPayloadFragment: {
            fixture: true,
            series: [44, 47, 51, 56, 61, 64, 69],
            window: "7d",
          },
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUsed: "0",
          startedAt: observedAt,
          completedAt,
          createdAt: observedAt,
          updatedAt: completedAt,
        },
        {
          id: FIXTURE_IDS.hackerNewsRun,
          scanRunId: FIXTURE_IDS.scanRun,
          source: "hacker_news",
          provider: "fixture_hn_algolia",
          state: "SUCCEEDED",
          maxCalls: 2,
          callsMade: 2,
          candidateCount: 1,
          durationMs: 25,
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUsed: "0",
          startedAt: observedAt,
          completedAt,
          createdAt: observedAt,
          updatedAt: completedAt,
        },
        {
          id: FIXTURE_IDS.githubRun,
          scanRunId: FIXTURE_IDS.scanRun,
          source: "github",
          provider: "fixture_github_api",
          state: "SUCCEEDED",
          maxCalls: 1,
          callsMade: 1,
          candidateCount: 1,
          durationMs: 25,
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUsed: "0",
          startedAt: observedAt,
          completedAt,
          createdAt: observedAt,
          updatedAt: completedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(signals)
      .values([
        {
          id: FIXTURE_IDS.websiteSignal,
          sourceRunId: FIXTURE_IDS.websiteRun,
          source: "website",
          sourceId: "fixture-trendsfast-homepage",
          canonicalUrl: "https://trendsfast.com",
          title: "TrendsFast — Know what to distribute next",
          textExcerpt: "Distribution intelligence for founders: one evidence-backed Next Move.",
          observedAt,
          language: "en",
          metrics: {},
          queryId: "fixture-context",
          provider: "fixture_website",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:fixture-website-content",
          provenance: {
            provider: "fixture_website",
            requestId: "fixture-website-request",
            retrievedAt: observedAt.toISOString(),
            cached: false,
            rawPayloadHash: "sha256:fixture-website-content",
          },
          createdAt: observedAt,
        },
        {
          id: FIXTURE_IDS.trendsSignal,
          sourceRunId: FIXTURE_IDS.trendsRun,
          source: "google_trends",
          sourceId: "fixture-google-trends-distribution-strategy",
          canonicalUrl: "https://trends.google.com/trends/explore?q=distribution%20strategy",
          title: "Fixture Google Trends series: distribution strategy",
          observedAt,
          language: "en",
          metrics: {},
          queryId: "qgrp_fixture_trends",
          provider: "fixture_dataforseo_google_trends",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:fixture-trends-series",
          provenance: {
            provider: "fixture_dataforseo_google_trends",
            requestId: "fixture-trends-request",
            retrievedAt: observedAt.toISOString(),
            cached: false,
            rawPayloadHash: "sha256:fixture-trends-series",
          },
          createdAt: observedAt,
        },
        {
          id: FIXTURE_IDS.hackerNewsSignal,
          sourceRunId: FIXTURE_IDS.hackerNewsRun,
          source: "hacker_news",
          sourceId: "fixture-hn-44123123",
          canonicalUrl: "https://news.ycombinator.com/item?id=44123123",
          title: "Ask HN: How do technical founders decide what to publish?",
          textExcerpt: "Founders describe fragmented research across communities and search.",
          author: { handle: "fixture-founder" },
          publishedAt,
          observedAt,
          language: "en",
          metrics: { points: 42, comments: 13 },
          queryId: "qgrp_fixture_hn",
          provider: "fixture_hn_algolia",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:fixture-hn-result",
          provenance: {
            provider: "fixture_hn_algolia",
            requestId: "fixture-hn-request",
            retrievedAt: observedAt.toISOString(),
            cached: false,
            rawPayloadHash: "sha256:fixture-hn-result",
          },
          createdAt: observedAt,
        },
        {
          id: FIXTURE_IDS.githubSignal,
          sourceRunId: FIXTURE_IDS.githubRun,
          source: "github",
          sourceId: "fixture-github-trendsfast-alpha",
          canonicalUrl: "https://github.com/trendsfast/trendsfast",
          title: "TrendsFast open-source alpha fixture repository",
          textExcerpt: "An open implementation of evidence-backed distribution decisions.",
          publishedAt,
          observedAt,
          language: "en",
          metrics: { stars: 12, forks: 2 },
          queryId: "qgrp_fixture_github",
          provider: "fixture_github_api",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:fixture-github-result",
          provenance: {
            provider: "fixture_github_api",
            requestId: "fixture-github-request",
            retrievedAt: observedAt.toISOString(),
            cached: false,
            rawPayloadHash: "sha256:fixture-github-result",
          },
          createdAt: observedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(signalMetricSnapshots)
      .values([
        {
          signalId: FIXTURE_IDS.trendsSignal,
          observedAt,
          metrics: {},
          createdAt: observedAt,
        },
        {
          signalId: FIXTURE_IDS.hackerNewsSignal,
          observedAt,
          metrics: { points: 42, comments: 13 },
          createdAt: observedAt,
        },
        {
          signalId: FIXTURE_IDS.githubSignal,
          observedAt,
          metrics: { stars: 12, forks: 2 },
          createdAt: observedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(clusters)
      .values({
        id: FIXTURE_IDS.cluster,
        scanRunId: FIXTURE_IDS.scanRun,
        dedupeKey: "fixture-distribution-decision-cluster",
        topic: "Founders need decisions, not another trend feed",
        summary: "Fixture sources independently support the founder distribution-research pain.",
        signalClass: "CORROBORATED_SIGNAL",
        independentSourceCount: 3,
        saturation: "low_to_medium",
        scoreComponents: {
          audience_fit: 0.91,
          product_relevance: 0.94,
          momentum: 0.72,
          saturation: 0.25,
        },
        createdAt: observedAt,
      })
      .onConflictDoNothing();

    await tx
      .insert(clusterMembers)
      .values([
        {
          clusterId: FIXTURE_IDS.cluster,
          signalId: FIXTURE_IDS.trendsSignal,
          similarity: "0.88000",
          isPrimary: true,
          createdAt: observedAt,
        },
        {
          clusterId: FIXTURE_IDS.cluster,
          signalId: FIXTURE_IDS.hackerNewsSignal,
          similarity: "0.84000",
          createdAt: observedAt,
        },
        {
          clusterId: FIXTURE_IDS.cluster,
          signalId: FIXTURE_IDS.githubSignal,
          similarity: "0.76000",
          createdAt: observedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(opportunities)
      .values({
        id: FIXTURE_IDS.opportunity,
        scanRunId: FIXTURE_IDS.scanRun,
        clusterId: FIXTURE_IDS.cluster,
        rank: 1,
        actionCandidate: "PUBLISH",
        channel: "x",
        format: "founder_text",
        totalScore: "0.860000",
        scoreComponents: {
          audience_fit: 0.91,
          product_relevance: 0.94,
          measured_or_corroborated_momentum: 0.72,
          novelty: 0.78,
          saturation: 0.25,
        },
        passesQualityFloor: true,
        validUntil: fixtureValidUntil,
        scoreVersion: "opportunity-score-v1",
        createdAt: observedAt,
      })
      .onConflictDoNothing();

    await tx
      .insert(nextMoves)
      .values({
        id: FIXTURE_IDS.nextMove,
        publicId: FIXTURE_MOVE_PUBLIC_ID,
        scanRequestId: FIXTURE_IDS.scanRequest,
        scanRunId: FIXTURE_IDS.scanRun,
        projectContextVersionId: FIXTURE_IDS.context,
        opportunityId: FIXTURE_IDS.opportunity,
        state: "READY",
        action: "PUBLISH",
        channel: "x",
        topic: "Why founders need a distribution decision instead of another trend feed",
        angle:
          "Show the manual research loop, the evidence quality floor, and why WAIT is a useful answer.",
        format: "founder_text",
        hook: "Shipping software got faster. Deciding what to distribute did not.",
        outline: fixtureOutline,
        cta: "Offer a founder-reviewed scan and ask founders whether they would use the move.",
        priority: 86,
        confidence: "0.82000",
        confidenceRationale:
          "Strong product fit with three independent fixture source classes; live demand is not claimed.",
        whyNow:
          "The fixture demonstrates corroboration across demand, conversation, and developer context.",
        signalClass: "CORROBORATED_SIGNAL",
        independentSourceCount: 3,
        saturation: "low_to_medium",
        limitations: [
          "Fixture evidence is illustrative and must not be presented as a live trend.",
          "A production scan requires successful provider read-backs.",
        ],
        decisionContractVersion: NEXT_MOVE_CONTRACT_VERSION,
        actionDetails: fixtureActionDetails,
        trendWindow: fixtureTrendWindow,
        breakoutPotential: fixtureBreakoutPotential,
        generationLevel: "brief",
        draftContent: null,
        founderReviewed: true,
        autoPublish: false,
        promptVersion: "fixture-synthesis-v1",
        scoreVersion: "opportunity-score-v1",
        validUntil: fixtureValidUntil,
        createdAt: observedAt,
        updatedAt: completedAt,
        approvedAt: new Date("2026-08-11T10:00:07.000Z"),
        deliveredAt: completedAt,
      })
      .onConflictDoUpdate({
        target: nextMoves.id,
        set: {
          proposalStale: false,
          decisionContractVersion: NEXT_MOVE_CONTRACT_VERSION,
          actionDetails: fixtureActionDetails,
          trendWindow: fixtureTrendWindow,
          breakoutPotential: fixtureBreakoutPotential,
          generationLevel: "brief",
          draftContent: null,
          validUntil: fixtureValidUntil,
          updatedAt: completedAt,
        },
      });

    const verifiedAt = new Date("2026-08-11T10:00:07.000Z");
    await tx
      .insert(evidenceReceipts)
      .values([
        {
          id: FIXTURE_IDS.evidenceTrends,
          nextMoveId: FIXTURE_IDS.nextMove,
          signalId: FIXTURE_IDS.trendsSignal,
          source: "google_trends",
          provider: "fixture_dataforseo_google_trends",
          canonicalUrl: "https://trends.google.com/trends/explore?q=distribution%20strategy",
          title: "Fixture Google Trends series: distribution strategy",
          observedAt,
          reason: "Provides an illustrative external demand series.",
          verified: true,
          availability: "AVAILABLE",
          reviewedBy: "fixture-founder",
          verifiedAt,
          createdAt: observedAt,
        },
        {
          id: FIXTURE_IDS.evidenceHackerNews,
          nextMoveId: FIXTURE_IDS.nextMove,
          signalId: FIXTURE_IDS.hackerNewsSignal,
          source: "hacker_news",
          provider: "fixture_hn_algolia",
          canonicalUrl: "https://news.ycombinator.com/item?id=44123123",
          title: "Ask HN: How do technical founders decide what to publish?",
          publishedAt,
          observedAt,
          reason: "Represents a current founder conversation in the fixture.",
          verified: true,
          availability: "AVAILABLE",
          reviewedBy: "fixture-founder",
          verifiedAt,
          createdAt: observedAt,
        },
        {
          id: FIXTURE_IDS.evidenceGithub,
          nextMoveId: FIXTURE_IDS.nextMove,
          signalId: FIXTURE_IDS.githubSignal,
          source: "github",
          provider: "fixture_github_api",
          canonicalUrl: "https://github.com/trendsfast/trendsfast",
          title: "TrendsFast open-source alpha fixture repository",
          publishedAt,
          observedAt,
          reason: "Shows product credibility and a developer-native distribution surface.",
          verified: true,
          availability: "AVAILABLE",
          reviewedBy: "fixture-founder",
          verifiedAt,
          createdAt: observedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(reviewEvents)
      .values({
        id: FIXTURE_IDS.reviewEvent,
        scanRequestId: FIXTURE_IDS.scanRequest,
        scanRunId: FIXTURE_IDS.scanRun,
        nextMoveId: FIXTURE_IDS.nextMove,
        action: "DELIVERED",
        reviewerId: "fixture-founder",
        before: { state: "REVIEW_REQUIRED" },
        after: { state: "READY", fixture: true },
        note: "Seeded founder-reviewed fixture; it is not a live trend claim.",
        createdAt: completedAt,
      })
      .onConflictDoNothing();

    await tx
      .insert(deliveryTokens)
      .values({
        id: FIXTURE_IDS.deliveryToken,
        nextMoveId: FIXTURE_IDS.nextMove,
        tokenPrefix: "fixture1",
        tokenHash: deliveryTokenHash,
        status: "DELIVERED",
        publicShareConsent: false,
        createdAt: observedAt,
        expiresAt,
        deliveredAt: completedAt,
      })
      .onConflictDoUpdate({
        target: deliveryTokens.id,
        set: { tokenHash: deliveryTokenHash, expiresAt },
      });

    await tx
      .insert(providerCostLedger)
      .values([
        {
          id: FIXTURE_IDS.costWebsite,
          scanRunId: FIXTURE_IDS.scanRun,
          ledgerKey: "fixture-website-fetch-1",
          sourceRunId: FIXTURE_IDS.websiteRun,
          provider: "fixture_website",
          operation: "fetch",
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUnits: "0",
          occurredAt: observedAt,
        },
        {
          id: FIXTURE_IDS.costTrends,
          scanRunId: FIXTURE_IDS.scanRun,
          ledgerKey: "fixture-trends-series-1",
          sourceRunId: FIXTURE_IDS.trendsRun,
          provider: "fixture_dataforseo_google_trends",
          operation: "fixture_series",
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUnits: "0",
          occurredAt: observedAt,
        },
        {
          id: FIXTURE_IDS.costHackerNews,
          scanRunId: FIXTURE_IDS.scanRun,
          ledgerKey: "fixture-hn-search-1",
          sourceRunId: FIXTURE_IDS.hackerNewsRun,
          provider: "fixture_hn_algolia",
          operation: "fixture_search",
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUnits: "0",
          occurredAt: observedAt,
        },
        {
          id: FIXTURE_IDS.costGithub,
          scanRunId: FIXTURE_IDS.scanRun,
          ledgerKey: "fixture-github-search-1",
          sourceRunId: FIXTURE_IDS.githubRun,
          provider: "fixture_github_api",
          operation: "fixture_search",
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUnits: "0",
          occurredAt: observedAt,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(analyticsEvents)
      .values({
        id: FIXTURE_IDS.analyticsDelivered,
        name: "scan_delivered",
        scanRequestId: FIXTURE_IDS.scanRequest,
        nextMoveId: FIXTURE_IDS.nextMove,
        properties: { mode: "fixture", provider_cost_usd: 0 },
        occurredAt: completedAt,
      })
      .onConflictDoNothing();
  });
}

async function main() {
  loadCliEnvironment();
  const env = loadEnv();
  if (env.PROVIDER_CREDENTIAL_MODE !== "fixture") {
    throw new Error("Fixture seeding is allowed only in PROVIDER_CREDENTIAL_MODE=fixture");
  }
  const client = createDatabaseFromEnv(env);
  try {
    await seedFixtureDatabase(
      client.db,
      env.API_KEY_PEPPER ? { apiKeyPepper: env.API_KEY_PEPPER } : {},
    );
    console.info(`Fixture scan seeded: ${FIXTURE_SCAN_PUBLIC_ID}`);
  } finally {
    await client.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
