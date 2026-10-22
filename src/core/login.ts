import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { isMissing, writeFileAtomic } from "./fs.ts";
import type { Keychain } from "./keychain.ts";

/** Claude Code's active login: a Keychain item on macOS, a file elsewhere. */
export interface ActiveLogin {
  /** Where the login lives, for messages and `ccswitch doctor`. */
  readonly location: string;
  read(): string | null;
  write(secret: string): void;
}

/** `account` is used only when the item doesn't exist yet; an existing item keeps its account. */
export function keychainLogin(keychain: Keychain, service: string, account: string): ActiveLogin {
  return {
    location: `Keychain item "${service}"`,
    read() {
      const existing = keychain.accountOf(service);
      return existing === null ? null : keychain.read(service, existing);
    },
    write(secret) {
      keychain.write(service, keychain.accountOf(service) ?? account, secret);
    },
  };
}

export function fileLogin(path: string): ActiveLogin {
  return {
    location: path,
    read() {
      try {
        return readFileSync(path, "utf8");
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    write(secret) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileAtomic(path, secret, 0o600);
    },
  };
}
