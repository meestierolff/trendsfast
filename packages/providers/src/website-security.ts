import { request as requestHttp, type IncomingMessage } from "node:http";
import { request as requestHttps, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import type { DnsAddress, DnsResolver, WebsiteTransport } from "./types";
import { cleanText } from "./util";

export type WebsiteFetchErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_IN_URL"
  | "BLOCKED_HOSTNAME"
  | "DNS_FAILURE"
  | "NON_PUBLIC_ADDRESS"
  | "REDIRECT_LIMIT"
  | "INVALID_REDIRECT"
  | "CROSS_ORIGIN_REDIRECT"
  | "HTTP_STATUS"
  | "CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
  | "NETWORK_ERROR";

export class WebsiteFetchError extends Error {
  readonly code: WebsiteFetchErrorCode;
  readonly retryable: boolean;

  constructor(code: WebsiteFetchErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "WebsiteFetchError";
    this.code = code;
    this.retryable = retryable;
  }
}

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const values = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255))
    return undefined;
  return values;
}

function ipv4InCidr(
  parts: number[],
  base: [number, number, number, number],
  prefix: number,
): boolean {
  const value =
    (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
  const network = (((base[0] << 24) >>> 0) + (base[1] << 16) + (base[2] << 8) + base[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

const BLOCKED_IPV4_RANGES: Array<[[number, number, number, number], number]> = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

function expandIpv6(input: string): number[] | undefined {
  let address = input.toLocaleLowerCase("en").split("%")[0]!;
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = parseIpv4(address.slice(lastColon + 1));
    if (!ipv4) return undefined;
    address = `${address.slice(0, lastColon)}:${((ipv4[0]! << 8) | ipv4[1]!).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]!);
  if (family === 4) {
    const parts = parseIpv4(address);
    if (!parts) return false;
    return !BLOCKED_IPV4_RANGES.some(([base, prefix]) => ipv4InCidr(parts, base, prefix));
  }
  if (family === 6) {
    const parts = expandIpv6(address);
    if (!parts) return false;
    // Only global unicast 2000::/3 is accepted. Explicitly exclude documentation 2001:db8::/32.
    const globalUnicast = (parts[0]! & 0xe000) === 0x2000;
    const documentation = parts[0] === 0x2001 && parts[1] === 0x0db8;
    return globalUnicast && !documentation;
  }
  return false;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/, "").toLocaleLowerCase("en");
  if (!host || host === "localhost" || host === "metadata" || host === "instance-data") return true;
  if (
    host === "metadata.google.internal" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home") ||
    host.endsWith(".lan")
  ) {
    return true;
  }
  return false;
}

export type ValidatedPublicUrl = {
  url: URL;
  addresses: DnsAddress[];
};

export async function validatePublicHttpUrl(
  input: string | URL,
  resolve: DnsResolver,
): Promise<ValidatedPublicUrl> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new WebsiteFetchError("INVALID_URL", "Website URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteFetchError(
      "UNSUPPORTED_PROTOCOL",
      "Only HTTP and HTTPS website URLs are supported",
    );
  }
  if (url.username || url.password) {
    throw new WebsiteFetchError(
      "CREDENTIALS_IN_URL",
      "Credentials in website URLs are not allowed",
    );
  }
  url.hash = "";
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLocaleLowerCase("en");
  if (blockedHostname(hostname)) {
    throw new WebsiteFetchError("BLOCKED_HOSTNAME", "Website hostname is reserved or local");
  }

  let addresses: DnsAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new WebsiteFetchError("DNS_FAILURE", "Website hostname could not be resolved", true);
    }
  }
  if (addresses.length === 0) {
    throw new WebsiteFetchError("DNS_FAILURE", "Website hostname returned no addresses", true);
  }
  const unsafe = addresses.find((record) => !isPublicIpAddress(record.address));
  if (unsafe) {
    throw new WebsiteFetchError(
      "NON_PUBLIC_ADDRESS",
      `Website hostname resolved to a non-public address (${unsafe.address})`,
    );
  }
  const validatedAddresses = addresses.map((record) => ({
    address: record.address,
    family: isIP(record.address),
  }));
  url.hostname = hostname;
  return { url, addresses: validatedAddresses };
}

export type WebsiteFetchLimits = {
  timeoutMs: number;
  maxRedirects: number;
  maxBytes: number;
  allowedContentTypes: readonly string[];
};

export const DEFAULT_WEBSITE_FETCH_LIMITS: WebsiteFetchLimits = {
  timeoutMs: 8_000,
  maxRedirects: 3,
  maxBytes: 1_000_000,
  allowedContentTypes: ["text/html", "application/xhtml+xml", "text/plain"],
};

export type PinnedWebsiteConnection = {
  protocol: "http:" | "https:";
  address: string;
  family: 4 | 6;
  port: number;
  authority: string;
  path: string;
  servername?: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
};

export type PinnedWebsiteDispatcher = (connection: PinnedWebsiteConnection) => Promise<Response>;

function requestAbortError(): Error {
  const error = new Error("Website request was aborted");
  error.name = "AbortError";
  return error;
}

function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headers.append(name, value);
  }
  return headers;
}

/**
 * Opens a Node HTTP(S) request against the validated numeric address itself.
 * Host routing and HTTPS identity verification still use the original URL
 * authority. No hostname lookup occurs in this function.
 */
export function dispatchPinnedNodeRequest(connection: PinnedWebsiteConnection): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (connection.signal.aborted) {
      reject(requestAbortError());
      return;
    }

    const options: HttpsRequestOptions = {
      protocol: connection.protocol,
      hostname: connection.address,
      family: connection.family,
      port: connection.port,
      method: "GET",
      path: connection.path,
      headers: { ...connection.headers, host: connection.authority },
      agent: false,
      ...(connection.protocol === "https:"
        ? {
            rejectUnauthorized: true,
            ...(connection.servername ? { servername: connection.servername } : {}),
          }
        : {}),
    };

    let incoming: IncomingMessage | undefined;
    let settled = false;
    const onAbort = (): void => {
      const error = requestAbortError();
      incoming?.destroy(error);
      clientRequest.destroy(error);
    };
    const cleanup = (): void => connection.signal.removeEventListener("abort", onAbort);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onResponse = (message: IncomingMessage): void => {
      incoming = message;
      const status = message.statusCode;
      if (status === undefined || status < 200 || status > 599) {
        message.destroy();
        fail(new Error("Website returned an invalid HTTP response status"));
        return;
      }
      try {
        const hasNoBody = status === 204 || status === 205 || status === 304;
        const body = hasNoBody ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>);
        const webResponse = new Response(body, {
          status,
          ...(message.statusMessage ? { statusText: message.statusMessage } : {}),
          headers: responseHeaders(message),
        });
        settled = true;
        message.once("close", cleanup);
        resolve(webResponse);
      } catch (error) {
        message.destroy();
        fail(error instanceof Error ? error : new Error("Website response conversion failed"));
      }
    };

    const clientRequest =
      connection.protocol === "https:"
        ? requestHttps(options, onResponse)
        : requestHttp(options, onResponse);
    clientRequest.once("error", fail);
    connection.signal.addEventListener("abort", onAbort, { once: true });
    if (connection.signal.aborted) {
      onAbort();
      return;
    }
    clientRequest.end();
  });
}

/**
 * Builds a website transport which can only dispatch to one of the addresses
 * supplied by validatePublicHttpUrl. Every address is independently checked at
 * the connection boundary as defense in depth.
 */
export function createPinnedWebsiteTransport(
  dispatch: PinnedWebsiteDispatcher = dispatchPinnedNodeRequest,
): WebsiteTransport {
  return async ({ url, addresses, signal, headers }) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new WebsiteFetchError(
        "UNSUPPORTED_PROTOCOL",
        "Only HTTP and HTTPS website URLs are supported",
      );
    }

    const pinned: Array<{ address: string; family: 4 | 6 }> = addresses.map((record) => {
      const detectedFamily = isIP(record.address);
      if ((detectedFamily !== 4 && detectedFamily !== 6) || !isPublicIpAddress(record.address)) {
        throw new WebsiteFetchError(
          "NON_PUBLIC_ADDRESS",
          "Website transport received a non-public address",
        );
      }
      const family: 4 | 6 = detectedFamily;
      return { address: record.address, family };
    });
    if (pinned.length === 0) {
      throw new WebsiteFetchError("DNS_FAILURE", "Website hostname returned no addresses", true);
    }

    const protocol = url.protocol;
    const port = url.port ? Number(url.port) : protocol === "https:" ? 443 : 80;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const servername = protocol === "https:" && isIP(hostname) === 0 ? hostname : undefined;
    const path = `${url.pathname}${url.search}`;
    let lastError: unknown;

    for (const record of pinned) {
      if (signal.aborted) throw requestAbortError();
      try {
        return await dispatch({
          protocol,
          address: record.address,
          family: record.family,
          port,
          authority: url.host,
          path,
          ...(servername ? { servername } : {}),
          headers,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw requestAbortError();
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Website request failed");
  };
}

const defaultPinnedWebsiteTransport = createPinnedWebsiteTransport();

export type SafeWebsiteFetchOptions = {
  resolve: DnsResolver;
  transport?: WebsiteTransport;
  limits?: Partial<WebsiteFetchLimits>;
  /** Exact origin that every request and redirect hop must retain. */
  allowedOrigin?: string;
  /** Optional outer execution capability; aborting it closes the pinned transport. */
  signal?: AbortSignal;
};

export type SafeWebsiteFetchResult = {
  url: string;
  html: string;
  contentType: string;
  bytes: number;
  redirects: number;
};

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The request is already being discarded; socket/stream errors are not the
    // caller-facing failure for redirect and policy rejection paths.
  }
}

async function readLimitedBody(
  response: Response,
  maximum: number,
  signal: AbortSignal,
): Promise<{ text: string; bytes: number }> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maximum) {
    await discardResponseBody(response);
    throw new WebsiteFetchError("RESPONSE_TOO_LARGE", "Website response exceeds the byte limit");
  }
  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader();
  const onAbort = (): void => {
    void reader.cancel(requestAbortError()).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) throw requestAbortError();
      const chunk = await reader.read();
      if (signal.aborted) throw requestAbortError();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new WebsiteFetchError(
          "RESPONSE_TOO_LARGE",
          "Website response exceeds the byte limit",
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

export async function safeFetchWebsite(
  input: string | URL,
  options: SafeWebsiteFetchOptions,
): Promise<SafeWebsiteFetchResult> {
  const limits: WebsiteFetchLimits = { ...DEFAULT_WEBSITE_FETCH_LIMITS, ...options.limits };
  const transport = options.transport ?? defaultPinnedWebsiteTransport;
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromParent, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new WebsiteFetchError("TIMEOUT", "Website request timed out", true));
    }, limits.timeoutMs);
  });
  let redirects = 0;
  let current: string | URL = input;
  let allowedOrigin: string | undefined;
  if (options.allowedOrigin) {
    try {
      allowedOrigin = new URL(options.allowedOrigin).origin;
    } catch {
      throw new WebsiteFetchError("INVALID_URL", "Allowed website origin is invalid");
    }
  }

  try {
    if (limits.timeoutMs <= 0 || controller.signal.aborted) {
      throw new WebsiteFetchError("TIMEOUT", "Website request deadline was exhausted", true);
    }
    while (true) {
      // Re-resolve immediately before every request, including every redirect hop.
      const validated = await Promise.race([
        validatePublicHttpUrl(current, options.resolve),
        deadline,
      ]);
      if (allowedOrigin && validated.url.origin !== allowedOrigin) {
        throw new WebsiteFetchError(
          "CROSS_ORIGIN_REDIRECT",
          "Website navigation left the approved origin",
        );
      }
      let response: Response;
      try {
        response = await Promise.race([
          transport({
            url: validated.url,
            addresses: validated.addresses,
            signal: controller.signal,
            headers: {
              accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
              "accept-encoding": "identity",
              "user-agent": "TrendsFastWebsiteReader/0.1 (+https://trendsfast.com/sources)",
            },
          }),
          deadline,
        ]);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new WebsiteFetchError("TIMEOUT", "Website request timed out", true);
        }
        if (error instanceof WebsiteFetchError) throw error;
        throw new WebsiteFetchError("NETWORK_ERROR", "Website request failed", true);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await Promise.race([discardResponseBody(response), deadline]);
        if (redirects >= limits.maxRedirects) {
          throw new WebsiteFetchError("REDIRECT_LIMIT", "Website exceeded the redirect limit");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new WebsiteFetchError("INVALID_REDIRECT", "Website redirect has no location");
        }
        let redirected: URL;
        try {
          redirected = new URL(location, validated.url);
        } catch {
          throw new WebsiteFetchError(
            "INVALID_REDIRECT",
            "Website returned an invalid redirect URL",
          );
        }
        if (allowedOrigin && redirected.origin !== allowedOrigin) {
          throw new WebsiteFetchError(
            "CROSS_ORIGIN_REDIRECT",
            "Website redirect left the approved origin",
          );
        }
        current = redirected;
        redirects += 1;
        continue;
      }
      if (!response.ok) {
        await Promise.race([discardResponseBody(response), deadline]);
        throw new WebsiteFetchError(
          "HTTP_STATUS",
          `Website returned HTTP ${response.status}`,
          response.status === 429 || response.status >= 500,
        );
      }
      const contentType = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]!
        .trim()
        .toLocaleLowerCase("en");
      if (!limits.allowedContentTypes.includes(contentType)) {
        await Promise.race([discardResponseBody(response), deadline]);
        throw new WebsiteFetchError(
          "CONTENT_TYPE",
          `Website content type is not allowed (${contentType || "missing"})`,
        );
      }
      const body = await Promise.race([
        readLimitedBody(response, limits.maxBytes, controller.signal),
        deadline,
      ]);
      return {
        url: validated.url.href,
        html: body.text,
        contentType,
        bytes: body.bytes,
        redirects,
      };
    }
  } catch (error) {
    if (error instanceof WebsiteFetchError) throw error;
    if (controller.signal.aborted) {
      throw new WebsiteFetchError("TIMEOUT", "Website request timed out", true);
    }
    throw new WebsiteFetchError("NETWORK_ERROR", "Website request failed", true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  const codePoint = (numeric: number): string =>
    Number.isInteger(numeric) &&
    numeric >= 0 &&
    numeric <= 0x10ffff &&
    !(numeric >= 0xd800 && numeric <= 0xdfff)
      ? String.fromCodePoint(numeric)
      : "�";
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) return codePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return codePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? match;
  });
}

export type ExtractedWebsiteDocument = {
  url: string;
  title: string;
  description?: string;
  openGraph: string[];
  structuredData: string[];
  headings: string[];
  primaryCtas: string[];
  faqPrompts: string[];
  text: string;
  untrusted: true;
};

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isEcmaScriptWhitespace(code: number): boolean {
  return (
    code === 0x0009 ||
    code === 0x000a ||
    code === 0x000b ||
    code === 0x000c ||
    code === 0x000d ||
    code === 0x0020 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function isAttributeNameStart(code: number): boolean {
  return isAsciiLetter(code) || code === 95 || code === 58;
}

function isAttributeNameCharacter(code: number): boolean {
  return isAttributeNameStart(code) || isAsciiDigit(code) || code === 45 || code === 46;
}

function htmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let index = 0;
  while (index < tag.length) {
    while (index < tag.length && !isAttributeNameStart(tag.charCodeAt(index))) index += 1;
    if (index >= tag.length) break;

    const nameStart = index;
    index += 1;
    while (index < tag.length && isAttributeNameCharacter(tag.charCodeAt(index))) index += 1;
    const nameEnd = index;
    while (index < tag.length && isEcmaScriptWhitespace(tag.charCodeAt(index))) index += 1;
    if (tag.charCodeAt(index) !== 61) {
      // A contiguous name cannot contain another viable start with a different
      // outcome, so resume at its end without retrying overlapping suffixes.
      index = nameEnd;
      continue;
    }

    index += 1;
    while (index < tag.length && isEcmaScriptWhitespace(tag.charCodeAt(index))) index += 1;
    if (index >= tag.length) break;

    let value: string;
    const quote = tag.charCodeAt(index);
    if (quote === 34 || quote === 39) {
      const valueStart = index + 1;
      index = valueStart;
      while (index < tag.length) {
        const code = tag.charCodeAt(index);
        if (code === 34 || code === 39) break;
        index += 1;
      }
      if (index < tag.length) {
        value = tag.slice(valueStart, index);
        index += 1;
      } else {
        // The original expression's unquoted alternative accepted an opening
        // quote when no closing quote existed.
        index = valueStart - 1;
        while (
          index < tag.length &&
          !isEcmaScriptWhitespace(tag.charCodeAt(index)) &&
          tag.charCodeAt(index) !== 62
        ) {
          index += 1;
        }
        value = tag.slice(valueStart - 1, index);
      }
    } else {
      const valueStart = index;
      while (
        index < tag.length &&
        !isEcmaScriptWhitespace(tag.charCodeAt(index)) &&
        tag.charCodeAt(index) !== 62
      ) {
        index += 1;
      }
      if (index === valueStart) continue;
      value = tag.slice(valueStart, index);
    }

    const name = tag.slice(nameStart, nameEnd).toLocaleLowerCase("en");
    attributes[name] = decodeHtmlEntities(value);
  }
  return attributes;
}

function stripInlineHtmlTags(value: string): string {
  const output: string[] = [];
  let copyStart = 0;
  let searchStart = 0;
  while (searchStart < value.length) {
    const open = value.indexOf("<", searchStart);
    if (open < 0) break;
    const close = value.indexOf(">", open + 1);
    if (close < 0) break;
    if (close === open + 1) {
      searchStart = open + 1;
      continue;
    }
    output.push(value.slice(copyStart, open), " ");
    copyStart = close + 1;
    searchStart = copyStart;
  }
  output.push(value.slice(copyStart));
  return output.join("");
}

function uniqueClean(values: Iterable<string>, maximum: number, length: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanText(decodeHtmlEntities(stripInlineHtmlTags(value)), length);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= maximum) break;
  }
  return output;
}

function selectedStructuredData(html: string): string[] {
  const selected: string[] = [];
  const allowedKeys = new Set([
    "@type",
    "name",
    "headline",
    "description",
    "category",
    "audience",
    "price",
    "pricecurrency",
  ]);
  for (const match of html.matchAll(
    /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (selected.length >= 12) break;
    try {
      const parsed: unknown = JSON.parse((match[1] ?? "").slice(0, 50_000));
      const queue: unknown[] = [parsed];
      while (queue.length > 0 && selected.length < 12) {
        const current = queue.shift();
        if (Array.isArray(current)) {
          queue.push(...current.slice(0, 20));
          continue;
        }
        if (!current || typeof current !== "object") continue;
        for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
          if (Array.isArray(value) || (value && typeof value === "object")) {
            queue.push(value);
          } else if (allowedKeys.has(key.toLocaleLowerCase("en")) && typeof value === "string") {
            const cleaned = cleanText(value, 300);
            if (cleaned) selected.push(`${key}: ${cleaned}`);
          }
          if (selected.length >= 12) break;
        }
      }
    } catch {
      // Invalid JSON-LD is ignored; ordinary sanitized page text remains usable.
    }
  }
  return uniqueClean(selected, 12, 350);
}

function stripHtmlComments(value: string): string {
  const output: string[] = [];
  let copyStart = 0;
  let searchStart = 0;
  while (searchStart < value.length) {
    const open = value.indexOf("<!--", searchStart);
    if (open < 0) break;
    const close = value.indexOf("-->", open + 4);
    if (close < 0) break;
    output.push(value.slice(copyStart, open), " ");
    copyStart = close + 3;
    searchStart = copyStart;
  }
  output.push(value.slice(copyStart));
  return output.join("");
}

const EXECUTABLE_ELEMENT_NAMES = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "svg",
  "canvas",
  "form",
]);
const TEXT_BREAK_ELEMENT_NAMES = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
]);

function openingExecutableElement(tag: string): string | undefined {
  let end = 0;
  while (end < tag.length && isAsciiLetter(tag.charCodeAt(end))) end += 1;
  if (end === 0) return undefined;
  const next = tag.charCodeAt(end);
  if (isAsciiLetter(next) || isAsciiDigit(next) || next === 95) return undefined;
  const name = tag.slice(0, end).toLocaleLowerCase("en");
  return EXECUTABLE_ELEMENT_NAMES.has(name) ? name : undefined;
}

function asciiCaseInsensitiveIndexOf(
  value: string,
  expectedLowercase: string,
  start: number,
): number {
  const lastStart = value.length - expectedLowercase.length;
  for (let index = start; index <= lastStart; index += 1) {
    let matches = true;
    for (let offset = 0; offset < expectedLowercase.length; offset += 1) {
      const code = value.charCodeAt(index + offset);
      const lowercaseCode = code >= 65 && code <= 90 ? code + 32 : code;
      if (lowercaseCode !== expectedLowercase.charCodeAt(offset)) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function isBreakTag(tag: string): boolean {
  const lowercase = tag.toLocaleLowerCase("en");
  if (lowercase.startsWith("/")) return TEXT_BREAK_ELEMENT_NAMES.has(lowercase.slice(1));
  if (!lowercase.startsWith("br")) return false;
  let end = lowercase.length;
  if (lowercase.charCodeAt(end - 1) === 47) end -= 1;
  for (let index = 2; index < end; index += 1) {
    if (!isEcmaScriptWhitespace(lowercase.charCodeAt(index))) return false;
  }
  return end >= 2;
}

function htmlMarkupToText(value: string): string {
  const html = stripHtmlComments(value);
  const output: string[] = [];
  const elementsWithoutClosingTag = new Set<string>();
  let index = 0;

  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) {
      output.push(html.slice(index));
      break;
    }
    output.push(html.slice(index, open));
    const close = html.indexOf(">", open + 1);
    if (close < 0) {
      output.push(html.slice(open));
      break;
    }

    const tag = html.slice(open + 1, close);
    if (tag.length === 0) {
      output.push("<>");
      index = close + 1;
      continue;
    }

    const unsafeElement = openingExecutableElement(tag);
    if (unsafeElement && !elementsWithoutClosingTag.has(unsafeElement)) {
      const closingTag = `</${unsafeElement}>`;
      const closingStart = asciiCaseInsensitiveIndexOf(html, closingTag, close + 1);
      if (closingStart >= 0) {
        output.push(" ");
        index = closingStart + closingTag.length;
        continue;
      }
      // A failed search proves this element has no closing tag anywhere in the
      // remaining suffix, so later openings can be handled without rescanning.
      elementsWithoutClosingTag.add(unsafeElement);
    }
    output.push(isBreakTag(tag) ? "\n" : " ");
    index = close + 1;
  }
  return output.join("");
}

export function extractWebsiteDocument(url: string, html: string): ExtractedWebsiteDocument {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const descriptionMatch =
    /<meta\b[^>]*\bname=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*>/i.exec(html) ??
    /<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']description["'][^>]*>/i.exec(html);
  const withoutExecutableContent = htmlMarkupToText(html);
  const text = cleanText(decodeHtmlEntities(withoutExecutableContent), 50_000) ?? "";
  const fallbackTitle = new URL(url).hostname;
  const title = cleanText(decodeHtmlEntities(titleMatch?.[1] ?? ""), 300) ?? fallbackTitle;
  const description = cleanText(decodeHtmlEntities(descriptionMatch?.[1] ?? ""), 500);
  const openGraph = uniqueClean(
    [...html.matchAll(/<meta\b[^>]*>/gi)].flatMap((match) => {
      const attributes = htmlAttributes(match[0]);
      const property = (attributes.property ?? attributes.name)?.toLocaleLowerCase("en");
      const content = attributes.content;
      return property?.startsWith("og:") && content ? [`${property}: ${content}`] : [];
    }),
    12,
    550,
  );
  const headings = uniqueClean(
    [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => match[1] ?? ""),
    20,
    300,
  );
  const primaryCtas = uniqueClean(
    [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)].map(
      (match) => match[1] ?? "",
    ),
    16,
    160,
  );
  const faqPrompts = uniqueClean(
    [
      ...[...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi)].map(
        (match) => match[1] ?? "",
      ),
      ...headings.filter((heading) => heading.endsWith("?")),
    ],
    12,
    300,
  );
  return {
    url,
    title,
    ...(description === undefined ? {} : { description }),
    openGraph,
    structuredData: selectedStructuredData(html),
    headings,
    primaryCtas,
    faqPrompts,
    text,
    untrusted: true,
  };
}

const CONTEXT_PATH_MARKERS = [
  "features",
  "product",
  "pricing",
  "use-case",
  "about",
  "docs",
  "blog",
  "changelog",
] as const;

/** Returns a small deterministic same-origin candidate set; it never fetches. */
export function extractSameOriginContextLinks(baseUrl: string, html: string): string[] {
  const base = new URL(baseUrl);
  const candidates = new Map<string, { url: string; rank: number }>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi)) {
    const raw = decodeHtmlEntities(match[1] ?? match[2] ?? "").trim();
    if (!raw || raw.startsWith("#")) continue;
    try {
      const candidate = new URL(raw, base);
      candidate.hash = "";
      if (candidate.origin !== base.origin || !["http:", "https:"].includes(candidate.protocol)) {
        continue;
      }
      const path = candidate.pathname.toLocaleLowerCase("en").replace(/\/+$/, "") || "/";
      const markerIndex = CONTEXT_PATH_MARKERS.findIndex((marker) => path.includes(marker));
      if (markerIndex < 0) continue;
      candidate.search = "";
      const href = candidate.href;
      const rank = markerIndex * 10 + path.split("/").filter(Boolean).length;
      const prior = candidates.get(href);
      if (!prior || rank < prior.rank) candidates.set(href, { url: href, rank });
    } catch {
      // Malformed links are untrusted page data and are ignored.
    }
  }
  return [...candidates.values()]
    .sort((left, right) => left.rank - right.rank || left.url.localeCompare(right.url))
    .slice(0, 20)
    .map((candidate) => candidate.url);
}

export function wrapUntrustedContent(content: string): string {
  const escaped = content
    .replaceAll("<UNTRUSTED_WEBSITE_CONTENT>", "[UNTRUSTED_WEBSITE_CONTENT]")
    .replaceAll("</UNTRUSTED_WEBSITE_CONTENT>", "[/UNTRUSTED_WEBSITE_CONTENT]");
  return `<UNTRUSTED_WEBSITE_CONTENT>${escaped}</UNTRUSTED_WEBSITE_CONTENT>`;
}
