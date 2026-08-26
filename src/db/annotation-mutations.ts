import { getBookById } from "./books.ts";
import { Tables } from "./constants.ts";
import { coreDataNow } from "./core-data.ts";
import type { LibraryTx, MutationResult } from "./library-mutation.ts";
import { MutationError } from "./library-mutation.ts";
import { productionAnnotationMutation } from "./library-mutation-singleton.ts";

function mutationResultToLegacyShape<T>(
  result: MutationResult<T>,
  successMessage: string,
): { success: boolean; message: string; backupPath?: string } {
  if (result.success) {
    return {
      success: true,
      message: successMessage,
      backupPath: result.backupPath,
    };
  }
  return {
    success: false,
    message: result.message,
    backupPath: result.backupPath,
  };
}

interface AnnotationRow {
  Z_PK: number;
  ZANNOTATIONUUID: string | null;
  ZANNOTATIONDELETED: number | null;
}

export interface CreateAnnotationTxInput {
  assetId: string;
  selectedText: string;
  representativeText?: string;
  note?: string;
  location: string;
  absolutePhysicalLocation: number;
  rangeStart: number;
  rangeEnd: number;
  style: number;
  isUnderline: boolean;
}

export interface CreatedAnnotation {
  annotationPk: number;
  annotationUuid: string;
}

export interface CreateAnnotationInput
  extends Omit<CreateAnnotationTxInput, "assetId"> {
  bookId: string;
}

export type CreateAnnotationResult =
  | {
      success: true;
      message: string;
      annotationId: string;
      annotationPk: number;
      backupPath: string;
    }
  | { success: false; message: string; backupPath?: string };

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new MutationError(`${field} must not be empty.`);
  }
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MutationError(`${field} must be a non-negative integer.`);
  }
}

/**
 * Insert a type-2 Apple Books highlight at caller-supplied EPUB coordinates.
 * The caller must resolve `assetId` against the Library before entering the
 * Annotations transaction; this function owns only the AEAnnotation row.
 */
export function createAnnotationTx(
  tx: LibraryTx,
  input: CreateAnnotationTxInput,
): CreatedAnnotation {
  requireNonEmpty(input.assetId, "book_id");
  requireNonEmpty(input.selectedText, "selected_text");
  requireNonEmpty(input.location, "location");
  requireNonNegativeInteger(
    input.absolutePhysicalLocation,
    "absolute_physical_location",
  );
  requireNonNegativeInteger(input.rangeStart, "range_start");
  requireNonNegativeInteger(input.rangeEnd, "range_end");
  if (input.rangeEnd < input.rangeStart) {
    throw new MutationError(
      "range_end must be greater than or equal to range_start.",
    );
  }
  if (!Number.isInteger(input.style) || input.style < 1 || input.style > 5) {
    throw new MutationError("style must be an integer from 1 through 5.");
  }

  const entity = tx.query<{ Z_ENT: number }>(
    "SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME = ?",
    ["AEAnnotation"],
  );
  if (!entity) {
    throw new MutationError(
      "Apple Books annotation entity metadata is unavailable; schema may have changed.",
    );
  }

  const allocated = tx.query<{ Z_MAX: number }>(
    "UPDATE Z_PRIMARYKEY SET Z_MAX = Z_MAX + 1 WHERE Z_ENT = ? RETURNING Z_MAX",
    [entity.Z_ENT],
  );
  if (!allocated) {
    throw new MutationError("Could not allocate an Apple Books annotation ID.");
  }

  const creator = tx.query<{ ZANNOTATIONCREATORIDENTIFIER: string }>(
    `SELECT ZANNOTATIONCREATORIDENTIFIER
     FROM ${Tables.Annotations}
     WHERE ZANNOTATIONCREATORIDENTIFIER IS NOT NULL
       AND length(ZANNOTATIONCREATORIDENTIFIER) > 0
       AND COALESCE(ZANNOTATIONDELETED, 0) = 0
     ORDER BY CASE WHEN ZANNOTATIONASSETID = ? THEN 0 ELSE 1 END,
              ZANNOTATIONMODIFICATIONDATE DESC, Z_PK DESC
     LIMIT 1`,
    [input.assetId],
  );
  const now = coreDataNow();
  const annotationUuid = crypto.randomUUID();

  tx.run(
    `INSERT INTO ${Tables.Annotations} (
       Z_PK, Z_ENT, Z_OPT,
       ZANNOTATIONDELETED, ZANNOTATIONISUNDERLINE,
       ZANNOTATIONSTYLE, ZANNOTATIONTYPE,
       ZPLABSOLUTEPHYSICALLOCATION,
       ZPLLOCATIONRANGESTART, ZPLLOCATIONRANGEEND,
       ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE,
       ZANNOTATIONASSETID, ZANNOTATIONCREATORIDENTIFIER,
       ZANNOTATIONLOCATION, ZANNOTATIONNOTE,
       ZANNOTATIONREPRESENTATIVETEXT, ZANNOTATIONSELECTEDTEXT,
       ZANNOTATIONUUID
     ) VALUES (?, ?, 1, 0, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      allocated.Z_MAX,
      entity.Z_ENT,
      input.isUnderline ? 1 : 0,
      input.style,
      input.absolutePhysicalLocation,
      input.rangeStart,
      input.rangeEnd,
      now,
      now,
      input.assetId,
      creator?.ZANNOTATIONCREATORIDENTIFIER ?? null,
      input.location,
      input.note ?? "",
      input.representativeText ?? "",
      input.selectedText,
      annotationUuid,
    ],
  );

  return { annotationPk: allocated.Z_MAX, annotationUuid };
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
    throw new MutationError(`Annotation ${annotationId} is already deleted.`);
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

export async function createAnnotation(
  input: CreateAnnotationInput,
): Promise<CreateAnnotationResult> {
  const book = getBookById(input.bookId);
  if (!book) {
    throw new MutationError(`Book not found: ${input.bookId}`);
  }

  const result = await productionAnnotationMutation().mutate((tx) =>
    createAnnotationTx(tx, { ...input, assetId: book.assetId }),
  );
  if (!result.success) return result;
  return {
    success: true,
    message: "Annotation created.",
    annotationId: result.data.annotationUuid,
    annotationPk: result.data.annotationPk,
    backupPath: result.backupPath,
  };
}

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
