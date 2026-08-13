import { createDatabaseFromRoleEnv, createRepositories } from "@trendsfast/database";
import { loadEnv } from "@trendsfast/config";
import { loadCliEnvironment } from "../../packages/database/src/load-cli-env";

loadCliEnvironment();

const [checkType, outcome, failureCode] = process.argv.slice(2);
if (checkType !== "BACKUP") {
  throw new Error("Usage: ops:record-health BACKUP SUCCESS|FAILURE [SAFE_FAILURE_CODE]");
}
if (outcome !== "SUCCESS" && outcome !== "FAILURE") {
  throw new Error("Usage: ops:record-health BACKUP SUCCESS|FAILURE [SAFE_FAILURE_CODE]");
}
if (outcome === "FAILURE" && !failureCode) {
  throw new Error("A failure heartbeat requires a non-secret failure code");
}

const client = createDatabaseFromRoleEnv(loadEnv(), "worker");
try {
  await createRepositories(client.db).operations.recordBackupHealth({
    succeeded: outcome === "SUCCESS",
    ...(failureCode ? { failureCode } : {}),
  });
  console.info(JSON.stringify({ checkType, outcome, recorded: true, privateValuesRead: false }));
} finally {
  await client.close();
}
