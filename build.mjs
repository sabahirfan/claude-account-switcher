import { chmodSync } from "node:fs";
import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node20", format: "cjs", logLevel: "info" };

await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] });
await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node" } });

chmodSync("dist/cli.js", 0o755);
