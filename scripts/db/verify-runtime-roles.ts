import { createHash } from "node:crypto";

import {
  APPLICATION_FUNCTIONS,
  APPLICATION_TABLES,
  APPLICATION_TYPES,
  BILLING_FORBIDDEN_MUTATION_TABLES,
  createDatabaseClient,
  DATABASE_ROLES,
  PUBLIC_PROVIDER_VERIFICATION_FUNCTION,
  PUBLIC_PROVIDER_VERIFICATION_FUNCTION_SOURCE,
  PUBLIC_FORBIDDEN_MUTATION_TABLES,
  RETENTION_FORBIDDEN_MUTATION_TABLES,
  RUNTIME_COLUMN_PRIVILEGES,
  RUNTIME_TABLE_PRIVILEGES,
  WORKER_FORBIDDEN_MUTATION_TABLES,
  type RuntimeDatabaseRoleKind,
  type Pool,
} from "@trendsfast/database";

import { loadCliEnvironment } from "../../packages/database/src/load-cli-env";

const runtimeKinds = ["public", "member", "ops", "worker", "billing", "auth", "retention"] as const;
const roleUrlVariables: Readonly<Record<RuntimeDatabaseRoleKind, string>> = {
  public: "DATABASE_URL",
  member: "MEMBER_DATABASE_URL",
  ops: "OPS_DATABASE_URL",
  worker: "WORKER_DATABASE_URL",
  billing: "BILLING_DATABASE_URL",
  auth: "AUTH_DATABASE_URL",
  retention: "RETENTION_DATABASE_URL",
};
const identifierPattern = /^[a-z][a-z0-9_]{0,62}$/;

function identifier(value: string): string {
  if (!identifierPattern.test(value)) throw new Error("Unsafe database identifier");
  return `"${value}"`;
}

function requiredUrl(variable: string): string {
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required`);
  return value;
}

async function expectPrivilegeDenied(pool: Pool, statement: string, label: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(statement);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: unknown }).code === "42501") return;
      throw new Error(`${label} failed for a reason other than privilege denial`);
    }
    await client.query("ROLLBACK");
    throw new Error(`${label} was unexpectedly allowed`);
  } finally {
    client.release();
  }
}

async function expectErrorCode(pool: Pool, statement: string, code: string, label: string) {
  try {
    await pool.query(statement);
  } catch (error) {
    if ((error as { code?: unknown }).code === code) return;
    throw new Error(`${label} failed with an unexpected database error`);
  }
  throw new Error(`${label} was unexpectedly allowed`);
}

async function verifyBrowserFunctionDenied(pool: Pool, functionOid: string, label: string) {
  const access = await pool.query<{ role_name: string; allowed: boolean }>(
    `select role.rolname as role_name,
            pg_catalog.has_function_privilege(role.rolname, $1::oid, 'EXECUTE') as allowed
       from pg_catalog.pg_roles role
      where role.rolname in ('anon', 'authenticated')
      order by role.rolname`,
    [functionOid],
  );
  if (access.rows.some((entry) => entry.allowed)) {
    throw new Error(`anon or authenticated has effective ${label} access`);
  }
}

async function verifyRuntimeConnection(kind: RuntimeDatabaseRoleKind, sslCa: string | undefined) {
  const variable = roleUrlVariables[kind];
  const connectionString = requiredUrl(variable);
  const database = createDatabaseClient({
    connectionString,
    ...(sslCa ? { sslCa } : {}),
    maxConnections: 1,
    applicationName: `trendsfast-role-verifier-${kind}`,
  });
  try {
    const identity = await database.pool.query<{
      current_user: string;
      ssl: boolean;
      version: string | null;
      search_path: string;
    }>(`select
        current_user,
        coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as ssl,
        (select version from pg_stat_ssl where pid = pg_backend_pid()) as version,
        current_setting('search_path') as search_path`);
    const record = identity.rows[0];
    if (!record || record.current_user !== DATABASE_ROLES[kind]) {
      throw new Error(`${variable} does not authenticate as ${DATABASE_ROLES[kind]}`);
    }
    const host = new URL(connectionString).hostname.toLowerCase();
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
    if ((!local || process.env.ALLOW_LOCAL_ROLE_VERIFICATION !== "YES") && !record.ssl) {
      throw new Error(`${variable} did not negotiate TLS`);
    }
    if (record.search_path.replaceAll('"', "") !== "pg_catalog, public") {
      throw new Error(`${DATABASE_ROLES[kind]} has an unsafe search_path`);
    }
    await database.pool.query(
      kind === "retention"
        ? "select current_user"
        : kind === "auth"
          ? "select scope_hash from public.api_auth_admission_buckets where false"
          : kind === "billing"
            ? "select id from public.projects where false"
            : "select 1 from public.projects where false",
    );
    await expectPrivilegeDenied(
      database.pool,
      "create table public.trendsfast_runtime_acl_probe(id integer)",
      `${kind} DDL`,
    );
    const forbidden =
      kind === "public"
        ? PUBLIC_FORBIDDEN_MUTATION_TABLES
        : kind === "worker"
          ? WORKER_FORBIDDEN_MUTATION_TABLES
          : kind === "billing"
            ? BILLING_FORBIDDEN_MUTATION_TABLES
            : kind === "retention"
              ? RETENTION_FORBIDDEN_MUTATION_TABLES
              : [];
    for (const table of forbidden) {
      await expectPrivilegeDenied(
        database.pool,
        `insert into public.${identifier(table)} default values`,
        `${kind} insert on ${table}`,
      );
    }
    if (kind === "retention") {
      for (const table of APPLICATION_TABLES) {
        await expectPrivilegeDenied(
          database.pool,
          `select * from public.${identifier(table)} where false`,
          `retention read on ${table}`,
        );
      }
      await expectErrorCode(
        database.pool,
        "select * from public.trendsfast_purge_retained_data('invalid')",
        "22023",
        "retention revision fence",
      );
    }
    if (kind === "public") {
      const safeProjection = await database.pool.query(
        `select source, provider, state, credential_mode, deployment_environment,
                health_status, readback_verified, canonical_url_count, latency_ms,
                checked_at, completed_at
           from public.trendsfast_public_provider_verifications(
             '0000000', 'no-match.invalid', 'dpl_no_match'
           )`,
      );
      if (safeProjection.rows.length !== 0) {
        throw new Error("The provider projection returned a mismatched deployment row");
      }
      for (const [statement, label] of [
        ["select secret_hash from public.api_keys where false", "public key hashes"],
        [
          "select requester_fingerprint_hash from public.api_key_auth_events where false",
          "public auth fingerprints",
        ],
        [
          "select canonical_urls from public.provider_verification_records where false",
          "public verification targets",
        ],
      ] as const) {
        await expectPrivilegeDenied(database.pool, statement, label);
      }
    }
    if (kind === "worker") {
      await expectErrorCode(
        database.pool,
        "select public.trendsfast_assert_managed_policy_revision('invalid')",
        "22023",
        "worker revision fence",
      );
    }
    if (kind === "auth") {
      await database.pool.query("select secret_hash from public.api_keys where false");
      await expectPrivilegeDenied(
        database.pool,
        "select submitted_url from public.scan_requests where false",
        "auth scan payloads",
      );
    }
    return { role: record.current_user, tls: record.ssl, tlsVersion: record.version };
  } finally {
    await database.close();
  }
}

async function verifyCatalog(sslCa: string | undefined) {
  const adminUrl =
    process.env.ROLE_ADMIN_DATABASE_URL?.trim() ?? process.env.DIRECT_DATABASE_URL?.trim();
  if (!adminUrl) throw new Error("ROLE_ADMIN_DATABASE_URL or DIRECT_DATABASE_URL is required");
  const database = createDatabaseClient({
    connectionString: adminUrl,
    ...(sslCa ? { sslCa } : {}),
    maxConnections: 1,
    applicationName: "trendsfast-role-catalog-verifier",
  });
  try {
    const roles = await database.pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `select rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
              rolreplication, rolbypassrls, rolcanlogin
         from pg_roles
        where rolname = any($1::text[])
        order by rolname`,
      [Object.values(DATABASE_ROLES)],
    );
    if (roles.rows.length !== Object.keys(DATABASE_ROLES).length) {
      throw new Error("One or more TrendsFast database roles are missing");
    }
    for (const role of roles.rows) {
      if (
        !role.rolcanlogin ||
        role.rolsuper ||
        role.rolcreatedb ||
        role.rolcreaterole ||
        role.rolinherit ||
        role.rolreplication ||
        role.rolbypassrls
      ) {
        throw new Error(`${role.rolname} has unsafe PostgreSQL role attributes`);
      }
    }
    const memberships = await database.pool.query<{ member: string; granted_role: string }>(
      `select member.rolname as member, granted.rolname as granted_role
         from pg_auth_members membership
         join pg_roles member on member.oid = membership.member
         join pg_roles granted on granted.oid = membership.roleid
        where member.rolname = any($1::text[])
           or granted.rolname = any($1::text[])
        order by member.rolname, granted.rolname`,
      [Object.values(DATABASE_ROLES)],
    );
    if (memberships.rows.length) {
      throw new Error("A TrendsFast database role has an unexpected role membership");
    }

    const ownership = await database.pool.query<{ schema_name: string; object_name: string }>(
      `select n.nspname as schema_name, c.relname as object_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_roles owner on owner.oid = c.relowner
        where c.relkind in ('r','p','S','v','m','f')
          and (
            (n.nspname = 'public' and c.relname = any($1::text[]))
            or (n.nspname = 'drizzle' and c.relname = '__drizzle_migrations')
          )
          and owner.rolname <> $2
        order by n.nspname, c.relname`,
      [APPLICATION_TABLES, DATABASE_ROLES.migrator],
    );
    if (ownership.rows.length) {
      throw new Error("One or more TrendsFast database objects are not migrator-owned");
    }
    const typeOwnership = await database.pool.query<{ type_name: string }>(
      `select t.typname as type_name
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         join pg_roles owner on owner.oid = t.typowner
        where n.nspname = 'public'
          and t.typname = any($1::text[])
          and owner.rolname <> $2
        order by t.typname`,
      [APPLICATION_TYPES, DATABASE_ROLES.migrator],
    );
    if (typeOwnership.rows.length) {
      throw new Error("One or more TrendsFast database types are not migrator-owned");
    }

    const providerProjection = await database.pool.query<{
      oid: string;
      owner_name: string;
      security_definer: boolean;
      volatility: string;
      configuration: string[] | null;
      source: string;
      result_type: string;
    }>(
      `select function.oid::text as oid,
              owner.rolname as owner_name,
              function.prosecdef as security_definer,
              function.provolatile as volatility,
              function.proconfig as configuration,
              function.prosrc as source,
              pg_catalog.pg_get_function_result(function.oid) as result_type
         from pg_catalog.pg_proc function
         join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
         join pg_catalog.pg_roles owner on owner.oid = function.proowner
        where namespace.nspname = $1
          and function.proname = $2
          and pg_catalog.oidvectortypes(function.proargtypes) = $3`,
      [
        PUBLIC_PROVIDER_VERIFICATION_FUNCTION.schema,
        PUBLIC_PROVIDER_VERIFICATION_FUNCTION.name,
        PUBLIC_PROVIDER_VERIFICATION_FUNCTION.identityArguments,
      ],
    );
    const projection = providerProjection.rows[0];
    if (!projection || providerProjection.rows.length !== 1) {
      throw new Error(
        "The public provider-verification projection function is missing or ambiguous",
      );
    }
    const normalizedSource = projection.source.trim().replaceAll("\r\n", "\n");
    const expectedSource = PUBLIC_PROVIDER_VERIFICATION_FUNCTION_SOURCE.trim().replaceAll(
      "\r\n",
      "\n",
    );
    const sourceHash = createHash("sha256").update(normalizedSource).digest("hex");
    const expectedHash = createHash("sha256").update(expectedSource).digest("hex");
    const expectedResult =
      "TABLE(source text, provider text, state text, credential_mode text, deployment_environment text, health_status text, readback_verified boolean, canonical_url_count integer, latency_ms integer, checked_at timestamp with time zone, completed_at timestamp with time zone)";
    if (
      projection.owner_name !== DATABASE_ROLES.migrator ||
      !projection.security_definer ||
      projection.volatility !== "s" ||
      JSON.stringify(projection.configuration) !== JSON.stringify(["search_path=pg_catalog"]) ||
      projection.result_type !== expectedResult ||
      sourceHash !== expectedHash
    ) {
      throw new Error("The public provider-verification projection contract or hash changed");
    }
    if (
      /estimated_cost_usd|actual_cost_usd|quota_used|failure_message|initiated_by|requester|secret_hash/i.test(
        normalizedSource,
      )
    ) {
      throw new Error("The public provider-verification projection references a forbidden field");
    }
    const functionAcl = await database.pool.query<{
      grantee: string;
      privilege_type: string;
    }>(
      `select case when acl.grantee = 0 then 'PUBLIC' else role.rolname end as grantee,
              acl.privilege_type
         from pg_catalog.pg_proc function
         cross join lateral pg_catalog.aclexplode(function.proacl) acl
         left join pg_catalog.pg_roles role on role.oid = acl.grantee
        where function.oid = $1::oid
        order by role.rolname, acl.privilege_type`,
      [projection.oid],
    );
    const expectedFunctionAcl = new Set([
      `${DATABASE_ROLES.migrator}:EXECUTE`,
      `${DATABASE_ROLES.public}:EXECUTE`,
    ]);
    const actualFunctionAcl = new Set(
      functionAcl.rows.map((entry) => `${entry.grantee}:${entry.privilege_type}`),
    );
    if (
      [...expectedFunctionAcl].some((entry) => !actualFunctionAcl.has(entry)) ||
      [...actualFunctionAcl].some((entry) => !expectedFunctionAcl.has(entry))
    ) {
      throw new Error("The public provider-verification function has an unexpected ACL");
    }
    for (const kind of runtimeKinds) {
      const functionAccess = await database.pool.query<{ allowed: boolean }>(
        "select pg_catalog.has_function_privilege($1, $2::oid, 'EXECUTE') as allowed",
        [DATABASE_ROLES[kind], projection.oid],
      );
      if (Boolean(functionAccess.rows[0]?.allowed) !== (kind === "public")) {
        throw new Error(`${DATABASE_ROLES[kind]} has unexpected provider projection access`);
      }
    }
    await verifyBrowserFunctionDenied(
      database.pool,
      projection.oid,
      "provider projection function",
    );

    for (const functionRecord of APPLICATION_FUNCTIONS.filter(
      (candidate) => candidate.name !== PUBLIC_PROVIDER_VERIFICATION_FUNCTION.name,
    )) {
      const functions = await database.pool.query<{
        oid: string;
        owner_name: string;
        security_definer: boolean;
        volatility: string;
        configuration: string[] | null;
        source: string;
      }>(
        `select function.oid::text as oid,
                owner.rolname as owner_name,
                function.prosecdef as security_definer,
                function.provolatile as volatility,
                function.proconfig as configuration,
                function.prosrc as source
           from pg_catalog.pg_proc function
           join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
           join pg_catalog.pg_roles owner on owner.oid = function.proowner
          where namespace.nspname = $1
            and function.proname = $2
            and pg_catalog.oidvectortypes(function.proargtypes) = $3`,
        [functionRecord.schema, functionRecord.name, functionRecord.identityArguments],
      );
      const functionDefinition = functions.rows[0];
      if (!functionDefinition || functions.rows.length !== 1) {
        throw new Error(`${functionRecord.name} is missing or ambiguous`);
      }
      if (
        functionDefinition.owner_name !== DATABASE_ROLES.migrator ||
        !functionDefinition.security_definer ||
        functionDefinition.volatility !== functionRecord.volatility ||
        JSON.stringify(functionDefinition.configuration) !==
          JSON.stringify(["search_path=pg_catalog"]) ||
        createHash("sha256")
          .update(functionDefinition.source.trim().replaceAll("\r\n", "\n"))
          .digest("hex") !== functionRecord.sourceHash
      ) {
        throw new Error(`${functionRecord.name} has an unsafe execution contract`);
      }
      const acl = await database.pool.query<{ grantee: string; privilege_type: string }>(
        `select case when acl.grantee = 0 then 'PUBLIC' else role.rolname end as grantee,
                acl.privilege_type
           from pg_catalog.pg_proc function
           cross join lateral pg_catalog.aclexplode(function.proacl) acl
           left join pg_catalog.pg_roles role on role.oid = acl.grantee
          where function.oid = $1::oid
          order by grantee, acl.privilege_type`,
        [functionDefinition.oid],
      );
      const expectedAcl = new Set([
        `${DATABASE_ROLES.migrator}:EXECUTE`,
        ...functionRecord.executeRoles.map((kind) => `${DATABASE_ROLES[kind]}:EXECUTE`),
      ]);
      const actualAcl = new Set(
        acl.rows.map((entry) => `${entry.grantee}:${entry.privilege_type}`),
      );
      if (
        [...expectedAcl].some((entry) => !actualAcl.has(entry)) ||
        [...actualAcl].some((entry) => !expectedAcl.has(entry))
      ) {
        throw new Error(`${functionRecord.name} has an unexpected ACL`);
      }
      for (const kind of runtimeKinds) {
        const access = await database.pool.query<{ allowed: boolean }>(
          "select pg_catalog.has_function_privilege($1, $2::oid, 'EXECUTE') as allowed",
          [DATABASE_ROLES[kind], functionDefinition.oid],
        );
        const shouldAllow = functionRecord.executeRoles.some((executeRole) => executeRole === kind);
        if (Boolean(access.rows[0]?.allowed) !== shouldAllow) {
          throw new Error(`${DATABASE_ROLES[kind]} has unexpected ${functionRecord.name} access`);
        }
      }
      await verifyBrowserFunctionDenied(database.pool, functionDefinition.oid, functionRecord.name);
    }

    const missingTables = await database.pool.query<{ table_name: string }>(
      `select expected.table_name
         from unnest($1::text[]) expected(table_name)
         left join information_schema.tables actual
           on actual.table_schema = 'public' and actual.table_name = expected.table_name
        where actual.table_name is null
        order by expected.table_name`,
      [APPLICATION_TABLES],
    );
    if (missingTables.rows.length)
      throw new Error("Runtime-role verification found missing tables");

    for (const kind of runtimeKinds) {
      const role = DATABASE_ROLES[kind];
      const schema = await database.pool.query<{ usage: boolean; create: boolean }>(
        `select has_schema_privilege($1, 'public', 'USAGE') as usage,
                has_schema_privilege($1, 'public', 'CREATE') as create`,
        [role],
      );
      if (!schema.rows[0]?.usage || schema.rows[0]?.create) {
        throw new Error(`${role} does not have the exact runtime schema privilege`);
      }
      const databasePrivileges = await database.pool.query<{
        connect: boolean;
        create: boolean;
        temporary: boolean;
      }>(
        `select
           has_database_privilege($1, current_database(), 'CONNECT') as connect,
           has_database_privilege($1, current_database(), 'CREATE') as create,
           has_database_privilege($1, current_database(), 'TEMPORARY') as temporary`,
        [role],
      );
      if (
        !databasePrivileges.rows[0]?.connect ||
        databasePrivileges.rows[0]?.create ||
        databasePrivileges.rows[0]?.temporary
      ) {
        throw new Error(`${role} has unsafe database CREATE/TEMPORARY privileges`);
      }
      const expected = RUNTIME_TABLE_PRIVILEGES[kind];
      for (const table of APPLICATION_TABLES) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          const result = await database.pool.query<{ allowed: boolean }>(
            "select has_table_privilege($1, format('%I.%I', 'public', $2::text), $3) as allowed",
            [role, table, privilege],
          );
          const shouldAllow = expected[table]?.includes(privilege) ?? false;
          if (Boolean(result.rows[0]?.allowed) !== shouldAllow) {
            throw new Error(`${role} has an unexpected ${privilege} table grant on ${table}`);
          }
        }
      }
      for (const grant of RUNTIME_COLUMN_PRIVILEGES[kind]) {
        for (const column of grant.columns) {
          const result = await database.pool.query<{ allowed: boolean }>(
            "select has_column_privilege($1, format('%I.%I', 'public', $2::text), $3, $4) as allowed",
            [role, grant.table, column, grant.privilege],
          );
          if (!result.rows[0]?.allowed) {
            throw new Error(`${role} is missing ${grant.privilege} on ${grant.table}.${column}`);
          }
        }
      }
    }

    const explicitColumnGrants = await database.pool.query<{
      role_name: string;
      table_name: string;
      column_name: string;
      privilege_type: string;
    }>(
      `select role.rolname as role_name,
              relation.relname as table_name,
              attribute.attname as column_name,
              acl.privilege_type
         from pg_attribute attribute
         join pg_class relation on relation.oid = attribute.attrelid
         join pg_namespace namespace on namespace.oid = relation.relnamespace
         cross join lateral aclexplode(attribute.attacl) acl
         join pg_roles role on role.oid = acl.grantee
        where namespace.nspname = 'public'
          and relation.relname = any($1::text[])
          and role.rolname = any($2::text[])
        order by role.rolname, relation.relname, attribute.attname, acl.privilege_type`,
      [APPLICATION_TABLES, runtimeKinds.map((kind) => DATABASE_ROLES[kind])],
    );
    const expectedColumnGrants = new Set(
      runtimeKinds.flatMap((kind) =>
        RUNTIME_COLUMN_PRIVILEGES[kind].flatMap((grant) =>
          grant.columns.map(
            (column) => `${DATABASE_ROLES[kind]}:${grant.table}:${column}:${grant.privilege}`,
          ),
        ),
      ),
    );
    const actualColumnGrants = new Set(
      explicitColumnGrants.rows.map(
        (grant) =>
          `${grant.role_name}:${grant.table_name}:${grant.column_name}:${grant.privilege_type}`,
      ),
    );
    if (
      [...expectedColumnGrants].some((grant) => !actualColumnGrants.has(grant)) ||
      [...actualColumnGrants].some((grant) => !expectedColumnGrants.has(grant))
    ) {
      throw new Error("Runtime roles do not have the exact reviewed column privilege set");
    }

    const unsafeBrowser = await database.pool.query<{
      grantee: string;
      object_name: string;
      privilege_type: string;
    }>(
      `with browser_roles as (
          select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')
        ), unsafe as (
          select case when acl.grantee = 0 then 'PUBLIC' else role.rolname end as grantee,
                 c.relname as object_name,
                 acl.privilege_type
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
            left join pg_roles role on role.oid = acl.grantee
           where n.nspname = 'public'
             and c.relname = any($1::text[])
             and (acl.grantee = 0 or acl.grantee in (select oid from browser_roles))
        ) select * from unsafe order by grantee, object_name, privilege_type`,
      [APPLICATION_TABLES],
    );
    if (unsafeBrowser.rows.length) {
      throw new Error("PUBLIC, anon, or authenticated retains TrendsFast table access");
    }

    const unsafeBrowserColumns = await database.pool.query<{
      grantee: string;
      table_name: string;
      column_name: string;
      privilege_type: string;
    }>(
      `with browser_roles as (
          select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')
        )
        select case when acl.grantee = 0 then 'PUBLIC' else role.rolname end as grantee,
               relation.relname as table_name,
               attribute.attname as column_name,
               acl.privilege_type
          from pg_attribute attribute
          join pg_class relation on relation.oid = attribute.attrelid
          join pg_namespace namespace on namespace.oid = relation.relnamespace
          cross join lateral aclexplode(attribute.attacl) acl
          left join pg_roles role on role.oid = acl.grantee
         where namespace.nspname = 'public'
           and relation.relname = any($1::text[])
           and (acl.grantee = 0 or acl.grantee in (select oid from browser_roles))
         order by grantee, table_name, column_name, privilege_type`,
      [APPLICATION_TABLES],
    );
    if (unsafeBrowserColumns.rows.length) {
      throw new Error("PUBLIC, anon, or authenticated retains an explicit column grant");
    }

    const effectiveBrowser = await database.pool.query<{
      role_name: string;
      table_name: string;
      column_name: string | null;
      privilege_type: string;
    }>(
      `with browser_roles as (
          select rolname from pg_roles where rolname in ('anon', 'authenticated')
        ), application_columns as (
          select relation.relname as table_name, attribute.attname as column_name
            from pg_attribute attribute
            join pg_class relation on relation.oid = attribute.attrelid
            join pg_namespace namespace on namespace.oid = relation.relnamespace
           where namespace.nspname = 'public'
             and relation.relname = any($1::text[])
             and attribute.attnum > 0
             and not attribute.attisdropped
        ), column_access as (
          select role.rolname as role_name,
                 application_column.table_name,
                 application_column.column_name,
                 privilege.privilege_type
            from browser_roles role
            cross join application_columns application_column
            cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
              privilege(privilege_type)
           where has_column_privilege(
             role.rolname,
             format('%I.%I', 'public', application_column.table_name),
             application_column.column_name,
             privilege.privilege_type
           )
        ), table_only_access as (
          select role.rolname as role_name,
                 application_table.table_name,
                 null::text as column_name,
                 privilege.privilege_type
            from browser_roles role
            cross join unnest($1::text[]) application_table(table_name)
            cross join (values ('DELETE'), ('TRUNCATE'), ('TRIGGER')) privilege(privilege_type)
           where has_table_privilege(
             role.rolname,
             format('%I.%I', 'public', application_table.table_name),
             privilege.privilege_type
           )
        )
        select * from column_access
        union all
        select * from table_only_access
        order by role_name, table_name, column_name, privilege_type`,
      [APPLICATION_TABLES],
    );
    if (effectiveBrowser.rows.length) {
      throw new Error("anon or authenticated has inherited/effective TrendsFast access");
    }
    return { roles: roles.rows.length, objectsOwnedByMigrator: true };
  } finally {
    await database.close();
  }
}

async function main() {
  loadCliEnvironment();
  const sslCa = process.env.DATABASE_SSL_CA?.trim();
  const catalog = await verifyCatalog(sslCa);
  const runtime = Object.fromEntries(
    await Promise.all(
      runtimeKinds.map(async (kind) => [kind, await verifyRuntimeConnection(kind, sslCa)]),
    ),
  );
  console.info(JSON.stringify({ ok: true, catalog, runtime, rowValuesRead: false }));
}

await main();
