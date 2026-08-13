import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  APPLICATION_FUNCTIONS,
  APPLICATION_TABLES,
  APPLICATION_TYPES,
  createDatabaseClient,
  DATABASE_ROLES,
  parseCliEnvironmentFile,
  RUNTIME_COLUMN_PRIVILEGES,
  RUNTIME_TABLE_PRIVILEGES,
  type DatabaseRoleKind,
  type PoolClient,
} from "@trendsfast/database";

import { loadCliEnvironment } from "../../packages/database/src/load-cli-env";

const PASSWORD_VARIABLES: Readonly<Record<DatabaseRoleKind, string>> = {
  migrator: "TRENDSFAST_MIGRATOR_PASSWORD",
  public: "TRENDSFAST_PUBLIC_RUNTIME_PASSWORD",
  member: "TRENDSFAST_MEMBER_RUNTIME_PASSWORD",
  ops: "TRENDSFAST_OPS_RUNTIME_PASSWORD",
  worker: "TRENDSFAST_WORKER_RUNTIME_PASSWORD",
  billing: "TRENDSFAST_BILLING_RUNTIME_PASSWORD",
  auth: "TRENDSFAST_AUTH_RUNTIME_PASSWORD",
  retention: "TRENDSFAST_RETENTION_RUNTIME_PASSWORD",
};

const runtimeKinds = ["public", "member", "ops", "worker", "billing", "auth", "retention"] as const;
const allKinds = ["migrator", ...runtimeKinds] as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;
const MAX_ROLE_SECRETS_FILE_BYTES = 64 * 1_024;

function identifier(value: string): string {
  if (!identifierPattern.test(value)) throw new Error("Unsafe database identifier");
  return `"${value}"`;
}

function grantee(value: string): string {
  return value === "PUBLIC" ? "PUBLIC" : identifier(value);
}

async function privateRoleSecretEnvironment(): Promise<Readonly<Record<string, string>> | null> {
  const configuredPath = process.env.RUNTIME_ROLE_SECRETS_FILE?.trim();
  if (!configuredPath) return null;
  const absolutePath = resolve(configuredPath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("RUNTIME_ROLE_SECRETS_FILE must be a regular file");
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error("RUNTIME_ROLE_SECRETS_FILE must have mode 0600");
  }
  if (metadata.size > MAX_ROLE_SECRETS_FILE_BYTES) {
    throw new Error("RUNTIME_ROLE_SECRETS_FILE exceeds the bounded file size");
  }
  return parseCliEnvironmentFile(absolutePath);
}

function requiredPassword(
  environment: Readonly<Record<string, string | undefined>>,
  kind: DatabaseRoleKind,
): string {
  const variable = PASSWORD_VARIABLES[kind];
  const password = environment[variable];
  if (!password || password.length < 32 || password.length > 1_024 || password.includes("\0")) {
    throw new Error(`${variable} must contain 32-1024 non-NUL characters`);
  }
  return password;
}

async function formattedStatement(
  client: PoolClient,
  format: string,
  values: readonly unknown[],
): Promise<string> {
  const result = await client.query<{ statement: string }>(
    "select format($1::text, variadic $2::text[]) as statement",
    [format, values.map(String)],
  );
  const statement = result.rows[0]?.statement;
  if (!statement) throw new Error("PostgreSQL did not construct the bounded role statement");
  return statement;
}

async function ensureRole(client: PoolClient, kind: DatabaseRoleKind, password: string) {
  const role = DATABASE_ROLES[kind];
  const existing = await client.query<{ exists: boolean }>(
    "select exists(select 1 from pg_roles where rolname = $1) as exists",
    [role],
  );
  if (!existing.rows[0]?.exists) {
    await client.query(
      `CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30`,
    );
  }
  await client.query(
    `ALTER ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30`,
  );
  await client.query("set local password_encryption = 'scram-sha-256'");
  const passwordStatement = await formattedStatement(client, "ALTER ROLE %I PASSWORD %L", [
    role,
    password,
  ]);
  await client.query(passwordStatement);
  await client.query(`ALTER ROLE ${identifier(role)} SET search_path = pg_catalog, public`);
  await client.query(
    `ALTER ROLE ${identifier(role)} SET idle_in_transaction_session_timeout = '30s'`,
  );
  await client.query(
    `ALTER ROLE ${identifier(role)} SET statement_timeout = '${kind === "worker" || kind === "retention" || kind === "migrator" ? "5min" : "30s"}'`,
  );
}

async function transferApplicationOwnership(client: PoolClient) {
  const role = DATABASE_ROLES.migrator;
  const membership = await client.query<{ member: boolean }>(
    "select pg_has_role(current_user, $1, 'MEMBER') as member",
    [role],
  );
  const temporaryMembership = !membership.rows[0]?.member;
  if (temporaryMembership) {
    await client.query(`GRANT ${identifier(role)} TO CURRENT_USER`);
  }

  const relations = await client.query<{ statement: string }>(
    `select format(
       'ALTER %s %I.%I OWNER TO %I',
       case c.relkind
         when 'r' then 'TABLE'
         when 'p' then 'TABLE'
         when 'S' then 'SEQUENCE'
         when 'v' then 'VIEW'
         when 'm' then 'MATERIALIZED VIEW'
         when 'f' then 'FOREIGN TABLE'
       end,
       n.nspname,
       c.relname,
       $1::text
     ) as statement
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r','p','S','v','m','f')
       and (
         (n.nspname = 'public' and c.relname = any($2::text[]))
         or (n.nspname = 'drizzle' and c.relname = '__drizzle_migrations')
       )
     order by n.nspname, c.relname`,
    [role, APPLICATION_TABLES],
  );
  for (const row of relations.rows) await client.query(row.statement);

  const types = await client.query<{ statement: string }>(
    `select format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, $1::text) as statement
       from pg_type t
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
        and t.typtype in ('e', 'd')
        and t.typname = any($2::text[])
      order by t.typname`,
    [role, APPLICATION_TYPES],
  );
  for (const row of types.rows) await client.query(row.statement);

  for (const functionRecord of APPLICATION_FUNCTIONS) {
    await client.query(
      `ALTER FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) OWNER TO ${identifier(role)}`,
    );
  }

  await client.query(`SET LOCAL ROLE ${identifier(role)}`);
  return async () => {
    await client.query("RESET ROLE");
    if (temporaryMembership) {
      await client.query(`REVOKE ${identifier(role)} FROM CURRENT_USER`);
    }
  };
}

async function revokeUnsafeDefaultPrivileges(client: PoolClient) {
  await client.query(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES REVOKE ALL ON FUNCTIONS FROM PUBLIC`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC`,
  );
  for (const browserRole of ["anon", "authenticated"]) {
    const exists = await client.query<{ exists: boolean }>(
      "select exists(select 1 from pg_roles where rolname = $1) as exists",
      [browserRole],
    );
    if (!exists.rows[0]?.exists) continue;
    for (const objectKind of ["TABLES", "SEQUENCES", "FUNCTIONS"] as const) {
      await client.query(
        `ALTER DEFAULT PRIVILEGES REVOKE ALL ON ${objectKind} FROM ${identifier(browserRole)}`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ${objectKind} FROM ${identifier(browserRole)}`,
      );
    }
  }
}

async function clearApplicationColumnPrivileges(client: PoolClient, grantees: readonly string[]) {
  const applicationColumns = await client.query<{ table_name: string; columns: string }>(
    `select relation.relname as table_name,
            string_agg(attribute.attname, E'\n' order by attribute.attnum) as columns
       from pg_class relation
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       join pg_attribute attribute on attribute.attrelid = relation.oid
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
        and attribute.attnum > 0
        and not attribute.attisdropped
      group by relation.relname
      order by relation.relname`,
    [APPLICATION_TABLES],
  );
  for (const record of applicationColumns.rows) {
    const columns = record.columns.split("\n").map(identifier).join(", ");
    for (const role of grantees) {
      await client.query(
        `REVOKE SELECT (${columns}), INSERT (${columns}), UPDATE (${columns}), REFERENCES (${columns}) ON TABLE public.${identifier(record.table_name)} FROM ${grantee(role)}`,
      );
    }
  }
}

async function revokeUnsafeBaseline(client: PoolClient) {
  await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC`);
  for (const table of APPLICATION_TABLES) {
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.${identifier(table)} FROM PUBLIC`);
  }
  for (const functionRecord of APPLICATION_FUNCTIONS) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) FROM PUBLIC`,
    );
  }
  const browserGrantees = ["PUBLIC"];
  for (const browserRole of ["anon", "authenticated"]) {
    const exists = await client.query<{ exists: boolean }>(
      "select exists(select 1 from pg_roles where rolname = $1) as exists",
      [browserRole],
    );
    if (!exists.rows[0]?.exists) continue;
    browserGrantees.push(browserRole);
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${identifier(browserRole)}`);
    for (const table of APPLICATION_TABLES) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON TABLE public.${identifier(table)} FROM ${identifier(browserRole)}`,
      );
    }
    for (const functionRecord of APPLICATION_FUNCTIONS) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) FROM ${identifier(browserRole)}`,
      );
    }
  }
  await clearApplicationColumnPrivileges(client, browserGrantees);
  await revokeUnsafeDefaultPrivileges(client);
}

async function grantMigratorDdl(client: PoolClient) {
  const role = identifier(DATABASE_ROLES.migrator);
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  const drizzleSchema = await client.query<{ exists: boolean }>(
    "select exists(select 1 from pg_namespace where nspname = 'drizzle') as exists",
  );
  if (drizzleSchema.rows[0]?.exists) {
    await client.query(`GRANT USAGE, CREATE ON SCHEMA drizzle TO ${role}`);
  }
}

async function grantRuntimeSchemaUsage(client: PoolClient) {
  for (const kind of runtimeKinds) {
    await client.query(`GRANT USAGE ON SCHEMA public TO ${identifier(DATABASE_ROLES[kind])}`);
  }
}

async function applyRuntimeGrants(client: PoolClient) {
  for (const kind of runtimeKinds) {
    const role = identifier(DATABASE_ROLES[kind]);
    for (const table of APPLICATION_TABLES) {
      await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.${identifier(table)} FROM ${role}`);
    }
    for (const functionRecord of APPLICATION_FUNCTIONS) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) FROM ${role}`,
      );
    }
  }

  // Table-level REVOKE does not erase an older explicit column ACL. Clear
  // every grantable column privilege before applying the reviewed allowlist.
  await clearApplicationColumnPrivileges(
    client,
    runtimeKinds.map((kind) => DATABASE_ROLES[kind]),
  );

  for (const kind of runtimeKinds) {
    const role = identifier(DATABASE_ROLES[kind]);
    const grants = RUNTIME_TABLE_PRIVILEGES[kind];
    for (const [table, privileges] of Object.entries(grants)) {
      if (privileges.length === 0) continue;
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE public.${identifier(table)} TO ${role}`,
      );
    }
    for (const grant of RUNTIME_COLUMN_PRIVILEGES[kind]) {
      await client.query(
        `GRANT ${grant.privilege} (${grant.columns.map(identifier).join(", ")}) ON TABLE public.${identifier(grant.table)} TO ${role}`,
      );
    }
    const types = await client.query<{ statement: string }>(
      `select format('GRANT USAGE ON TYPE %I.%I TO %I', n.nspname, t.typname, $1::text) as statement
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
          and t.typtype in ('e', 'd')
          and t.typname = any($2::text[])`,
      [DATABASE_ROLES[kind], APPLICATION_TYPES],
    );
    for (const row of types.rows) await client.query(row.statement);
    for (const functionRecord of APPLICATION_FUNCTIONS) {
      if (!functionRecord.executeRoles.some((executeRole) => executeRole === kind)) continue;
      await client.query(
        `GRANT EXECUTE ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) TO ${role}`,
      );
    }
  }
}

async function main() {
  loadCliEnvironment();
  const privateSecrets = await privateRoleSecretEnvironment();
  const adminUrl =
    process.env.ROLE_ADMIN_DATABASE_URL?.trim() ?? process.env.DIRECT_DATABASE_URL?.trim();
  if (!adminUrl) {
    throw new Error("ROLE_ADMIN_DATABASE_URL or DIRECT_DATABASE_URL is required");
  }
  const passwords = Object.fromEntries(
    allKinds.map((kind) => [kind, requiredPassword(privateSecrets ?? process.env, kind)]),
  ) as Record<DatabaseRoleKind, string>;
  const database = createDatabaseClient({
    connectionString: adminUrl,
    ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
    maxConnections: 1,
    applicationName: "trendsfast-role-provisioner",
  });
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    for (const kind of allKinds) await ensureRole(client, kind, passwords[kind]);
    const databaseName = await client.query<{ name: string }>("select current_database() as name");
    const name = databaseName.rows[0]?.name;
    if (!name) throw new Error("The current PostgreSQL database could not be identified");
    for (const kind of allKinds) {
      const grant = await formattedStatement(client, "GRANT CONNECT ON DATABASE %I TO %I", [
        name,
        DATABASE_ROLES[kind],
      ]);
      await client.query(grant);
    }
    const revokePublicDatabase = await formattedStatement(
      client,
      "REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC",
      [name],
    );
    await client.query(revokePublicDatabase);
    for (const kind of runtimeKinds) {
      const revokeRuntimeDatabase = await formattedStatement(
        client,
        "REVOKE CREATE, TEMPORARY ON DATABASE %I FROM %I",
        [name, DATABASE_ROLES[kind]],
      );
      await client.query(revokeRuntimeDatabase);
    }
    const grantCreate = await formattedStatement(client, "GRANT CREATE ON DATABASE %I TO %I", [
      name,
      DATABASE_ROLES.migrator,
    ]);
    await client.query(grantCreate);
    const grantTemporary = await formattedStatement(
      client,
      "GRANT TEMPORARY ON DATABASE %I TO %I",
      [name, DATABASE_ROLES.migrator],
    );
    await client.query(grantTemporary);

    await revokeUnsafeBaseline(client);
    await grantMigratorDdl(client);
    await grantRuntimeSchemaUsage(client);
    const restoreAdmin = await transferApplicationOwnership(client);
    await revokeUnsafeDefaultPrivileges(client);
    await applyRuntimeGrants(client);
    await restoreAdmin();
    await client.query("COMMIT");
    console.info(
      JSON.stringify({
        provisioned: true,
        roles: allKinds.map((kind) => DATABASE_ROLES[kind]),
        applicationTables: APPLICATION_TABLES.length,
        passwordsPrinted: false,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await database.close();
  }
}

await main();
