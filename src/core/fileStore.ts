import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isMissing, writeFileAtomic } from "./fs.ts";
import type { Keychain } from "./keychain.ts";

// Ids look like "uuid:uuid", and ":" can't be in a Windows file name.
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Keychain stand-in for Linux and Windows: one file per item, mode 0600, in a 0700 folder.
 * That is the same protection Claude Code gives its own login on those systems.
 */
export function fileKeychain(dir: string): Keychain {
  const folder = (service: string) => join(dir, encode(service));
  const file = (service: string, account: string) => join(folder(service), `${encode(account)}.json`);
  return {
    read(service, account) {
      try {
        return readFileSync(file(service, account), "utf8");
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },

    write(service, account, secret) {
      mkdirSync(folder(service), { recursive: true, mode: 0o700 });
      writeFileAtomic(file(service, account), secret, 0o600);
    },

    remove(service, account) {
      try {
        unlinkSync(file(service, account));
        return true;
      } catch (e) {
        if (isMissing(e)) return false;
        throw e;
      }
    },

    accountOf(service) {
      let names: string[];
      try {
        names = readdirSync(folder(service));
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
      const name = names.find((n) => n.endsWith(".json"));
      return name ? decodeURIComponent(name.slice(0, -".json".length)) : null;
    },
  };
}
