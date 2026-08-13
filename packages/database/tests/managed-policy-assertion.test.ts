import { describe, expect, it, vi } from "vitest";

import { OperationsRepository } from "../src/index";

describe("managed policy effect fence", () => {
  it("accepts only an opaque bounded revision and returns no policy values", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ trendsfast_assert_managed_policy_revision: null }] });
    const repository = new OperationsRepository({ execute } as never);

    await expect(repository.assertManagedPolicyRevision("r".repeat(32))).resolves.toBeUndefined();
    await expect(repository.assertManagedPolicyRevision("invalid")).rejects.toThrow(
      "Managed runtime policy revision is invalid",
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("records backup health through the fixed worker function", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new OperationsRepository({ execute } as never);

    await expect(repository.recordBackupHealth({ succeeded: true })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
