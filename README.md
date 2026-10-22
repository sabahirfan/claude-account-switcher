# Claude Account Switcher

Switch the Claude Code account from the VS Code status bar, or with `ccswitch` in a terminal. macOS only.

## How it works
Claude Code keeps one login: the tokens are in the Keychain item `Claude Code-credentials`, and the account details are in `~/.claude.json` → `oauthAccount`. This tool saves each account's login and copies the one you pick into those two places.

- Saved tokens are in the Keychain under the service `claude-account-switcher`, one item per account.
- `~/.claude-account-switcher/accounts.json` (mode 0600) holds only emails, org names and the `oauthAccount` details shown in the list. It has no tokens.
- Before switching away from an account, its current login is saved again, because refresh tokens rotate while an account is in use.
- A switch also drops a few per-account caches from `~/.claude.json` (model access, usage, and so on) so Claude Code refetches them. Projects, MCP servers, history, memory, settings and plugins are shared by all accounts.

## Install
```sh
npm install
npm run install-local   # builds, installs the .vsix into VS Code, links /usr/local/bin/ccswitch
```
Then run **Developer: Reload Window** in VS Code.

## Use
**VS Code**: click the account in the status bar (bottom right). Pick an account to switch, then choose **Reload now**. The list also has **Add new account…**, **Save … to the list** (shown when the signed-in account isn't saved yet) and **Remove account…**. The same actions are in the Command Palette under *Claude Accounts*.

**Terminal**:
```
ccswitch                 list (* = signed in)
ccswitch switch 2        or: ccswitch switch someone@example.com
ccswitch save            save the signed-in account
ccswitch add             save the current account, then sign in to another one
ccswitch remove 2
ccswitch current
```

**Adding an account**: *Add new account…* saves the current account, then opens a terminal running `claude auth login` with the bundled binary. Sign in with the other account in the browser. It is saved and becomes active when sign-in finishes.

## Things to know
- **Reload after switching.** A running Claude session keeps the account it started with. Reload every VS Code window and restart `claude` in terminals. Until then, an old session can refresh its token and write the old account back into the Keychain. The status bar then shows ⚠, and you can switch again to fix it.
- **Two orgs, one email.** Accounts are keyed by account + organization, so the same email in a personal org and a team org shows as two entries. In the CLI, pick them by number.
- **Removing** an account only forgets it here. It doesn't sign you out or revoke anything.
- **Expired logins.** If a saved account hasn't been used for a long time, its refresh token can expire. Switch to it, run *Add new account…*, sign in as that account again, and it's re-saved.

## Restore by hand
If something goes wrong, sign in again with `claude auth login`, or restore a backup:
```sh
cp /path/to/backup/claude.json ~/.claude.json
security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w "$(cat /path/to/backup/credentials.json)"
```

## Uninstall
```sh
code --uninstall-extension sabah-local.claude-account-switcher
rm /usr/local/bin/ccswitch
# forget saved logins: for each id in ~/.claude-account-switcher/accounts.json
security delete-generic-password -s claude-account-switcher -a "<id>"
rm -r ~/.claude-account-switcher
```

## Develop
`npm test` runs the unit tests (fake Keychain, temp config) and a real-Keychain test that uses a throwaway service name. `npm run typecheck`, `npm run build`.
