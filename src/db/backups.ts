import type { BackupInfo } from "./library-mutation.ts";
import { productionMutation } from "./library-mutation-singleton.ts";

/**
 * Public read-side helper: enumerate the snapshots LibraryMutation has
 * previously taken before each write. Newest first. The `handle` field
 * is the value to pass back to `restoreLibraryFromBackup`.
 */
export function listLibraryBackups(): BackupInfo[] {
  return productionMutation().listBackups();
}

/**
 * Public write-side helper: restore the live Apple Books Library from a
 * previously-taken backup. Routes through `LibraryMutation.restore`, which
 * verifies integrity, quits Books, takes a fresh pre-restore safety snapshot,
 * swaps the file, and relaunches Books.
 *
 * Returns a flat success/message shape for MCP serialisation; the
 * pre-restore safety snapshot path is included in the message on both the
 * success and failure-after-snapshot paths so users always know how to
 * recover.
 */
export async function restoreLibraryFromBackup(handle: string): Promise<{
  success: boolean;
  message: string;
  restoredFrom?: string;
  safetyBackupPath?: string;
}> {
  const result = await productionMutation().restore(handle);
  if (result.success) {
    return {
      success: true,
      message: result.message,
      restoredFrom: result.restoredFrom,
      safetyBackupPath: result.safetyBackupPath,
    };
  }
  return {
    success: false,
    message: result.message,
    safetyBackupPath: result.safetyBackupPath,
  };
}
