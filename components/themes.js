/* Theme palettes shared across the app and the about page.
   "ivory" is the foreground/marks color, "ember" the accent. */

export const THEMES = {
  soot: {
    label: "Soot",
    page: "#1E1813",
    card: "#130F0B",
    cardEdge: "#2A231B",
    ivory: "#F4ECDC",
    ivoryDim: "rgba(244,236,220,0.16)",
    ember: "#E8A33D",
    emberSoft: "rgba(232,163,61,0.35)",
    textDim: "#9C9183",
  },
  slate: {
    label: "Slate",
    page: "#0F1217",
    card: "#151A22",
    cardEdge: "#272F3B",
    ivory: "#E9EDF4",
    ivoryDim: "rgba(233,237,244,0.16)",
    ember: "#7FA8FF",
    emberSoft: "rgba(127,168,255,0.35)",
    textDim: "#8C95A4",
  },
  orchid: {
    label: "Orchid",
    page: "#14101B",
    card: "#1B1526",
    cardEdge: "#2F2740",
    ivory: "#F0EAF8",
    ivoryDim: "rgba(240,234,248,0.16)",
    ember: "#B98AFF",
    emberSoft: "rgba(185,138,255,0.35)",
    textDim: "#9A8FAE",
  },
  paper: {
    label: "Paper",
    page: "#EFEAE0",
    card: "#FAF7F1",
    cardEdge: "#DCD4C4",
    ivory: "#2A241C",
    ivoryDim: "rgba(42,36,28,0.18)",
    ember: "#C9722A",
    emberSoft: "rgba(201,114,42,0.30)",
    textDim: "#8B8270",
  },
};

export const THEME_KEY = "soot-theme";

export function loadTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t && THEMES[t]) return t;
  } catch (e) {}
  return "soot";
}

export function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* CSS custom properties for every theme, switched by html[data-soot].
   A pre-paint inline script sets the attribute from localStorage, so the
   first painted frame is already in the saved theme — no flash. */
export function themeStyleText() {
  const vars = (t) =>
    `--s-page:${t.page};--s-card:${t.card};--s-edge:${t.cardEdge};` +
    `--s-fg:${t.ivory};--s-fg-dim:${t.ivoryDim};--s-accent:${t.ember};` +
    `--s-accent-soft:${t.emberSoft};--s-text-dim:${t.textDim};` +
    `--s-page-veil:${hexA(t.page, 0.45)};--s-card-veil:${hexA(t.card, 0.6)};`;
  let css = `:root{${vars(THEMES.soot)}}`;
  for (const [id, t] of Object.entries(THEMES)) {
    css += `html[data-soot="${id}"]{${vars(t)}}`;
  }
  css += `body{background:var(--s-page);}`;
  return css;
}

export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t)document.documentElement.setAttribute("data-soot",t)}catch(e){}`;
