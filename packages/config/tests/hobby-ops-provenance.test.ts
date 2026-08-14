import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseProductionInventory } from "../../../scripts/staged-production-env";
import {
  HobbyOpsProvenanceError,
  renderHobbyOpsProvenanceInventory,
  updateHobbyOpsProvenanceInventory,
} from "../../../scripts/update-hobby-ops-provenance";

const OLD_HOST = "trendsfast-old-revision.vercel.app";
const OLD_ID = "dpl_OldRevision123";
const NEW_HOST = "trendsfast-new-revision.vercel.app";
const NEW_ID = "dpl_NewRevision456";
const PRIVATE_VALUE = "private-value-that-must-not-be-printed";

function inventory(): string {
  return (
    `# Private inventory\n` +
    `PRIVATE_VALUE=${JSON.stringify(PRIVATE_VALUE)}\n` +
    `MULTILINE_VALUE="first\nsecond"\n` +
    `SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST=${JSON.stringify(OLD_HOST)} # stale\n` +
    `SOL_HOBBY_PUBLIC_DEPLOYMENT_ID=${JSON.stringify(OLD_ID)}\n`
  );
}

describe("Hobby ops deployment provenance inventory update", () => {
  it("replaces exactly the two safe provenance assignments and preserves private data", () => {
    const updated = renderHobbyOpsProvenanceInventory(inventory(), NEW_HOST, NEW_ID);
    const parsed = parseProductionInventory(updated);

    expect(parsed.values.SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST).toBe(NEW_HOST);
    expect(parsed.values.SOL_HOBBY_PUBLIC_DEPLOYMENT_ID).toBe(NEW_ID);
    expect(parsed.values.PRIVATE_VALUE).toBe(PRIVATE_VALUE);
    expect(parsed.values.MULTILINE_VALUE).toBe("first\nsecond");
    expect(updated).not.toContain(OLD_HOST);
    expect(updated).not.toContain(OLD_ID);
  });

  it("fails closed on malformed provenance and duplicate or absent assignments", () => {
    expect(() => renderHobbyOpsProvenanceInventory(inventory(), "example.com", NEW_ID)).toThrow(
      "host provenance is malformed",
    );
    expect(() => renderHobbyOpsProvenanceInventory(inventory(), NEW_HOST, "bad-id")).toThrow(
      "ID provenance is malformed",
    );
    expect(() =>
      renderHobbyOpsProvenanceInventory(
        `${inventory()}SOL_HOBBY_PUBLIC_DEPLOYMENT_ID=${JSON.stringify(OLD_ID)}\n`,
        NEW_HOST,
        NEW_ID,
      ),
    ).toThrow("exactly one SOL_HOBBY_PUBLIC_DEPLOYMENT_ID");
    expect(() =>
      renderHobbyOpsProvenanceInventory(
        inventory().replace(/^SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST=.*\n/mu, ""),
        NEW_HOST,
        NEW_ID,
      ),
    ).toThrow(HobbyOpsProvenanceError);
  });

  it("writes atomically only to an ignored regular mode-0600 inventory", () => {
    const directory = mkdtempSync(join(tmpdir(), "tf-ops-provenance-"));
    const path = join(directory, ".env.production.local");
    writeFileSync(path, inventory(), { mode: 0o600 });

    updateHobbyOpsProvenanceInventory(NEW_HOST, NEW_ID, path, () => true);
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      expect(fstatSync(descriptor).mode & 0o777).toBe(0o600);
      expect(parseProductionInventory(readFileSync(descriptor, "utf8")).values).toMatchObject({
        SOL_HOBBY_PUBLIC_DEPLOYMENT_HOST: NEW_HOST,
        SOL_HOBBY_PUBLIC_DEPLOYMENT_ID: NEW_ID,
        PRIVATE_VALUE,
      });
    } finally {
      closeSync(descriptor);
    }

    expect(() => updateHobbyOpsProvenanceInventory(NEW_HOST, NEW_ID, path, () => false)).toThrow(
      "remain ignored",
    );
    chmodSync(path, 0o640);
    expect(() => updateHobbyOpsProvenanceInventory(NEW_HOST, NEW_ID, path, () => true)).toThrow(
      "regular mode-0600",
    );
  });
});
