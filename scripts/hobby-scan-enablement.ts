import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HobbyEnvironmentError, type HobbyScanEnablementContext } from "./hobby-environments";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export const HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH =
  ".var/private/hobby-scan-enablement.json" as const;
export const HOBBY_ACCEPTED_RELEASE_PATH = ".var/private/hobby-release.json" as const;

type IgnoredCheck = (relativePath: string) => boolean;

function defaultIgnoredCheck(relativePath: string): boolean {
  return (
    spawnSync("git", ["check-ignore", "-q", "--", relativePath], {
      cwd: repositoryRoot,
      stdio: "ignore",
    }).status === 0
  );
}

function readPrivateContract(
  root: string,
  relativePath: string,
  label: string,
  isIgnored: IgnoredCheck,
): string {
  const path = resolve(root, relativePath);
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new HobbyEnvironmentError(`${label} must be a regular mode-0600 file`);
    }
    throw new HobbyEnvironmentError(`${label} is missing`);
  }
  try {
    const metadata = fstatSync(descriptor);
    if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
      throw new HobbyEnvironmentError(`${label} must be a regular mode-0600 file`);
    }
    if (!isIgnored(relativePath)) {
      throw new HobbyEnvironmentError(`${label} must remain ignored by Git`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function readPrivateHobbyScanEnablementContext(
  root = repositoryRoot,
  isIgnored: IgnoredCheck = defaultIgnoredCheck,
): HobbyScanEnablementContext {
  return {
    evidenceSource: readPrivateContract(
      root,
      HOBBY_SCAN_ENABLEMENT_EVIDENCE_PATH,
      "The private Hobby scan-enablement evidence",
      isIgnored,
    ),
    acceptedReleaseSource: readPrivateContract(
      root,
      HOBBY_ACCEPTED_RELEASE_PATH,
      "The private accepted-release contract",
      isIgnored,
    ),
  };
}
