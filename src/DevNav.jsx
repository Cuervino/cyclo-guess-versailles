// Shared navigation across the dev tools (random curation, free exploration,
// avis editor) so you can jump between them from any of them. `current`
// highlights the active tool: "curate" | "free" | "avis".
const TOOLS = [
  { key: "game", href: "#", label: "← Jeu" },
  { key: "curate", href: "#curate", label: "Mode aléatoire" },
  { key: "free", href: "#curate-free", label: "Exploration libre" },
  { key: "avis", href: "#avis", label: "Avis" },
];

export default function DevNav({ current }) {
  return (
    <nav className="devnav">
      {TOOLS.map((t) => (
        <a
          key={t.key}
          href={t.href}
          className={`devnav-link${t.key === current ? " active" : ""}`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}
