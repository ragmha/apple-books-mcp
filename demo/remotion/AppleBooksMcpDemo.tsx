import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  type DemoMcpCall,
  type DemoScene,
  type DemoSceneVariant,
  demoAnnotations,
  demoBooks,
  demoScenes,
} from "../script";

const palette = {
  background: "#0b1020",
  card: "rgba(15, 23, 42, 0.82)",
  cardStrong: "rgba(30, 41, 59, 0.92)",
  border: "rgba(148, 163, 184, 0.28)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#7dd3fc",
  green: "#86efac",
  yellow: "#fde68a",
  blue: "#93c5fd",
  pink: "#f9a8d4",
  purple: "#c4b5fd",
  danger: "#fca5a5",
} as const;

const variantColor: Record<DemoSceneVariant, string> = {
  intro: palette.accent,
  connect: palette.purple,
  read: palette.green,
  export: palette.yellow,
  write: palette.pink,
  safety: palette.blue,
  backup: palette.danger,
  outro: palette.accent,
};

interface ActiveScene {
  scene: DemoScene;
  localFrame: number;
  sceneIndex: number;
  sceneStart: number;
}

function getActiveScene(frame: number): ActiveScene {
  let cursor = 0;

  for (const [sceneIndex, scene] of demoScenes.entries()) {
    const sceneEnd = cursor + scene.durationInFrames;
    if (frame < sceneEnd) {
      return {
        scene,
        localFrame: frame - cursor,
        sceneIndex,
        sceneStart: cursor,
      };
    }
    cursor = sceneEnd;
  }

  const finalScene = demoScenes.at(-1);
  if (!finalScene) {
    throw new Error("Demo has no scenes");
  }

  return {
    scene: finalScene,
    localFrame: finalScene.durationInFrames - 1,
    sceneIndex: demoScenes.length - 1,
    sceneStart: cursor - finalScene.durationInFrames,
  };
}

function jsonLines(call: DemoMcpCall): string[] {
  return [
    `tool: ${call.tool}`,
    "arguments:",
    JSON.stringify(call.arguments, null, 2),
    "result:",
    ...call.result.map((line) => `  ${line}`),
  ];
}

function ShellWindow({
  title,
  lines,
  accent,
}: {
  title: string;
  lines: string[];
  accent: string;
}) {
  return (
    <div style={styles.shell}>
      <div style={styles.shellHeader}>
        <div style={styles.dots}>
          <span style={{ ...styles.dot, backgroundColor: "#fb7185" }} />
          <span style={{ ...styles.dot, backgroundColor: "#facc15" }} />
          <span style={{ ...styles.dot, backgroundColor: "#4ade80" }} />
        </div>
        <span style={{ ...styles.shellTitle, color: accent }}>{title}</span>
      </div>
      <pre style={styles.pre}>{lines.join("\n")}</pre>
    </div>
  );
}

function ToolCalls({
  calls,
  accent,
}: {
  calls: DemoMcpCall[];
  accent: string;
}) {
  if (calls.length === 0) {
    return (
      <ShellWindow
        accent={accent}
        lines={[
          "write safety rail:",
          "  snapshot -> integrity check -> quit Books",
          "  BEGIN IMMEDIATE -> Core Data metadata -> commit",
          "  relaunch Books after successful write",
        ]}
        title="LibraryMutation"
      />
    );
  }

  return (
    <div style={styles.toolColumn}>
      {calls.map((call) => (
        <ShellWindow
          accent={accent}
          key={call.tool}
          lines={jsonLines(call)}
          title={call.tool}
        />
      ))}
    </div>
  );
}

function LibraryPanel({ accent }: { accent: string }) {
  return (
    <div style={styles.libraryPanel}>
      <div style={styles.panelHeader}>
        <span style={{ ...styles.badge, color: accent }}>Sample library</span>
        <span style={styles.panelHint}>sanitized demo data</span>
      </div>
      <div style={styles.bookGrid}>
        {demoBooks.map((book) => (
          <div key={book.assetId} style={styles.bookCard}>
            <div style={styles.bookTitle}>{book.title}</div>
            <div style={styles.bookAuthor}>{book.author}</div>
            <div style={styles.bookMeta}>
              <span>{book.progress} read</span>
              <span>{book.annotations} annotations</span>
            </div>
          </div>
        ))}
      </div>
      <div style={styles.annotationList}>
        {demoAnnotations.map((annotation) => (
          <div key={annotation.quote} style={styles.annotationCard}>
            <div
              style={{
                ...styles.colorPill,
                backgroundColor: palette[annotation.color],
              }}
            />
            <div>
              <div style={styles.annotationQuote}>"{annotation.quote}"</div>
              <div style={styles.annotationNote}>{annotation.note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FocusList({ scene, accent }: { scene: DemoScene; accent: string }) {
  return (
    <div style={styles.focusList}>
      {scene.focus.map((item, index) => (
        <div key={item} style={styles.focusItem}>
          <span style={{ ...styles.focusNumber, color: accent }}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({
  frame,
  durationInFrames,
  accent,
}: {
  frame: number;
  durationInFrames: number;
  accent: string;
}) {
  const progress = interpolate(
    frame,
    [0, Math.max(durationInFrames - 1, 1)],
    [0, 100],
  );

  return (
    <div style={styles.progressTrack}>
      <div
        style={{
          ...styles.progressFill,
          backgroundColor: accent,
          width: `${progress}%`,
        }}
      />
    </div>
  );
}

export function AppleBooksMcpDemo() {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const { scene, localFrame, sceneIndex, sceneStart } = getActiveScene(frame);
  const accent = variantColor[scene.variant];
  const fade = interpolate(
    localFrame,
    [0, 12, Math.max(scene.durationInFrames - 12, 13), scene.durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const slide = spring({
    frame: localFrame,
    fps,
    config: {
      damping: 18,
      stiffness: 90,
    },
  });

  return (
    <AbsoluteFill style={styles.root}>
      <div style={styles.backgroundOrbOne} />
      <div style={styles.backgroundOrbTwo} />
      <div
        style={{
          ...styles.scene,
          opacity: fade,
          transform: `translateY(${(1 - slide) * 28}px)`,
        }}
      >
        <header style={styles.header}>
          <div>
            <div style={{ ...styles.kicker, color: accent }}>
              {scene.kicker}
            </div>
            <h1 style={styles.title}>{scene.title}</h1>
          </div>
          <div style={styles.counter}>
            {sceneIndex + 1}/{demoScenes.length}
          </div>
        </header>

        <main style={styles.main}>
          <section style={styles.leftColumn}>
            <p style={styles.narration}>{scene.narration}</p>
            <FocusList accent={accent} scene={scene} />
            <ToolCalls accent={accent} calls={scene.mcpCalls ?? []} />
          </section>

          <section style={styles.rightColumn}>
            <LibraryPanel accent={accent} />
          </section>
        </main>
      </div>

      <footer style={styles.footer}>
        <span>apple-books-mcp</span>
        <span style={styles.footerMuted}>Remotion demo from fake data</span>
        <span style={styles.footerMuted}>frame {frame - sceneStart}</span>
      </footer>
      <ProgressBar
        accent={accent}
        durationInFrames={durationInFrames}
        frame={frame}
      />
    </AbsoluteFill>
  );
}

const baseCard: CSSProperties = {
  background: palette.card,
  border: `1px solid ${palette.border}`,
  borderRadius: 28,
  boxShadow: "0 24px 80px rgba(0, 0, 0, 0.34)",
};

const styles: Record<string, CSSProperties> = {
  root: {
    background: palette.background,
    color: palette.text,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflow: "hidden",
  },
  backgroundOrbOne: {
    position: "absolute",
    width: 720,
    height: 720,
    left: -180,
    top: -220,
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(125, 211, 252, 0.24), transparent 68%)",
  },
  backgroundOrbTwo: {
    position: "absolute",
    width: 820,
    height: 820,
    right: -260,
    bottom: -280,
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(249, 168, 212, 0.2), transparent 70%)",
  },
  scene: {
    position: "absolute",
    inset: 72,
    display: "flex",
    flexDirection: "column",
    gap: 42,
  },
  header: {
    alignItems: "flex-start",
    display: "flex",
    justifyContent: "space-between",
  },
  kicker: {
    fontSize: 30,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    fontSize: 78,
    lineHeight: 1.02,
    margin: "18px 0 0",
    maxWidth: 1180,
  },
  counter: {
    ...baseCard,
    alignItems: "center",
    display: "flex",
    fontSize: 32,
    fontWeight: 800,
    height: 86,
    justifyContent: "center",
    width: 120,
  },
  main: {
    display: "grid",
    gap: 34,
    gridTemplateColumns: "1fr 0.92fr",
    minHeight: 0,
  },
  leftColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 28,
    minWidth: 0,
  },
  rightColumn: {
    minWidth: 0,
  },
  narration: {
    color: palette.text,
    fontSize: 35,
    lineHeight: 1.24,
    margin: 0,
    maxWidth: 980,
  },
  focusList: {
    ...baseCard,
    display: "grid",
    gap: 16,
    padding: 26,
  },
  focusItem: {
    alignItems: "flex-start",
    display: "grid",
    fontSize: 25,
    gap: 18,
    gridTemplateColumns: "54px 1fr",
    lineHeight: 1.25,
  },
  focusNumber: {
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 22,
    fontWeight: 800,
  },
  toolColumn: {
    display: "grid",
    gap: 18,
  },
  shell: {
    ...baseCard,
    overflow: "hidden",
  },
  shellHeader: {
    alignItems: "center",
    background: palette.cardStrong,
    display: "flex",
    gap: 18,
    padding: "18px 22px",
  },
  dots: {
    display: "flex",
    gap: 8,
  },
  dot: {
    borderRadius: "50%",
    display: "block",
    height: 14,
    width: 14,
  },
  shellTitle: {
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 20,
    fontWeight: 800,
  },
  pre: {
    color: palette.text,
    fontFamily: "Menlo, Monaco, Consolas, monospace",
    fontSize: 19,
    lineHeight: 1.42,
    margin: 0,
    maxHeight: 238,
    overflow: "hidden",
    padding: 22,
    whiteSpace: "pre-wrap",
  },
  libraryPanel: {
    ...baseCard,
    display: "flex",
    flexDirection: "column",
    gap: 24,
    height: "100%",
    padding: 28,
  },
  panelHeader: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
  },
  badge: {
    fontSize: 24,
    fontWeight: 900,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  panelHint: {
    color: palette.muted,
    fontSize: 20,
  },
  bookGrid: {
    display: "grid",
    gap: 18,
  },
  bookCard: {
    background: "rgba(15, 23, 42, 0.72)",
    border: `1px solid ${palette.border}`,
    borderRadius: 22,
    padding: 22,
  },
  bookTitle: {
    fontSize: 27,
    fontWeight: 850,
  },
  bookAuthor: {
    color: palette.muted,
    fontSize: 21,
    marginTop: 8,
  },
  bookMeta: {
    color: palette.text,
    display: "flex",
    fontSize: 19,
    gap: 20,
    marginTop: 16,
  },
  annotationList: {
    display: "grid",
    gap: 16,
  },
  annotationCard: {
    alignItems: "flex-start",
    background: "rgba(2, 6, 23, 0.38)",
    border: `1px solid ${palette.border}`,
    borderRadius: 20,
    display: "grid",
    gap: 14,
    gridTemplateColumns: "16px 1fr",
    padding: 18,
  },
  colorPill: {
    borderRadius: 999,
    height: "100%",
    minHeight: 58,
    width: 8,
  },
  annotationQuote: {
    fontSize: 21,
    lineHeight: 1.3,
  },
  annotationNote: {
    color: palette.muted,
    fontSize: 18,
    lineHeight: 1.28,
    marginTop: 8,
  },
  footer: {
    alignItems: "center",
    bottom: 30,
    color: palette.text,
    display: "flex",
    fontSize: 22,
    fontWeight: 750,
    gap: 24,
    left: 72,
    position: "absolute",
    right: 72,
  },
  footerMuted: {
    color: palette.muted,
    fontWeight: 600,
  },
  progressTrack: {
    background: "rgba(148, 163, 184, 0.18)",
    bottom: 0,
    height: 10,
    left: 0,
    position: "absolute",
    right: 0,
  },
  progressFill: {
    height: "100%",
  },
};
