import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";
import { claudePaths } from "../src/core/paths.ts";

const home = join("/home", "sam");

describe("claudePaths", () => {
  it("uses ~/.claude.json and the plain Keychain item by default", () => {
    assert.deepEqual(claudePaths({ USER: "sam" }, home), {
      configDir: join(home, ".claude"),
      claudeJsonPath: join(home, ".claude.json"),
      credentialsFile: join(home, ".claude", ".credentials.json"),
      keychainService: "Claude Code-credentials",
      keychainAccount: "sam",
    });
  });

  it("moves everything into CLAUDE_CONFIG_DIR and names the Keychain item after its hash", () => {
    const p = claudePaths({ USER: "sam", CLAUDE_CONFIG_DIR: "/tmp/cc-config" }, home);
    assert.equal(p.configDir, "/tmp/cc-config");
    assert.equal(p.claudeJsonPath, join("/tmp/cc-config", ".claude.json"));
    assert.equal(p.credentialsFile, join("/tmp/cc-config", ".credentials.json"));
    // printf %s /tmp/cc-config | shasum -a 256 | cut -c1-8
    assert.equal(p.keychainService, "Claude Code-credentials-b57698fd");
  });

  it("lets CLAUDE_SECURESTORAGE_CONFIG_DIR pick the Keychain item, and an empty one means no suffix", () => {
    const env = { USER: "sam", CLAUDE_CONFIG_DIR: "/tmp/cc-config" };
    // printf %s /tmp/secure | shasum -a 256 | cut -c1-8
    assert.equal(claudePaths({ ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: "/tmp/secure" }, home).keychainService, "Claude Code-credentials-7f494bd1");
    assert.equal(claudePaths({ ...env, CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }, home).keychainService, "Claude Code-credentials");
  });

  it("falls back to claude-code-user for a user name Claude Code wouldn't use", () => {
    assert.equal(claudePaths({ USER: "sam smith" }, home).keychainAccount, "claude-code-user");
  });
});
