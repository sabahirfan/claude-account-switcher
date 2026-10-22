import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";

/** Generic-password store. The real one shells out to /usr/bin/security; tests use a Map. */
export interface Keychain {
  read(service: string, account: string): string | null;
  write(service: string, account: string, secret: string): void;
  remove(service: string, account: string): boolean;
  /** The account attribute of the first item with this service, if any. */
  accountOf(service: string): string | null;
}

const SECURITY = "/usr/bin/security";
// `security -i` reads one command per line and cuts lines at 4096 bytes.
const MAX_COMMAND_LINE = 4000;

function run(args: string[], input?: string) {
  const res = spawnSync(SECURITY, args, { input, encoding: "utf8" });
  if (res.error) throw res.error;
  return res;
}

function quoted(value: string): string {
  if (/["\\\n\r]/.test(value)) throw new Error(`Unsupported character in keychain attribute: ${value}`);
  return `"${value}"`;
}

export function macKeychain(): Keychain {
  const kc: Keychain = {
    read(service, account) {
      const res = run(["find-generic-password", "-s", service, "-a", account, "-w"]);
      if (res.status !== 0) return null;
      return res.stdout.replace(/\n$/, "");
    },

    write(service, account, secret) {
      // The secret goes in on stdin as hex, so it never shows up in a process listing.
      const hex = Buffer.from(secret, "utf8").toString("hex");
      const line = `add-generic-password -U -s ${quoted(service)} -a ${quoted(account)} -X ${hex}\n`;
      if (line.length > MAX_COMMAND_LINE) throw new Error(`Secret too large for the keychain helper (${secret.length} bytes)`);
      const res = run(["-i"], line);
      if (res.status !== 0) throw new Error(`security add-generic-password failed: ${res.stderr.trim()}`);
      if (kc.read(service, account) !== secret) throw new Error(`Keychain write to "${service}" did not read back the same value`);
    },

    remove(service, account) {
      return run(["delete-generic-password", "-s", service, "-a", account]).status === 0;
    },

    accountOf(service) {
      const res = run(["find-generic-password", "-s", service]);
      if (res.status !== 0) return null;
      const m = /"acct"<blob>="([^"]*)"/.exec(res.stdout);
      return m ? m[1] : userInfo().username;
    },
  };
  return kc;
}

export function memoryKeychain(): Keychain & { items: Map<string, string> } {
  const items = new Map<string, string>();
  const key = (s: string, a: string) => `${s}\u0000${a}`;
  return {
    items,
    read: (s, a) => items.get(key(s, a)) ?? null,
    write: (s, a, secret) => void items.set(key(s, a), secret),
    remove: (s, a) => items.delete(key(s, a)),
    accountOf(s) {
      for (const k of items.keys()) {
        const [svc, acct] = k.split("\u0000");
        if (svc === s) return acct;
      }
      return null;
    },
  };
}
