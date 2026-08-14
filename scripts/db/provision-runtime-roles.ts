import {
  APPLICATION_FUNCTIONS,
  APPLICATION_TABLES,
  APPLICATION_TYPES,
  assertLiveProductionDatabaseIdentity,
  assertProductionDatabaseTarget,
  createDatabaseClient,
  DATABASE_ROLES,
  RUNTIME_COLUMN_PRIVILEGES,
  RUNTIME_TABLE_PRIVILEGES,
  type DatabaseRoleKind,
  type PoolClient,
} from "@trendsfast/database";
import { loadPinnedProductionDatabaseEnvironment } from "@trendsfast/database/production-cli-environment";

import { verifyRuntimeRoleState } from "./verify-runtime-roles";

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
const supabaseDataApiRoles = ["anon", "authenticated", "service_role"] as const;
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;

function identifier(value: string): string {
  if (!identifierPattern.test(value)) throw new Error("Unsafe database identifier");
  return `"${value}"`;
}

function grantee(value: string): string {
  return value === "PUBLIC" ? "PUBLIC" : identifier(value);
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

async function ensureRole(
  client: PoolClient,
  kind: DatabaseRoleKind,
  password: string,
  operatorIsSuperuser: boolean,
) {
  const role = DATABASE_ROLES[kind];
  const existing = await client.query<{ rolsuper: boolean }>(
    "select rolsuper from pg_roles where rolname = $1",
    [role],
  );
  if (existing.rows[0]?.rolsuper && !operatorIsSuperuser) {
    throw new Error(`${role} is unexpectedly superuser and this operator cannot safely demote it`);
  }
  if (existing.rows.length === 0) {
    await client.query(
      `CREATE ROLE ${identifier(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30`,
    );
  }
  // Managed PostgreSQL operators such as Supabase's `postgres` have CREATEROLE
  // but are intentionally not true superusers. PostgreSQL already guarantees a
  // newly created role is NOSUPERUSER above, while the managed hook rejects even
  // a no-op attempt to alter the SUPERUSER attribute. A true superuser retains
  // the original idempotent demotion behavior.
  const noSuperuser = operatorIsSuperuser ? "NOSUPERUSER " : "";
  await client.query(
    `ALTER ROLE ${identifier(role)} LOGIN ${noSuperuser}NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30`,
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

async function transferApplicationOwnership(client: PoolClient, serverVersion: number) {
  const role = DATABASE_ROLES.migrator;
  const modernMemberships = serverVersion >= 160000;
  const membership = await client.query<{ allowed: boolean }>(
    modernMemberships
      ? "select pg_has_role(current_user, $1, 'SET') as allowed"
      : "select pg_has_role(current_user, $1, 'MEMBER') as allowed",
    [role],
  );
  const temporaryMembership = !membership.rows[0]?.allowed;
  if (temporaryMembership) {
    await client.query(
      modernMemberships
        ? `GRANT ${identifier(role)} TO CURRENT_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER`
        : `GRANT ${identifier(role)} TO CURRENT_USER`,
    );
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
     join pg_roles owner on owner.oid = c.relowner
     where c.relkind in ('r','p','S','v','m','f')
       and owner.rolname <> $1
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
       join pg_roles owner on owner.oid = t.typowner
      where n.nspname = 'public'
        and t.typtype in ('e', 'd')
        and t.typname = any($2::text[])
        and owner.rolname <> $1
      order by t.typname`,
    [role, APPLICATION_TYPES],
  );
  for (const row of types.rows) await client.query(row.statement);

  for (const functionRecord of APPLICATION_FUNCTIONS) {
    const owner = await client.query<{ owner: string }>(
      `select owner.rolname as owner
         from pg_proc function
         join pg_namespace namespace on namespace.oid = function.pronamespace
         join pg_roles owner on owner.oid = function.proowner
        where namespace.nspname = $1
          and function.proname = $2
          and pg_catalog.oidvectortypes(function.proargtypes) = $3`,
      [functionRecord.schema, functionRecord.name, functionRecord.identityArguments],
    );
    if (owner.rows[0]?.owner === role) continue;
    await client.query(
      `ALTER FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) OWNER TO ${identifier(role)}`,
    );
  }

  await client.query(`SET LOCAL ROLE ${identifier(role)}`);
  return async () => {
    await client.query("RESET ROLE");
    if (temporaryMembership) {
      await client.query(
        modernMemberships
          ? `REVOKE ${identifier(role)} FROM CURRENT_USER GRANTED BY CURRENT_USER`
          : `REVOKE ${identifier(role)} FROM CURRENT_USER`,
      );
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
  for (const browserRole of supabaseDataApiRoles) {
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

async function revokeUnsafeSchemaBaseline(client: PoolClient) {
  await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC`);
  for (const dataApiRole of supabaseDataApiRoles) {
    const exists = await client.query<{ exists: boolean }>(
      "select exists(select 1 from pg_roles where rolname = $1) as exists",
      [dataApiRole],
    );
    if (exists.rows[0]?.exists) {
      await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${identifier(dataApiRole)}`);
    }
  }
}

async function revokeUnsafeApplicationBaseline(client: PoolClient) {
  for (const table of APPLICATION_TABLES) {
    await client.query(`REVOKE ALL PRIVILEGES ON TABLE public.${identifier(table)} FROM PUBLIC`);
  }
  for (const functionRecord of APPLICATION_FUNCTIONS) {
    await client.query(
      `REVOKE ALL PRIVILEGES ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) FROM PUBLIC`,
    );
  }
  const dataApiGrantees = ["PUBLIC"];
  for (const dataApiRole of supabaseDataApiRoles) {
    const exists = await client.query<{ exists: boolean }>(
      "select exists(select 1 from pg_roles where rolname = $1) as exists",
      [dataApiRole],
    );
    if (!exists.rows[0]?.exists) continue;
    dataApiGrantees.push(dataApiRole);
    for (const table of APPLICATION_TABLES) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON TABLE public.${identifier(table)} FROM ${identifier(dataApiRole)}`,
      );
    }
    for (const functionRecord of APPLICATION_FUNCTIONS) {
      await client.query(
        `REVOKE ALL PRIVILEGES ON FUNCTION ${identifier(functionRecord.schema)}.${identifier(functionRecord.name)}(${functionRecord.identityArguments}) FROM ${identifier(dataApiRole)}`,
      );
    }
  }
  await clearApplicationColumnPrivileges(client, dataApiGrantees);
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
  const environment = loadPinnedProductionDatabaseEnvironment("provision-runtime-roles");
  const roleAdminUrl = environment.ROLE_ADMIN_DATABASE_URL;
  const roleAdminConfigured = Boolean(roleAdminUrl?.trim());
  const connectionString = roleAdminConfigured ? roleAdminUrl : environment.DIRECT_DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("ROLE_ADMIN_DATABASE_URL or DIRECT_DATABASE_URL is required");
  }
  const expectedOperator = roleAdminConfigured ? "postgres" : DATABASE_ROLES.migrator;
  const target = assertProductionDatabaseTarget({
    connectionString,
    endpoint: "direct-or-session",
    expectedRole: expectedOperator,
    sslCa: environment.DATABASE_SSL_CA,
  });
  const passwords = Object.fromEntries(
    allKinds.map((kind) => [kind, requiredPassword(environment, kind)]),
  ) as Record<DatabaseRoleKind, string>;
  const database = createDatabaseClient({
    connectionString: target.connectionString,
    sslCa: target.sslCa,
    maxConnections: 1,
    applicationName: "trendsfast-role-provisioner",
  });
  const client = await database.pool.connect();
  try {
    const operator = await client.query<{
      current_database: string;
      current_user: string;
      rolcreaterole: boolean;
      rolsuper: boolean;
      server_version_num: string;
    }>(
      `select current_user,
              current_database() as current_database,
              role.rolcreaterole,
              role.rolsuper,
              current_setting('server_version_num') as server_version_num
         from pg_roles role
        where role.rolname = current_user`,
    );
    assertLiveProductionDatabaseIdentity(operator.rows[0], target.expectedRole);
    const operatorIsSuperuser = operator.rows[0]?.rolsuper === true;
    const operatorCanCreateRoles = operator.rows[0]?.rolcreaterole === true;
    const serverVersion = Number(operator.rows[0]?.server_version_num ?? "0");
    if (!Number.isSafeInteger(serverVersion) || serverVersion < 150000) {
      throw new Error("Role provisioning requires PostgreSQL 15 or newer");
    }
    if (target.expectedRole !== "postgres" && (operatorIsSuperuser || operatorCanCreateRoles)) {
      throw new Error("The migrator has unexpected role-administration capability");
    }
    if (!operatorIsSuperuser && !operatorCanCreateRoles) {
      const verification = await verifyRuntimeRoleState();
      console.info(
        JSON.stringify({
          provisioned: false,
          alreadyExact: true,
          verifiedRoles: verification.catalog.roles,
          restrictedOperator: true,
          secretValuesPrinted: false,
        }),
      );
      return;
    }
    await client.query("BEGIN");
    for (const kind of allKinds) {
      await ensureRole(client, kind, passwords[kind], operatorIsSuperuser);
    }
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

    await revokeUnsafeSchemaBaseline(client);
    await revokeUnsafeDefaultPrivileges(client);
    await grantMigratorDdl(client);
    await grantRuntimeSchemaUsage(client);
    const restoreAdmin = await transferApplicationOwnership(client, serverVersion);
    await revokeUnsafeApplicationBaseline(client);
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

try {
  await main();
} catch {
  console.error(JSON.stringify({ ok: false, error: "RUNTIME_ROLE_PROVISIONING_FAILED" }));
  process.exitCode = 1;
}
