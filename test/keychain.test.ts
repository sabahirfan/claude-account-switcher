import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";
import { macKeychain } from "../src/core/keychain.ts";

// Uses the real login Keychain with a throwaway service name; never touches Claude Code's items.
const SERVICE = `ccswitch-selftest-${process.pid}`;

describe("macKeychain", { skip: process.platform !== "darwin" }, () => {
  const kc = macKeychain();
  after(() => {
    kc.remove(SERVICE, "one");
    kc.remove(SERVICE, "two");
  });

  it("writes, overwrites, reads and removes a JSON secret", () => {
    const secret = JSON.stringify({ claudeAiOauth: { accessToken: "x".repeat(900), scopes: ["a b", 'q"uote'] } });
    assert.equal(kc.read(SERVICE, "one"), null);
    kc.write(SERVICE, "one", secret);
    assert.equal(kc.read(SERVICE, "one"), secret);
    kc.write(SERVICE, "one", "{}");
    assert.equal(kc.read(SERVICE, "one"), "{}");
    assert.equal(kc.accountOf(SERVICE), "one");
    assert.ok(kc.remove(SERVICE, "one"));
    assert.equal(kc.read(SERVICE, "one"), null);
  });

  it("refuses a secret too large for one `security -i` line instead of truncating it", () => {
    assert.throws(() => kc.write(SERVICE, "two", "y".repeat(3000)), /too large/);
    assert.equal(kc.read(SERVICE, "two"), null);
  });
});
