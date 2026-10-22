import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileKeychain } from "../src/core/fileStore.ts";
import { fileLogin } from "../src/core/login.ts";

const posix = process.platform !== "win32";

describe("fileKeychain", () => {
  it("writes, overwrites, reads and removes items with file-name-safe names", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccswitch-store-"));
    const kc = fileKeychain(dir);
    const id = "a-1:org-a";
    assert.equal(kc.read("svc", id), null);
    assert.equal(kc.accountOf("svc"), null);
    kc.write("svc", id, '{"x":1}');
    kc.write("svc", id, '{"x":2}');
    assert.equal(kc.read("svc", id), '{"x":2}');
    assert.equal(kc.accountOf("svc"), id);
    assert.deepEqual(readdirSync(join(dir, "svc")), ["a-1%3Aorg-a.json"]);
    if (posix) {
      assert.equal(statSync(join(dir, "svc")).mode & 0o777, 0o700);
      assert.equal(statSync(join(dir, "svc", "a-1%3Aorg-a.json")).mode & 0o777, 0o600);
    }
    assert.ok(kc.remove("svc", id));
    assert.equal(kc.remove("svc", id), false);
    assert.equal(kc.read("svc", id), null);
  });
});

describe("fileLogin", () => {
  it("reads nothing before sign-in and creates the file with mode 0600", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ccswitch-login-")), "new-dir", ".credentials.json");
    const login = fileLogin(path);
    assert.equal(login.read(), null);
    login.write("{}");
    assert.equal(login.read(), "{}");
    if (posix) assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});
