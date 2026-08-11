import { describe, expect, it } from "vitest";
import { redact } from "../src/index";

describe("secret redaction", () => {
  it("redacts keys, bearer credentials, urls with userinfo and nested secret fields", () => {
    const output = redact({
      authorization: "Bearer tf_live_prefix.supersecret",
      api_key: "provider-secret",
      nested: { password: "hunter2", safe: "visible" },
      database: "postgresql://user:password@host/db",
    });

    expect(JSON.stringify(output)).not.toContain("supersecret");
    expect(JSON.stringify(output)).not.toContain("provider-secret");
    expect(JSON.stringify(output)).not.toContain("hunter2");
    expect(JSON.stringify(output)).not.toContain("user:password");
    expect(output).toMatchObject({ nested: { safe: "visible" } });
  });
});
