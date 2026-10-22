import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { diagnose } from "./core/doctor.ts";
import { claudePaths } from "./core/paths.ts";
import { claudeBinary, defaultOptions, Switcher } from "./core/switcher.ts";

const USAGE = `ccswitch — switch the Claude Code account

  ccswitch                    list saved accounts (same as \`list\`)
  ccswitch list
  ccswitch current            show the signed-in account
  ccswitch switch <n|email>   switch to a saved account
  ccswitch save               save the signed-in account to the list
  ccswitch add                save the current account, then sign in to another one
  ccswitch remove <n|email>   remove a saved account (you stay signed in)
  ccswitch doctor             show where the logins are kept and check them (prints no secrets)

After a switch, reload VS Code windows (Developer: Reload Window) and restart terminal sessions.`;

function label(a: { email: string; orgName: string; subscriptionType?: string }) {
  const extra = [a.orgName, a.subscriptionType].filter(Boolean).join(", ");
  return extra ? `${a.email} (${extra})` : a.email;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main(argv: string[]): Promise<number> {
  const paths = claudePaths();
  const sw = new Switcher(defaultOptions(paths));
  const [cmd = "list", arg] = argv;

  switch (cmd) {
    case "list": {
      const accounts = sw.list();
      if (!accounts.length) {
        console.log("No saved accounts. Run `ccswitch save` to add the signed-in one.");
        return 0;
      }
      accounts.forEach((a, i) => console.log(`${a.active ? "*" : " "} ${i + 1}. ${label(a)}`));
      return 0;
    }
    case "current": {
      const cur = sw.current();
      if (!cur) {
        console.log("Not signed in.");
        return 1;
      }
      console.log(label(cur));
      if (!cur.consistent) console.log("Warning: the active login belongs to another organization. Restart Claude sessions.");
      return 0;
    }
    case "save": {
      console.log(`Saved ${label(sw.saveCurrent())}`);
      return 0;
    }
    case "switch": {
      if (!arg) throw new Error("Usage: ccswitch switch <n|email>");
      const { to, from, warnings } = sw.switchTo(sw.resolve(arg).id);
      if (from?.id === to.id) console.log(`Already on ${label(to)}`);
      else console.log(`Switched to ${label(to)}`);
      warnings.forEach((w) => console.warn(`Warning: ${w}`));
      return 0;
    }
    case "add": {
      const before = sw.current();
      if (before) console.log(`Saved ${label(sw.saveCurrent())}`);
      console.log("Opening the Claude sign-in page. Sign in with the account you want to add.");
      const res = spawnSync(claudeBinary(), ["auth", "login"], { stdio: "inherit" });
      if (res.status !== 0) throw new Error("Sign-in did not finish");
      const after = sw.current();
      if (!after) throw new Error("Still not signed in");
      const saved = sw.saveCurrent();
      console.log(after.id === before?.id ? `Still on ${label(saved)}; nothing new added.` : `Added ${label(saved)}`);
      return 0;
    }
    case "remove": {
      if (!arg) throw new Error("Usage: ccswitch remove <n|email>");
      const target = sw.resolve(arg);
      const isActive = sw.current()?.id === target.id;
      const prompt = isActive
        ? `${label(target)} is signed in now. Remove it from the list? You stay signed in.`
        : `Remove ${label(target)} from the list?`;
      if (!(await confirm(prompt))) return 1;
      sw.remove(target.id);
      console.log(`Removed ${label(target)}`);
      return 0;
    }
    case "doctor": {
      const lines = diagnose(sw, paths, claudeBinary());
      lines.forEach((l) => console.log(l));
      return lines.some((l) => l.startsWith("!!")) ? 1 : 0;
    }
    case "help":
    case "-h":
    case "--help":
      console.log(USAGE);
      return 0;
    default:
      console.error(USAGE);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    console.error(`ccswitch: ${e.message}`);
    process.exit(1);
  },
);
