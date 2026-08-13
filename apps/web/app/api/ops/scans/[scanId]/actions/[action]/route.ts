import { after } from "next/server";

import { loadEnv } from "@trendsfast/config";
import { ReviewVersionConflictError } from "@trendsfast/database";

import { readBoundedJsonBody } from "../../../../../../../lib/bounded-json";
import { getOpsRepositories } from "../../../../../../../lib/server-database";
import { runPersistedScan } from "../../../../../../../lib/scan-processing";
import { recomputeStoredReview } from "../../../../../../../lib/stored-review-recompute";
import { authorizeOpsActionRequest } from "../../../../_security";
import { parseOpsAction } from "../../../../_validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const privateHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
const maxActionBodyBytes = 16 * 1_024;

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

function validPublicScanId(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scanId: string; action: string }> },
) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);

  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Operations actions require a JSON request body." }, 415);
  }

  const { scanId, action } = await params;
  if (!validPublicScanId(scanId)) return json({ error: "The scan identifier is invalid." }, 400);

  const boundedBody = await readBoundedJsonBody(request, maxActionBodyBytes);
  if (!boundedBody.ok && boundedBody.reason === "payload_too_large") {
    return json({ error: "The operations action body is too large." }, 413);
  }
  if (!boundedBody.ok) {
    return json({ error: "The operations action body is not valid JSON." }, 400);
  }
  const parsed = parseOpsAction(action, boundedBody.value);
  if (!parsed.success) return json({ error: parsed.error }, 400);

  const repositories = getOpsRepositories();
  const detail = await repositories.scans.getStatusByPublicId(scanId);
  if (!detail) return json({ error: "The scan was not found." }, 404);

  const requireDraftReview = () => {
    if (
      detail.request.state !== "REVIEW_REQUIRED" ||
      !detail.run ||
      !detail.move ||
      detail.move.state !== "DRAFT" ||
      detail.move.proposalStale ||
      detail.move.autoPublish
    ) {
      throw new Error("REVIEW_STATE_CONFLICT");
    }
    return { run: detail.run, move: detail.move };
  };

  try {
    switch (parsed.action) {
      case "verify-evidence": {
        const { move } = requireDraftReview();
        const receipt = detail.evidence.find(
          (candidate) => candidate.id === parsed.data.evidenceReceiptId,
        );
        if (!receipt || receipt.nextMoveId !== move.id) {
          return json({ error: "The evidence receipt was not found on this move." }, 404);
        }
        const updated = await repositories.scanData.bindEvidence({
          nextMoveId: move.id,
          signalId: receipt.signalId,
          evidenceReceiptId: receipt.id,
          expectedVersion: parsed.data.expectedVersion,
          reason: receipt.reason,
          reviewerId: authorization.reviewerId,
          verified: true,
        });
        return json({ ok: true, action: parsed.action, receiptId: updated.id });
      }

      case "reject-evidence": {
        const { move } = requireDraftReview();
        const receipt = detail.evidence.find(
          (candidate) => candidate.id === parsed.data.evidenceReceiptId,
        );
        if (!receipt || receipt.nextMoveId !== move.id) {
          return json({ error: "The evidence receipt was not found on this move." }, 404);
        }
        await repositories.reviews.rejectEvidence({
          evidenceReceiptId: receipt.id,
          expectedVersion: parsed.data.expectedVersion,
          reviewerId: authorization.reviewerId,
          reason: parsed.data.reason,
        });
        return json({ ok: true, action: parsed.action, receiptId: receipt.id });
      }

      case "approve": {
        const { move } = requireDraftReview();
        const approved = await repositories.reviews.approve({
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expectedVersion: parsed.data.expectedVersion,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        });
        return json({ ok: true, action: parsed.action, moveState: approved.state });
      }

      case "edit-and-approve": {
        const { move } = requireDraftReview();
        const approved = await repositories.reviews.editAndApprove({
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expectedVersion: parsed.data.expectedVersion,
          reason: parsed.data.reason,
          edits: {
            topic: parsed.data.topic,
            angle: parsed.data.angle,
            channel: parsed.data.channel,
            format: parsed.data.format,
            hook: parsed.data.hook,
            outline: parsed.data.outline,
            cta: parsed.data.cta,
            whyNow: parsed.data.whyNow,
            limitations: parsed.data.limitations,
            validUntil: new Date(parsed.data.validUntil),
            confidenceRationale: parsed.data.confidenceRationale,
          },
        });
        return json({
          ok: true,
          action: parsed.action,
          moveState: approved.state,
          reviewVersion: approved.reviewVersion,
        });
      }

      case "correct-context": {
        const { move } = requireDraftReview();
        const recomputed = await recomputeStoredReview(repositories, {
          scanPublicId: scanId,
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expectedVersion: parsed.data.expectedVersion,
          reason: parsed.data.reason,
          contextCorrection: {
            productName: parsed.data.productName,
            audience: parsed.data.audience,
            problem: parsed.data.problem,
            desiredOutcome: parsed.data.desiredOutcome,
            credibleClaims: parsed.data.credibleClaims,
            credibleTopics: parsed.data.credibleTopics,
            suitableChannels: parsed.data.suitableChannels,
            availableFormats: parsed.data.availableFormats,
            assumptions: parsed.data.assumptions,
          },
        });
        return json({
          ok: true,
          action: parsed.action,
          moveState: recomputed.move.state,
          reviewVersion: recomputed.move.reviewVersion,
          evidenceReviewRequired: true,
          providerCallsMade: recomputed.providerCallsMade,
          modelSynthesisPerformed: recomputed.modelSynthesisPerformed,
        });
      }

      case "recompute-stored": {
        const { move } = requireDraftReview();
        const recomputed = await recomputeStoredReview(repositories, {
          scanPublicId: scanId,
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expectedVersion: parsed.data.expectedVersion,
          reason: parsed.data.reason,
        });
        return json({
          ok: true,
          action: parsed.action,
          moveState: recomputed.move.state,
          reviewVersion: recomputed.move.reviewVersion,
          evidenceReviewRequired: true,
          providerCallsMade: recomputed.providerCallsMade,
          modelSynthesisPerformed: recomputed.modelSynthesisPerformed,
        });
      }

      case "convert-to-wait": {
        const { move } = requireDraftReview();
        const validUntil = new Date(Date.now() + parsed.data.validForHours * 60 * 60 * 1_000);
        const converted = await repositories.reviews.convertToWait({
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expectedVersion: parsed.data.expectedVersion,
          reason: parsed.data.reason,
          validUntil,
        });
        return json({
          ok: true,
          action: parsed.action,
          moveState: converted.state,
          reviewVersion: converted.reviewVersion,
          validUntil: converted.validUntil.toISOString(),
        });
      }

      case "deliver": {
        const env = loadEnv();
        const publicOrigin = env.TRENDSFAST_SURFACE === "ops" ? env.PUBLIC_APP_URL : env.APP_URL;
        if (!publicOrigin) {
          throw new Error("PUBLIC_DELIVERY_ORIGIN_UNAVAILABLE");
        }
        const move = detail.move;
        if (
          detail.request.state !== "REVIEW_REQUIRED" ||
          !move ||
          move.state !== "APPROVED" ||
          !move.founderReviewed ||
          move.autoPublish
        ) {
          throw new Error("DELIVERY_STATE_CONFLICT");
        }
        const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1_000);
        const delivery = await repositories.delivery.deliver({
          nextMoveId: move.id,
          reviewerId: authorization.reviewerId,
          expiresAt,
        });
        const deliveryUrl = delivery.rawToken
          ? new URL(`/scan/${encodeURIComponent(delivery.rawToken)}`, publicOrigin).toString()
          : null;
        return json({
          ok: true,
          action: parsed.action,
          created: delivery.created,
          deliveryToken: delivery.rawToken,
          deliveryUrl,
          tokenPrefix: delivery.tokenPrefix,
          expiresAt: delivery.expiresAt.toISOString(),
        });
      }

      case "mark-failed": {
        const run = detail.run;
        if (
          !run ||
          !["QUEUED", "RUNNING", "REVIEW_REQUIRED"].includes(detail.request.state) ||
          !["QUEUED", "RUNNING", "REVIEW_REQUIRED"].includes(run.state)
        ) {
          throw new Error("FAILURE_STATE_CONFLICT");
        }
        await repositories.reviews.markFailed({
          scanRequestId: detail.request.id,
          scanRunId: run.id,
          reviewerId: authorization.reviewerId,
          failureCode: parsed.data.failureCode,
          failureMessage: parsed.data.failureMessage,
        });
        return json({ ok: true, action: parsed.action, requestState: "FAILED" });
      }

      case "retry": {
        if (detail.request.state !== "FAILED") throw new Error("RETRY_STATE_CONFLICT");
        if (loadEnv().PROVIDER_CREDENTIAL_MODE !== "fixture") {
          return json(
            {
              error:
                "Whole-scan retry is disabled outside fixture mode until paid source-level resume is available.",
            },
            409,
          );
        }
        await repositories.scans.requeueFailed(scanId);
        if (detail.run) {
          await repositories.reviews.appendEvent({
            scanRequestId: detail.request.id,
            scanRunId: detail.run.id,
            ...(detail.move ? { nextMoveId: detail.move.id } : {}),
            action: "SOURCE_RERUN_REQUESTED",
            reviewerId: authorization.reviewerId,
            note: "Founder requested a full persisted scan retry after failure.",
          });
        }
        after(async () => {
          await runPersistedScan(scanId).catch(() => undefined);
        });
        return json({ ok: true, action: parsed.action, requestState: "QUEUED" }, 202);
      }
    }
  } catch (error) {
    if (error instanceof ReviewVersionConflictError) {
      return json(
        { error: "The recommendation changed after this form loaded. Reload before editing." },
        409,
      );
    }
    if (error instanceof Error && error.message.endsWith("_STATE_CONFLICT")) {
      return json({ error: "The scan changed state and this action is no longer allowed." }, 409);
    }
    return json({ error: "The operation could not be completed from the current state." }, 409);
  }
}
