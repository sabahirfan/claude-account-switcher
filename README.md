# ccswitch: Accounts for Claude Code

Switch between your Claude Code accounts from the VS Code status bar, or with `ccswitch` in a terminal. Works on macOS, Linux and Windows, in VS Code, Cursor, Windsurf and VSCodium.

*This is a community tool. It is not made, endorsed or supported by Anthropic.*

## What it does
Claude Code keeps one login at a time. This tool keeps a copy of each account's login and puts the one you pick back in place, so you don't have to sign out and sign in again.

- Click the account in the status bar to switch, add, save or remove an account.
- `ccswitch` does the same from a terminal.
- Each account is identified by account and organization, so the same email in a personal and a team org shows up as two entries.
- Nothing is sent anywhere. The tool makes no network requests and has no telemetry.

## Install
- **VS Code**: search for *ccswitch* in Extensions, or `code --install-extension sabahirfan.account-switcher-for-claude-code`.
- **Cursor, Windsurf, VSCodium**: the same extension is on [Open VSX](https://open-vsx.org/extension/sabahirfan/account-switcher-for-claude-code).
- **Terminal only**: `npm install -g account-switcher-for-claude-code` installs the `ccswitch` command (Node 20 or newer).

If you use Remote SSH, WSL or a dev container, install the extension in the remote window as well. Claude Code runs there and keeps its login there.

## Use
**VS Code**: click the account in the status bar (bottom right). Pick an account to switch to it, then choose **Reload now**. The list also has **Add new account…**, **Save … to the list** (shown when the signed-in account isn't saved yet) and **Remove account…**. The same actions, plus **Diagnose**, are in the Command Palette under *Claude Accounts*.

**Terminal**:
```
ccswitch                 list (* = signed in)
ccswitch switch 2        or: ccswitch switch someone@example.com
ccswitch save            save the signed-in account
ccswitch add             save the current account, then sign in to another one
ccswitch remove 2
ccswitch current
ccswitch doctor          show where logins are kept and check them (prints no secrets)
```

**Adding an account**: *Add new account…* saves the current account, then opens a terminal running `claude auth login`. Sign in with the other account in the browser. It is saved and becomes active when sign-in finishes.

## Where your logins are kept
The tool stores logins the same way Claude Code does on each system. It doesn't add a weaker copy anywhere.

| | Claude Code's active login | Saved logins |
|---|---|---|
| macOS | Keychain item `Claude Code-credentials` | Keychain, service `claude-account-switcher`, one item per account |
| Linux, Windows | `~/.claude/.credentials.json` | `~/.claude-account-switcher/secrets/`, one file per account (folder 0700, files 0600) |

`~/.claude-account-switcher/accounts.json` (mode 0600) lists the saved accounts: emails, org names and the account details Claude Code shows. It contains no tokens.

A switch writes the chosen login into Claude Code's slot and its account details into `~/.claude.json` → `oauthAccount`. It also drops a few per-account caches from that file (model access, usage and so on) so that Claude Code fetches them again. Projects, MCP servers, history, memory, settings and plugins are shared by all accounts.

If you set `CLAUDE_CONFIG_DIR`, the tool follows it the way Claude Code does. The VS Code extension sees the environment VS Code was started with, so start VS Code from a shell that sets the same `CLAUDE_CONFIG_DIR` as your terminal. **Diagnose** shows which paths are in use.

## Things to know
- **Reload after switching.** A running Claude session keeps the account it started with. Reload each VS Code window (other windows ask you) and restart `claude` in terminals. Until you do, an old session can refresh its token and write the old account back. The status bar then shows ⚠, and switching again fixes it.
- **Removing** an account only forgets it here. It doesn't sign you out or revoke anything.
- **Expired logins.** A saved login that isn't used for a long time can expire. `ccswitch doctor` shows how long each one has left. To renew one, switch to it, run *Add new account…* and sign in as that account again.
- **Claude Code updates.** The tool reads Claude Code's login files, and their format is not a public interface. If a Claude Code update changes the format, the tool refuses to save or switch instead of guessing. Update the extension when that happens.

## Restore by hand
If something goes wrong, run `claude auth login` to sign in again. Or put back a copy you made:
```sh
cp /path/to/backup/claude.json ~/.claude.json
# macOS
security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w "$(cat /path/to/backup/credentials.json)"
# Linux / Windows (Git Bash)
cp /path/to/backup/credentials.json ~/.claude/.credentials.json
```

## Uninstall
Uninstall the extension from the Extensions view, and run `npm uninstall -g account-switcher-for-claude-code` if you installed the CLI. To forget all saved logins:
```sh
# macOS: for each id in ~/.claude-account-switcher/accounts.json
security delete-generic-password -s claude-account-switcher -a "<id>"
# all systems
rm -r ~/.claude-account-switcher
```

## Develop
```sh
npm install
npm test            # unit tests; on macOS also a real-Keychain test with a throwaway service name
npm run typecheck
npm run install-local   # macOS: build, install the .vsix into VS Code, link /usr/local/bin/ccswitch
npm run pack-npm        # lay out the npm package in dist/npm
```
Releases are published by pushing a `v*` tag; see `.github/workflows/release.yml`.
