const TARGET = 200;
const FLIP_BONUS = 15;
const STORAGE_KEY = "flip7-marcador-v1";

const CARDS = [
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

const MODS = [
  { v: 2, ink: "#e35336" },
  { v: 4, ink: "#e35336" },
  { v: 6, ink: "#e35336" },
  { v: 8, ink: "#e35336" },
  { v: 10, ink: "#d9383a" },
];

let deferredInstall = null;
let toastTimer = 0;
let lastScreen = null;
let lastDialog = null;
let shownActive = null;
let usingKeyboard = false;

const state = {
  players: [],
  nextId: 1,
  rounds: [],
  activeId: null,
  screen: "setup",
  banner: "",
  dialog: null,
  toast: null,
  undo: null,
  hint: "",
  nameDraft: "",
  lateDraft: "",
  _focus: "",
};

function blankEntry() {
  return {
    numbers: [],
    bonuses: [],
    x2: false,
    bust: false,
    confirmed: false,
  };
}

function blankRound() {
  const entries = {};
  for (const player of state.players) {
    entries[player.id] = blankEntry();
  }
  return { closed: false, entries };
}

function normalizeEntry(entry) {
  const blank = blankEntry();
  if (!entry || typeof entry !== "object") return blank;
  const numbers = [2, 4, 6, 8, 10];
  // Entradas antigas gravadas como total digitado viram zero, já que só existem cartas agora.
  const typed = typeof entry.typed === "string" ? entry.typed.replace(/\D/g, "").slice(0, 3) : "";
  const legacy = entry.source === "manual" && typed !== "";
  return {
    numbers: Array.isArray(entry.numbers) ? entry.numbers.map(Number).filter((n) => n >= 0 && n <= 12) : [],
    bonuses: Array.isArray(entry.bonuses) ? entry.bonuses.map(Number).filter((n) => numbers.includes(n)) : [],
    x2: Boolean(entry.x2),
    bust: Boolean(entry.bust) || legacy,
    confirmed: Boolean(entry.confirmed),
  };
}

// Ordem oficial: soma dos números, ×2, modificadores +, bônus de Flip 7.
function scoreOf(entry) {
  if (!entry || entry.bust) {
    return { total: 0, bust: true, flip7: false, numbersSum: 0, afterX2: 0, bonusSum: 0 };
  }
  const numbersSum = entry.numbers.reduce((sum, n) => sum + n, 0);
  const afterX2 = entry.x2 ? numbersSum * 2 : numbersSum;
  const bonusSum = entry.bonuses.reduce((sum, n) => sum + n, 0);
  const flip7 = entry.numbers.length === 7;
  return {
    total: afterX2 + bonusSum + (flip7 ? FLIP_BONUS : 0),
    bust: false,
    flip7,
    numbersSum,
    afterX2,
    bonusSum,
  };
}

function selfCheck() {
  const empty = blankEntry();
  const cases = [
    [{ ...empty, numbers: [3, 5, 7, 10, 11] }, 36],
    [{ ...empty, numbers: [3, 5, 7, 10, 11], x2: true }, 72],
    [{ ...empty, numbers: [3, 5, 7, 10, 11], bonuses: [10] }, 46],
    [{ ...empty, numbers: [3, 5, 9, 11], x2: true, bonuses: [6] }, 62],
    [{ ...empty, numbers: [0, 1, 2, 3, 4, 5, 6] }, 36],
    [{ ...empty, bonuses: [10] }, 10],
    [{ ...empty, x2: true, bonuses: [10] }, 10],
    [{ ...empty, numbers: [12, 11, 10], bust: true }, 0],
    [{ ...empty, numbers: [12, 11, 10, 9, 8, 7, 6], x2: true, bonuses: [2, 4, 6, 8, 10] }, 171],
  ];
  for (const [entry, total] of cases) {
    const got = scoreOf(entry).total;
    if (got !== total) throw new Error(`Conta esperada ${total}, saiu ${got}`);
  }
  if (!scoreOf({ ...empty, numbers: [0, 1, 2, 3, 4, 5, 6] }).flip7) throw new Error("Flip 7");
}

function currentRound() {
  return state.rounds.at(-1) || null;
}

function activePlayer() {
  return state.players.find((player) => player.id === state.activeId) || state.players[0] || null;
}

function activeEntry() {
  const player = activePlayer();
  const round = currentRound();
  if (!player || !round) return blankEntry();
  return round.entries[player.id] || blankEntry();
}

function entryBlank(entry) {
  return !entry.confirmed && !entry.bust && entry.numbers.length === 0 && entry.bonuses.length === 0 && !entry.x2;
}

function hasDraft(entry) {
  return entry.numbers.length > 0 || entry.bonuses.length > 0 || entry.x2;
}

function roundReady() {
  const round = currentRound();
  if (!round || round.closed) return false;
  return state.players.every((player) => round.entries[player.id]?.confirmed);
}

function standings() {
  const totals = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  for (const round of state.rounds) {
    for (const player of state.players) {
      const entry = round.entries[player.id];
      if (!entry) continue;
      if (!round.closed && !entry.confirmed) continue;
      totals[player.id] += scoreOf(entry).total;
    }
  }
  const rows = state.players.map((player, seat) => ({ ...player, total: totals[player.id], seat }));
  rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
  let lastTotal = null;
  let rank = 0;
  return rows.map((row, index) => {
    if (row.total !== lastTotal) rank = index + 1;
    lastTotal = row.total;
    return { ...row, rank };
  });
}

function roundNumber() {
  const closed = state.rounds.filter((round) => round.closed).length;
  return state.screen === "victory" ? state.rounds.length : closed + 1;
}

function payload() {
  return {
    players: state.players,
    nextId: state.nextId,
    rounds: state.rounds,
    activeId: state.activeId,
    screen: state.screen,
    banner: state.banner,
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload()));
  } catch {
    /* navegador privado */
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.players)) return;
    state.players = data.players.filter((player) => player && player.id && typeof player.name === "string");
    state.nextId = Number(data.nextId) || state.players.length + 1;
    state.rounds = Array.isArray(data.rounds) ? data.rounds : [];
    state.activeId = data.activeId || null;
    state.screen = ["setup", "play", "victory"].includes(data.screen) ? data.screen : "setup";
    state.banner = typeof data.banner === "string" ? data.banner : "";
    for (const round of state.rounds) {
      round.closed = Boolean(round.closed);
      round.entries = round.entries || {};
      for (const id of Object.keys(round.entries)) round.entries[id] = normalizeEntry(round.entries[id]);
      if (!round.closed) {
        for (const player of state.players) {
          if (!round.entries[player.id]) round.entries[player.id] = blankEntry();
        }
      }
    }
    if ((state.screen === "play" || state.screen === "victory") && state.players.length < 2) state.screen = "setup";
    if (state.screen === "play" && !currentRound()) state.rounds.push(blankRound());
    if (state.screen === "play" && !state.players.some((player) => player.id === state.activeId)) {
      state.activeId = state.players[0]?.id || null;
    }
  } catch {
    /* partida nova */
  }
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function buzz(strong) {
  try {
    navigator.vibrate?.(strong ? [12, 40, 16] : 12);
  } catch {
    /* sem vibração */
  }
}

function commit() {
  save();
  render();
}

function tryAddPlayer(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 18);
  if (!name) return "Diz o nome de quem vai jogar.";
  if (state.players.some((player) => player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
    return "Esse nome já está na mesa.";
  }
  if (state.players.length >= 18) return "A mesa vai até 18 jogadores.";
  const player = { id: "p" + state.nextId++, name };
  state.players.push(player);
  for (const round of state.rounds) {
    if (!round.closed) round.entries[player.id] = blankEntry();
  }
  if (state.screen === "play") state.activeId = player.id;
  return "";
}

function submitName(raw, field) {
  const error = tryAddPlayer(raw);
  state[field] = error ? raw : "";
  state.hint = error;
  if (!error && state.dialog === "menu") state.dialog = null;
  if (!error && field === "nameDraft") state._focus = "player-name";
  commit();
}

function removePlayer(id) {
  if (state.screen !== "setup") return;
  state.players = state.players.filter((player) => player.id !== id);
  state.hint = "";
  commit();
}

function movePlayer(id, dir) {
  const index = state.players.findIndex((player) => player.id === id);
  const next = index + dir;
  if (index < 0 || next < 0 || next >= state.players.length) return;
  const [player] = state.players.splice(index, 1);
  state.players.splice(next, 0, player);
  commit();
}

function startGame() {
  if (state.players.length < 2) {
    state.hint = "Chama pelo menos mais uma pessoa.";
    commit();
    return;
  }
  state.rounds = [blankRound()];
  state.screen = "play";
  state.banner = "";
  state.activeId = state.players[0].id;
  state.undo = null;
  state.toast = null;
  state.dialog = null;
  state.hint = "";
  commit();
}

function selectPlayer(id) {
  const round = currentRound();
  if (!round || round.closed) return;
  const entry = round.entries[id];
  if (!entry) return;
  if (id === state.activeId && !entry.confirmed && !roundReady()) return;
  if (entry.confirmed) entry.confirmed = false;
  state.activeId = id;
  state.hint = "";
  commit();
}

function selectRelative(delta) {
  const rows = standings();
  if (!rows.length) return;
  let index = rows.findIndex((row) => row.id === state.activeId);
  if (index < 0) index = 0;
  const next = rows[(index + delta + rows.length) % rows.length];
  selectPlayer(next.id);
}

function ownerOf(kind, value) {
  const round = currentRound();
  for (const player of state.players) {
    if (player.id === state.activeId) continue;
    const entry = round?.entries[player.id];
    if (!entry) continue;
    if (kind === "x2" && entry.x2) return player;
    if (kind === "bonus" && entry.bonuses.includes(value)) return player;
  }
  return null;
}

function toggleNumber(raw) {
  const entry = activeEntry();
  if (entry.confirmed) return;
  const n = Number(raw);
  if (entry.numbers.includes(n)) {
    entry.numbers = entry.numbers.filter((value) => value !== n);
    state.hint = "";
  } else if (entry.numbers.length >= 7) {
    state.hint = "São 7 números no máximo. Repetiu, estourou.";
  } else {
    entry.numbers = [...entry.numbers, n].sort((a, b) => a - b);
    state.hint = "";
    if (entry.numbers.length === 7) buzz(true);
  }
  commit();
}

function toggleBonus(raw) {
  const entry = activeEntry();
  if (entry.confirmed) return;
  const value = Number(raw);
  if (entry.bonuses.includes(value)) {
    entry.bonuses = entry.bonuses.filter((bonus) => bonus !== value);
    state.hint = "";
    commit();
    return;
  }
  const owner = ownerOf("bonus", value);
  if (owner) {
    state.hint = `O +${value} já está com ${owner.name}.`;
    commit();
    return;
  }
  entry.bonuses = [...entry.bonuses, value].sort((a, b) => a - b);
  state.hint = "";
  commit();
}

function toggleX2() {
  const entry = activeEntry();
  if (entry.confirmed) return;
  if (entry.x2) {
    entry.x2 = false;
    state.hint = "";
    commit();
    return;
  }
  const owner = ownerOf("x2");
  if (owner) {
    state.hint = `O ×2 já está com ${owner.name}.`;
    commit();
    return;
  }
  entry.x2 = true;
  state.hint = "";
  commit();
}

function clearActive() {
  const entry = activeEntry();
  if (entry.confirmed) return;
  const fresh = blankEntry();
  Object.assign(entry, fresh);
  state.hint = "";
  commit();
}

function rememberUndo(snapshot, text) {
  state.undo = {
    playerId: state.activeId,
    entry: snapshot,
    activeId: state.activeId,
    roundIndex: state.rounds.length - 1,
  };
  state.toast = { text };
}

function nextOpen(fromId) {
  const ids = state.players.map((player) => player.id);
  const start = Math.max(0, ids.indexOf(fromId));
  const round = currentRound();
  for (let step = 1; step <= ids.length; step += 1) {
    const id = ids[(start + step) % ids.length];
    if (!round.entries[id].confirmed) return id;
  }
  return fromId;
}

function advanceFrom(id) {
  state.activeId = nextOpen(id);
}

function confirmActive() {
  const entry = activeEntry();
  const player = activePlayer();
  if (!player || entry.confirmed) return;
  if (!entry.bust && !hasDraft(entry)) {
    state.hint = "Marque as cartas da mão ou toque em Estourou.";
    commit();
    return;
  }
  const snapshot = structuredClone(entry);
  entry.confirmed = true;
  const score = scoreOf(entry);
  rememberUndo(snapshot, entry.bust ? `${player.name} estourou` : `${player.name} +${score.total}`);
  buzz(score.flip7);
  advanceFrom(player.id);
  state.hint = "";
  commit();
}

function bustActive() {
  const entry = activeEntry();
  const player = activePlayer();
  if (!player || entry.confirmed) return;
  if (entry.bust) {
    entry.bust = false;
    state.hint = "";
    commit();
    return;
  }
  const snapshot = structuredClone(entry);
  entry.bust = true;
  entry.confirmed = true;
  rememberUndo(snapshot, `${player.name} estourou`);
  buzz(false);
  advanceFrom(player.id);
  state.hint = "";
  commit();
}

function undo() {
  const snapshot = state.undo;
  const round = currentRound();
  if (!snapshot || !round || round.closed || snapshot.roundIndex !== state.rounds.length - 1) {
    state.undo = null;
    state.toast = null;
    commit();
    return;
  }
  round.entries[snapshot.playerId] = structuredClone(snapshot.entry);
  state.activeId = snapshot.playerId;
  state.undo = null;
  state.toast = null;
  state.hint = "";
  state.dialog = null;
  commit();
}

function closeRound() {
  if (!roundReady()) return;
  const round = currentRound();
  round.closed = true;
  const rows = standings();
  const top = rows[0];
  const tied = rows.filter((row) => row.total === top.total);
  state.undo = null;
  state.toast = null;
  state.hint = "";
  state.dialog = null;
  if (top.total >= TARGET && tied.length === 1) {
    state.banner = "";
    state.screen = "victory";
    buzz(true);
  } else {
    state.banner = top.total >= TARGET ? "Empate na liderança. Mais uma rodada — só um pode ficar na frente." : "";
    state.rounds.push(blankRound());
    state.activeId = state.players[0].id;
  }
  commit();
}

function canReopen() {
  if (state.screen === "victory") return state.rounds.length > 0;
  if (state.screen !== "play" || state.rounds.length < 2) return false;
  const last = state.rounds.at(-1);
  return !last.closed && Object.values(last.entries).every((entry) => !entry.confirmed);
}

function reopenPrevious() {
  if (!canReopen()) return;
  if (state.screen === "play") state.rounds.pop();
  const target = state.rounds.at(-1);
  if (!target) return;
  target.closed = false;
  state.screen = "play";
  state.banner = "";
  state.activeId = state.players[0].id;
  state.undo = null;
  state.toast = null;
  state.dialog = null;
  state.hint = "";
  commit();
}

function resetMatch() {
  state.rounds = [];
  state.screen = "setup";
  state.banner = "";
  state.activeId = null;
  state.undo = null;
  state.toast = null;
  state.dialog = null;
  state.hint = "";
  commit();
}

function rematch() {
  state.rounds = [blankRound()];
  state.screen = "play";
  state.banner = "";
  state.activeId = state.players[0].id;
  state.undo = null;
  state.toast = null;
  state.dialog = null;
  state.hint = "";
  commit();
}

async function installApp() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try {
    await deferredInstall.userChoice;
  } catch {
    /* instalação cancelada */
  }
  deferredInstall = null;
  commit();
}

function detail(entry) {
  if (entry.bust) return "estourou";
  const bits = [];
  if (entry.numbers.length) bits.push(entry.numbers.join("+"));
  if (entry.x2) bits.push("×2");
  if (entry.bonuses.length) bits.push(entry.bonuses.map((n) => `+${n}`).join(" "));
  if (entry.numbers.length === 7) bits.push("+15");
  return bits.join(" ") || "0";
}

function formula(entry, score) {
  if (entry.bust) return "Estourou. Esta rodada vale 0.";
  if (!entry.numbers.length && !entry.bonuses.length && !entry.x2) return "Toque os números da mão. O 0 conta para o Flip 7.";
  const bits = [];
  if (entry.numbers.length) bits.push(`<span>${entry.numbers.join(" + ")} = ${score.numbersSum}</span>`);
  if (entry.x2) bits.push(`<span>×2 = ${score.afterX2}</span>`);
  if (entry.bonuses.length) bits.push(`<span>${entry.bonuses.map((n) => `+${n}`).join(" ")}</span>`);
  if (score.flip7) bits.push(`<span class="pill">Flip 7 +15</span>`);
  return bits.join("");
}

const DARK = "#231f28";
const CREAM = "#f6eed8";

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

function frameSvg(h) {
  return `<path fill="none" stroke="${DARK}" stroke-width="3.4" d="M13 7H37A13 13 0 0 0 63 7H87V13H93V${h - 13}H87V${h - 7}H63A13 13 0 0 0 37 ${h - 7}H13V${h - 13}H7V13H13Z"/><path fill="none" stroke="#e8c55a" stroke-width="1.5" d="M13 7H37A13 13 0 0 0 63 7H87V13H93V${h - 13}H87V${h - 7}H63A13 13 0 0 0 37 ${h - 7}H13V${h - 13}H7V13H13Z"/><g stroke="${DARK}" stroke-width="1.4"><path class="k" d="M40 0A10 10 0 0 0 60 0Z"/><path fill="${CREAM}" d="M45 0A5 5 0 0 0 55 0Z"/><path class="k" d="M40 ${h}A10 10 0 0 1 60 ${h}Z"/><path fill="${CREAM}" d="M45 ${h}A5 5 0 0 1 55 ${h}Z"/></g>`;
}

function inlineNumber(text, cy, fs) {
  const y = Math.round((cy + fs * 0.35) * 10) / 10;
  return `<g font-family="'Bebas Neue', Impact, sans-serif" font-size="${fs}" text-anchor="middle" stroke-linejoin="round"><text x="51.6" y="${y + 1.6}" fill="${DARK}" stroke="${DARK}" stroke-width="7">${text}</text><text x="50" y="${y}" fill="${DARK}" stroke="${DARK}" stroke-width="7">${text}</text><text class="ks" x="50" y="${y}" stroke-width="4.2">${text}</text><text x="50" y="${y}" fill="none" stroke="${CREAM}" stroke-width="1.15">${text}</text></g>`;
}

const SHELLS = shellSvg(17, 60, 180, 18) + shellSvg(83, 60, 0, 18);
const MOD_SHELLS = shellSvg(50, 36, -90, 11) + shellSvg(50, 94, 90, 11);

function cardArtSvg(card) {
  const size = card.n > 9 ? 66 : 84;
  const ls = card.name.length > 5 ? 9.4 : 10.2;
  return `<svg class="card-svg" viewBox="0 0 100 140" aria-hidden="true">${frameSvg(140)}${SHELLS}${inlineNumber(card.n, 60, size)}<g stroke="${DARK}" stroke-width="1.3" stroke-linejoin="round"><path fill="#dccb9c" d="M19 103L10 104.5L13.5 109.5L10 114.5L19 116Z"/><path fill="#dccb9c" d="M81 103L90 104.5L86.5 109.5L90 114.5L81 116Z"/><path fill="#fcf7e8" d="M17 101Q50 98 83 101V117Q50 114 17 117Z"/></g><text x="50" y="112.4" font-family="Outfit, sans-serif" font-weight="800" font-size="${ls}" letter-spacing="1.1" fill="${DARK}" text-anchor="middle">${esc(card.name.toUpperCase())}</text></svg>`;
}

function modArtSvg(label) {
  return `<svg class="mod-svg" viewBox="0 0 100 130" aria-hidden="true">${frameSvg(130)}${MOD_SHELLS}${inlineNumber(label, 65, label.length > 2 ? 44 : 52)}</svg>`;
}

function cardButton(card, pressed) {
  return `<button type="button" class="card${pressed ? " on" : ""}" style="--ink:${card.ink}" data-action="toggle-number" data-n="${card.n}" data-focus="n-${card.n}" aria-pressed="${pressed}" aria-label="${card.n}, ${esc(card.name)}">${cardArtSvg(card)}</button>`;
}

function cardFace(card, extra) {
  return `<div class="card ${extra}" style="--ink:${card.ink}" aria-hidden="true">${cardArtSvg(card)}</div>`;
}

function heroHand() {
  const hand = [CARDS[2], CARDS[7], CARDS[10]];
  return `<div class="hero-hand" aria-hidden="true">${hand
    .map((card, i) => cardFace(card, `hero hero-${i}`))
    .join("")}</div>`;
}

function boardTable(rows) {
  const head = state.rounds.map((_, index) => `<th scope="col">R${index + 1}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = state.rounds
        .map((round) => {
          const entry = round.entries[row.id];
          if (!entry) return "<td>·</td>";
          if (!round.closed && !entry.confirmed) return "<td>—</td>";
          const score = scoreOf(entry);
          return `<td>${score.bust ? "0" : score.total}</td>`;
        })
        .join("");
      const leader = row.rank === 1 && row.total > 0 ? "leader" : "";
      return `<tr class="${leader}"><th scope="row">${row.rank} ${esc(row.name)}</th>${cells}<td class="total">${row.total}</td></tr>`;
    })
    .join("");
  return `<div class="board-wrap"><table class="board"><thead><tr><th scope="col">Jogador</th>${head}<th class="total" scope="col">Total</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function toastView() {
  if (!state.toast) return "";
  const undo = state.undo ? `<button type="button" data-action="undo">Desfazer</button>` : "";
  return `<div class="toast" role="status"><span>${esc(state.toast.text)}</span>${undo}</div>`;
}

function chipView(row) {
  const round = currentRound();
  const entry = round?.entries[row.id];
  const pending = !entry || !entry.confirmed;
  const delta = !entry ? "·" : pending ? (row.id === state.activeId && !roundReady() ? "agora" : "lançar") : entry.bust || scoreOf(entry).total === 0 ? "0" : `+${scoreOf(entry).total}`;
  const deltaClass = pending ? "pending" : delta === "0" ? "zero" : "";
  const leader = row.rank === 1 && row.total > 0 ? " leader" : "";
  const current = row.id === state.activeId ? "true" : "false";
  return `<button type="button" class="chip${leader}" data-action="select" data-id="${row.id}" data-focus="player-${row.id}" aria-current="${current}" aria-label="${row.rank}º ${esc(row.name)}, ${row.total} pontos${pending ? ", falta lançar" : `, ${delta} nesta rodada`}">
    <span class="rk">${row.rank}</span>
    <span class="nm">${esc(row.name)}</span>
    <span class="tot">${row.total}</span>
    <span class="delta ${deltaClass}">${delta}</span>
  </button>`;
}

function banners(rows) {
  const notes = [];
  if (state.banner) notes.push(state.banner);
  const round = currentRound();
  const flip = state.players.find((player) => {
    const entry = round?.entries[player.id];
    return entry && !entry.bust && entry.numbers.length === 7;
  });
  if (flip && !roundReady()) notes.push(`${flip.name} fez Flip 7. A rodada acaba para todo mundo.`);
  const over = rows.filter((row) => row.total >= TARGET);
  if (over.length && !roundReady()) notes.push("Alguém passou de 200. Ainda dá para lançar o resto da mesa.");
  if (over.length && roundReady()) {
    const sole = rows.length < 2 || rows[0].total > rows[1].total;
    notes.push(sole ? `${rows[0].name} chegou a ${rows[0].total}. Feche a rodada para encerrar.` : "Empate na meta. Se fechar agora, a partida continua.");
  }
  return notes.map((note) => `<p class="banner">${esc(note)}</p>`).join("");
}

function calculatorView(player, entry) {
  const score = scoreOf(entry);
  const display = score.total;
  const full = entry.numbers.length === 7;
  const slots = Array.from({ length: 7 }, (_, i) => {
    const n = entry.numbers[i];
    return n === undefined ? `<span class="slot"></span>` : `<span class="slot on" style="--ink:${CARDS[n].ink}">${n}</span>`;
  }).join("");
  const hand = `<div class="hand${full ? " flip" : ""}" role="img" aria-label="${entry.numbers.length} de 7 números">${slots}</div>`;
  const mods = MODS.map((mod) => {
    const owner = ownerOf("bonus", mod.v);
    const on = entry.bonuses.includes(mod.v);
    return `<button type="button" class="mod${on ? " on" : ""}${owner ? " taken" : ""}" style="--ink:${mod.ink}" data-action="toggle-bonus" data-n="${mod.v}" data-focus="bonus-${mod.v}" aria-pressed="${on}" aria-label="Modificador +${mod.v}${owner ? `, com ${esc(owner.name)}` : ""}" title="${owner ? `Com ${owner.name}` : `+${mod.v}`}">${modArtSvg(`+${mod.v}`)}</button>`;
  }).join("");
  const xOwner = ownerOf("x2");
  const entryBody = `<div class="entry${full ? " full" : ""}"><div class="grid">${CARDS.slice(0, 10)
    .map((card) => cardButton(card, entry.numbers.includes(card.n)))
    .join("")}</div><div class="grid three">${CARDS.slice(10)
    .map((card) => cardButton(card, entry.numbers.includes(card.n)))
    .join("")}</div><div class="mods">${mods}<button type="button" class="mod x2${entry.x2 ? " on" : ""}${xOwner ? " taken" : ""}" style="--ink:#d9383a" data-action="toggle-x2" data-focus="x2" aria-pressed="${entry.x2}" aria-label="Vezes 2${xOwner ? `, com ${esc(xOwner.name)}` : ""}">${modArtSvg("×2")}</button></div><p class="legend">×2 dobra os números. Os + entram depois. 7 números: +15.</p></div>`;
  return `<section class="calc${entry.bust ? " bust" : ""}">
    <div class="hand-head">
      <div class="hand-info">
        <p class="who">Vez de <strong>${esc(player.name)}</strong></p>
        ${hand}
      </div>
      <div class="score${score.flip7 ? " flip" : ""}${entry.bust ? " bust" : ""}"><b>${display}</b><span>nesta rodada</span></div>
    </div>
    <p class="formula">${formula(entry, score)}</p>
    ${state.hint ? `<p class="warn" role="status">${esc(state.hint)}</p>` : ""}
    ${entryBody}
  </section>`;
}

function summaryView(rows) {
  const list = rows
    .map((row) => {
      const entry = currentRound().entries[row.id];
      const score = scoreOf(entry);
      return `<article class="sum-row${row.rank === 1 && row.total > 0 ? " leader" : ""}">
        <span class="rk">${row.rank}</span>
        <div class="meta"><span class="nm">${esc(row.name)}</span><small>${esc(detail(entry))}</small></div>
        <span class="round">${entry.bust ? "0" : `+${score.total}`}</span>
        <span class="tot">total ${row.total}<br><button type="button" class="linkish" data-action="select" data-id="${row.id}">corrigir</button></span>
      </article>`;
    })
    .join("");
  return `<section class="calc"><h2>Rodada ${roundNumber()}</h2><div class="sum">${list}</div></section>`;
}

function dockView() {
  if (roundReady()) {
    return `<footer class="dock">${toastView()}<button type="button" class="primary xl" data-action="close-round">Fechar rodada</button></footer>`;
  }
  const entry = activeEntry();
  const player = activePlayer();
  if (entry.confirmed) {
    return `<footer class="dock">${toastView()}<button type="button" class="primary xl" data-action="select" data-id="${player.id}">Corrigir ${esc(player.name)}</button></footer>`;
  }
  const score = scoreOf(entry);
  const showClear = entry.bust || hasDraft(entry);
  const label = entry.bust ? "Confirmar 0" : hasDraft(entry) ? `Confirmar ${score.total}` : "Confirmar";
  const bustLabel = entry.bust ? "Não estourou" : "Estourou";
  return `<footer class="dock">${toastView()}${showClear ? `<div class="dock-tools"><button type="button" class="textbtn" data-action="clear">Limpar</button></div>` : ""}<div class="dock-row"><button type="button" class="ghost" data-action="bust">${bustLabel}</button><button type="button" class="primary" data-action="confirm">${label}</button></div></footer>`;
}

function playView() {
  const rows = standings();
  const leader = rows[0]?.total || 0;
  const pct = Math.max(0, Math.min(100, (leader / TARGET) * 100));
  const player = activePlayer();
  const entry = activeEntry();
  const body = roundReady() ? summaryView(rows) : calculatorView(player, entry);
  return `<main class="play">
    <header class="top">
      <div class="brandline">
        <div class="brand"><span class="mark" style="--ink:${CARDS[7].ink}" aria-hidden="true"><svg viewBox="0 0 100 140">${frameSvg(140)}${inlineNumber(7, 70, 104)}</svg></span><div><h1>Flip 7</h1><p>Rodada ${roundNumber()}</p></div></div>
        <div class="metawrap"><p class="meta">${leader} / ${TARGET}</p><button type="button" class="iconbtn" data-action="open-menu" aria-label="Menu da mesa">···</button></div>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${TARGET}" aria-valuenow="${leader}" aria-label="Pontos de quem lidera, meta ${TARGET}"><span style="width:${pct}%"></span></div>
      ${banners(rows)}
    </header>
    <nav class="rank" aria-label="Placar">${rows.map(chipView).join("")}</nav>
    ${body}
    ${dockView()}
  </main>`;
}

function setupView() {
  const people =
    state.players.length === 0
      ? `<p class="empty">Ninguém ainda. Comece por quem dá as cartas.</p>`
      : `<ul class="roster">${state.players
          .map((player, index) => {
            const up = index === 0 ? "disabled" : "";
            const down = index === state.players.length - 1 ? "disabled" : "";
            return `<li><span class="seat">${index + 1}</span><span class="nm">${esc(player.name)}</span>
              <button type="button" class="nudge" data-action="move" data-id="${player.id}" data-dir="-1" aria-label="Subir ${esc(player.name)}" ${up}>↑</button>
              <button type="button" class="nudge" data-action="move" data-id="${player.id}" data-dir="1" aria-label="Descer ${esc(player.name)}" ${down}>↓</button>
              <button type="button" class="textbtn" data-action="remove-player" data-id="${player.id}" aria-label="Remover ${esc(player.name)}">tirar</button></li>`;
          })
          .join("")}</ul>`;
  const install = deferredInstall ? `<button type="button" class="ghost xl" data-action="install">Instalar o app</button>` : "";
  const ios =
    (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
    !(navigator.standalone || matchMedia("(display-mode: standalone)").matches)
      ? `<p class="fine">Para usar em tela cheia: Compartilhar, depois Adicionar à Tela de Início.</p>`
      : "";
  return `<main class="setup">
    ${heroHand()}
    <p class="eyebrow">Marcador de mesa</p>
    <h1>Flip 7</h1>
    <p class="lede">Cadastre a mesa. No fim da rodada, toque as cartas de cada mão — a conta e a ordem do placar saem na hora.</p>
    <form data-form="add-player">
      <label class="order" for="player-name">Nome</label>
      <div class="adder">
        <input id="player-name" name="player" maxlength="18" autocomplete="off" autocapitalize="words" autocorrect="off" enterkeyhint="done" placeholder="Quem joga" value="${esc(state.nameDraft)}">
        <button type="submit">Entrar</button>
      </div>
    </form>
    ${state.hint ? `<p class="warn" role="status">${esc(state.hint)}</p>` : ""}
    <p class="order">Ordem da mesa${state.players.length ? ` · ${state.players.length}` : ""}</p>
    ${people}
    <div class="stack">
      <button type="button" class="primary xl" data-action="start" ${state.players.length < 2 ? "disabled" : ""}>Começar partida</button>
      ${install}
    </div>
    <p class="fine">De 2 a 18 pessoas. A meta é 200. O ×2 dobra só os números; os + entram depois; sete números diferentes valem +15.</p>
    ${ios}
  </main>`;
}

function victoryView() {
  const rows = standings();
  const winner = rows[0];
  const podium = rows
    .map(
      (row) => `<li class="${row.rank === 1 ? "leader" : ""}"><span class="rk">${row.rank}</span><span class="nm">${esc(row.name)}</span><span class="tot">${row.total}</span></li>`
    )
    .join("");
  return `<main class="victory">
    ${heroHand()}
    <p class="eyebrow">Fim de jogo</p>
    <h1>${esc(winner.name)} venceu</h1>
    <p class="win-score">${winner.total}</p>
    <ol class="podium">${podium}</ol>
    ${boardTable(rows)}
    <div class="stack">
      <button type="button" class="primary xl" data-action="rematch">Jogar de novo</button>
      <button type="button" class="ghost xl" data-action="reset">Trocar jogadores</button>
      <button type="button" class="textbtn" data-action="reopen">Corrigir a última rodada</button>
    </div>
  </main>`;
}

function dialogView() {
  if (!state.dialog) return "";
  const rows = standings();
  let body = "";
  if (state.dialog === "menu") {
    body = `<h2 id="sheet-title">Mesa</h2>
      <div class="menu">
        <button type="button" data-action="open-history">Placar das rodadas</button>
        <button type="button" data-action="undo" ${state.undo ? "" : "disabled"}>Desfazer última</button>
        ${canReopen() ? `<button type="button" data-action="reopen">Corrigir rodada anterior</button>` : ""}
        <button type="button" class="danger" data-action="ask-reset">Nova partida</button>
      </div>
      <form class="adder" data-form="add-late">
        <input id="late-name" name="player" maxlength="18" autocomplete="off" autocapitalize="words" autocorrect="off" enterkeyhint="done" placeholder="Novo jogador" value="${esc(state.lateDraft)}" aria-label="Novo jogador">
        <button type="submit">Entrar</button>
      </form>
      <button type="button" class="wide" data-action="dismiss" style="margin-top:8px">Fechar</button>`;
  } else if (state.dialog === "history") {
    body = `<h2 id="sheet-title">Placar</h2>${boardTable(rows)}<button type="button" class="wide" data-action="open-menu">Voltar</button>`;
  } else if (state.dialog === "reset") {
    body = `<h2 id="sheet-title">Nova partida</h2><p>Apagar os pontos desta partida? Os nomes continuam na mesa.</p><div class="pair"><button type="button" class="ghost" data-action="dismiss">Cancelar</button><button type="button" class="primary" data-action="reset">Apagar</button></div>`;
  }
  return `<div class="modal" data-action="backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div></div>`;
}

function view() {
  if (state.screen === "setup") return setupView();
  if (state.screen === "victory") return victoryView() + dialogView();
  return playView() + dialogView();
}

function title() {
  if (state.screen === "victory") {
    const winner = standings()[0];
    return winner ? `${winner.name} venceu · Flip 7` : "Flip 7 — Marcador";
  }
  if (state.screen === "play") {
    const player = activePlayer();
    const score = scoreOf(activeEntry());
    return player ? `${player.name} · ${score.total} · Flip 7` : "Flip 7";
  }
  return "Flip 7 — Marcador";
}

function render() {
  const y = window.scrollY;
  const rankLeft = document.querySelector(".rank")?.scrollLeft ?? 0;
  const calcTop = document.querySelector(".calc")?.scrollTop ?? 0;
  const focusKey = usingKeyboard ? document.activeElement?.getAttribute?.("data-focus") : "";
  const root = document.getElementById("app");
  document.body.classList.toggle("in-play", state.screen === "play");
  root.innerHTML = view();
  document.title = title();
  const rank = document.querySelector(".rank");
  if (rank) rank.scrollLeft = rankLeft;
  const calc = document.querySelector(".calc");
  if (calc) calc.scrollTop = calcTop;
  if (state.screen !== lastScreen) {
    window.scrollTo(0, 0);
    lastScreen = state.screen;
  } else {
    window.scrollTo(0, y);
  }
  if (state.screen === "play" && state.activeId && state.activeId !== shownActive) {
    document.querySelector(`.chip[data-id="${CSS.escape(state.activeId)}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
    shownActive = state.activeId;
  }
  if (state.screen !== "play") shownActive = null;
  if (state._focus) {
    document.getElementById(state._focus)?.focus({ preventScroll: true });
    state._focus = "";
  } else if (state.dialog !== lastDialog) {
    lastDialog = state.dialog;
    if (state.dialog) document.querySelector(".sheet button, .sheet input")?.focus({ preventScroll: true });
  }
  if (focusKey && !state.dialog) {
    document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  clearTimeout(toastTimer);
  if (state.toast) {
    toastTimer = setTimeout(() => {
      state.toast = null;
      render();
    }, 5000);
  }
}

function handle(action, target) {
  if (action === "backdrop") {
    state.dialog = null;
    commit();
    return;
  }
  if (action === "dismiss") {
    state.dialog = null;
    commit();
    return;
  }
  if (action === "open-menu") {
    state.dialog = "menu";
    state.hint = "";
    commit();
    return;
  }
  if (action === "open-history") {
    state.dialog = "history";
    commit();
    return;
  }
  if (action === "ask-reset") {
    state.dialog = "reset";
    commit();
    return;
  }
  if (action === "start") return startGame();
  if (action === "remove-player") return removePlayer(target.dataset.id);
  if (action === "move") return movePlayer(target.dataset.id, Number(target.dataset.dir));
  if (action === "select") return selectPlayer(target.dataset.id);
  if (action === "toggle-number") return toggleNumber(target.dataset.n);
  if (action === "toggle-bonus") return toggleBonus(target.dataset.n);
  if (action === "toggle-x2") return toggleX2();
  if (action === "clear") return clearActive();
  if (action === "confirm") return confirmActive();
  if (action === "bust") return bustActive();
  if (action === "undo") return undo();
  if (action === "close-round") return closeRound();
  if (action === "reopen") return reopenPrevious();
  if (action === "reset") return resetMatch();
  if (action === "rematch") return rematch();
  if (action === "install") return installApp();
}

function onKey(event) {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.repeat) return;
  if (state.dialog) {
    if (event.key === "Escape") {
      state.dialog = null;
      commit();
    }
    return;
  }
  if (state.screen !== "play") return;
  if (roundReady()) {
    if (event.key === "Enter") closeRound();
    return;
  }
  if (event.key === "Enter") {
    if (event.target instanceof HTMLButtonElement) return;
    confirmActive();
    return;
  }
  if (event.key === "b" || event.key === "B") {
    bustActive();
    return;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    selectRelative(1);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    selectRelative(-1);
  }
}

function init() {
  selfCheck();
  load();
  const root = document.getElementById("app");
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || !root.contains(target)) return;
    if (target.dataset.action === "backdrop" && event.target.closest(".sheet")) return;
    if (target.disabled) return;
    handle(target.dataset.action, target);
  });
  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const input = form.elements.namedItem("player");
    const value = input && "value" in input ? input.value : "";
    if (form.dataset.form === "add-player") submitName(value, "nameDraft");
    if (form.dataset.form === "add-late") submitName(value, "lateDraft");
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", () => {
    usingKeyboard = false;
  });
  document.addEventListener("keydown", () => {
    usingKeyboard = true;
  }, true);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    render();
  });
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

init();
