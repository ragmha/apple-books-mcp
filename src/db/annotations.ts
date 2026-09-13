import type { Database } from "bun:sqlite";
import { getAnnotationDb } from "./connection.ts";
import { Tables } from "./constants.ts";
import { resolveIdentifier } from "./identifiers.ts";
import { resolvePagination } from "./pagination.ts";
import { createDb, escapeLikePattern } from "./query.ts";
import {
  type Annotation,
  AnnotationRowSchema,
  AnnotationSchema,
} from "./schemas.ts";

const ACTIVE_ANNOTATIONS = "COALESCE(ZANNOTATIONDELETED, 0) = 0";

export type AnnotationPage = {
  annotations: Annotation[];
  total: number;
  limit: number;
  offset: number;
};

export function createAnnotationQueries(getDatabase: () => Database) {
  function listAllAnnotations(limit?: number, offset?: number): AnnotationPage {
    const pagination = resolvePagination(limit, offset);
    const annDb = getDatabase();
    const db = createDb(annDb);

    const totalRow = annDb
      .query<{ count: number }, []>(
        `SELECT COUNT(*) as count FROM ${Tables.Annotations}
       WHERE ${ACTIVE_ANNOTATIONS}`,
      )
      .get();
    if (!totalRow) {
      throw new Error("Failed to count annotations");
    }
    const total = totalRow.count;

    const annotations = db
      .selectFrom(Tables.Annotations, AnnotationSchema)
      .selectAll()
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return {
      annotations,
      total,
      ...pagination,
    };
  }

  function getAnnotationsByBookId(assetId: string): Annotation[] {
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Annotations, AnnotationSchema)
      .selectAll()
      .where("ZANNOTATIONASSETID", "=", assetId)
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONCREATIONDATE")
      .orderBy("Z_PK")
      .execute();
  }

  function getAnnotationById(annotationId: string): Annotation | null {
    const db = createDb(getDatabase());

    const annotation = resolveIdentifier(
      annotationId,
      "ZANNOTATIONUUID",
      (predicate, params) =>
        db
          .selectFrom(Tables.Annotations, AnnotationRowSchema)
          .selectAll()
          .whereRaw(predicate, params)
          .get(),
    );
    return annotation && (annotation.ZANNOTATIONDELETED ?? 0) === 0
      ? AnnotationSchema.parse(annotation)
      : null;
  }

  /** Map color name to style number */
  const colorToStyle: Record<string, number> = {
    green: 1,
    blue: 2,
    yellow: 3,
    pink: 4,
    purple: 5,
  };

  function getHighlightsByColor(
    color: string,
    limit?: number,
    offset?: number,
  ): AnnotationPage {
    const styleNum = colorToStyle[color.toLowerCase()];
    const pagination = resolvePagination(limit, offset);
    if (styleNum == null) {
      return {
        annotations: [],
        total: 0,
        ...pagination,
      };
    }

    const annDb = getDatabase();
    const db = createDb(annDb);

    const totalRow = annDb
      .query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM ${Tables.Annotations}
       WHERE ZANNOTATIONSTYLE = ? AND ${ACTIVE_ANNOTATIONS}`,
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
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return {
      annotations,
      total,
      ...pagination,
    };
  }

  function searchHighlightedText(
    text: string,
    limit?: number,
    offset?: number,
  ): Annotation[] {
    const pagination = resolvePagination(limit, offset);
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Annotations, AnnotationSchema)
      .selectAll()
      .whereLike("ZANNOTATIONSELECTEDTEXT", text)
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
  }

  function searchNotes(
    note: string,
    limit?: number,
    offset?: number,
  ): Annotation[] {
    const pagination = resolvePagination(limit, offset);
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Annotations, AnnotationSchema)
      .selectAll()
      .whereLike("ZANNOTATIONNOTE", note)
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
  }

  /** Note: Leading wildcard LIKE queries (%term%) cannot use indexes and cause full table scans */
  function fullTextSearch(
    text: string,
    limit?: number,
    offset?: number,
  ): Annotation[] {
    const pagination = resolvePagination(limit, offset);
    const db = createDb(getDatabase());
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
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
  }

  function recentAnnotations(limit = 10): Annotation[] {
    const db = createDb(getDatabase());
    return db
      .selectFrom(Tables.Annotations, AnnotationSchema)
      .selectAll()
      .whereRaw(ACTIVE_ANNOTATIONS)
      .orderBy("ZANNOTATIONMODIFICATIONDATE", "DESC")
      .orderBy("Z_PK", "DESC")
      .limit(limit)
      .execute();
  }

  return {
    listAllAnnotations,
    getAnnotationsByBookId,
    getAnnotationById,
    getHighlightsByColor,
    searchHighlightedText,
    searchNotes,
    fullTextSearch,
    recentAnnotations,
  };
}

export const {
  listAllAnnotations,
  getAnnotationsByBookId,
  getAnnotationById,
  getHighlightsByColor,
  searchHighlightedText,
  searchNotes,
  fullTextSearch,
  recentAnnotations,
} = createAnnotationQueries(getAnnotationDb);
