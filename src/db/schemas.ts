import { z } from "zod";

// Core Data epoch: 2001-01-01T00:00:00Z
const CORE_DATA_EPOCH = Date.UTC(2001, 0, 1) / 1000;

/** Convert Core Data timestamp to ISO string */
function coreDataToISO(timestamp: number | null): string | null {
  if (timestamp == null) return null;
  const unixSeconds = timestamp + CORE_DATA_EPOCH;
  return new Date(unixSeconds * 1000).toISOString();
}

// --- Raw row schemas (matching SQLite columns) ---

const BookRowSchema = z.object({
  Z_PK: z.number(),
  ZTITLE: z.string().nullable(),
  ZASSETID: z.string().nullable(),
  ZAUTHOR: z.string().nullable(),
  ZSORTAUTHOR: z.string().nullable(),
  ZSORTTITLE: z.string().nullable(),
  ZGENRE: z.string().nullable(),
  ZLANGUAGE: z.string().nullable(),
  ZPAGECOUNT: z.number().nullable(),
  ZRATING: z.number().nullable(),
  ZISFINISHED: z.number().nullable(),
  ZREADINGPROGRESS: z.number().nullable(),
  ZPATH: z.string().nullable(),
  ZCREATIONDATE: z.number().nullable(),
  ZMODIFICATIONDATE: z.number().nullable(),
  ZPURCHASEDATE: z.number().nullable(),
  ZRELEASEDATE: z.number().nullable(),
  ZLASTOPENDATE: z.number().nullable(),
  ZCONTENTTYPE: z.number().nullable(),
  ZFILESIZE: z.number().nullable(),
  ZBOOKDESCRIPTION: z.string().nullable(),
  ZEPUBID: z.string().nullable(),
  ZCOVERURL: z.string().nullable(),
  ZDURATION: z.number().nullable(),
  ZYEAR: z.string().nullable(),
});

const CollectionRowSchema = z.object({
  Z_PK: z.number(),
  ZTITLE: z.string().nullable(),
  ZCOLLECTIONID: z.string().nullable(),
  ZDELETEDFLAG: z.number().nullable(),
  ZHIDDEN: z.number().nullable(),
  ZSORTKEY: z.number().nullable(),
  ZSORTMODE: z.number().nullable(),
  ZLASTMODIFICATION: z.number().nullable(),
  ZDETAILS: z.string().nullable(),
});

const AnnotationRowSchema = z.object({
  Z_PK: z.number(),
  ZANNOTATIONASSETID: z.string().nullable(),
  ZANNOTATIONSELECTEDTEXT: z.string().nullable(),
  ZANNOTATIONNOTE: z.string().nullable(),
  ZANNOTATIONREPRESENTATIVETEXT: z.string().nullable(),
  ZANNOTATIONSTYLE: z.number().nullable(),
  ZANNOTATIONTYPE: z.number().nullable(),
  ZANNOTATIONLOCATION: z.string().nullable(),
  ZANNOTATIONUUID: z.string().nullable(),
  ZANNOTATIONCREATIONDATE: z.number().nullable(),
  ZANNOTATIONMODIFICATIONDATE: z.number().nullable(),
  ZANNOTATIONDELETED: z.number().nullable(),
  ZANNOTATIONISUNDERLINE: z.number().nullable(),
});

// --- Transformed presentation schemas ---

export const BookSummarySchema = BookRowSchema.transform((row) => ({
  id: row.Z_PK,
  assetId: row.ZASSETID ?? "",
  title: row.ZTITLE ?? "Untitled",
  author: row.ZAUTHOR ?? "Unknown",
  readingProgress: row.ZREADINGPROGRESS,
  isFinished: row.ZISFINISHED === 1,
}));

export const BookSchema = BookRowSchema.transform((row) => ({
  id: row.Z_PK,
  assetId: row.ZASSETID ?? "",
  title: row.ZTITLE ?? "Untitled",
  author: row.ZAUTHOR ?? "Unknown",
  genre: row.ZGENRE ?? "",
  language: row.ZLANGUAGE ?? "",
  pageCount: row.ZPAGECOUNT,
  rating: row.ZRATING,
  isFinished: row.ZISFINISHED === 1,
  readingProgress: row.ZREADINGPROGRESS,
  description: row.ZBOOKDESCRIPTION ?? "",
  epubId: row.ZEPUBID ?? "",
  coverUrl: row.ZCOVERURL ?? "",
  year: row.ZYEAR ?? "",
  fileSize: row.ZFILESIZE,
  contentType: row.ZCONTENTTYPE,
  creationDate: coreDataToISO(row.ZCREATIONDATE),
  modificationDate: coreDataToISO(row.ZMODIFICATIONDATE),
  purchaseDate: coreDataToISO(row.ZPURCHASEDATE),
  releaseDate: coreDataToISO(row.ZRELEASEDATE),
  lastOpenDate: coreDataToISO(row.ZLASTOPENDATE),
}));

export const CollectionSchema = CollectionRowSchema.transform((row) => ({
  id: row.Z_PK,
  collectionId: row.ZCOLLECTIONID ?? "",
  title: row.ZTITLE ?? "Untitled",
  hidden: row.ZHIDDEN === 1,
  sortKey: row.ZSORTKEY,
  details: row.ZDETAILS ?? "",
  lastModification: coreDataToISO(row.ZLASTMODIFICATION),
}));

export const AnnotationSchema = AnnotationRowSchema.transform((row) => ({
  id: row.Z_PK,
  uuid: row.ZANNOTATIONUUID ?? "",
  assetId: row.ZANNOTATIONASSETID ?? "",
  selectedText: row.ZANNOTATIONSELECTEDTEXT ?? "",
  note: row.ZANNOTATIONNOTE ?? "",
  representativeText: row.ZANNOTATIONREPRESENTATIVETEXT ?? "",
  style: row.ZANNOTATIONSTYLE,
  type: row.ZANNOTATIONTYPE,
  location: row.ZANNOTATIONLOCATION ?? "",
  isUnderline: row.ZANNOTATIONISUNDERLINE === 1,
  creationDate: coreDataToISO(row.ZANNOTATIONCREATIONDATE),
  modificationDate: coreDataToISO(row.ZANNOTATIONMODIFICATIONDATE),
}));

// Infer types from schemas
export type Book = z.output<typeof BookSchema>;
export type BookSummary = z.output<typeof BookSummarySchema>;
export type Collection = z.output<typeof CollectionSchema>;
export type Annotation = z.output<typeof AnnotationSchema>;
