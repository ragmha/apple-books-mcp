import { describe, expect, test } from "bun:test";
import { deleteCollectionTx } from "../src/db/collections.ts";
import { Tables } from "../src/db/constants.ts";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededDb, seedCollection } from "./helpers/seed.ts";

describe("deleteCollection integration", () => {
  test("soft-deletes by setting ZDELETEDFLAG=1 and bumps Z_OPT (this is the bug the security review caught)", async () => {
    const db = createSeededDb();
    seedCollection(db, { pk: 1, uuid: "uuid-doomed", title: "Old List" });
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      deleteCollectionTx(tx, "uuid-doomed"),
    );

    expect(result.success).toBe(true);

    const row = db
      .query<
        {
          ZDELETEDFLAG: number;
          Z_OPT: number;
          ZLASTMODIFICATION: number;
          ZLOCALMODDATE: number;
        },
        []
      >(
        `SELECT ZDELETEDFLAG, Z_OPT, ZLASTMODIFICATION, ZLOCALMODDATE FROM ${Tables.Collections}`,
      )
      .get();
    if (!row) {
      throw new Error("Expected deleted collection row");
    }

    expect(row.ZDELETEDFLAG).toBe(1);
    // Z_OPT must be incremented — the original code forgot this.
    expect(row.Z_OPT).toBe(2);
    expect(row.ZLASTMODIFICATION).toBeGreaterThan(0);
    expect(row.ZLOCALMODDATE).toBeGreaterThan(0);
  });

  test("returns a friendly MutationError when the collection does not exist", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      deleteCollectionTx(tx, "uuid-nope"),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Collection not found: uuid-nope");
  });
});
