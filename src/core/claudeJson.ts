import { readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "./fs.ts";

/** The part of ~/.claude.json → oauthAccount the switcher relies on; the rest is kept as-is. */
export interface OAuthAccount {
  accountUuid: string;
  emailAddress: string;
  organizationUuid: string;
  organizationName?: string;
  displayName?: string;
  [key: string]: unknown;
}

/** Caches Claude Code fills per account; dropped on a switch so they refetch for the new one. */
export const ACCOUNT_CACHE_KEYS = [
  "modelAccessCache",
  "orgModelDefaultCache",
  "cachedUsageUtilization",
  "overageCreditGrantCache",
  "passesEligibilityCache",
  "s1mAccessCache",
  "cachedExtraUsageDisabledReason",
  "additionalModelOptionsCache",
  "additionalModelCostsCache",
];

function load(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readOauthAccount(path: string): OAuthAccount | null {
  let data: Record<string, unknown>;
  try {
    data = load(path);
  } catch {
    return null;
  }
  const acct = data.oauthAccount as OAuthAccount | undefined;
  return acct && acct.accountUuid && acct.organizationUuid ? acct : null;
}

/** Replace oauthAccount and drop the account caches, writing atomically with Claude Code's formatting. */
export function writeOauthAccount(path: string, account: OAuthAccount): void {
  const data = load(path);
  data.oauthAccount = account;
  for (const key of ACCOUNT_CACHE_KEYS) delete data[key];
  writeFileAtomic(path, JSON.stringify(data, null, 2), statSync(path).mode & 0o777);
}

/**
 * Claude Code fills in parts of oauthAccount (org name, role, rate-limit tier) a moment after
 * sign-in, and refetches the profile now and then. True when `live` has news that `saved` lacks.
 */
export function profileIsNewer(live: OAuthAccount, saved: OAuthAccount): boolean {
  const fetchedAt = (a: OAuthAccount) => (typeof a.profileFetchedAt === "number" ? a.profileFetchedAt : 0);
  return Object.keys(live).some((k) => !(k in saved)) || fetchedAt(live) > fetchedAt(saved);
}
