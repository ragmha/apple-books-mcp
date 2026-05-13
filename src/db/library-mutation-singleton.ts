import {
  createLibraryMutation,
  type LibraryMutation,
} from "./library-mutation.ts";
import { osascriptBooksAppPort } from "./books-app-port.ts";
import { filesystemLibraryStore } from "./library-store.ts";
import { filesystemAnnotationStore } from "./annotation-store.ts";

/**
 * Lazily-constructed production singletons. Tests should not import these;
 * they construct their own LibraryMutation with in-memory fakes.
 */
let cachedLibrary: LibraryMutation | null = null;
let cachedAnnotation: LibraryMutation | null = null;

export function productionMutation(): LibraryMutation {
  cachedLibrary ??= createLibraryMutation(
    filesystemLibraryStore,
    osascriptBooksAppPort,
  );
  return cachedLibrary;
}

/**
 * Sibling singleton for the AEAnnotation Core Data store. Same safety
 * ceremony as `productionMutation`, but operates on the annotations file.
 */
export function productionAnnotationMutation(): LibraryMutation {
  cachedAnnotation ??= createLibraryMutation(
    filesystemAnnotationStore,
    osascriptBooksAppPort,
  );
  return cachedAnnotation;
}
