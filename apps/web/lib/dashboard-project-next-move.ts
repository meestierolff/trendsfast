import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  NextMoveStatusResponseSchema,
  ProjectNextMoveRequestSchema,
  type ContentCapabilityName,
  type NextMoveStatusResponse,
} from "@trendsfast/schemas";

import { retryAfterMilliseconds } from "./retry-after";

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIVE_PROJECT_KEY = /^tf_live_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{32,128}$/;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type DashboardProjectNextMoveInput = {
  objective: string;
  preferredChannels: readonly string[];
  contentCapabilities: readonly ContentCapabilityName[];
};

export type DashboardProjectNextMoveResult = {
  result: NextMoveStatusResponse;
  pollAfterMs: number;
};

export class DashboardProjectNextMoveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DashboardProjectNextMoveError";
  }
}

function exactLiveKey(rawKey: string): string {
  const normalized = rawKey.trim();
  if (!LIVE_PROJECT_KEY.test(normalized)) {
    throw new DashboardProjectNextMoveError("Paste a valid live project API key.");
  }
  return normalized;
}

async function parsedResponse(
  response: Response,
  options: { requireLocation?: boolean } = {},
): Promise<DashboardProjectNextMoveResult> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(value);
    throw new DashboardProjectNextMoveError(
      parsedError.success
        ? parsedError.data.error.message
        : "The project Next Move request was rejected.",
      response.status,
      retryAfterMilliseconds(response.headers.get("retry-after"), {
        maximumMs: 24 * 60 * 60_000,
      }),
    );
  }
  const result = NextMoveStatusResponseSchema.safeParse(value);
  if (!result.success) {
    throw new DashboardProjectNextMoveError("The project Next Move response was invalid.");
  }
  if ("status_url" in result.data) {
    const location = response.headers.get("location");
    if (
      (options.requireLocation === true && location === null) ||
      (location !== null && location !== result.data.status_url)
    ) {
      throw new DashboardProjectNextMoveError("The project Next Move status location was invalid.");
    }
  }
  return {
    result: result.data,
    pollAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
  };
}

function exactStatusPath(statusUrl: string, currentOrigin: string): string {
  let origin: string;
  try {
    const parsedOrigin = new URL(currentOrigin);
    if (
      parsedOrigin.origin !== currentOrigin ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search !== "" ||
      parsedOrigin.hash !== "" ||
      parsedOrigin.username !== "" ||
      parsedOrigin.password !== ""
    ) {
      throw new Error("invalid origin");
    }
    origin = parsedOrigin.origin;
  } catch {
    throw new DashboardProjectNextMoveError("The dashboard origin was invalid.");
  }
  const parsed = new URL(statusUrl, `${origin}/`);
  if (
    parsed.origin !== origin ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/v1\/next-moves\/[^/]{1,160}$/.test(parsed.pathname)
  ) {
    throw new DashboardProjectNextMoveError("The project Next Move status location was invalid.");
  }
  return parsed.pathname;
}

export async function requestDashboardProjectNextMove(input: {
  projectId: string;
  rawKey: string;
  idempotencyKey: string;
  request: DashboardProjectNextMoveInput;
  fetcher?: Fetcher;
}): Promise<DashboardProjectNextMoveResult> {
  if (!PROJECT_ID.test(input.projectId)) {
    throw new DashboardProjectNextMoveError("The selected project is invalid.");
  }
  const rawKey = exactLiveKey(input.rawKey);
  const idempotencyKey = IdempotencyKeySchema.parse(input.idempotencyKey);
  const request = ProjectNextMoveRequestSchema.parse({
    objective: input.request.objective,
    preferred_channels: [...input.request.preferredChannels],
    content_capabilities: [...input.request.contentCapabilities],
    generation_level: "draft",
  });
  const response = await (input.fetcher ?? fetch)(
    `/v1/projects/${encodeURIComponent(input.projectId)}/next-move`,
    {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(request),
    },
  );
  return parsedResponse(response, { requireLocation: true });
}

export async function readDashboardProjectNextMove(input: {
  statusUrl: string;
  currentOrigin: string;
  rawKey: string;
  expectedId: string;
  fetcher?: Fetcher;
}): Promise<DashboardProjectNextMoveResult> {
  const response = await (input.fetcher ?? fetch)(
    exactStatusPath(input.statusUrl, input.currentOrigin),
    {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${exactLiveKey(input.rawKey)}`,
      },
    },
  );
  const parsed = await parsedResponse(response);
  if (parsed.result.id !== input.expectedId) {
    throw new DashboardProjectNextMoveError("The project Next Move status identity changed.");
  }
  return parsed;
}
