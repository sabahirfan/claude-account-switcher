import { unwatchFile, watchFile } from "node:fs";
import * as vscode from "vscode";
import { claudeBinary, defaultOptions, Switcher, type Current } from "./core/switcher.ts";
import type { SavedAccount } from "./core/vault.ts";

let sw: Switcher;
let status: vscode.StatusBarItem;
let lastId: string | undefined;
/** Set while "Add new account" waits for the sign-in terminal to change the active login. */
let pendingAdd: { fromId?: string; fromSecret: string | null; terminal: vscode.Terminal } | undefined;

function label(a: { email: string; orgName: string }) {
  return a.orgName && a.orgName !== a.email ? `${a.email} · ${a.orgName}` : a.email;
}

export function activate(context: vscode.ExtensionContext) {
  const opts = defaultOptions();
  sw = new Switcher(opts);

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "claudeAccounts.pick";
  status.show();

  const onConfigChange = () => refresh();
  watchFile(opts.claudeJsonPath, { interval: 2000 }, onConfigChange);

  context.subscriptions.push(
    status,
    { dispose: () => unwatchFile(opts.claudeJsonPath, onConfigChange) },
    vscode.window.onDidChangeWindowState((s) => s.focused && refresh()),
    vscode.window.onDidCloseTerminal((t) => {
      if (pendingAdd?.terminal === t) {
        refresh();
        pendingAdd = undefined;
      }
    }),
    vscode.commands.registerCommand("claudeAccounts.pick", pick),
    vscode.commands.registerCommand("claudeAccounts.add", addNew),
    vscode.commands.registerCommand("claudeAccounts.save", saveCurrent),
    vscode.commands.registerCommand("claudeAccounts.remove", removeAccount),
  );
  refresh();
}

export function deactivate() {}

function refresh() {
  let cur: Current | null = null;
  try {
    cur = sw.current();
  } catch {
    // Keychain or config unreadable; show signed out.
  }
  if (!cur) {
    status.text = "$(account) Claude: signed out";
    status.tooltip = "Choose a Claude account";
  } else {
    status.text = `${cur.consistent ? "$(account)" : "$(warning)"} ${cur.email}`;
    status.tooltip = cur.consistent
      ? `Claude account: ${label(cur)}\nClick to switch`
      : `Claude account: ${label(cur)}\nThe Keychain login belongs to another organization — restart Claude sessions or switch again`;
  }
  if (cur?.id !== lastId) {
    lastId = cur?.id;
    finishPendingAdd(cur);
  }
}

function finishPendingAdd(cur: Current | null) {
  if (!pendingAdd || !cur || cur.id === pendingAdd.fromId) return;
  // ~/.claude.json can change a moment before the Keychain does; wait for a new secret.
  if (sw.activeSecret() === pendingAdd.fromSecret) {
    setTimeout(refresh, 1000);
    lastId = undefined;
    return;
  }
  const terminal = pendingAdd.terminal;
  pendingAdd = undefined;
  try {
    const saved = sw.saveCurrent();
    terminal.dispose();
    promptReload(`Added ${label(saved)} and switched to it.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not save the new account: ${(e as Error).message}`);
  }
}

type PickItem = vscode.QuickPickItem & { run?: () => unknown };

async function pick() {
  let accounts: (SavedAccount & { active: boolean })[];
  try {
    accounts = sw.list();
  } catch (e) {
    vscode.window.showErrorMessage(`Claude accounts: ${(e as Error).message}`);
    return;
  }
  const cur = sw.current();
  const unsaved = cur && !accounts.some((a) => a.active);

  const items: PickItem[] = [
    ...accounts.map((a) => ({
      label: `${a.active ? "$(check)" : "$(account)"} ${a.email}`,
      description: [a.orgName, a.subscriptionType].filter(Boolean).join(" · "),
      detail: a.active ? "Signed in" : undefined,
      run: () => switchTo(a),
    })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    ...(unsaved ? [{ label: `$(save) Save ${cur!.email} to the list`, run: saveCurrent }] : []),
    { label: "$(add) Add new account…", run: addNew },
    ...(accounts.length ? [{ label: "$(trash) Remove account…", run: removeAccount }] : []),
  ];
  const choice = await vscode.window.showQuickPick(items, { placeHolder: "Switch Claude account" });
  await choice?.run?.();
}

async function switchTo(a: SavedAccount & { active: boolean }) {
  if (a.active) return;
  try {
    const { to, warnings } = sw.switchTo(a.id);
    refresh();
    // This window's own Claude processes restart on reload, so only mention the warning in the log.
    if (warnings.length) console.warn(`[claude-accounts] ${warnings.join(" ")}`);
    await promptReload(`Switched to ${label(to)}. Reload VS Code windows so Claude uses it.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not switch: ${(e as Error).message}`);
  }
}

async function promptReload(message: string) {
  const choice = await vscode.window.showInformationMessage(
    `${message} Other open windows and terminal sessions need a reload or restart too.`,
    "Reload now",
    "Later",
  );
  if (choice === "Reload now") await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

function saveCurrent() {
  try {
    const saved = sw.saveCurrent();
    refresh();
    vscode.window.showInformationMessage(`Saved ${label(saved)}.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not save: ${(e as Error).message}`);
  }
}

async function addNew() {
  const cur = sw.current();
  if (cur) {
    try {
      sw.saveCurrent();
    } catch (e) {
      vscode.window.showErrorMessage(`Could not save ${cur.email} first: ${(e as Error).message}`);
      return;
    }
  }
  const terminal = vscode.window.createTerminal({
    name: "Claude sign-in",
    shellPath: claudeBinary(),
    shellArgs: ["auth", "login"],
  });
  terminal.show();
  pendingAdd = { fromId: cur?.id, fromSecret: sw.activeSecret(), terminal };
  lastId = cur?.id;
  vscode.window.showInformationMessage(
    "Sign in with the account you want to add in the browser page that opens. It is saved when sign-in finishes.",
  );
}

async function removeAccount() {
  const accounts = sw.list();
  const choice = await vscode.window.showQuickPick(
    accounts.map((a) => ({ label: a.email, description: a.orgName, detail: a.active ? "Signed in" : undefined, a })),
    { placeHolder: "Remove which account from the list?" },
  );
  if (!choice) return;
  const message = choice.a.active
    ? `Remove ${label(choice.a)} from the list? You stay signed in.`
    : `Remove ${label(choice.a)} from the list?`;
  if ((await vscode.window.showWarningMessage(message, { modal: true }, "Remove")) !== "Remove") return;
  sw.remove(choice.a.id);
  refresh();
  vscode.window.showInformationMessage(`Removed ${label(choice.a)}.`);
}
