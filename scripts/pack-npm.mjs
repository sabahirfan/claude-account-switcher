// Lays out dist/npm as the npm package for the ccswitch CLI. Run after `npm run build`.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const ext = JSON.parse(readFileSync("package.json", "utf8"));
const out = "dist/npm";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync("dist/cli.js", `${out}/cli.js`);
copyFileSync("README.md", `${out}/README.md`);
copyFileSync("LICENSE", `${out}/LICENSE`);

const pkg = {
  name: ext.name,
  version: ext.version,
  description: "ccswitch: switch between your Claude Code accounts from the terminal. Not affiliated with Anthropic.",
  license: ext.license,
  repository: ext.repository,
  bugs: ext.bugs,
  homepage: ext.homepage,
  keywords: ext.keywords,
  bin: { ccswitch: "cli.js" },
  files: ["cli.js"],
  engines: { node: ">=20" },
};
writeFileSync(`${out}/package.json`, JSON.stringify(pkg, null, 2) + "\n");
console.log(`${out}: ${pkg.name}@${pkg.version}`);
