import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const opsRoutesRoot = fileURLToPath(new URL("../../app/api/ops/", import.meta.url));
const sessionRoute = "session/route.ts";
const routeMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

type RouteHandler = { method: string; source: string };

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

function exportedHandlers(source: string): RouteHandler[] {
  const matches = [
    ...source.matchAll(
      /export\s+(?:(?:async\s+)?function\s+|const\s+)(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g,
    ),
  ];
  return matches.map((match, index) => ({
    method: match[1] ?? "",
    source: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

describe("operations API route authorization inventory", () => {
  const routes = findRouteFiles(opsRoutesRoot)
    .map((path) => ({
      path,
      relativePath: relative(opsRoutesRoot, path),
      source: readFileSync(path, "utf8"),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  it("discovers every operations route and only one login-session exception", () => {
    expect(routes.length).toBeGreaterThan(1);
    expect(routes.filter((route) => route.relativePath === sessionRoute)).toHaveLength(1);
    expect(routes.every((route) => exportedHandlers(route.source).length > 0)).toBe(true);
  });

  it("requires the shared authenticated guard before work in every non-session handler", () => {
    for (const route of routes.filter((candidate) => candidate.relativePath !== sessionRoute)) {
      const handlers = exportedHandlers(route.source);
      for (const handler of handlers) {
        expect(routeMethods.has(handler.method), `${route.relativePath}: ${handler.method}`).toBe(
          true,
        );
        const expectedGuard =
          handler.method === "GET" || handler.method === "HEAD"
            ? "authorizeOpsReadRequest"
            : "authorizeOpsActionRequest";
        const guardIndex = handler.source.indexOf(`${expectedGuard}(request)`);
        const rejectionIndex = handler.source.indexOf("if (!authorization.ok)");
        const firstAwaitIndex = handler.source.indexOf("await");

        expect(guardIndex, `${route.relativePath}: ${handler.method} shared guard`).toBeGreaterThan(
          -1,
        );
        expect(
          rejectionIndex,
          `${route.relativePath}: ${handler.method} rejects a failed guard`,
        ).toBeGreaterThan(guardIndex);
        if (firstAwaitIndex >= 0) {
          expect(
            rejectionIndex,
            `${route.relativePath}: ${handler.method} guard runs before awaited work`,
          ).toBeLessThan(firstAwaitIndex);
        }
      }
    }
  });

  it("keeps the public login endpoint same-origin and authenticates before durable admission", () => {
    const route = routes.find((candidate) => candidate.relativePath === sessionRoute);
    expect(route).toBeDefined();
    const handlers = exportedHandlers(route?.source ?? "");
    expect(handlers.map((handler) => handler.method).sort()).toEqual(["DELETE", "POST"]);

    for (const handler of handlers) {
      expect(
        handler.source.indexOf("if (!isOpsSameOrigin(request))"),
        `${sessionRoute}: ${handler.method} exact-surface and same-origin guard`,
      ).toBeGreaterThan(-1);
    }

    const login = handlers.find((handler) => handler.method === "POST")?.source ?? "";
    const localAuthentication = login.indexOf("authenticateOpsLoginRequest(request");
    const authenticationRejection = login.indexOf("if (!authentication.ok)");
    const durableAdmission = login.indexOf("getOpsRepositories().authAdmission.admit");
    const sessionCookie = login.indexOf('response.cookies.set("tf_ops_session"');

    expect(localAuthentication).toBeGreaterThan(-1);
    expect(authenticationRejection).toBeGreaterThan(localAuthentication);
    expect(durableAdmission).toBeGreaterThan(authenticationRejection);
    expect(sessionCookie).toBeGreaterThan(durableAdmission);
  });
});
