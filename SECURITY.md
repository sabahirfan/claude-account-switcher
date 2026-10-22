# Security

This tool handles Claude Code login tokens. It never sends them anywhere: it makes no network requests and has no telemetry. Where it stores them on each system is described in the README under "Where your logins are kept".

## Reporting a problem
Please report security problems privately through GitHub: **Security → Report a vulnerability** on https://github.com/sabahirfan/claude-account-switcher. Don't open a public issue for them. Include the version, your OS, and the steps to reproduce.

Never paste the output of `security find-generic-password -w`, the contents of `.credentials.json`, or any other token into an issue. `ccswitch doctor` output is safe to share, because it contains no secrets.
