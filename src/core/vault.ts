import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Keychain } from "./keychain.ts";
import type { OAuthAccount } from "./claudeJson.ts";

export const VAULT_SERVICE = "claude-account-switcher";

export interface SavedAccount {
  /** `${accountUuid}:${organizationUuid}` — one person can sign in to several orgs with the same email. */
  id: string;
  email: string;
  orgName: string;
  subscriptionType?: string;
  oauthAccount: OAuthAccount;
  savedAt: string;
}

interface IndexFile {
  version: 1;
  accounts: SavedAccount[];
}

export function accountId(acct: Pick<OAuthAccount, "accountUuid" | "organizationUuid">): string {
  return `${acct.accountUuid}:${acct.organizationUuid}`;
}

/**
 * Saved logins. Secrets live in the Keychain under VAULT_SERVICE; the index file holds only
 * the non-secret account details shown in the list.
 */
export class Vault {
  private keychain: Keychain;
  private dir: string;
  private service: string;

  constructor(keychain: Keychain, dir: string, service = VAULT_SERVICE) {
    this.keychain = keychain;
    this.dir = dir;
    this.service = service;
  }

  private get indexPath() {
    return join(this.dir, "accounts.json");
  }

  list(): SavedAccount[] {
    if (!existsSync(this.indexPath)) return [];
    return (JSON.parse(readFileSync(this.indexPath, "utf8")) as IndexFile).accounts;
  }

  private writeIndex(accounts: SavedAccount[]) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.indexPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, accounts } satisfies IndexFile, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, this.indexPath);
  }

  get(id: string): SavedAccount | undefined {
    return this.list().find((a) => a.id === id);
  }

  secret(id: string): string | null {
    return this.keychain.read(this.service, id);
  }

  save(oauthAccount: OAuthAccount, credentials: string): SavedAccount {
    const id = accountId(oauthAccount);
    this.keychain.write(this.service, id, credentials);
    const entry: SavedAccount = {
      id,
      email: oauthAccount.emailAddress,
      orgName: oauthAccount.organizationName ?? "",
      subscriptionType: subscriptionOf(credentials),
      oauthAccount,
      savedAt: new Date().toISOString(),
    };
    const rest = this.list().filter((a) => a.id !== id);
    this.writeIndex([...rest, entry]);
    return entry;
  }

  remove(id: string): boolean {
    const before = this.list();
    const after = before.filter((a) => a.id !== id);
    const removedSecret = this.keychain.remove(this.service, id);
    if (after.length !== before.length) this.writeIndex(after);
    return removedSecret || after.length !== before.length;
  }
}

function subscriptionOf(credentials: string): string | undefined {
  try {
    return JSON.parse(credentials)?.claudeAiOauth?.subscriptionType ?? undefined;
  } catch {
    return undefined;
  }
}
