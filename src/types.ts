// Apple Books database row types (matching SQLite Core Data schema)

export interface BookRow {
  Z_PK: number;
  ZTITLE: string | null;
  ZASSETID: string | null;
  ZAUTHOR: string | null;
  ZSORTAUTHOR: string | null;
  ZSORTTITLE: string | null;
  ZGENRE: string | null;
  ZLANGUAGE: string | null;
  ZPAGECOUNT: number | null;
  ZRATING: number | null;
  ZISFINISHED: number | null;
  ZREADINGPROGRESS: number | null;
  ZPATH: string | null;
  ZCREATIONDATE: number | null;
  ZMODIFICATIONDATE: number | null;
  ZPURCHASEDATE: number | null;
  ZRELEASEDATE: number | null;
  ZLASTOPENDATE: number | null;
  ZCONTENTTYPE: number | null;
  ZFILESIZE: number | null;
  ZBOOKDESCRIPTION: string | null;
  ZEPUBID: string | null;
  ZCOVERURL: string | null;
  ZDURATION: number | null;
  ZYEAR: string | null;
}

export interface CollectionRow {
  Z_PK: number;
  ZTITLE: string | null;
  ZCOLLECTIONID: string | null;
  ZDELETEDFLAG: number | null;
  ZHIDDEN: number | null;
  ZSORTKEY: number | null;
  ZSORTMODE: number | null;
  ZLASTMODIFICATION: number | null;
  ZDETAILS: string | null;
}

export interface CollectionMemberRow {
  Z_PK: number;
  ZCOLLECTION: number;
  ZASSET: number;
  ZASSETID: string | null;
  ZSORTKEY: number | null;
}

export interface AnnotationRow {
  Z_PK: number;
  ZANNOTATIONASSETID: string | null;
  ZANNOTATIONSELECTEDTEXT: string | null;
  ZANNOTATIONNOTE: string | null;
  ZANNOTATIONREPRESENTATIVETEXT: string | null;
  ZANNOTATIONSTYLE: number | null;
  ZANNOTATIONTYPE: number | null;
  ZANNOTATIONLOCATION: string | null;
  ZANNOTATIONUUID: string | null;
  ZANNOTATIONCREATIONDATE: number | null;
  ZANNOTATIONMODIFICATIONDATE: number | null;
  ZANNOTATIONDELETED: number | null;
  ZANNOTATIONISUNDERLINE: number | null;
}

// Presentation types (returned from MCP tools)

export interface Book {
  id: number;
  assetId: string;
  title: string;
  author: string;
  genre: string;
  language: string;
  pageCount: number | null;
  rating: number | null;
  isFinished: boolean;
  readingProgress: number | null;
  description: string;
  epubId: string;
  coverUrl: string;
  year: string;
  fileSize: number | null;
  contentType: number | null;
  creationDate: string | null;
  modificationDate: string | null;
  purchaseDate: string | null;
  releaseDate: string | null;
  lastOpenDate: string | null;
}

export interface Collection {
  id: number;
  collectionId: string;
  title: string;
  hidden: boolean;
  sortKey: number | null;
  details: string;
  lastModification: string | null;
}

export interface Annotation {
  id: number;
  uuid: string;
  assetId: string;
  selectedText: string;
  note: string;
  representativeText: string;
  style: number | null;
  type: number | null;
  location: string;
  isUnderline: boolean;
  creationDate: string | null;
  modificationDate: string | null;
}

// Core Data epoch: 2001-01-01T00:00:00Z
const CORE_DATA_EPOCH = Date.UTC(2001, 0, 1) / 1000;

export function coreDataTimestampToISO(timestamp: number | null): string | null {
  if (timestamp == null) return null;
  const unixSeconds = timestamp + CORE_DATA_EPOCH;
  return new Date(unixSeconds * 1000).toISOString();
}

export function bookFromRow(row: BookRow): Book {
  return {
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
    creationDate: coreDataTimestampToISO(row.ZCREATIONDATE),
    modificationDate: coreDataTimestampToISO(row.ZMODIFICATIONDATE),
    purchaseDate: coreDataTimestampToISO(row.ZPURCHASEDATE),
    releaseDate: coreDataTimestampToISO(row.ZRELEASEDATE),
    lastOpenDate: coreDataTimestampToISO(row.ZLASTOPENDATE),
  };
}

export function collectionFromRow(row: CollectionRow): Collection {
  return {
    id: row.Z_PK,
    collectionId: row.ZCOLLECTIONID ?? "",
    title: row.ZTITLE ?? "Untitled",
    hidden: row.ZHIDDEN === 1,
    sortKey: row.ZSORTKEY,
    details: row.ZDETAILS ?? "",
    lastModification: coreDataTimestampToISO(row.ZLASTMODIFICATION),
  };
}

export function annotationFromRow(row: AnnotationRow): Annotation {
  return {
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
    creationDate: coreDataTimestampToISO(row.ZANNOTATIONCREATIONDATE),
    modificationDate: coreDataTimestampToISO(row.ZANNOTATIONMODIFICATIONDATE),
  };
}
