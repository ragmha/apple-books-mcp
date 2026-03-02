import { getAnnotationDb } from "./connection.ts";
import { createDb } from "./query.ts";
import { AnnotationSchema, type Annotation } from "./schemas.ts";
import { Tables } from "./constants.ts";

export function listAllAnnotations(): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function getAnnotationsByBookId(assetId: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONASSETID", "=", assetId)
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
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
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function searchHighlightedText(text: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereLike("ZANNOTATIONSELECTEDTEXT", text)
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function searchNotes(note: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereLike("ZANNOTATIONNOTE", note)
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function fullTextSearch(text: string): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .whereLike("ZANNOTATIONSELECTEDTEXT", text)
    .orWhereLike("ZANNOTATIONNOTE", text)
    .orWhereLike("ZANNOTATIONREPRESENTATIVETEXT", text)
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .execute();
}

export function recentAnnotations(limit = 10): Annotation[] {
  const db = createDb(getAnnotationDb());
  return db
    .selectFrom(Tables.Annotations, AnnotationSchema)
    .selectAll()
    .where("ZANNOTATIONDELETED", "=", 0)
    .orWhere("ZANNOTATIONDELETED", "IS", null)
    .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
    .limit(limit)
    .execute();
}
