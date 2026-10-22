import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { macKeychain, type Keychain } from "./keychain.ts";
import { fileKeychain } from "./fileStore.ts";
import { fileLogin, keychainLogin, type ActiveLogin } from "./login.ts";
import { claudePaths, type ClaudePaths } from "./paths.ts";
import { profileIsNewer, readOauthAccount, writeOauthAccount, type OAuthAccount } from "./claudeJson.ts";
import { accountId, Vault, type SavedAccount } from "./vault.ts";

export interface SwitcherOptions {
  /** Claude Code's active login. */
  login: ActiveLogin;
  /** Where saved logins are kept. */
  secrets: Keychain;
  claudeJsonPath: string;
  vaultDir: string;
  vaultService?: string;
  /** Running Claude Code processes other than this one. */
  claudeProcesses?: () => number[];
}

export interface Current {
  id: string;
  email: string;
  orgName: string;
  /** False when the active login is for a different org than ~/.claude.json says. */
  consistent: boolean;
}

export interface SwitchResult {
  from: SavedAccount | null;
  to: SavedAccount;
  warnings: string[];
}

export function defaultOptions(paths: ClaudePaths = claudePaths()): SwitcherOptions {
  const vaultDir = join(homedir(), ".claude-account-switcher");
  const keychain = process.platform === "darwin" ? macKeychain() : null;
  return {
    login: activeLogin(paths, keychain),
    secrets: keychain ?? fileKeychain(join(vaultDir, "secrets")),
    claudeJsonPath: paths.claudeJsonPath,
    vaultDir,
    claudeProcesses: runningClaudeProcesses,
  };
}

function activeLogin(paths: ClaudePaths, keychain: Keychain | null): ActiveLogin {
  // On macOS Claude Code uses the Keychain, and falls back to the file only when the Keychain fails.
  if (keychain && (keychain.accountOf(paths.keychainService) !== null || !existsSync(paths.credentialsFile))) {
    return keychainLogin(keychain, paths.keychainService, paths.keychainAccount);
  }
  return fileLogin(paths.credentialsFile);
}

export class Switcher {
  readonly vault: Vault;
  private opts: SwitcherOptions;

  constructor(opts: SwitcherOptions) {
    this.opts = opts;
    this.vault = new Vault(opts.secrets, opts.vaultDir, opts.vaultService);
  }

  get loginLocation(): string {
    return this.opts.login.location;
  }

  private oauthAccount(): OAuthAccount | null {
    return readOauthAccount(this.opts.claudeJsonPath);
  }

  /** The raw credentials JSON of the active login. */
  activeSecret(): string | null {
    return this.opts.login.read();
  }

  /** Also brings the saved details of the signed-in account up to date. */
  current(): Current | null {
    const acct = this.oauthAccount();
    if (!acct) return null;
    const id = accountId(acct);
    const saved = this.vault.get(id);
    if (saved && profileIsNewer(acct, saved.oauthAccount)) this.vault.updateProfile(acct);
    return {
      id,
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

  /** Store the active login in the vault. Refuses when the login and ~/.claude.json disagree. */
  saveCurrent(): SavedAccount {
    const acct = this.oauthAccount();
    if (!acct) throw new Error(`Not signed in to Claude Code (no oauthAccount in ${this.opts.claudeJsonPath})`);
    const secret = this.activeSecret();
    if (!secret) throw new Error(`No Claude Code login found (${this.opts.login.location})`);
    checkLoginFormat(secret, this.opts.login.location);
    if (!slotMatches(secret, acct)) {
      throw new Error(
        `The active Claude Code login belongs to a different organization than ${acct.emailAddress}. ` +
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
    if (!secret) throw new Error(`The saved login for ${target.email} is missing; add the account again`);
    checkLoginFormat(secret, `the saved login for ${target.email}`);

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

    this.opts.login.write(secret);
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

/** Refuse to save or restore a login whose shape this version doesn't know. */
function checkLoginFormat(secret: string, where: string): void {
  let parsed: { claudeAiOauth?: unknown } | null = null;
  try {
    parsed = JSON.parse(secret);
  } catch {
    // Reported below.
  }
  if (!parsed || typeof parsed.claudeAiOauth !== "object" || parsed.claudeAiOauth === null) {
    throw new Error(`Unsupported Claude Code login format in ${where}; this version of the switcher may be out of date`);
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
  if (process.platform === "win32") {
    const res = spawnSync("tasklist", ["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq claude.exe"], { encoding: "utf8" });
    if (res.status !== 0) return [];
    return res.stdout
      .split(/\r?\n/)
      .map((line) => /^"claude\.exe","(\d+)"/i.exec(line))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
      .filter((pid) => pid !== process.pid);
  }
  const res = spawnSync("/bin/ps", ["-axo", "pid=,comm="], { encoding: "utf8" });
  if (res.status !== 0) return [];
  return res.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && basename(m[2].trim()) === "claude")
    .map((m) => Number(m[1]))
    .filter((pid) => pid !== process.pid);
}

const EDITOR_EXTENSION_DIRS = [".vscode", ".vscode-insiders", ".cursor", ".windsurf", ".vscode-oss"];

/**
 * The claude binary bundled with the Claude Code extension: the one at `extensionPath` if given,
 * else the newest install across VS Code, Insiders, Cursor, Windsurf and VSCodium; else `claude` from PATH.
 */
export function claudeBinary(extensionPath?: string): string {
  const bundled = (dir: string) =>
    join(dir, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude");
  if (extensionPath && existsSync(bundled(extensionPath))) return bundled(extensionPath);

  const installs: string[] = [];
  for (const editor of EDITOR_EXTENSION_DIRS) {
    const extDir = join(homedir(), editor, "extensions");
    if (!existsSync(extDir)) continue;
    for (const d of readdirSync(extDir)) {
      if (d.startsWith("anthropic.claude-code-")) installs.push(join(extDir, d));
    }
  }
  installs.sort((a, b) => basename(b).localeCompare(basename(a), undefined, { numeric: true }));
  return installs.map(bundled).find((bin) => existsSync(bin)) ?? "claude";
}
