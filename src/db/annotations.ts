import { getAnnotationDb } from "./connection.ts";
import { Tables } from "./constants.ts";
import { createDb, escapeLikePattern } from "./query.ts";
import { type Annotation, AnnotationSchema } from "./schemas.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

export type AnnotationPage = {
  annotations: Annotation[];
  total: number;
  limit: number;
  offset: number;
};

export function listAllAnnotations(
  limit?: number,
  offset?: number,
): AnnotationPage {
  const annDb = getAnnotationDb();
  const db = createDb(annDb);
  const effectiveLimit = clampLimit(limit);
  const effectiveOffset = Math.max(offset ?? 0, 0);

  const totalRow = annDb
    .query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM ${Tables.Annotations}
       WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0`,
    )
    .get();
  if (!totalRow) {
    throw new Error("Failed to count annotations");
  }
  const total = totalRow.count;

  const annotations = db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .orderBy("Z_PK", "DESC")
    .limit(effectiveLimit)
    .offset(effectiveOffset)
    .execute();

  return {
    annotations,
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
  };
}

export function getAnnotationsByBookId(assetId: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONASSETID", "=", assetId)
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONCREATIONDATE")
    .execute();
}

export function getAnnotationById(annotationId: string): Annotation | null {
  const db = createDb(getAnnotationDb());

  let annotation = db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONUUID", "=", annotationId)
    .get();

  if (!annotation) {
    const numId = parseInt(annotationId, 10);
    if (!Number.isNaN(numId)) {
      annotation = db
        .selectFrom(Tables.Annotations, AnnotationSchema)
        .selectAll()
        .where("Z_PK", "=", numId)
        .get();
    }
  }
  return annotation;
}

/** Map color name to style number */
const colorToStyle: Record<string, number> = {
  green: 1,
  blue: 2,
  yellow: 3,
  pink: 4,
  purple: 5,
};

export function getHighlightsByColor(
  color: string,
  limit?: number,
  offset?: number,
): AnnotationPage {
  const styleNum = colorToStyle[color.toLowerCase()];
  const effectiveLimit = clampLimit(limit);
  const effectiveOffset = Math.max(offset ?? 0, 0);
  if (styleNum == null) {
    return {
      annotations: [],
      total: 0,
      limit: effectiveLimit,
      offset: effectiveOffset,
    };
  }

  const annDb = getAnnotationDb();
  const db = createDb(annDb);

  const totalRow = annDb
    .query<{ count: number }, [number]>(
      `SELECT COUNT(*) as count FROM ${Tables.Annotations}
       WHERE ZANNOTATIONSTYLE = ? AND COALESCE(ZANNOTATIONDELETED, 0) = 0`,
    )
    .get(styleNum);
  if (!totalRow) {
    throw new Error("Failed to count annotations by color");
  }
  const total = totalRow.count;

  const annotations = db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONSTYLE", "=", styleNum)
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .orderBy("Z_PK", "DESC")
    .limit(effectiveLimit)
    .offset(effectiveOffset)
    .execute();

  return {
    annotations,
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
  };
}

export function searchHighlightedText(text: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereLike("ZANNOTATIONSELECTEDTEXT", text)
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function searchNotes(note: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereLike("ZANNOTATIONNOTE", note)
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

/** Note: Leading wildcard LIKE queries (%term%) cannot use indexes and cause full table scans */
export function fullTextSearch(text: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereRaw(
      "(ZANNOTATIONSELECTEDTEXT LIKE ? ESCAPE '\\' OR ZANNOTATIONNOTE LIKE ? ESCAPE '\\' OR ZANNOTATIONREPRESENTATIVETEXT LIKE ? ESCAPE '\\')",
      [
        `%${escapeLikePattern(text)}%`,
        `%${escapeLikePattern(text)}%`,
        `%${escapeLikePattern(text)}%`,
      ],
    )
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function recentAnnotations(limit = 10): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .limit(limit)
    .execute();
}
