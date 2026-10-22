import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Write through a temp file and rename, so readers never see half a file. */
export function writeFileAtomic(path: string, data: string, mode: number): void {
  const tmp = `${path}.ccswitch-${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode });
  // writeFileSync's mode is masked by the umask and ignored for an existing file.
  if (process.platform !== "win32") chmodSync(tmp, mode);
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      // On Windows the rename fails while another process (Claude Code) has the file open.
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (process.platform !== "win32" || !RETRY_CODES.has(code) || attempt === 10) {
        rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
}

export function isMissing(e: unknown): boolean {
  return (e as NodeJS.ErrnoException).code === "ENOENT";
}
