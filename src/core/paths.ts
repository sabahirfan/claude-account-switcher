import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

/** Claude Code's login slot name when no custom config dir is set. */
export const ACTIVE_SERVICE = "Claude Code-credentials";

/** Where Claude Code keeps its login, worked out the same way Claude Code does (checked against 2.1.308). */
export interface ClaudePaths {
  configDir: string;
  claudeJsonPath: string;
  /** The login on Linux and Windows, and on macOS when the Keychain can't be used. */
  credentialsFile: string;
  keychainService: string;
  keychainAccount: string;
}

type Env = Record<string, string | undefined>;

export function claudePaths(env: Env = process.env, home = homedir()): ClaudePaths {
  const configDir = (env.CLAUDE_CONFIG_DIR || join(home, ".claude")).normalize("NFC");
  return {
    configDir,
    claudeJsonPath: join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"),
    credentialsFile: join(configDir, ".credentials.json"),
    keychainService: ACTIVE_SERVICE + keychainSuffix(env, configDir),
    keychainAccount: keychainAccount(env),
  };
}

/** A custom config dir gets its own Keychain item, named after a hash of the dir. */
function keychainSuffix(env: Env, configDir: string): string {
  const secure = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const dir = secure !== undefined ? secure.normalize("NFC") : env.CLAUDE_CONFIG_DIR ? configDir : "";
  return dir ? `-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}` : "";
}

function keychainAccount(env: Env): string {
  let name: string;
  try {
    name = env.USER || userInfo().username;
  } catch {
    return "claude-code-user";
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
}
