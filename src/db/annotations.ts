import { getAnnotationDb } from "./connection.ts";
import { createDb, escapeLikePattern } from "./query.ts";
import { AnnotationSchema, type Annotation } from "./schemas.ts";
import { Tables } from "./constants.ts";

export function listAllAnnotations(): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
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
    if (!isNaN(numId)) {
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

export function getHighlightsByColor(color: string): Annotation[] {
  const styleNum = colorToStyle[color.toLowerCase()];
  if (styleNum == null) return [];

  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONSTYLE", "=", styleNum)
    .whereRaw("COALESCE(ZANNOTATIONDELETED, 0) = 0")
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
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
      [`%${escapeLikePattern(text)}%`, `%${escapeLikePattern(text)}%`, `%${escapeLikePattern(text)}%`],
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
