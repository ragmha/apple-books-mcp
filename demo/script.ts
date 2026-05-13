export const DEMO_FPS = 30;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

export type DemoSceneVariant =
  | "intro"
  | "connect"
  | "read"
  | "export"
  | "write"
  | "safety"
  | "backup"
  | "outro";

export interface DemoBook {
  title: string;
  author: string;
  assetId: string;
  progress: string;
  annotations: number;
}

export interface DemoAnnotation {
  bookTitle: string;
  color: "green" | "blue" | "yellow" | "pink" | "purple";
  quote: string;
  note: string;
}

export interface DemoMcpCall {
  tool: string;
  arguments: Record<string, string | number | boolean | null>;
  result: string[];
}

export interface DemoScene {
  id: string;
  variant: DemoSceneVariant;
  kicker: string;
  title: string;
  durationInFrames: number;
  narration: string;
  focus: string[];
  mcpCalls?: DemoMcpCall[];
}

export const demoBooks: DemoBook[] = [
  {
    title: "Designing Calm Systems",
    author: "Mira Chen",
    assetId: "asset-designing-calm-systems",
    progress: "68%",
    annotations: 24,
  },
  {
    title: "The SQLite Field Guide",
    author: "Jon Bellamy",
    assetId: "asset-sqlite-field-guide",
    progress: "42%",
    annotations: 17,
  },
  {
    title: "Notes on Durable Software",
    author: "Ari Novak",
    assetId: "asset-durable-software",
    progress: "91%",
    annotations: 31,
  },
];

export const demoAnnotations: DemoAnnotation[] = [
  {
    bookTitle: "Designing Calm Systems",
    color: "green",
    quote: "Resilient defaults make the safe path feel like the easiest path.",
    note: "Good framing for write safety rails.",
  },
  {
    bookTitle: "The SQLite Field Guide",
    color: "yellow",
    quote: "A backup that has not been checked is only a hopeful copy.",
    note: "Use near restore docs.",
  },
  {
    bookTitle: "Notes on Durable Software",
    color: "blue",
    quote: "Make irreversible operations pass through a named seam.",
    note: "Maps directly to LibraryMutation.",
  },
];

export const writeSafetySteps = [
  "Snapshot the Library or Annotations database",
  "Run PRAGMA integrity_check against the snapshot",
  "Quit Books.app before opening SQLite in write mode",
  "Use BEGIN IMMEDIATE and Core Data metadata discipline",
  "Commit, rotate backups, then relaunch Books.app",
];

export const demoScenes: DemoScene[] = [
  {
    id: "intro",
    variant: "intro",
    kicker: "Sanitized adoption demo",
    title: "Apple Books MCP for real reading workflows",
    durationInFrames: 105,
    narration:
      "A short generated demo showing how an MCP client can read and safely write a local Apple Books library.",
    focus: [
      "Bun and TypeScript MCP server",
      "macOS Apple Books only",
      "Fake data, no private library content",
    ],
  },
  {
    id: "connect",
    variant: "connect",
    kicker: "Client setup",
    title: "Connect from Claude, Cursor, VS Code, or Copilot CLI",
    durationInFrames: 120,
    narration:
      "Use Bun to run the package, then grant Full Disk Access to the app that spawns the server.",
    focus: [
      "bunx @ragmha/apple-books-mcp",
      "Full Disk Access for the client process",
      "Schema validation fails closed at startup",
    ],
    mcpCalls: [
      {
        tool: "client config",
        arguments: { command: "bunx", package: "@ragmha/apple-books-mcp" },
        result: ["server: apple-books", "transport: stdio"],
      },
    ],
  },
  {
    id: "read-library",
    variant: "read",
    kicker: "Read flow",
    title: "List books and search highlights",
    durationInFrames: 135,
    narration:
      "Start with paginated reads, then search highlighted text without loading an entire library into context.",
    focus: [
      "list_books returns paginated library rows",
      "search_highlighted_text finds matching highlights",
      "IDs from read tools feed later write tools",
    ],
    mcpCalls: [
      {
        tool: "list_books",
        arguments: { limit: 3, offset: 0 },
        result: [
          "Designing Calm Systems - 24 annotations",
          "The SQLite Field Guide - 17 annotations",
          "Notes on Durable Software - 31 annotations",
        ],
      },
      {
        tool: "search_highlighted_text",
        arguments: { text: "resilient defaults" },
        result: [
          "1 green highlight in Designing Calm Systems",
          "annotation_id: ann-calm-001",
        ],
      },
    ],
  },
  {
    id: "export",
    variant: "export",
    kicker: "Read flow",
    title: "Export annotations to Markdown",
    durationInFrames: 115,
    narration:
      "For review workflows, export one book or the whole library as Markdown grouped under book headers.",
    focus: [
      "export_annotations_markdown is read-only",
      "Pass asset_id for one book",
      "Omit asset_id for a library-wide export",
    ],
    mcpCalls: [
      {
        tool: "export_annotations_markdown",
        arguments: { asset_id: "asset-designing-calm-systems" },
        result: [
          "# Designing Calm Systems",
          "## Green highlights",
          "> Resilient defaults make the safe path feel like the easiest path.",
        ],
      },
    ],
  },
  {
    id: "writes",
    variant: "write",
    kicker: "Write flow",
    title: "Create collections and manage annotations",
    durationInFrames: 145,
    narration:
      "Write tools support common organization tasks while returning backup handles for traceability.",
    focus: [
      "create_collection returns a collectionId",
      "add_book_to_collection and remove_book_from_collection update Library",
      "update_annotation_note and delete_annotation update Annotations",
    ],
    mcpCalls: [
      {
        tool: "create_collection",
        arguments: { name: "Demo Reading Queue" },
        result: [
          "success: true",
          "collectionId: collection-demo-reading-queue",
          "backupPath: BKLibrary.sqlite.backup-20260513T091500Z",
        ],
      },
      {
        tool: "update_annotation_note",
        arguments: {
          annotation_id: "ann-durable-001",
          note: "Use this quote in the architecture README.",
        },
        result: ["success: true", "backupPath: AEAnnotation.sqlite.backup-*"],
      },
    ],
  },
  {
    id: "safety",
    variant: "safety",
    kicker: "Safety ceremony",
    title: "Every write goes through LibraryMutation",
    durationInFrames: 130,
    narration:
      "The unsafe path is not exposed. Mutations pass through a single seam that protects the database before changing it.",
    focus: writeSafetySteps,
  },
  {
    id: "backup",
    variant: "backup",
    kicker: "Recovery flow",
    title: "Backups and restore are part of the workflow",
    durationInFrames: 125,
    narration:
      "If a collection edit was wrong, list backups and restore with the same integrity and lifecycle checks.",
    focus: [
      "list_backups returns newest snapshots first",
      "restore_backup verifies the selected backup",
      "A fresh pre-restore safety snapshot is kept",
    ],
    mcpCalls: [
      {
        tool: "list_backups",
        arguments: {},
        result: [
          "handle: BKLibrary.sqlite.backup-20260513T091500Z",
          "createdAt: 2026-05-13T09:15:00.000Z",
        ],
      },
      {
        tool: "restore_backup",
        arguments: {
          handle: "/Users/demo/.../BKLibrary.sqlite.backup-20260513T091500Z",
        },
        result: [
          "success: true",
          "safetyBackupPath: BKLibrary.sqlite.backup-restore-safety-*",
        ],
      },
    ],
  },
  {
    id: "outro",
    variant: "outro",
    kicker: "Adopt safely",
    title: "Review the prompts, then try it on your Mac",
    durationInFrames: 100,
    narration:
      "The demo source stays in the repository. Generated videos stay out of git and out of the npm package.",
    focus: [
      "Read demo/prompts.md",
      "Preview with bun run demo:preview",
      "Render with bun run demo:render",
    ],
  },
];

export const DEMO_DURATION_IN_FRAMES = demoScenes.reduce(
  (total, scene) => total + scene.durationInFrames,
  0,
);
