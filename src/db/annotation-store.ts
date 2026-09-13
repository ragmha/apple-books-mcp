import {
  closeAnnotationDb,
  getAnnotationDbPath,
  getWritableAnnotationDb,
} from "./connection.ts";
import { createFilesystemStore } from "./filesystem-store.ts";
import { validateAnnotationSchema } from "./schema-check.ts";

export const filesystemAnnotationStore = createFilesystemStore({
  getDbPath: getAnnotationDbPath,
  openWritable: getWritableAnnotationDb,
  closeConnections: closeAnnotationDb,
  validateSchema: validateAnnotationSchema,
});
