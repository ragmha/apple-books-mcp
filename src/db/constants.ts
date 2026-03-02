import { join } from "node:path";
import { homedir } from "node:os";

// --- Apple Books Container Paths ---

export const BOOKS_CONTAINER = join(
  homedir(),
  "Library/Containers/com.apple.iBooksX/Data/Documents",
);

export const Paths = {
  libraryDir: join(BOOKS_CONTAINER, "BKLibrary"),
  annotationDir: join(BOOKS_CONTAINER, "AEAnnotation"),
} as const;

export const DbPrefixes = {
  library: "BKLibrary",
  annotation: "AEAnnotation",
} as const;

// --- Table Names ---

export const Tables = {
  Books: "ZBKLIBRARYASSET",
  Collections: "ZBKCOLLECTION",
  CollectionMembers: "ZBKCOLLECTIONMEMBER",
  Annotations: "ZAEANNOTATION",
  PrimaryKey: "Z_PRIMARYKEY",
} as const;

// --- CoreData Entity Numbers (Z_ENT) ---

export const EntityTypes = {
  Collection: 2,
  CollectionMember: 3,
} as const;
