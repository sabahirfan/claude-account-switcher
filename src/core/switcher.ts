import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { macKeychain, type Keychain } from "./keychain.ts";
import { readOauthAccount, writeOauthAccount, type OAuthAccount } from "./claudeJson.ts";
import { accountId, Vault, type SavedAccount } from "./vault.ts";

/** Claude Code's active login slot. */
export const ACTIVE_SERVICE = "Claude Code-credentials";

export interface SwitcherOptions {
  keychain: Keychain;
  claudeJsonPath: string;
  vaultDir: string;
  activeService?: string;
  vaultService?: string;
  /** Running Claude Code processes other than this one. */
  claudeProcesses?: () => number[];
}

export interface Current {
  id: string;
  email: string;
  orgName: string;
  /** False when the Keychain slot holds a login for a different org than ~/.claude.json says. */
  consistent: boolean;
}

export interface SwitchResult {
  from: SavedAccount | null;
  to: SavedAccount;
  warnings: string[];
}

export function defaultOptions(): SwitcherOptions {
  return {
    keychain: macKeychain(),
    claudeJsonPath: join(homedir(), ".claude.json"),
    vaultDir: join(homedir(), ".claude-account-switcher"),
    claudeProcesses: runningClaudeProcesses,
  };
}

export class Switcher {
  readonly vault: Vault;
  private opts: SwitcherOptions;
  private keychain: Keychain;
  private activeService: string;

  constructor(opts: SwitcherOptions) {
    this.opts = opts;
    this.keychain = opts.keychain;
    this.activeService = opts.activeService ?? ACTIVE_SERVICE;
    this.vault = new Vault(opts.keychain, opts.vaultDir, opts.vaultService);
  }

  private oauthAccount(): OAuthAccount | null {
    return readOauthAccount(this.opts.claudeJsonPath);
  }

  /** The raw credentials JSON in the active slot. */
  activeSecret(): string | null {
    const account = this.keychain.accountOf(this.activeService);
    return account === null ? null : this.keychain.read(this.activeService, account);
  }

  current(): Current | null {
    const acct = this.oauthAccount();
    if (!acct) return null;
    return {
      id: accountId(acct),
      email: acct.emailAddress,
      orgName: acct.organizationName ?? "",
      consistent: slotMatches(this.activeSecret(), acct),
    };
  }

  list(): (SavedAccount & { active: boolean })[] {
    const activeId = this.current()?.id;
    return this.vault
      .list()
      .map((a) => ({ ...a, active: a.id === activeId }))
      .sort((a, b) => a.email.localeCompare(b.email) || a.orgName.localeCompare(b.orgName));
  }

  /** Store the active login in the vault. Refuses when the slot and ~/.claude.json disagree. */
  saveCurrent(): SavedAccount {
    const acct = this.oauthAccount();
    if (!acct) throw new Error("Not signed in to Claude Code (no oauthAccount in ~/.claude.json)");
    const secret = this.activeSecret();
    if (!secret) throw new Error(`No "${this.activeService}" item in the Keychain`);
    if (!slotMatches(secret, acct)) {
      throw new Error(
        `The active Keychain login belongs to a different organization than ${acct.emailAddress}. ` +
          "Restart running Claude sessions, sign in again, then save.",
      );
    }
    return this.vault.save(acct, secret);
  }

  /** Find a saved account by id, email, or 1-based position in list(). */
  resolve(query: string): SavedAccount {
    const accounts = this.list();
    const byIndex = /^\d+$/.test(query) ? accounts[Number(query) - 1] : undefined;
    if (byIndex) return byIndex;
    const byId = accounts.find((a) => a.id === query);
    if (byId) return byId;
    const byEmail = accounts.filter((a) => a.email.toLowerCase() === query.toLowerCase());
    if (byEmail.length === 1) return byEmail[0];
    if (byEmail.length > 1) {
      throw new Error(`${query} is saved for several organizations; use the number from \`ccswitch list\``);
    }
    throw new Error(`No saved account matches "${query}"`);
  }

  switchTo(id: string): SwitchResult {
    const target = this.vault.get(id);
    if (!target) throw new Error(`No saved account with id ${id}`);
    const secret = this.vault.secret(id);
    if (!secret) throw new Error(`The saved login for ${target.email} is missing from the Keychain; add it again`);

    const warnings: string[] = [];
    let from: SavedAccount | null = null;
    const cur = this.current();
    if (cur?.id === id) return { from: target, to: target, warnings };

    // Refresh tokens rotate while an account is in use, so save the outgoing login first.
    if (cur) {
      try {
        from = this.saveCurrent();
      } catch (e) {
        warnings.push(`Could not save ${cur.email} before switching: ${(e as Error).message}`);
      }
    }

    const slotAccount = this.keychain.accountOf(this.activeService) ?? process.env.USER ?? "claude";
    this.keychain.write(this.activeService, slotAccount, secret);
    writeOauthAccount(this.opts.claudeJsonPath, target.oauthAccount);

    const others = this.opts.claudeProcesses?.() ?? [];
    if (others.length) {
      warnings.push(
        `${others.length} Claude process${others.length === 1 ? " is" : "es are"} still running (pid ${others.join(", ")}). ` +
          "Restart those sessions; until then they use the old account and can write it back when their token refreshes.",
      );
    }
    return { from, to: target, warnings };
  }

  remove(id: string): boolean {
    return this.vault.remove(id);
  }
}

function slotMatches(secret: string | null, acct: OAuthAccount): boolean {
  if (!secret) return false;
  try {
    const org = JSON.parse(secret)?.organizationUuid;
    return !org || org === acct.organizationUuid;
  } catch {
    return false;
  }
}

/** PIDs of running `claude` executables other than this process. */
export function runningClaudeProcesses(): number[] {
  const res = spawnSync("/bin/ps", ["-axo", "pid=,comm="], { encoding: "utf8" });
  if (res.status !== 0) return [];
  return res.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && basename(m[2].trim()) === "claude")
    .map((m) => Number(m[1]))
    .filter((pid) => pid !== process.pid);
}

/** Newest VS Code extension's bundled claude binary, else `claude` from PATH. */
export function claudeBinary(): string {
  const extDir = join(homedir(), ".vscode", "extensions");
  if (existsSync(extDir)) {
    const versions = readdirSync(extDir)
      .filter((d) => d.startsWith("anthropic.claude-code-"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse();
    for (const d of versions) {
      const bin = join(extDir, d, "resources", "native-binary", "claude");
      if (existsSync(bin)) return bin;
    }
  }
  return "claude";
}
