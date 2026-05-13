import { describe, expect, test } from "bun:test";
import { createCollectionTx } from "../src/db/collections.ts";
import { Tables } from "../src/db/constants.ts";
import { createLibraryMutation } from "../src/db/library-mutation.ts";
import { FakeBooksAppPort, FakeLibraryStore } from "./helpers/fakes.ts";
import { createSeededDb } from "./helpers/seed.ts";

describe("createCollection integration", () => {
  test("creates a new collection with a fresh UUID and Z_OPT=1", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    const result = await mutation.mutate((tx) =>
      createCollectionTx(tx, "Reading List"),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.collectionId).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
    );

    const row = db
      .query<
        {
          Z_PK: number;
          Z_OPT: number;
          Z_ENT: number;
          ZTITLE: string;
          ZCOLLECTIONID: string;
          ZDELETEDFLAG: number;
        },
        []
      >(
        `SELECT Z_PK, Z_OPT, Z_ENT, ZTITLE, ZCOLLECTIONID, ZDELETEDFLAG FROM ${Tables.Collections}`,
      )
      .get();
    if (!row) {
      throw new Error("Expected created collection");
    }

    expect(row.Z_OPT).toBe(1);
    expect(row.Z_ENT).toBe(2);
    expect(row.ZTITLE).toBe("Reading List");
    expect(row.ZCOLLECTIONID).toBe(result.data.collectionId);
    expect(row.ZDELETEDFLAG).toBe(0);
  });

  test("subsequent collections get distinct PKs and sort keys", async () => {
    const db = createSeededDb();
    const store = new FakeLibraryStore(db);
    const mutation = createLibraryMutation(store, new FakeBooksAppPort());

    await mutation.mutate((tx) => createCollectionTx(tx, "First"));
    await mutation.mutate((tx) => createCollectionTx(tx, "Second"));

    const rows = db
      .query<{ Z_PK: number; ZTITLE: string; ZSORTKEY: number }, []>(
        `SELECT Z_PK, ZTITLE, ZSORTKEY FROM ${Tables.Collections} ORDER BY Z_PK`,
      )
      .all();
    expect(rows).toEqual([
      { Z_PK: 1, ZTITLE: "First", ZSORTKEY: 1 },
      { Z_PK: 2, ZTITLE: "Second", ZSORTKEY: 2 },
    ]);
  });
});
