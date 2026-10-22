import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { memoryKeychain } from "../src/core/keychain.ts";
import { ACCOUNT_CACHE_KEYS } from "../src/core/claudeJson.ts";
import { ACTIVE_SERVICE, Switcher } from "../src/core/switcher.ts";
import { VAULT_SERVICE } from "../src/core/vault.ts";

const alice = { accountUuid: "a-1", emailAddress: "alice@example.com", organizationUuid: "org-a", organizationName: "Alice" };
const bob = { accountUuid: "b-1", emailAddress: "bob@example.com", organizationUuid: "org-b", organizationName: "Bob Ltd" };
const creds = (org: string, token: string) =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: `r-${token}`, subscriptionType: "pro" }, organizationUuid: org });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ccswitch-test-"));
  const claudeJsonPath = join(dir, "claude.json");
  const config = {
    numStartups: 3,
    projects: { "/x": { allowedTools: [] } },
    oauthAccount: alice,
    modelAccessCache: { foo: 1 },
    cachedUsageUtilization: 0.5,
  };
  writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
  chmodSync(claudeJsonPath, 0o644);
  const keychain = memoryKeychain();
  keychain.write(ACTIVE_SERVICE, "sabah", creds("org-a", "alice-1"));
  let procs: number[] = [];
  const sw = new Switcher({ keychain, claudeJsonPath, vaultDir: join(dir, "vault"), claudeProcesses: () => procs });
  return { dir, claudeJsonPath, keychain, sw, setProcs: (p: number[]) => (procs = p) };
}

/** Pretend `claude auth login` signed in as `who`. */
function signIn(ctx: ReturnType<typeof setup>, who: typeof bob, secret: string) {
  ctx.keychain.write(ACTIVE_SERVICE, "sabah", secret);
  const data = JSON.parse(readFileSync(ctx.claudeJsonPath, "utf8"));
  data.oauthAccount = who;
  writeFileSync(ctx.claudeJsonPath, JSON.stringify(data, null, 2));
}

describe("Switcher", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));

  it("reports the signed-in account", () => {
    assert.deepEqual(ctx.sw.current(), { id: "a-1:org-a", email: "alice@example.com", orgName: "Alice", consistent: true });
  });

  it("saves the current login to the vault with the secret in the keychain only", () => {
    const saved = ctx.sw.saveCurrent();
    assert.equal(saved.id, "a-1:org-a");
    assert.equal(saved.subscriptionType, "pro");
    assert.equal(ctx.keychain.read(VAULT_SERVICE, "a-1:org-a"), creds("org-a", "alice-1"));
    const index = readFileSync(join(ctx.dir, "vault", "accounts.json"), "utf8");
    assert.ok(!index.includes("alice-1"), "index file must not contain tokens");
    assert.equal(statSync(join(ctx.dir, "vault", "accounts.json")).mode & 0o777, 0o600);
  });

  it("switches both the keychain slot and oauthAccount, leaving other config untouched", () => {
    ctx.sw.saveCurrent();
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.sw.saveCurrent();

    const { from, to, warnings } = ctx.sw.switchTo("a-1:org-a");
    assert.equal(from?.email, "bob@example.com");
    assert.equal(to.email, "alice@example.com");
    assert.deepEqual(warnings, []);
    assert.equal(ctx.keychain.read(ACTIVE_SERVICE, "sabah"), creds("org-a", "alice-1"));

    const data = JSON.parse(readFileSync(ctx.claudeJsonPath, "utf8"));
    assert.deepEqual(data.oauthAccount, alice);
    assert.equal(data.numStartups, 3);
    assert.deepEqual(data.projects, { "/x": { allowedTools: [] } });
    for (const key of ACCOUNT_CACHE_KEYS) assert.ok(!(key in data), `${key} should be dropped`);
    assert.equal(statSync(ctx.claudeJsonPath).mode & 0o777, 0o644);
  });

  it("saves the outgoing login first so rotated refresh tokens are kept", () => {
    ctx.sw.saveCurrent();
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.sw.saveCurrent();
    ctx.sw.switchTo("a-1:org-a");
    // Alice's token rotated while she was active.
    ctx.keychain.write(ACTIVE_SERVICE, "sabah", creds("org-a", "alice-2"));
    ctx.sw.switchTo("b-1:org-b");
    assert.equal(ctx.keychain.read(VAULT_SERVICE, "a-1:org-a"), creds("org-a", "alice-2"));
    ctx.sw.switchTo("a-1:org-a");
    assert.equal(ctx.keychain.read(ACTIVE_SERVICE, "sabah"), creds("org-a", "alice-2"));
  });

  it("saves an unsaved current account automatically when switching away", () => {
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.sw.saveCurrent();
    signIn(ctx, alice, creds("org-a", "alice-1"));
    ctx.sw.switchTo("b-1:org-b");
    assert.deepEqual(ctx.sw.list().map((a) => [a.email, a.active]), [
      ["alice@example.com", false],
      ["bob@example.com", true],
    ]);
  });

  it("refuses to save when the slot belongs to another org, and still switches with a warning", () => {
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.sw.saveCurrent();
    ctx.sw.switchTo("b-1:org-b");
    // A stale process refreshed and wrote Alice's token back into the slot.
    ctx.keychain.write(ACTIVE_SERVICE, "sabah", creds("org-a", "alice-9"));
    assert.equal(ctx.sw.current()?.consistent, false);
    assert.throws(() => ctx.sw.saveCurrent(), /different organization/);
    assert.equal(ctx.keychain.read(VAULT_SERVICE, "b-1:org-b"), creds("org-b", "bob-1"));

    ctx.sw.vault.save(alice, creds("org-a", "alice-1"));
    const { warnings } = ctx.sw.switchTo("a-1:org-a");
    assert.match(warnings[0], /Could not save bob@example.com/);
  });

  it("warns about other running Claude processes", () => {
    ctx.sw.saveCurrent();
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.setProcs([111, 222]);
    const { warnings } = ctx.sw.switchTo("a-1:org-a");
    assert.match(warnings.at(-1)!, /2 Claude processes are still running \(pid 111, 222\)/);
  });

  it("is a no-op when switching to the active account", () => {
    ctx.sw.saveCurrent();
    const before = readFileSync(ctx.claudeJsonPath, "utf8");
    const { from, to } = ctx.sw.switchTo("a-1:org-a");
    assert.equal(from?.id, to.id);
    assert.equal(readFileSync(ctx.claudeJsonPath, "utf8"), before);
  });

  it("resolves accounts by number, email and id", () => {
    ctx.sw.saveCurrent();
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.sw.saveCurrent();
    assert.equal(ctx.sw.resolve("2").email, "bob@example.com");
    assert.equal(ctx.sw.resolve("ALICE@example.com").id, "a-1:org-a");
    assert.equal(ctx.sw.resolve("b-1:org-b").email, "bob@example.com");
    assert.throws(() => ctx.sw.resolve("nobody@example.com"), /No saved account/);
  });

  it("asks for a number when one email is saved for two orgs", () => {
    ctx.sw.saveCurrent();
    const aliceTeam = { ...alice, organizationUuid: "org-t", organizationName: "Team" };
    signIn(ctx, aliceTeam, creds("org-t", "alice-t"));
    ctx.sw.saveCurrent();
    assert.throws(() => ctx.sw.resolve("alice@example.com"), /several organizations/);
  });

  it("removes an account from the index and the keychain, leaving the active login alone", () => {
    ctx.sw.saveCurrent();
    assert.ok(ctx.sw.remove("a-1:org-a"));
    assert.deepEqual(ctx.sw.list(), []);
    assert.equal(ctx.keychain.read(VAULT_SERVICE, "a-1:org-a"), null);
    assert.equal(ctx.keychain.read(ACTIVE_SERVICE, "sabah"), creds("org-a", "alice-1"));
    assert.equal(ctx.sw.current()?.email, "alice@example.com");
  });

  it("fails clearly when a saved secret is missing", () => {
    ctx.sw.saveCurrent();
    signIn(ctx, bob, creds("org-b", "bob-1"));
    ctx.keychain.remove(VAULT_SERVICE, "a-1:org-a");
    assert.throws(() => ctx.sw.switchTo("a-1:org-a"), /missing from the Keychain/);
    assert.equal(ctx.keychain.read(ACTIVE_SERVICE, "sabah"), creds("org-b", "bob-1"));
  });
});
