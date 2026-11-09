const TARGET = 200;
const FLIP_BONUS = 30;
const STORAGE_KEY = "flip7-marcador-v1";
const INSTALL_SKIP = "flip7-install-skip";

import { CARDS, MODS, esc, modArtSvg, cardArtSvg, heroHand, brandMark } from "./art.js";
import { calmMotion, EASE, countUp, confetti, flyPoints, flash, buzz } from "./fx.js";
import * as onlineModule from "./online.js";
import * as roomModule from "./room.js";
import * as gameModule from "./game.js";
import * as api from "./net.js";

let deferredInstall = null;
let toastTimer = 0;
let toastGone = 0;
let mode = "marker";
let entered = false;
let pendingFocus = "";
const TOAST_HOLD = 2200;
const TOAST_LEAVE = 280;
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
    [{ ...empty, numbers: [0, 1, 2, 3, 4, 5, 6] }, 51],
    [{ ...empty, bonuses: [10] }, 10],
    [{ ...empty, x2: true, bonuses: [10] }, 10],
    [{ ...empty, numbers: [12, 11, 10], bust: true }, 0],
    [{ ...empty, numbers: [12, 11, 10, 9, 8, 7, 6], x2: true, bonuses: [2, 4, 6, 8, 10] }, 186],
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

function runningInstalled() {
  return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true;
}

function onIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function skippedInstall() {
  try {
    return sessionStorage.getItem(INSTALL_SKIP) === "1";
  } catch {
    return false;
  }
}

function rememberInstallSkip() {
  try {
    sessionStorage.setItem(INSTALL_SKIP, "1");
  } catch {
    /* navegador sem sessão */
  }
}

function offerInstall() {
  if (runningInstalled() || skippedInstall() || state.dialog) return;
  if (!deferredInstall && !onIos()) return;
  state.dialog = "install";
  render();
}

function closeDialog() {
  if (state.dialog === "install") rememberInstallSkip();
  state.dialog = null;
  commit();
}

async function installApp() {
  const promptEvent = deferredInstall;
  if (!promptEvent) return;
  rememberInstallSkip();
  deferredInstall = null;
  state.dialog = null;
  commit();
  try {
    promptEvent.prompt();
    await promptEvent.userChoice;
  } catch {
    /* instalação cancelada */
  }
}

function detail(entry) {
  if (entry.bust) return "estourou";
  const bits = [];
  if (entry.numbers.length) bits.push(entry.numbers.join("+"));
  if (entry.x2) bits.push("×2");
  if (entry.bonuses.length) bits.push(entry.bonuses.map((n) => `+${n}`).join(" "));
  if (entry.numbers.length === 7) bits.push(`+${FLIP_BONUS}`);
  return bits.join(" ") || "0";
}

function formula(entry, score) {
  if (entry.bust) return "Estourou";
  const bits = [];
  if (entry.numbers.length) bits.push(`<span>${entry.numbers.join(" + ")} = ${score.numbersSum}</span>`);
  if (entry.x2) bits.push(`<span>×2 = ${score.afterX2}</span>`);
  if (entry.bonuses.length) bits.push(`<span>${entry.bonuses.map((n) => `+${n}`).join(" ")}</span>`);
  if (score.flip7) bits.push(`<span class="pill">Flip 7 +${FLIP_BONUS}</span>`);
  return bits.join("");
}

function cardButton(card, pressed) {
  return `<button type="button" class="card${pressed ? " on" : ""}" style="--ink:${card.ink};--i:${card.n}" data-action="toggle-number" data-n="${card.n}" data-focus="n-${card.n}" aria-pressed="${pressed}" aria-label="${card.n}, ${esc(card.name)}">${cardArtSvg(card)}</button>`;
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
  const over = rows.filter((row) => row.total >= TARGET);
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
    return n === undefined ? `<span class="slot"></span>` : `<span class="slot on" style="--ink:${CARDS[n].ink};--i:${i}" data-n="${n}">${n}</span>`;
  }).join("");
  const hand = `<div class="hand${full ? " flip" : ""}" role="img" aria-label="${entry.numbers.length} de 7 números">${slots}</div>`;
  const mods = MODS.map((mod, i) => {
    const owner = ownerOf("bonus", mod.v);
    const on = entry.bonuses.includes(mod.v);
    return `<button type="button" class="mod${on ? " on" : ""}${owner ? " taken" : ""}" style="--ink:${mod.ink};--i:${13 + i}" data-action="toggle-bonus" data-n="${mod.v}" data-focus="bonus-${mod.v}" aria-pressed="${on}" aria-label="Modificador +${mod.v}${owner ? `, com ${esc(owner.name)}` : ""}" title="${owner ? `Com ${owner.name}` : `+${mod.v}`}">${modArtSvg(`+${mod.v}`)}</button>`;
  }).join("");
  const xOwner = ownerOf("x2");
  const entryBody = `<div class="entry${full ? " full" : ""}"><div class="deck"><div class="grid">${CARDS.slice(0, 10)
    .map((card) => cardButton(card, entry.numbers.includes(card.n)))
    .join("")}</div><div class="grid three">${CARDS.slice(10)
    .map((card) => cardButton(card, entry.numbers.includes(card.n)))
    .join("")}</div><div class="mods">${mods}<button type="button" class="mod x2${entry.x2 ? " on" : ""}${xOwner ? " taken" : ""}" style="--ink:#d9383a;--i:18" data-action="toggle-x2" data-focus="x2" aria-pressed="${entry.x2}" aria-label="Vezes 2${xOwner ? `, com ${esc(xOwner.name)}` : ""}">${modArtSvg("×2")}</button></div></div></div>`;
  return `<section class="calc deal${entry.bust ? " bust" : ""}" data-player="${player.id}">
    <div class="hand-head">
      <div class="hand-info">
        <p class="who">Vez de <strong>${esc(player.name)}</strong></p>
        ${hand}
      </div>
      <div class="score${score.flip7 ? " flip" : ""}${entry.bust ? " bust" : ""}"><b>${display}</b></div>
    </div>
    <p class="formula">${formula(entry, score)}</p>
    ${entryBody}
  </section>`;
}

function summaryView(rows) {
  const list = rows
    .map((row, i) => {
      const entry = currentRound().entries[row.id];
      const score = scoreOf(entry);
      return `<article class="sum-row${row.rank === 1 && row.total > 0 ? " leader" : ""}" style="--i:${i}">
        <span class="rk">${row.rank}</span>
        <div class="meta"><span class="nm">${esc(row.name)}</span><small>${esc(detail(entry))}</small></div>
        <span class="round">${entry.bust ? "0" : `+${score.total}`}</span>
        <span class="tot">total ${row.total}<br><button type="button" class="linkish" data-action="select" data-id="${row.id}">corrigir</button></span>
      </article>`;
    })
    .join("");
  return `<section class="calc"><h2>Rodada ${roundNumber()}</h2><div class="sum">${list}</div></section>`;
}

const ICONS = {
  clear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4 3.8v5h5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bust: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12l-5.4 1.9 2.5 5.2-5.2-2.5L12 22l-1.9-5.4-5.2 2.5 2.5-5.2L2 12l5.4-1.9-2.5-5.2 5.2 2.5L12 2l1.9 5.4 5.2-2.5-2.5 5.2z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  confirm: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function floatView() {
  const hint = state.hint ? `<p class="warn" role="status">${esc(state.hint)}</p>` : "";
  return hint || state.toast ? `<div class="float">${hint}${toastView()}</div>` : "";
}

function dockView() {
  if (roundReady()) {
    return `<footer class="dock">${floatView()}<button type="button" class="primary xl" data-action="close-round">Fechar rodada</button></footer>`;
  }
  const entry = activeEntry();
  const player = activePlayer();
  if (entry.confirmed) {
    return `<footer class="dock">${floatView()}<button type="button" class="primary xl" data-action="select" data-id="${player.id}">Corrigir ${esc(player.name)}</button></footer>`;
  }
  const score = scoreOf(entry);
  const canClear = entry.bust || hasDraft(entry);
  const label = entry.bust ? "Confirmar 0" : `Confirmar ${score.total}`;
  return `<footer class="dock">${floatView()}<div class="dock-row">
    <button type="button" class="icon-btn clear" data-action="clear" aria-label="Limpar a mão" title="Limpar" ${canClear ? "" : "disabled"}>${ICONS.clear}</button>
    <button type="button" class="icon-btn bust" data-action="bust" aria-pressed="${entry.bust}" aria-label="Estourou" title="Estourou">${ICONS.bust}</button>
    <button type="button" class="icon-btn go" data-action="confirm" aria-label="${label}" title="Confirmar">${ICONS.confirm}</button>
  </div></footer>`;
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
        <div class="brand">${brandMark()}<div><h1>Flip 7</h1><p>Rodada ${roundNumber()}</p></div></div>
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
            return `<li data-id="${player.id}"><span class="seat">${index + 1}</span><span class="nm">${esc(player.name)}</span>
              <button type="button" class="nudge" data-action="move" data-id="${player.id}" data-dir="-1" aria-label="Subir ${esc(player.name)}" ${up}>↑</button>
              <button type="button" class="nudge" data-action="move" data-id="${player.id}" data-dir="1" aria-label="Descer ${esc(player.name)}" ${down}>↓</button>
              <button type="button" class="textbtn" data-action="remove-player" data-id="${player.id}" aria-label="Remover ${esc(player.name)}">tirar</button></li>`;
          })
          .join("")}</ul>`;
  const install = deferredInstall ? `<button type="button" class="ghost xl" data-action="install">Instalar o app</button>` : "";
  const ios = onIos() && !runningInstalled() ? `<p class="fine">Para usar em tela cheia: Compartilhar, depois Adicionar à Tela de Início.</p>` : "";
  return `<main class="setup">
    ${heroHand()}
    <p class="eyebrow">Marcador de mesa</p>
    <h1>Flip 7</h1>
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
    ${ios}
  </main>`;
}

function victoryView() {
  const rows = standings();
  const winner = rows[0];
  const podium = rows
    .map(
      (row, i) => `<li class="${row.rank === 1 ? "leader" : ""}" style="--i:${i}"><span class="rk">${row.rank}</span><span class="nm">${esc(row.name)}</span><span class="tot">${row.total}</span></li>`
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
  } else if (state.dialog === "install") {
    const share = `<svg class="share" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.8 7.4 12 3.2l4.2 4.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11.5V19h12v-7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    body = deferredInstall
      ? `<h2 id="sheet-title">Instalar o Flip 7</h2><p>Fica na tela inicial e abre em tela cheia, como um app.</p><div class="pair"><button type="button" class="ghost" data-action="skip-install">Agora não</button><button type="button" class="primary" data-action="install" autofocus>Instalar</button></div>`
      : `<h2 id="sheet-title">Instalar o Flip 7</h2><p>Toque em Compartilhar ${share} e depois em <strong>Adicionar à Tela de Início</strong>.</p><button type="button" class="primary wide" data-action="skip-install" autofocus>Entendi</button>`;
  }
  return `<div class="modal" data-action="backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div></div>`;
}

function view() {
  if (!entered) return homeView() + dialogView();
  if (state.screen === "setup") return setupView() + dialogView();
  if (state.screen === "victory") return victoryView() + dialogView();
  return playView() + dialogView();
}

function homeView() {
  const saved = state.players.length > 0 && state.screen !== "setup";
  const resume = saved
    ? `<button type="button" class="mode" data-action="home-marker"><strong>Continuar a mesa</strong><span>${state.players.length} jogadores, rodada ${roundNumber()}.</span></button>`
    : "";
  return `<main class="setup home">
    ${heroHand()}
    <p class="eyebrow">Flip 7</p>
    <h1>Como vamos jogar?</h1>
    <div class="mode-list">
      <button type="button" class="mode primary-mode" data-action="home-marker">
        <strong>Marcador de mesa</strong>
        <span>Cartas de verdade na mesa. O app soma e ordena o placar.</span>
      </button>
      <button type="button" class="mode" data-action="home-online">
        <strong>Jogar online</strong>
        <span>Crie uma sala, mande o link e jogue com os amigos.</span>
      </button>
      ${resume}
    </div>
    <p class="fine">A meta é ${TARGET} pontos. O ×2 dobra só os números, os + entram depois e sete números valem +${FLIP_BONUS}.</p>
  </main>`;
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

function snapshotView() {
  const main = document.querySelector("#app > main");
  if (!main) return null;
  const chips = new Map();
  const shown = (el) => el?.dataset.value ?? el?.textContent ?? null;
  main.querySelectorAll(".chip").forEach((chip) => {
    chips.set(chip.dataset.id, {
      rect: chip.getBoundingClientRect(),
      tot: shown(chip.querySelector(".tot")),
      delta: chip.querySelector(".delta")?.textContent,
    });
  });
  const score = main.querySelector(".score b");
  return {
    screen: main.classList[0],
    player: main.querySelector(".calc.deal")?.dataset.player ?? null,
    pressed: new Set([...main.querySelectorAll('[aria-pressed="true"][data-focus]')].map((el) => el.dataset.focus)),
    slots: new Set([...main.querySelectorAll(".slot.on")].map((el) => el.dataset.n)),
    score: shown(score),
    scoreRect: score?.getBoundingClientRect() ?? null,
    chips,
    progress: main.querySelector(".progress span")?.style.width ?? null,
    round: main.querySelector(".brand p")?.textContent ?? null,
    float: main.querySelector(".float")?.textContent ?? null,
    sheet: document.querySelector(".sheet h2")?.textContent ?? null,
    roster: new Set([...main.querySelectorAll(".roster li")].map((li) => li.dataset.id)),
    summary: Boolean(main.querySelector(".sum")),
  };
}

function animateChanges(before) {
  if (calmMotion.matches) return;
  const main = document.querySelector("#app > main");
  if (!main) return;
  if (!before || before.screen !== main.classList[0]) {
    main.classList.add("arrive");
    const win = main.querySelector(".win-score");
    if (win) {
      countUp(win, 0, Number(win.textContent), 350);
      setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.28, 110, 1.6), 300);
    }
    return;
  }

  const sheet = document.querySelector(".sheet h2");
  if (sheet && sheet.textContent !== before.sheet) document.querySelector(".modal").classList.add(before.sheet ? "swap" : "arrive");

  const float = main.querySelector(".float");
  if (float && float.textContent !== before.float) float.classList.add("arrive");

  main.querySelectorAll(".roster li").forEach((li) => {
    if (!before.roster.has(li.dataset.id)) li.classList.add("arrive");
  });

  const bar = main.querySelector(".progress span");
  if (bar && before.progress !== null && bar.style.width !== before.progress) {
    bar.animate([{ width: before.progress }, { width: bar.style.width }], { duration: 800, delay: 300, easing: EASE, fill: "backwards" });
  }

  const round = main.querySelector(".brand p");
  if (round && before.round !== null && round.textContent !== before.round) round.classList.add("bump");

  const calc = main.querySelector(".calc.deal");
  const switched = (calc?.dataset.player ?? null) !== before.player;
  const leaving = before.player && switched ? currentRound()?.entries[before.player] : null;
  const leavingChip = leaving ? main.querySelector(`.chip[data-id="${CSS.escape(before.player)}"]`) : null;
  const leavingOld = leavingChip ? before.chips.get(before.player) : null;
  const scored =
    leaving?.confirmed && leavingOld && before.scoreRect &&
    (leavingOld.tot !== leavingChip.querySelector(".tot")?.textContent || (leaving.bust && leavingOld.delta !== "0"));
  const delay = scored ? 560 : 0;

  main.querySelectorAll(".chip").forEach((chip) => {
    const old = before.chips.get(chip.dataset.id);
    if (!old) {
      chip.classList.add("arrive");
      return;
    }
    const now = chip.getBoundingClientRect();
    const dx = old.rect.left - now.left;
    const dy = old.rect.top - now.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      chip.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 560, delay, easing: EASE, fill: "backwards" });
    }
    const tot = chip.querySelector(".tot");
    if (tot && old.tot !== tot.textContent) {
      countUp(tot, Number(old.tot), Number(tot.textContent), delay);
      chip.style.setProperty("--delay", `${delay}ms`);
      chip.classList.add("gain");
    }
  });

  if (scored) {
    const total = scoreOf(leaving).total;
    flyPoints(before.scoreRect, leavingChip.querySelector(".tot"), leaving.bust ? "0" : `+${total}`, leaving.bust);
    if (leaving.bust) {
      flash("bust");
      leavingChip.style.setProperty("--delay", `${delay}ms`);
      leavingChip.classList.add("busted");
    } else if (scoreOf(leaving).flip7) {
      const r = leavingChip.getBoundingClientRect();
      setTimeout(() => confetti(r.left + r.width / 2, r.top + r.height / 2, 40, 0.7), delay);
    }
  }

  const sum = main.querySelector(".sum");
  if (sum && !before.summary) sum.classList.add("arrive");

  if (!calc) return;
  if (switched) {
    calc.classList.add(before.player ? "next" : "deal-in");
    return;
  }
  main.querySelectorAll("[aria-pressed][data-focus]").forEach((el) => {
    const was = before.pressed.has(el.dataset.focus);
    const is = el.getAttribute("aria-pressed") === "true";
    if (is && !was) el.classList.add("pick");
    if (!is && was) el.classList.add("unpick");
  });
  const slots = [...main.querySelectorAll(".slot.on")];
  slots.forEach((slot) => {
    if (!before.slots.has(slot.dataset.n)) slot.classList.add("drop-in");
  });
  const score = calc.querySelector(".score b");
  if (score && before.score !== null && score.textContent !== before.score) {
    countUp(score, Number(before.score), Number(score.textContent));
    score.classList.add("bump");
  }
  if (slots.length === 7 && before.slots.size < 7) {
    const hand = calc.querySelector(".hand");
    hand.classList.add("flip7");
    const r = hand.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 2, 70);
    flash("gold");
  }
}

function render() {
  if (mode === "online") return renderOnline();
  const before = snapshotView();
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
    if (state.dialog) (document.querySelector(".sheet [autofocus]") || document.querySelector(".sheet button, .sheet input"))?.focus({ preventScroll: true });
  }
  if (focusKey && !state.dialog) {
    document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }
  animateChanges(before);
  clearTimeout(toastTimer);
  clearTimeout(toastGone);
  if (state.toast || (state.hint && state.screen === "play")) toastTimer = setTimeout(dismissFloat, TOAST_HOLD);
}

function dismissFloat() {
  const float = document.querySelector(".float");
  if (!float || calmMotion.matches) {
    state.toast = null;
    state.hint = "";
    render();
    return;
  }
  float.classList.add("leave");
  toastGone = setTimeout(() => {
    state.toast = null;
    state.hint = "";
    render();
  }, TOAST_LEAVE);
}

function handle(action, target) {
  if (action === "backdrop" || action === "dismiss" || action === "skip-install") return closeDialog();
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
  if (action === "home-marker") {
    entered = true;
    return commit();
  }
  if (action === "home-online") {
    entered = true;
    onlineModule.go("start");
    return enterOnline();
  }
  if (action.startsWith("ol-")) return handleOnline(action, target);
}

// --- Jogo online -------------------------------------------------------

const room = roomModule.store;
let lastOnlineHtml = "";
let lastOnlineDialog = null;

function enterOnline() {
  mode = "online";
  lastOnlineHtml = "";
  renderOnline();
}

function setRoomUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("sala", code);
  else url.searchParams.delete("sala");
  history.replaceState(null, "", url.pathname + url.search);
}

function exitRoom() {
  roomModule.exitRoom();
  onlineModule.view.dialog = null;
  onlineModule.view.peek = null;
  setRoomUrl("");
}

function leaveOnline() {
  exitRoom();
  onlineModule.go("start");
  mode = "marker";
  entered = false;
  document.body.classList.remove("in-play");
  render();
}

function renderOnline() {
  if (mode !== "online") return;
  const root = document.getElementById("app");
  const html = onlineModule.onlineView();
  document.title = onlineModule.title();
  if (html === lastOnlineHtml && root.firstElementChild) return;
  const before = lastOnlineHtml ? onlineModule.snapshot() : null;
  const active = document.activeElement;
  const focusId = active && root.contains(active) && active.id ? active.id : "";
  const selection = focusId && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  const values = new Map([...root.querySelectorAll("input[id]:not([readonly])")].map((input) => [input.id, input.value]));
  const screen = root.querySelector("main")?.dataset.screen;
  const y = window.scrollY;
  const rankLeft = root.querySelector(".rank")?.scrollLeft ?? 0;
  root.innerHTML = html;
  lastOnlineHtml = html;
  document.body.classList.toggle("in-play", Boolean(root.querySelector("main.play")));
  for (const [id, value] of values) {
    const input = document.getElementById(id);
    if (input && !input.readOnly) input.value = value;
  }
  const rank = root.querySelector(".rank");
  if (rank) rank.scrollLeft = rankLeft;
  window.scrollTo(0, root.querySelector("main")?.dataset.screen === screen ? y : 0);
  const dialog = onlineModule.view.dialog;
  if (pendingFocus) {
    document.getElementById(pendingFocus)?.focus({ preventScroll: true });
    pendingFocus = "";
  } else if (dialog !== lastOnlineDialog && dialog) {
    const field = document.querySelector(".sheet input");
    field?.focus({ preventScroll: true });
    field?.select?.();
  } else if (focusId) {
    const again = document.getElementById(focusId);
    again?.focus({ preventScroll: true });
    if (selection && again?.setSelectionRange) again.setSelectionRange(...selection);
  }
  lastOnlineDialog = dialog;
  onlineModule.animate(before);
  const viewed = root.querySelector(".chip[aria-current=\"true\"]");
  viewed?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 18);
}

function invalid(input) {
  input.classList.add("invalid");
  input.focus();
}

function takenName(input, name) {
  onlineModule.view.error = `Já tem alguém como "${cleanName(name)}" nesta sala. Escolha outro nome.`;
  input.classList.add("invalid");
  renderOnline();
  const again = input.id ? document.getElementById(input.id) : null;
  again?.classList.add("invalid");
  again?.focus();
  again?.select?.();
}

async function handleOnline(action, target) {
  const view = onlineModule.view;
  const s = room.state;
  if (action === "ol-home") return leaveOnline();
  if (action === "ol-exit") {
    exitRoom();
    onlineModule.go("start");
    return renderOnline();
  }
  if (action === "ol-open") {
    const form = target.closest("form");
    const roomField = form.elements.namedItem("room");
    const playerField = form.elements.namedItem("player");
    const name = cleanName(playerField.value);
    view.roomDraft = roomField.value;
    const code = api.slug(roomField.value);
    if (!code) return invalid(roomField);
    if (!name) return invalid(playerField);
    view.error = "";
    try {
      await roomModule.createRoom(roomField.value);
      setRoomUrl(code);
      const mine = room.state.players.find((p) => p.id === room.me);
      if (!mine) {
        if (gameModule.isNameTaken(room.state, name)) return takenName(playerField, name);
        await roomModule.joinSelf(name);
      } else if (gameModule.nameKey(mine.name) !== gameModule.nameKey(name)) {
        if (gameModule.isNameTaken(room.state, name, room.me)) return takenName(playerField, name);
        await roomModule.play((state, id) => gameModule.rename(state, id, name));
      } else {
        roomModule.rememberName(name);
      }
    } catch (error) {
      exitRoom();
      view.error = /fetch|network/i.test(String(error?.message)) ? "Sem conexão. Confira a internet e tente de novo." : String(error?.message || error);
    }
    return renderOnline();
  }
  if (action === "ol-join") {
    const input = target.closest("form").elements.namedItem("player");
    const name = cleanName(input.value);
    if (!name) return invalid(input);
    if (gameModule.isNameTaken(room.state, name, room.me)) return takenName(input, name);
    view.error = "";
    await roomModule.joinSelf(name);
    return renderOnline();
  }
  if (action === "ol-copy") {
    const link = roomModule.link(room.code);
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      document.getElementById("share-link")?.select();
    }
    view.copied = true;
    renderOnline();
    setTimeout(() => {
      view.copied = false;
      renderOnline();
    }, 1600);
    return;
  }
  if (action === "ol-share") {
    try {
      await navigator.share({ title: `Flip 7 · ${s?.name || room.code}`, text: "Bora jogar Flip 7?", url: roomModule.link(room.code) });
    } catch {
      /* compartilhamento cancelado */
    }
    return;
  }
  if (action === "ol-peek") {
    const id = target.dataset.id;
    view.peek = id;
    view.peekTurn = s?.turn ?? null;
    view.hold = null;
    return renderOnline();
  }
  if (action === "ol-menu") {
    view.dialog = "menu";
    return renderOnline();
  }
  if (action === "ol-rename-open") {
    view.dialog = "rename";
    return renderOnline();
  }
  if (action === "ol-dismiss" || action === "ol-backdrop") {
    view.dialog = null;
    return renderOnline();
  }
  if (action === "ol-rename") {
    const input = target.closest("form").elements.namedItem("player");
    const name = cleanName(input.value);
    if (!name) return invalid(input);
    if (gameModule.isNameTaken(s, name, room.me)) return takenName(input, name);
    roomModule.rememberName(name);
    view.dialog = null;
    return act((state, id) => gameModule.rename(state, id, name));
  }
  if (action === "ol-start") return act((state) => gameModule.startRound(state));
  if (action === "ol-hit") return act((state, id) => gameModule.hit(state, id));
  if (action === "ol-stay") return act((state, id) => gameModule.stay(state, id));
  if (action === "ol-resolve") return act((state) => gameModule.resolve(state, target.dataset.id));
  if (action === "ol-next") return act((state) => gameModule.nextRound(state));
  if (action === "ol-kick") return act((state) => gameModule.leave(state, target.dataset.id));
  if (action === "ol-rematch") return act((state) => gameModule.rematch(state));
  if (action === "ol-leave") {
    view.dialog = null;
    if (s && roomModule.amIn()) await roomModule.play((state, id) => gameModule.leave(state, id));
    exitRoom();
    onlineModule.go("start");
    return renderOnline();
  }
}

async function act(mutate) {
  await roomModule.play(mutate);
  renderOnline();
}

function onKey(event) {
  if (mode === "online") {
    if (event.key === "Escape" && onlineModule.view.dialog) handleOnline("ol-dismiss");
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.repeat) return;
  if (state.dialog) {
    if (event.key === "Escape") closeDialog();
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
    if (target.dataset.action.endsWith("backdrop") && event.target.closest(".sheet")) return;
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
    if (form.dataset.form?.startsWith("ol-")) handle(form.dataset.form, form.querySelector("button[type=submit]") || form);
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
    offerInstall();
    if (state.dialog !== "install") render();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    if (state.dialog === "install") state.dialog = null;
    render();
  });
  render();
  offerInstall();
  roomModule.onRoom(renderOnline);
  onlineModule.onRerender(renderOnline);
  const code = api.slug(new URLSearchParams(location.search).get("sala") || "");
  if (code) {
    entered = true;
    onlineModule.view.roomDraft = code;
    enterOnline();
    roomModule.openRoom(code).then(async (ok) => {
      if (ok && !roomModule.amIn() && roomModule.myName()) await roomModule.joinSelf(roomModule.myName());
      renderOnline();
    });
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

init();
