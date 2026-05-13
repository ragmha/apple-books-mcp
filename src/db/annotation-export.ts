import type { Database } from "bun:sqlite";
import { getAnnotationDb } from "./connection.ts";
import { Tables } from "./constants.ts";

interface AnnotationExportRow {
  ZANNOTATIONUUID: string | null;
  ZANNOTATIONASSETID: string | null;
  ZANNOTATIONSELECTEDTEXT: string | null;
  ZANNOTATIONNOTE: string | null;
  ZANNOTATIONLOCATION: string | null;
  ZANNOTATIONCREATIONDATE: number | null;
}

/**
 * Escape characters that would otherwise be interpreted as markdown so that
 * user-authored notes and quotes render as literal text rather than as a
 * rendered hyperlink, heading, or emphasis. We escape conservatively — every
 * structural character users might have typed.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]<>()#+!|])/g, "\\$1");
}

function formatSelectedText(text: string): string {
  // Block quote: prefix every line with "> " so multi-paragraph selections
  // stay quoted end-to-end.
  return text
    .split(/\r?\n/)
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
}

function formatAnnotation(row: AnnotationExportRow): string {
  const sel = row.ZANNOTATIONSELECTEDTEXT ?? "";
  const note = row.ZANNOTATIONNOTE ?? "";
  const blocks: string[] = [];
  if (sel.length > 0) blocks.push(formatSelectedText(sel));
  if (note.length > 0) blocks.push(`**Note:** ${escapeMarkdown(note)}`);
  return blocks.join("\n\n");
}

/**
 * Render annotations from `db` as Markdown. If `assetId` is provided,
 * only that book's annotations appear (under a single `# Annotations for
 * <assetId>` header). Without `assetId`, all books are exported grouped
 * under per-book `## <assetId>` subheaders.
 *
 * Soft-deleted rows (`ZANNOTATIONDELETED = 1`) are excluded.
 *
 * Pure function — takes a Database directly so tests can pass an in-memory
 * fixture without touching the real Annotations file.
 */
export function exportAnnotationsMarkdown(
  db: Database,
  assetId?: string,
): string {
  if (assetId !== undefined) {
    const rows = db
      .query<AnnotationExportRow, [string]>(
        `SELECT ZANNOTATIONUUID, ZANNOTATIONASSETID, ZANNOTATIONSELECTEDTEXT,
                ZANNOTATIONNOTE, ZANNOTATIONLOCATION, ZANNOTATIONCREATIONDATE
         FROM ${Tables.Annotations}
         WHERE ZANNOTATIONASSETID = ?
           AND COALESCE(ZANNOTATIONDELETED, 0) = 0
         ORDER BY ZANNOTATIONCREATIONDATE ASC, Z_PK ASC`,
      )
      .all(assetId);
    const header = `# Annotations for ${assetId}`;
    if (rows.length === 0) return `${header}\n\n_No annotations._\n`;
    const body = rows.map(formatAnnotation).join("\n\n---\n\n");
    return `${header}\n\n${body}\n`;
  }

  // No assetId: dump every book, grouped.
  const rows = db
    .query<AnnotationExportRow, []>(
      `SELECT ZANNOTATIONUUID, ZANNOTATIONASSETID, ZANNOTATIONSELECTEDTEXT,
              ZANNOTATIONNOTE, ZANNOTATIONLOCATION, ZANNOTATIONCREATIONDATE
       FROM ${Tables.Annotations}
       WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0
       ORDER BY ZANNOTATIONASSETID ASC, ZANNOTATIONCREATIONDATE ASC, Z_PK ASC`,
    )
    .all();
  const out: string[] = ["# Annotations export"];
  if (rows.length === 0) {
    out.push("", "_No annotations._");
    return `${out.join("\n")}\n`;
  }
  const byBook = new Map<string, AnnotationExportRow[]>();
  for (const row of rows) {
    const aid = row.ZANNOTATIONASSETID ?? "(unknown)";
    const items = byBook.get(aid);
    if (items) {
      items.push(row);
    } else {
      byBook.set(aid, [row]);
    }
  }
  for (const [book, items] of byBook) {
    out.push("", `## ${book}`, "");
    out.push(items.map(formatAnnotation).join("\n\n---\n\n"));
  }
  return `${out.join("\n")}\n`;
}

/**
 * MCP-facing wrapper: opens the production AEAnnotation DB read-only and
 * returns the rendered markdown plus a count. The Annotations DB is
 * untouched.
 */
export function exportAnnotationsMarkdownForBook(assetId?: string): {
  assetId: string | null;
  markdown: string;
} {
  const md = exportAnnotationsMarkdown(getAnnotationDb(), assetId);
  return { assetId: assetId ?? null, markdown: md };
}
