import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.run("CREATE TABLE test (col TEXT)");
db.run("INSERT INTO test VALUES ('100%')");
db.run("INSERT INTO test VALUES ('1000')");

// Current logic simulation
function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, "\\$&");
}

const input = "100%";
const pattern = `%${escapeLikePattern(input)}%`; // "%100\%%"
console.log(`Pattern: ${pattern}`);

// Query WITHOUT ESCAPE (Current implementation)
const res1 = db.query("SELECT * FROM test WHERE col LIKE ?").all(pattern);
console.log("Result WITHOUT ESCAPE:", res1);

// Query WITH ESCAPE (Correct implementation)
const res2 = db.query("SELECT * FROM test WHERE col LIKE ? ESCAPE '\\'").all(pattern);
console.log("Result WITH ESCAPE:", res2);
