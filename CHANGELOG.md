# Changelog

## 1.0.1
- Renamed to **Multi Account for Claude Code**, extension ID `sabahirfan.multi-account-for-claude-code`; the old name was taken on the VS Code Marketplace. The npm package and the `ccswitch` command keep their names.

## 1.0.0
First public release.

- Linux and Windows support: Claude Code's login file is switched there, and saved logins are kept as 0600 files.
- Follows `CLAUDE_CONFIG_DIR` and `CLAUDE_SECURESTORAGE_CONFIG_DIR` the way Claude Code does.
- Works with Claude Code installed in VS Code, Insiders, Cursor, Windsurf or VSCodium.
- Other windows offer to reload when the account changes.
- `ccswitch doctor` and **Claude Accounts: Diagnose** show where logins are kept and check them.
- Refuses to save or switch a login in a format it doesn't recognize.
- Fixed: an account added with *Add new account…* was saved without its organization name.

## 0.1.0
macOS-only version for local use.
