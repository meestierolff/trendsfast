import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rotateRuntimeRolePasswords } from "../../../scripts/db/rotate-runtime-role-passwords";

const projectRef = "auxienkuufejeakaczlq";
const roles = {
  migrator: "trendsfast_migrator",
  public: "trendsfast_public_runtime",
  member: "trendsfast_member_runtime",
  ops: "trendsfast_ops_runtime",
  worker: "trendsfast_worker_runtime",
  billing: "trendsfast_billing_runtime",
  auth: "trendsfast_auth_runtime",
  retention: "trendsfast_retention_runtime",
} as const;
const passwordVariables = {
  migrator: "TRENDSFAST_MIGRATOR_PASSWORD",
  public: "TRENDSFAST_PUBLIC_RUNTIME_PASSWORD",
  member: "TRENDSFAST_MEMBER_RUNTIME_PASSWORD",
  ops: "TRENDSFAST_OPS_RUNTIME_PASSWORD",
  worker: "TRENDSFAST_WORKER_RUNTIME_PASSWORD",
  billing: "TRENDSFAST_BILLING_RUNTIME_PASSWORD",
  auth: "TRENDSFAST_AUTH_RUNTIME_PASSWORD",
  retention: "TRENDSFAST_RETENTION_RUNTIME_PASSWORD",
} as const;
const urlVariables = {
  public: "DATABASE_URL",
  member: "MEMBER_DATABASE_URL",
  ops: "OPS_DATABASE_URL",
  worker: "WORKER_DATABASE_URL",
  billing: "BILLING_DATABASE_URL",
  auth: "AUTH_DATABASE_URL",
  retention: "RETENTION_DATABASE_URL",
} as const;

function writePrivate(path: string, value: string): void {
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tf-role-rotation-test-"));
  mkdirSync(join(root, ".var/private"), { recursive: true, mode: 0o700 });
  mkdirSync(join(root, "supabase/.temp"), { recursive: true });
  writeFileSync(join(root, "supabase/.temp/project-ref"), projectRef, "utf8");
  const secrets = Object.entries(passwordVariables)
    .map(
      ([, variable]) =>
        `${variable}=${JSON.stringify("old-password-value-abcdefghijklmnopqrstuvwxyz")}`,
    )
    .join("\n");
  const urls = Object.entries(urlVariables)
    .map(
      ([kind, variable]) =>
        `${variable}=${JSON.stringify(`postgresql://${roles[kind as keyof typeof roles]}.${projectRef}:old-password-value-abcdefghijklmnopqrstuvwxyz@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`)}`,
    )
    .join("\n");
  writePrivate(join(root, ".var/private/runtime-role-secrets.env"), `${secrets}\n`);
  writePrivate(join(root, ".var/private/runtime-role-urls.env"), `${urls}\n`);
  writePrivate(
    join(root, ".var/private/migrator-database-url.env"),
    `DIRECT_DATABASE_URL=${JSON.stringify(`postgresql://trendsfast_migrator.${projectRef}:old-password-value-abcdefghijklmnopqrstuvwxyz@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`)}\n`,
  );
  writePrivate(
    join(root, ".env.production.local"),
    `${urls}\nUNRELATED=${JSON.stringify("kept")}\n`,
  );
  return root;
}

describe("runtime-role password rotation", () => {
  it("rotates all eight roles transactionally without placing passwords in the command surface", () => {
    const root = fixtureRoot();
    let capturedSql = "";
    try {
      rotateRuntimeRolePasswords({
        root,
        isIgnored: () => true,
        runLinkedSql: (path) => {
          capturedSql = readFileSync(path, "utf8");
          return true;
        },
      });
      expect(capturedSql).toContain("BEGIN;");
      expect(capturedSql).toContain("COMMIT;");
      for (const role of Object.values(roles)) {
        expect(capturedSql).toContain(`ALTER ROLE \"${role}\" PASSWORD`);
      }
      const secretInventory = readFileSync(
        join(root, ".var/private/runtime-role-secrets.env"),
        "utf8",
      );
      expect(secretInventory).not.toContain("old-password-value");
      expect(secretInventory.match(/[A-Za-z0-9_-]{64}/gu)).toHaveLength(8);
      const production = readFileSync(join(root, ".env.production.local"), "utf8");
      expect(production).toContain('UNRELATED="kept"');
      expect(production).not.toContain("old-password-value");
      expect(() =>
        readFileSync(join(root, ".var/private/runtime-role-rotation.pending.json")),
      ).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a recoverable pending record on failure and resumes with the same secrets", () => {
    const root = fixtureRoot();
    try {
      expect(() =>
        rotateRuntimeRolePasswords({ root, isIgnored: () => true, runLinkedSql: () => false }),
      ).toThrow("rerun with --resume");
      const pendingPath = join(root, ".var/private/runtime-role-rotation.pending.json");
      const pending = readFileSync(pendingPath, "utf8");
      expect(pending).not.toContain("old-password-value");
      expect(() =>
        rotateRuntimeRolePasswords({ root, isIgnored: () => true, runLinkedSql: () => true }),
      ).toThrow("rerun with --resume");
      rotateRuntimeRolePasswords({
        root,
        resume: true,
        isIgnored: () => true,
        runLinkedSql: () => true,
      });
      expect(() => readFileSync(pendingPath)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not run linked SQL when the linked project ref is not exact", () => {
    const root = fixtureRoot();
    let calls = 0;
    try {
      writeFileSync(join(root, "supabase/.temp/project-ref"), "another-project", "utf8");
      expect(() =>
        rotateRuntimeRolePasswords({
          root,
          isIgnored: () => true,
          runLinkedSql: () => {
            calls += 1;
            return true;
          },
        }),
      ).toThrow("exact Supabase production project");
      expect(calls).toBe(0);
      expect(() =>
        readFileSync(join(root, ".var/private/runtime-role-rotation.pending.json")),
      ).toThrow();

      const linkedPath = join(root, "supabase/.temp/project-ref");
      const linkedTarget = join(root, "supabase/.temp/project-ref-target");
      writeFileSync(linkedTarget, projectRef, "utf8");
      unlinkSync(linkedPath);
      symlinkSync(linkedTarget, linkedPath);
      expect(() =>
        rotateRuntimeRolePasswords({
          root,
          isIgnored: () => true,
          runLinkedSql: () => {
            calls += 1;
            return true;
          },
        }),
      ).toThrow("exact Supabase production project");
      expect(calls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("materializes and validates every private URL before running linked SQL", () => {
    for (const target of ["runtime", "production"] as const) {
      const root = fixtureRoot();
      let calls = 0;
      try {
        const relativePath =
          target === "runtime" ? ".var/private/runtime-role-urls.env" : ".env.production.local";
        const path = join(root, relativePath);
        const malformed = readFileSync(path, "utf8").replace(
          /^MEMBER_DATABASE_URL=.*$/mu,
          'MEMBER_DATABASE_URL="not-a-postgresql-url"',
        );
        writePrivate(path, malformed);
        expect(() =>
          rotateRuntimeRolePasswords({
            root,
            isIgnored: () => true,
            runLinkedSql: () => {
              calls += 1;
              return true;
            },
          }),
        ).toThrow("runtime-role URL is malformed");
        expect(calls).toBe(0);
        expect(() =>
          readFileSync(join(root, ".var/private/runtime-role-rotation.pending.json")),
        ).toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("rejects a resumed record whose planned role passwords are not independent", () => {
    const root = fixtureRoot();
    let calls = 0;
    try {
      const repeated = "r".repeat(64);
      const pending = {
        version: 1,
        projectRef,
        passwords: Object.fromEntries(Object.keys(roles).map((kind) => [kind, repeated])),
      };
      writePrivate(
        join(root, ".var/private/runtime-role-rotation.pending.json"),
        `${JSON.stringify(pending)}\n`,
      );
      expect(() =>
        rotateRuntimeRolePasswords({
          root,
          resume: true,
          isIgnored: () => true,
          runLinkedSql: () => {
            calls += 1;
            return true;
          },
        }),
      ).toThrow("pending runtime-role rotation record is malformed");
      expect(calls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
