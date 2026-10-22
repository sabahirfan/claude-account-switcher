import { existsSync } from "node:fs";
import type { ClaudePaths } from "./paths.ts";
import { runningClaudeProcesses, type Switcher } from "./switcher.ts";

const DAY = 24 * 60 * 60 * 1000;

/** Where everything is and whether it looks right. Never includes a secret. */
export function diagnose(sw: Switcher, paths: ClaudePaths, claudeBinary: string): string[] {
  const lines: string[] = [];
  const check = (good: boolean, text: string) => lines.push(`${good ? "ok" : "!!"}  ${text}`);

  lines.push(`    platform: ${process.platform}`);
  lines.push(`    Claude config dir: ${paths.configDir}${process.env.CLAUDE_CONFIG_DIR ? " (from CLAUDE_CONFIG_DIR)" : ""}`);
  check(existsSync(paths.claudeJsonPath), `config file: ${paths.claudeJsonPath}`);

  const cur = sw.current();
  check(!!cur, cur ? `signed in as ${cur.email}${cur.orgName ? ` (${cur.orgName})` : ""}` : "not signed in (no oauthAccount)");

  const secret = sw.activeSecret();
  check(!!secret, `active login: ${sw.loginLocation}${secret ? "" : " (not found)"}`);
  if (secret) {
    const info = loginInfo(secret);
    check(info.known, info.known ? "login format recognized" : "login format not recognized; saving and switching are disabled");
    if (cur) {
      check(
        cur.consistent,
        cur.consistent
          ? "login matches the signed-in organization"
          : "login belongs to another organization; restart Claude sessions, then switch again",
      );
    }
  }

  const accounts = sw.list();
  lines.push(`    saved accounts: ${accounts.length}`);
  for (const a of accounts) {
    const saved = sw.vault.secret(a.id);
    const info = saved ? loginInfo(saved) : null;
    const expiry = info?.refreshExpiresAt ? `, ${expiresIn(info.refreshExpiresAt)}` : "";
    check(!!info?.known, `  ${a.active ? "*" : " "} ${a.email}${a.orgName ? ` (${a.orgName})` : ""}: ${saved ? "saved login present" : "saved login missing"}${expiry}`);
  }

  lines.push(`    claude binary: ${claudeBinary}`);
  const procs = runningClaudeProcesses();
  lines.push(`    running Claude processes: ${procs.length ? procs.join(", ") : "none"}`);
  return lines;
}

function loginInfo(secret: string): { known: boolean; refreshExpiresAt?: number } {
  try {
    const oauth = JSON.parse(secret)?.claudeAiOauth;
    if (typeof oauth !== "object" || oauth === null) return { known: false };
    const at = oauth.refreshTokenExpiresAt;
    return { known: true, refreshExpiresAt: typeof at === "number" ? at : undefined };
  } catch {
    return { known: false };
  }
}

function expiresIn(at: number): string {
  const days = Math.floor((at - Date.now()) / DAY);
  if (days < 0) return "sign-in expired; sign in to it again";
  return `sign-in good for ${days} more day${days === 1 ? "" : "s"}`;
}
