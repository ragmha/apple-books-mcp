import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RestoreUnavailableError } from "./library-mutation.ts";

export interface SqliteRestoreConnection {
  snapshot(path: string): Promise<void>;
  restore(path: string): Promise<void>;
  verify(): Promise<boolean>;
  close(): Promise<void>;
}

export interface SqliteRestoreOptions {
  executable?: string;
  timeoutMs?: number;
  busyTimeoutMs?: number;
}

export async function openSqliteRestore(
  dbPath: string,
  workingDir: string,
  {
    executable = "/usr/bin/sqlite3",
    timeoutMs = 10_000,
    busyTimeoutMs = 250,
  }: SqliteRestoreOptions = {},
): Promise<SqliteRestoreConnection> {
  const logPath = join(workingDir, `sqlite-${randomUUID()}.log`);
  const logFd = openSync(logPath, "wx", 0o600);
  const uri = pathToFileURL(dbPath);
  uri.searchParams.set("mode", "rw");
  const child = spawn(executable, ["-batch", "-init", "/dev/null", uri.href], {
    stdio: ["pipe", "pipe", logFd],
  });
  const input = child.stdin;
  const stdout = child.stdout;
  if (!input || !stdout) {
    child.kill("SIGKILL");
    closeSync(logFd);
    unlinkSync(logPath);
    throw new Error("SQLite restore requires piped process streams.");
  }
  const write = input.write.bind(input);
  const end = input.end.bind(input);
  let pending:
    | {
        marker: string;
        lines: string[];
        resolve: (lines: string[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let output = "";
  let logOffset = 0;
  let exitError: Error | undefined;
  let exited = false;
  let originalMode: "wal" | "delete" | undefined;
  let closing: Promise<void> | undefined;
  const closed = new Promise<void>((resolve) => {
    child.once("close", (code, signal) => {
      exited = true;
      exitError ??= new Error(
        `SQLite restore process exited (${code ?? signal}).`,
      );
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(exitError);
        pending = undefined;
      }
      resolve();
    });
  });
  child.once("error", (error) => {
    exitError = new RestoreUnavailableError({ cause: error });
  });
  input.on("error", (error) => {
    exitError ??= error;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(exitError);
      pending = undefined;
    }
  });
  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => {
    output += chunk;
    let newline = output.indexOf("\n");
    while (newline >= 0) {
      const line = output.slice(0, newline).replace(/\r$/, "");
      output = output.slice(newline + 1);
      const request = pending;
      if (request) {
        if (line === request.marker) {
          clearTimeout(request.timer);
          pending = undefined;
          try {
            // The child has finished writing stderr before this stdout marker.
            // A file avoids ordering races between two independently-read pipes.
            const log = readFileSync(logPath);
            const errors = log.subarray(logOffset).toString().trim();
            logOffset = log.length;
            if (errors) request.reject(new Error(`SQLite restore: ${errors}`));
            else request.resolve(request.lines);
          } catch (error) {
            request.reject(
              new Error("Could not read SQLite restore diagnostics.", {
                cause: error,
              }),
            );
          }
        } else {
          request.lines.push(line);
        }
      }
      newline = output.indexOf("\n");
    }
  });

  function command(sql: string): Promise<string[]> {
    if (exited || exitError) {
      return Promise.reject(
        exitError ?? new Error("SQLite restore is closed."),
      );
    }
    if (pending) return Promise.reject(new Error("SQLite restore is busy."));
    return new Promise((resolve, reject) => {
      const marker = `restore_${randomUUID()}`;
      const timer = setTimeout(() => {
        const error = new Error("SQLite restore command timed out.");
        pending = undefined;
        exitError = error;
        child.kill("SIGKILL");
        reject(error);
      }, timeoutMs);
      pending = { marker, lines: [], resolve, reject, timer };
      write(`${sql}\n.print ${marker}\n`);
    });
  }

  async function close(): Promise<void> {
    closing ??= (async () => {
      let failure: unknown;
      try {
        if (!exited && !exitError && originalMode) {
          const rows = await command(`PRAGMA journal_mode=${originalMode};`);
          if (rows.join("") !== originalMode) {
            throw new Error(
              "Could not restore the original SQLite journal mode.",
            );
          }
        }
      } catch (error) {
        failure = error;
      } finally {
        end(".quit\n");
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        await closed;
        clearTimeout(timer);
        try {
          closeSync(logFd);
          unlinkSync(logPath);
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure) throw failure;
    })();
    return closing;
  }

  try {
    const modes = await command(
      `.bail off\n.headers off\n.mode list\nPRAGMA journal_mode;`,
    );
    const mode = modes[0];
    if (mode !== "wal" && mode !== "delete") {
      throw new Error("Unsupported SQLite journal mode for restore.");
    }
    originalMode = mode;
    const lock = await command(
      `PRAGMA busy_timeout=${busyTimeoutMs};\nPRAGMA locking_mode=EXCLUSIVE;`,
    );
    if (lock[1] !== "exclusive") {
      throw new Error("Could not acquire exclusive SQLite locking mode.");
    }
    const journal = await command("PRAGMA journal_mode=DELETE;");
    if (journal.join("") !== "delete") {
      throw new Error("Could not leave WAL mode for exclusive restore.");
    }
    // A write transaction cannot stay open during sqlite3_backup. EXCLUSIVE
    // locking_mode retains the rollback-journal lock after this COMMIT.
    await command("BEGIN EXCLUSIVE;\nCOMMIT;");
  } catch (error) {
    try {
      await close();
    } catch (closeError) {
      console.error("SQLite restore setup cleanup failed:", closeError);
    }
    throw error;
  }

  return {
    async snapshot(path) {
      await command(`VACUUM main INTO '${path.replaceAll("'", "''")}';`);
    },
    async restore(path) {
      // SQLite shell dot-command arguments use C-style double-quoted strings.
      const source = pathToFileURL(path);
      source.searchParams.set("mode", "ro");
      await command(`.restore ${JSON.stringify(source.href)}`);
    },
    async verify() {
      const rows = await command("PRAGMA integrity_check;");
      return rows.length === 1 && rows[0] === "ok";
    },
    close,
  };
}
