import { getAnnotationDb } from "./connection.ts";
import type { AnnotationRow } from "../types.ts";
import { annotationFromRow, type Annotation } from "../types.ts";

export function listAllAnnotations(): Annotation[] {
  const db = getAnnotationDb();
  const rows = db
    .query<AnnotationRow, []>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC`
    )
    .all();
  return rows.map(annotationFromRow);
}

export function getAnnotationsByBookId(assetId: string): Annotation[] {
  const db = getAnnotationDb();
  const rows = db
    .query<AnnotationRow, [string]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONASSETID = ?
         AND (ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL)
       ORDER BY ZANNOTATIONCREATIONDATE ASC`
    )
    .all(assetId);
  return rows.map(annotationFromRow);
}

export function getAnnotationById(annotationId: string): Annotation | null {
  const db = getAnnotationDb();
  let row = db
    .query<AnnotationRow, [string]>(
      `SELECT * FROM ZAEANNOTATION WHERE ZANNOTATIONUUID = ?`
    )
    .get(annotationId);
  if (!row) {
    const numId = parseInt(annotationId, 10);
    if (!isNaN(numId)) {
      row = db
        .query<AnnotationRow, [number]>(
          `SELECT * FROM ZAEANNOTATION WHERE Z_PK = ?`
        )
        .get(numId);
    }
  }
  return row ? annotationFromRow(row) : null;
}

/** Map annotation style numbers to color names */
function styleToColor(style: number | null): string {
  switch (style) {
    case 1: return "green";
    case 2: return "blue";
    case 3: return "yellow";
    case 4: return "pink";
    case 5: return "purple";
    default: return "unknown";
  }
}

export function getHighlightsByColor(color: string): Annotation[] {
  const db = getAnnotationDb();
  // Map color name to style number
  const colorMap: Record<string, number> = {
    green: 1, blue: 2, yellow: 3, pink: 4, purple: 5,
  };
  const styleNum = colorMap[color.toLowerCase()];
  if (styleNum == null) return [];

  const rows = db
    .query<AnnotationRow, [number]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONSTYLE = ?
         AND (ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL)
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC`
    )
    .all(styleNum);
  return rows.map(annotationFromRow);
}

export function searchHighlightedText(text: string): Annotation[] {
  const db = getAnnotationDb();
  const pattern = `%${text}%`;
  const rows = db
    .query<AnnotationRow, [string]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONSELECTEDTEXT LIKE ?
         AND (ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL)
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC`
    )
    .all(pattern);
  return rows.map(annotationFromRow);
}

export function searchNotes(note: string): Annotation[] {
  const db = getAnnotationDb();
  const pattern = `%${note}%`;
  const rows = db
    .query<AnnotationRow, [string]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONNOTE LIKE ?
         AND (ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL)
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC`
    )
    .all(pattern);
  return rows.map(annotationFromRow);
}

export function fullTextSearch(text: string): Annotation[] {
  const db = getAnnotationDb();
  const pattern = `%${text}%`;
  const rows = db
    .query<AnnotationRow, [string, string, string]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE (ZANNOTATIONSELECTEDTEXT LIKE ? OR ZANNOTATIONNOTE LIKE ? OR ZANNOTATIONREPRESENTATIVETEXT LIKE ?)
         AND (ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL)
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC`
    )
    .all(pattern, pattern, pattern);
  return rows.map(annotationFromRow);
}

export function recentAnnotations(limit = 10): Annotation[] {
  const db = getAnnotationDb();
  const rows = db
    .query<AnnotationRow, [number]>(
      `SELECT * FROM ZAEANNOTATION
       WHERE ZANNOTATIONDELETED = 0 OR ZANNOTATIONDELETED IS NULL
       ORDER BY ZANNOTATIONMODIFICATIONDATE DESC
       LIMIT ?`
    )
    .all(limit);
  return rows.map(annotationFromRow);
}
