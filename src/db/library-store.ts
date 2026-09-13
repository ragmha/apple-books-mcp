import {
  closeLibraryDb,
  getLibraryDbPath,
  getWritableLibraryDb,
} from "./connection.ts";
import { createFilesystemStore } from "./filesystem-store.ts";
import { validateLibrarySchema } from "./schema-check.ts";

export const filesystemLibraryStore = createFilesystemStore({
  getDbPath: getLibraryDbPath,
  openWritable: getWritableLibraryDb,
  closeConnections: closeLibraryDb,
  validateSchema: validateLibrarySchema,
});
