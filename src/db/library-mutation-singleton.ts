import {
  createLibraryMutation,
  type LibraryMutation,
} from "./library-mutation.ts";
import { osascriptBooksAppPort } from "./books-app-port.ts";
import { filesystemLibraryStore } from "./library-store.ts";

/**
 * Lazily-constructed production singleton. Tests should not import this;
 * they construct their own LibraryMutation with in-memory fakes.
 */
let cached: LibraryMutation | null = null;

export function productionMutation(): LibraryMutation {
  cached ??= createLibraryMutation(
    filesystemLibraryStore,
    osascriptBooksAppPort,
  );
  return cached;
}
