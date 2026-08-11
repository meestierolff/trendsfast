import { createHash } from "node:crypto";

import { NextMoveRequestSchema, type NextMoveRequest } from "@trendsfast/schemas";

export const NEXT_MOVE_REQUEST_DIGEST_VERSION = "next-move-request-v1";

function canonicalProductUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function canonicalizeNextMoveRequest(input: NextMoveRequest): NextMoveRequest {
  const request = NextMoveRequestSchema.parse(input);
  return {
    product_url: canonicalProductUrl(request.product_url),
    ...(request.goal === undefined ? {} : { goal: request.goal }),
    ...(request.market === undefined ? {} : { market: request.market }),
    ...(request.language === undefined ? {} : { language: request.language }),
    ...(request.preferred_channels === undefined
      ? {}
      : { preferred_channels: request.preferred_channels }),
    ...(request.available_formats === undefined
      ? {}
      : { available_formats: request.available_formats }),
  };
}

export function digestNextMoveRequest(input: NextMoveRequest): string {
  const canonical = canonicalizeNextMoveRequest(input);
  const hash = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  return `${NEXT_MOVE_REQUEST_DIGEST_VERSION}:sha256:${hash}`;
}
