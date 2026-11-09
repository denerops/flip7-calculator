// Arte das cartas em SVG, compartilhada pelo marcador e pelo jogo online.

export const CARDS = [
  { n: 0, name: "Zero", ink: "#d9383a" },
  { n: 1, name: "Um", ink: "#d89648" },
  { n: 2, name: "Dois", ink: "#c8d627" },
  { n: 3, name: "Três", ink: "#de4982" },
  { n: 4, name: "Quatro", ink: "#47b5d6" },
  { n: 5, name: "Cinco", ink: "#28ae52" },
  { n: 6, name: "Seis", ink: "#8951a4" },
  { n: 7, name: "Sete", ink: "#e25038" },
  { n: 8, name: "Oito", ink: "#76be43" },
  { n: 9, name: "Nove", ink: "#ee9433" },
  { n: 10, name: "Dez", ink: "#dc2929" },
  { n: 11, name: "Onze", ink: "#7381b8" },
  { n: 12, name: "Doze", ink: "#8d8078" },
];

export const MODS = [
  { v: 2, ink: "#e35336" },
  { v: 4, ink: "#e35336" },
  { v: 6, ink: "#e35336" },
  { v: 8, ink: "#e35336" },
  { v: 10, ink: "#d9383a" },
];

export const X2_INK = "#d9383a";

export const ACTIONS = {
  freeze: { name: "Freeze", banner: "FREEZE", ink: "#47b5d6" },
  three: { name: "Flip Three", banner: "FLIP THREE", ink: "#f7b132" },
  chance: { name: "Segunda Chance", banner: "2ª CHANCE", ink: "#de4982" },
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export const DARK = "#231f28";
export const CREAM = "#f6eed8";

function at(x, y, deg, r) {
  const a = (deg * Math.PI) / 180;
  return [Math.round((x + r * Math.cos(a)) * 10) / 10, Math.round((y + r * Math.sin(a)) * 10) / 10];
}

function shellSvg(hx, hy, deg, r) {
  const lobes = 5;
  const spread = 66;
  const angle = (i) => deg - spread + (2 * spread * i) / lobes;
  const tips = Array.from({ length: lobes + 1 }, (_, i) => at(hx, hy, angle(i), r));
  let edge = `M${hx} ${hy}L${tips[0].join(" ")}`;
  for (let i = 0; i < lobes; i += 1) {
    edge += `Q${at(hx, hy, angle(i + 0.5), r * 1.22).join(" ")} ${tips[i + 1].join(" ")}`;
  }
  const ribs = tips
    .slice(1, -1)
    .map((tip, i) => `M${at(hx, hy, angle(i + 1), r * 0.24).join(" ")}L${tip.join(" ")}`)
    .join("");
  const back = at(hx, hy, deg + 180, r * 0.2);
  const ears = [at(hx, hy, deg - 90, r * 0.2), at(...back, deg - 90, r * 0.36), at(...back, deg + 90, r * 0.36), at(hx, hy, deg + 90, r * 0.2)];
  return `<g stroke="${DARK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"><path class="k" d="M${ears.map((p) => p.join(" ")).join("L")}Z"/><path class="k" d="${edge}Z"/><path fill="none" stroke-width=".9" d="${ribs}"/></g>`;
}

export function frameSvg(h) {
  return `<path fill="none" stroke="${DARK}" stroke-width="3.4" d="M13 7H37A13 13 0 0 0 63 7H87V13H93V${h - 13}H87V${h - 7}H63A13 13 0 0 0 37 ${h - 7}H13V${h - 13}H7V13H13Z"/><path fill="none" stroke="#e8c55a" stroke-width="1.5" d="M13 7H37A13 13 0 0 0 63 7H87V13H93V${h - 13}H87V${h - 7}H63A13 13 0 0 0 37 ${h - 7}H13V${h - 13}H7V13H13Z"/><g stroke="${DARK}" stroke-width="1.4"><path class="k" d="M40 0A10 10 0 0 0 60 0Z"/><path fill="${CREAM}" d="M45 0A5 5 0 0 0 55 0Z"/><path class="k" d="M40 ${h}A10 10 0 0 1 60 ${h}Z"/><path fill="${CREAM}" d="M45 ${h}A5 5 0 0 1 55 ${h}Z"/></g>`;
}

export function inlineNumber(text, cy, fs) {
  const y = Math.round((cy + fs * 0.35) * 10) / 10;
  return `<g font-family="'Bebas Neue', Impact, sans-serif" font-size="${fs}" text-anchor="middle" stroke-linejoin="round"><text x="51.6" y="${y + 1.6}" fill="${DARK}" stroke="${DARK}" stroke-width="7">${text}</text><text x="50" y="${y}" fill="${DARK}" stroke="${DARK}" stroke-width="7">${text}</text><text class="ks" x="50" y="${y}" stroke-width="4.2">${text}</text><text x="50" y="${y}" fill="none" stroke="${CREAM}" stroke-width="1.15">${text}</text></g>`;
}

const SHELLS = shellSvg(17, 60, 180, 18) + shellSvg(83, 60, 0, 18);
const MOD_SHELLS = shellSvg(50, 36, -90, 11) + shellSvg(50, 94, 90, 11);

function bannerSvg(label) {
  const ls = label.length > 7 ? 8.2 : label.length > 5 ? 9.4 : 10.2;
  return `<g stroke="${DARK}" stroke-width="1.3" stroke-linejoin="round"><path fill="#dccb9c" d="M19 103L10 104.5L13.5 109.5L10 114.5L19 116Z"/><path fill="#dccb9c" d="M81 103L90 104.5L86.5 109.5L90 114.5L81 116Z"/><path fill="#fcf7e8" d="M17 101Q50 98 83 101V117Q50 114 17 117Z"/></g><text x="50" y="112.4" font-family="Outfit, sans-serif" font-weight="800" font-size="${ls}" letter-spacing="1.1" fill="${DARK}" text-anchor="middle">${esc(label)}</text>`;
}

export function cardArtSvg(card) {
  const size = card.n > 9 ? 66 : 84;
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">${frameSvg(140)}${SHELLS}${inlineNumber(card.n, 60, size)}${bannerSvg(card.name.toUpperCase())}</svg>`;
}

export function modArtSvg(label) {
  return `<svg class="mod-svg" viewBox="0 0 100 130" aria-hidden="true">${frameSvg(130)}${MOD_SHELLS}${inlineNumber(label, 65, label.length > 2 ? 44 : 52)}</svg>`;
}

function snowflakeSvg() {
  const arms = [0, 60, 120, 180, 240, 300]
    .map((deg) => {
      const tip = at(50, 58, deg - 90, 30);
      const mid = at(50, 58, deg - 90, 17);
      const left = at(...mid, deg - 90 - 45, 9);
      const right = at(...mid, deg - 90 + 45, 9);
      return `M50 58L${tip.join(" ")}M${left.join(" ")}L${mid.join(" ")}L${right.join(" ")}`;
    })
    .join("");
  return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="${DARK}" stroke-width="9" d="${arms}"/><path class="kst" stroke-width="5" d="${arms}"/><path stroke="${CREAM}" stroke-width="1.1" d="${arms}"/></g><circle cx="50" cy="58" r="7" class="k" stroke="${DARK}" stroke-width="2"/><circle cx="50" cy="58" r="2.6" fill="${CREAM}"/>`;
}

function threeSvg() {
  const card = (deg) =>
    `<g transform="rotate(${deg} 50 90)"><rect x="35" y="34" width="30" height="44" rx="4" fill="#fcf7e8" stroke="${DARK}" stroke-width="2.2"/><rect x="38.5" y="37.5" width="23" height="37" rx="2.5" fill="none" stroke="#e8c55a" stroke-width="1.2"/></g>`;
  return `${card(-22)}${card(22)}${card(0)}${inlineNumber(3, 55, 42)}`;
}

function heartSvg() {
  const d = "M50 88C22 68 17 46 30 36C40 29 48 34 50 42C52 34 60 29 70 36C83 46 78 68 50 88Z";
  return `<path class="k" stroke="${DARK}" stroke-width="2.6" stroke-linejoin="round" d="${d}"/><path fill="none" stroke="${CREAM}" stroke-width="2.4" stroke-linecap="round" d="M32 47C32 42 35 39 39 38"/>${inlineNumber(2, 58, 34)}`;
}

export function actionArtSvg(kind) {
  const icon = kind === "freeze" ? snowflakeSvg() : kind === "three" ? threeSvg() : heartSvg();
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">${frameSvg(140)}${icon}${bannerSvg(ACTIONS[kind].banner)}</svg>`;
}

export function cardBackSvg() {
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">${frameSvg(140)}<text x="50" y="44" font-family="'Bebas Neue', Impact, sans-serif" font-size="22" letter-spacing="3" text-anchor="middle" fill="${CREAM}" stroke="${DARK}" stroke-width="3" paint-order="stroke">FLIP</text>${inlineNumber(7, 76, 70)}</svg>`;
}

export function cardFace(card, extra = "") {
  return `<div class="card ${extra}" style="--ink:${card.ink}" aria-hidden="true">${cardArtSvg(card)}</div>`;
}

/** Qualquer carta do baralho online: {t:"n",n} | {t:"m",v} | {t:"freeze"|"three"|"chance"}. */
export function anyCard(card, extra = "") {
  if (card.t === "n") return cardFace(CARDS[card.n], extra);
  if (card.t === "m") {
    const label = card.v === 0 ? "×2" : `+${card.v}`;
    return `<div class="mod ${extra}" style="--ink:${card.v === 0 ? X2_INK : MODS.find((m) => m.v === card.v)?.ink}" aria-hidden="true">${modArtSvg(label)}</div>`;
  }
  return `<div class="card act ${extra}" style="--ink:${ACTIONS[card.t].ink}" aria-hidden="true">${actionArtSvg(card.t)}</div>`;
}

export function cardBack(extra = "") {
  return `<div class="card back ${extra}" style="--ink:#f7b132" aria-hidden="true">${cardBackSvg()}</div>`;
}

export function heroHand() {
  const hand = [CARDS[2], CARDS[7], CARDS[10]];
  return `<div class="hero-hand" aria-hidden="true">${hand.map((card, i) => cardFace(card, `hero hero-${i}`)).join("")}</div>`;
}

export function brandMark() {
  return `<span class="mark" style="--ink:${CARDS[7].ink}" aria-hidden="true"><svg viewBox="0 0 100 140">${frameSvg(140)}${inlineNumber(7, 70, 104)}</svg></span>`;
}
