import {
  ContentCapabilitiesSchema,
  ContextProvenanceSchema,
  ProjectContextSchema,
  ProjectEntityTypeSchema,
  VoiceProfileSchema,
} from "@trendsfast/schemas";
import { z } from "zod";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { getMemberRepositories } from "@/lib/server-database";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    context: ProjectContextSchema,
    entityType: ProjectEntityTypeSchema,
    // Website observations are scan evidence, not member-authored context.
    // The strict editable shape rejects attempts to overwrite observed_facts.
    contextProvenance: ContextProvenanceSchema.omit({ observed_facts: true }),
    voiceProfile: VoiceProfileSchema,
    contentCapabilities: ContentCapabilitiesSchema,
  })
  .strict();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!acceptsPrivateMutation(request)) return json({ error: "Request rejected." }, 403);
  const authUserId = await getVerifiedAuthSubject();
  if (!authUserId) return json({ error: "Sign in is required." }, 401);
  const { projectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "Project not found." }, 404);
  const bounded = await readBoundedJsonBody(request, 64 * 1_024);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Context is too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "Project context is invalid." }, 400);
  try {
    const members = getMemberRepositories().members;
    const current = await members.getProjectDashboard({ authUserId, projectId });
    const trustedProvenance = ContextProvenanceSchema.safeParse(
      current?.context?.contextProvenance,
    );
    if (!trustedProvenance.success) {
      return json({ error: "The current project provenance is unavailable." }, 409);
    }
    const created = await members.updateProjectContext({
      authUserId,
      projectId,
      ...body.data,
      contextProvenance: {
        observed_facts: trustedProvenance.data.observed_facts,
        ...body.data.contextProvenance,
      },
    });
    return json({ ok: true, contextVersion: created.version }, 201);
  } catch {
    return json({ error: "The project context could not be saved." }, 403);
  }
}
