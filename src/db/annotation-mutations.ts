import type { LibraryTx, MutationResult } from "./library-mutation.ts";
import { MutationError } from "./library-mutation.ts";
import { productionAnnotationMutation } from "./library-mutation-singleton.ts";
import { Tables } from "./constants.ts";

/** Core Data epoch: 2001-01-01 00:00:00 UTC, in seconds. */
const CORE_DATA_EPOCH_S = Date.UTC(2001, 0, 1) / 1000;

function coreDataNow(): number {
  return Date.now() / 1000 - CORE_DATA_EPOCH_S;
}

function mutationResultToLegacyShape<T>(
  result: MutationResult<T>,
  successMessage: string,
): { success: boolean; message: string; backupPath?: string } {
  if (result.success) {
    return { success: true, message: successMessage, backupPath: result.backupPath };
  }
  return { success: false, message: result.message, backupPath: result.backupPath };
}

interface AnnotationRow {
  Z_PK: number;
  ZANNOTATIONUUID: string | null;
  ZANNOTATIONDELETED: number | null;
}

/**
 * Resolve an annotation by either its UUID (`ZANNOTATIONUUID`) or its numeric
 * primary key. Throws `MutationError` if not found. Returns the row so callers
 * can branch on existing state (e.g. "already deleted").
 */
function resolveAnnotation(tx: LibraryTx, id: string): AnnotationRow {
  const numId = Number.parseInt(id, 10);
  const row = tx.query<AnnotationRow>(
    `SELECT Z_PK, ZANNOTATIONUUID, ZANNOTATIONDELETED FROM ${Tables.Annotations}
     WHERE ZANNOTATIONUUID = ? OR Z_PK = ?`,
    [id, Number.isNaN(numId) ? -1 : numId],
  );
  if (!row) throw new MutationError(`Annotation not found: ${id}`);
  return row;
}

/**
 * Pure description of "update the note text on this annotation". The
 * Annotation table uses `ZANNOTATIONMODIFICATIONDATE` (not `ZLOCALMODDATE`)
 * for its mtime, so we issue the SQL directly rather than using the generic
 * `tx.update` helper.
 */
export function updateAnnotationNoteTx(
  tx: LibraryTx,
  annotationId: string,
  note: string,
): { annotationPk: number } {
  if (note.length === 0) {
    throw new MutationError("Note text must not be empty.");
  }
  const row = resolveAnnotation(tx, annotationId);
  tx.run(
    `UPDATE ${Tables.Annotations}
     SET ZANNOTATIONNOTE = ?,
         ZANNOTATIONMODIFICATIONDATE = ?,
         Z_OPT = Z_OPT + 1
     WHERE Z_PK = ?`,
    [note, coreDataNow(), row.Z_PK],
  );
  return { annotationPk: row.Z_PK };
}

/**
 * Pure description of "soft-delete this annotation". Apple Books treats
 * `ZANNOTATIONDELETED = 1` as deleted but keeps the row for sync purposes.
 */
export function deleteAnnotationTx(
  tx: LibraryTx,
  annotationId: string,
): { annotationPk: number } {
  const row = resolveAnnotation(tx, annotationId);
  if (row.ZANNOTATIONDELETED === 1) {
    throw new MutationError(
      `Annotation ${annotationId} is already deleted.`,
    );
  }
  tx.run(
    `UPDATE ${Tables.Annotations}
     SET ZANNOTATIONDELETED = 1,
         ZANNOTATIONMODIFICATIONDATE = ?,
         Z_OPT = Z_OPT + 1
     WHERE Z_PK = ?`,
    [coreDataNow(), row.Z_PK],
  );
  return { annotationPk: row.Z_PK };
}

// --- Public MCP-facing helpers ---
//
// These wrap the *Tx pure functions in the production
// `LibraryMutation` for the AEAnnotation database, which owns the safety
// ceremony (snapshot, integrity check, quit Books, BEGIN IMMEDIATE,
// COMMIT/ROLLBACK, relaunch Books) for that file.

export async function updateAnnotationNote(
  annotationId: string,
  note: string,
): Promise<{ success: boolean; message: string; backupPath?: string }> {
  const result = await productionAnnotationMutation().mutate((tx) =>
    updateAnnotationNoteTx(tx, annotationId, note),
  );
  return mutationResultToLegacyShape(result, "Annotation note updated.");
}

export async function deleteAnnotation(
  annotationId: string,
): Promise<{ success: boolean; message: string; backupPath?: string }> {
  const result = await productionAnnotationMutation().mutate((tx) =>
    deleteAnnotationTx(tx, annotationId),
  );
  return mutationResultToLegacyShape(result, "Annotation deleted.");
}
