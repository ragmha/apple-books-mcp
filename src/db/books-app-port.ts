import { $ } from "bun";
import type { BooksAppPort } from "./library-mutation.ts";

/**
 * Production adapter for the macOS Books application.
 *
 * - `isRunning` shells out to `pgrep -x Books`.
 * - `quit` uses `osascript` to ask Books to quit cleanly, then polls
 *   `isRunning` until it stops or a short timeout elapses.
 * - `launch` uses `open -a Books`.
 *
 * All shell calls are silenced; failures bubble as thrown Errors so the
 * surrounding `LibraryMutation.mutate` can package them into a sanitised
 * MutationResult.
 */
export const osascriptBooksAppPort: BooksAppPort = {
  async isRunning(): Promise<boolean> {
    const proc = await $`pgrep -x Books`.quiet().nothrow();
    return proc.exitCode === 0;
  },

  async quit(): Promise<void> {
    await $`osascript -e ${'tell application "Books" to quit'}`
      .quiet()
      .nothrow();
    // Poll until Books actually exits (or give up after ~3s).
    for (let i = 0; i < 30; i += 1) {
      const proc = await $`pgrep -x Books`.quiet().nothrow();
      if (proc.exitCode !== 0) return;
      await Bun.sleep(100);
    }
    throw new Error("Books.app failed to quit within 3s");
  },

  async launch(): Promise<void> {
    await $`open -a Books`.quiet();
  },
};
