import { describe, expect, test } from "bun:test";
import { AnnotationSchema } from "../src/db/schemas.ts";

describe("AnnotationSchema", () => {
  test("preserves anchored-highlight coordinates for MCP callers", () => {
    const annotation = AnnotationSchema.parse({
      Z_PK: 8,
      ZANNOTATIONASSETID: "book-1",
      ZANNOTATIONSELECTEDTEXT: "A material fact",
      ZANNOTATIONNOTE: "",
      ZANNOTATIONREPRESENTATIVETEXT: "Context",
      ZANNOTATIONSTYLE: 3,
      ZANNOTATIONTYPE: 2,
      ZANNOTATIONLOCATION: "epubcfi(/6/8!/4/2/6,:10,:25)",
      ZANNOTATIONUUID: "ann-8",
      ZANNOTATIONCREATIONDATE: 1,
      ZANNOTATIONMODIFICATIONDATE: 2,
      ZANNOTATIONDELETED: 0,
      ZANNOTATIONISUNDERLINE: 0,
      ZPLABSOLUTEPHYSICALLOCATION: 9,
      ZPLLOCATIONRANGESTART: 10,
      ZPLLOCATIONRANGEEND: 25,
    });

    expect(annotation.absolutePhysicalLocation).toBe(9);
    expect(annotation.rangeStart).toBe(10);
    expect(annotation.rangeEnd).toBe(25);
  });
});
