// Regras do Flip 7 online. Funções puras sobre o estado da sala:
// a mesma jogada dá o mesmo resultado em qualquer celular.
//
// Baralho oficial (94 cartas): um 0, um 1, dois 2, três 3 ... doze 12
// (79 números), +2 +4 +6 +8 +10 e ×2 (6 modificadores) e três de cada ação:
// Freeze, Flip Three e Second Chance (9 ações).

export const TARGET = 200;
export const FLIP_BONUS = 30;

const NUMBER_COPIES = [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function buildDeck() {
  const deck = [];
  for (let n = 0; n <= 12; n += 1) {
    for (let i = 0; i < NUMBER_COPIES[n]; i += 1) deck.push({ t: "n", n });
  }
  for (const v of [2, 4, 6, 8, 10, 0]) deck.push({ t: "m", v });
  for (const kind of ["freeze", "three", "chance"]) {
    for (let i = 0; i < 3; i += 1) deck.push({ t: kind });
  }
  return deck;
}

function shuffle(cards, rnd) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function emptyHand() {
  return { numbers: [], bonuses: [], x2: 0, chance: 0, active: true, bust: false, frozen: false, stayed: false, banked: 0 };
}

export function scoreOf(hand) {
  if (!hand || hand.bust) return 0;
  const numbers = hand.numbers.reduce((sum, n) => sum + n, 0);
  const doubled = hand.x2 ? numbers * 2 : numbers;
  const bonuses = hand.bonuses.reduce((sum, n) => sum + n, 0);
  const flip = hand.numbers.length === 7 ? FLIP_BONUS : 0;
  return doubled + bonuses + flip;
}

export function roundPoints(hand) {
  if (!hand || hand.bust) return 0;
  return hand.banked || scoreOf(hand);
}

export function createRoom(name, code) {
  return {
    name,
    code,
    createdAt: Date.now(),
    players: [],
    phase: "lobby",
    roundNo: 0,
    dealer: 0,
    target: TARGET,
    winner: null,
    deck: [],
    discard: [],
    hands: {},
    turn: null,
    pending: [],
    log: [],
    lastRound: null,
  };
}

export function nameOf(s, id) {
  return s.players.find((p) => p.id === id)?.name || "Alguém";
}

function addLog(s, text) {
  s.log = [...s.log, text].slice(-60);
}

function ensureHands(s) {
  for (const player of s.players) {
    if (!s.hands[player.id]) s.hands[player.id] = emptyHand();
  }
}

export function isActive(s, id) {
  const h = s.hands[id];
  return Boolean(h && h.active && !h.bust && !h.frozen && !h.stayed);
}

export function activePlayers(s) {
  return s.players.filter((p) => isActive(s, p.id));
}

export function join(s, id, name) {
  if (s.players.some((p) => p.id === id)) return s;
  const clean = String(name || "").trim().slice(0, 18) || `Jogador ${s.players.length + 1}`;
  s.players = [...s.players, { id, name: clean, seat: s.players.length, score: 0 }];
  // Quem chega no meio da rodada espera a próxima.
  if (s.phase === "playing") s.hands[id] = { ...emptyHand(), active: false, waiting: true };
  ensureHands(s);
  addLog(s, `${clean} entrou na mesa`);
  return s;
}

export function leave(s, id) {
  if (!s.players.some((p) => p.id === id)) return s;
  const playing = s.phase === "playing";
  const name = nameOf(s, id);
  const next = playing && s.turn === id ? nextActiveFrom(s, id, id) : s.turn;
  s.players = s.players.filter((p) => p.id !== id);
  delete s.hands[id];
  s.players.forEach((p, i) => {
    p.seat = i;
  });
  s.pending = s.pending.filter((item) => item.by !== id);
  if (!playing) return s;
  addLog(s, `${name} saiu da mesa`);
  if (openPending(s)) return s;
  s.turn = next && isActive(s, next) ? next : activePlayers(s)[0]?.id || null;
  if (!s.turn) endRound(s, null);
  return s;
}

export function rematch(s, rnd = Math.random) {
  for (const player of s.players) player.score = 0;
  Object.assign(s, { winner: null, dealer: 0, roundNo: 0, log: [], hands: {}, phase: "lobby" });
  return startRound(s, rnd);
}

export function rename(s, id, name) {
  const player = s.players.find((p) => p.id === id);
  const clean = String(name || "").trim().slice(0, 18);
  if (player && clean) player.name = clean;
  return s;
}

function draw(s, rnd) {
  if (!s.deck.length) {
    s.deck = shuffle(s.discard, rnd);
    s.discard = [];
    if (s.deck.length) addLog(s, "Baralho reembaralhado");
  }
  return s.deck.pop() || null;
}

function burn(s, card) {
  s.discard = [...s.discard, card];
}

function stand(s, id, points) {
  const h = s.hands[id];
  h.banked = points;
  h.active = false;
}

/**
 * Entrega uma carta para a mão `id` e guarda em `s.last` para as telas animarem.
 * Devolve "bust" | "flip7" | "keep" | "saved" | "action" (ação guardada para escolher o alvo).
 */
function give(s, id, card, autoTarget) {
  s.seq = (s.seq || 0) + 1;
  const last = { by: id, card, seq: s.seq, result: "keep" };
  s.last = last;
  last.result = giveCard(s, id, card, autoTarget);
  return last.result === "saved" ? "keep" : last.result;
}

function giveCard(s, id, card, autoTarget) {
  const h = s.hands[id];
  if (card.t === "n") {
    if (h.numbers.includes(card.n)) {
      if (h.chance) {
        h.chance = 0;
        burn(s, card);
        addLog(s, `${nameOf(s, id)} usou a Segunda Chance no ${card.n}`);
        return "saved";
      }
      h.bust = true;
      h.bustOn = card.n;
      stand(s, id, 0);
      burn(s, card);
      addLog(s, `${nameOf(s, id)} estourou no ${card.n}`);
      return "bust";
    }
    h.numbers = [...h.numbers, card.n].sort((a, b) => a - b);
    if (h.numbers.length === 7) {
      addLog(s, `${nameOf(s, id)} fechou o Flip 7`);
      return "flip7";
    }
    return "keep";
  }
  if (card.t === "m") {
    if (card.v === 0) h.x2 += 1;
    else h.bonuses = [...h.bonuses, card.v];
    return "keep";
  }
  if (card.t === "chance") {
    if (!h.chance) {
      h.chance = 1;
      return "keep";
    }
    const other = s.players.find((p) => p.id !== id && isActive(s, p.id) && !s.hands[p.id].chance);
    if (other) {
      s.hands[other.id].chance = 1;
      addLog(s, `${nameOf(s, id)} passou a Segunda Chance para ${other.name}`);
    }
    return "keep";
  }
  if (autoTarget) {
    applyAction(s, id, card);
    return "keep";
  }
  s.pending = [...s.pending, { kind: card.t, by: id }];
  return "action";
}

function applyAction(s, targetId, card) {
  const h = s.hands[targetId];
  burn(s, card);
  if (!h || !isActive(s, targetId)) return;
  if (card.t === "freeze") {
    const points = scoreOf(h);
    stand(s, targetId, points);
    h.frozen = true;
    addLog(s, `${nameOf(s, targetId)} congelou com ${points}`);
    return;
  }
  if (card.t === "three") {
    addLog(s, `${nameOf(s, targetId)} flipou três`);
    flipThree(s, targetId);
  }
}

function flipThree(s, id) {
  for (let i = 0; i < 3; i += 1) {
    if (s.phase !== "playing" || !isActive(s, id)) return;
    const card = draw(s, Math.random);
    if (!card) return;
    const result = give(s, id, card, true);
    if (card.t === "n" || card.t === "m") burn(s, card);
    if (result === "bust") return;
    if (result === "flip7") {
      endRound(s, id);
      return;
    }
  }
}

function nextActiveFrom(s, id, exclude = null) {
  const count = s.players.length;
  if (!count) return null;
  const start = Math.max(0, s.players.findIndex((p) => p.id === id));
  for (let step = 1; step <= count; step += 1) {
    const candidate = s.players[(start + step) % count].id;
    if (candidate !== exclude && isActive(s, candidate)) return candidate;
  }
  return null;
}

function openPending(s) {
  const item = s.pending[0];
  if (!item) return false;
  s.turn = item.by;
  return true;
}

export function startRound(s, rnd = Math.random) {
  if (s.players.length < 2) return s;
  s.deck = shuffle(buildDeck(), rnd);
  s.discard = [];
  s.roundNo += 1;
  s.phase = "playing";
  s.winner = null;
  s.pending = [];
  s.lastRound = null;
  s.log = [];
  s.hands = {};
  ensureHands(s);
  s.dealer = s.players.length ? s.dealer % s.players.length : 0;

  const order = s.players.map((p) => p.id);
  // Distribuição inicial: uma carta por jogador. Ações caem em si mesmas.
  for (let i = 0; i < order.length; i += 1) {
    const id = order[(s.dealer + i) % order.length];
    const card = draw(s, rnd);
    if (!card) break;
    const result = give(s, id, card, true);
    if (card.t === "n" || card.t === "m") burn(s, card);
    if (result === "flip7") {
      endRound(s, id);
      return s;
    }
  }

  s.last = null;
  addLog(s, `Rodada ${s.roundNo} começou`);
  const first = nextActiveFrom(s, order[s.dealer], null);
  s.turn = first || order[0];
  if (!activePlayers(s).length) endRound(s, null);
  return s;
}

export function hit(s, id, rnd = Math.random) {
  if (s.phase !== "playing" || s.turn !== id || s.pending.length) return s;
  if (!isActive(s, id)) return s;
  const card = draw(s, rnd);
  if (!card) return s;
  const result = give(s, id, card, false);
  if (card.t === "n" || card.t === "m") burn(s, card);

  if (result === "flip7") {
    endRound(s, id);
    return s;
  }
  if (result === "action") return openPending(s);
  if (result === "bust") {
    const next = nextActiveFrom(s, id);
    s.turn = next;
    if (!next) endRound(s, null);
    return s;
  }
  const next = nextActiveFrom(s, id);
  s.turn = next;
  if (!next) endRound(s, null);
  return s;
}

export function stay(s, id) {
  if (s.phase !== "playing" || s.turn !== id || s.pending.length) return s;
  if (!isActive(s, id)) return s;
  const h = s.hands[id];
  const points = scoreOf(h);
  stand(s, id, points);
  h.stayed = true;
  addLog(s, `${nameOf(s, id)} parou com ${points}`);
  const next = nextActiveFrom(s, id);
  s.turn = next;
  if (!next) endRound(s, null);
  return s;
}

export function resolve(s, targetId) {
  const item = s.pending[0];
  if (!item) return s;
  const targets = activePlayers(s);
  if (!targets.length) {
    s.pending = s.pending.slice(1);
    return s;
  }
  const chosen = targets.some((p) => p.id === targetId) ? targetId : targets[0].id;
  s.pending = s.pending.slice(1);
  if (item.kind === "freeze") {
    s.seq = (s.seq || 0) + 1;
    s.last = { by: chosen, card: { t: "freeze" }, seq: s.seq, result: "frozen", from: item.by };
  }
  applyAction(s, chosen, { t: item.kind });

  if (!activePlayers(s).length && !s.pending.length) {
    endRound(s, null);
    return s;
  }
  if (openPending(s)) return s;
  const next = nextActiveFrom(s, item.by);
  s.turn = next;
  if (!next) endRound(s, null);
  return s;
}

function endRound(s, flipId) {
  s.phase = "round-end";
  s.turn = null;
  s.pending = [];
  s.lastRound = s.players.map((p) => {
    const h = s.hands[p.id] || emptyHand();
    const gained = h.bust ? 0 : roundPoints(h);
    p.score = (p.score || 0) + gained;
    return { id: p.id, name: p.name, gained, bust: Boolean(h.bust), total: p.score };
  });
  if (!flipId) addLog(s, "Rodada encerrada");
  const over = s.players.filter((p) => (p.score || 0) >= s.target);
  if (!over.length) return;
  const top = Math.max(...s.players.map((p) => p.score || 0));
  const leaders = s.players.filter((p) => (p.score || 0) === top);
  if (leaders.length === 1) {
    s.winner = leaders[0].id;
    s.phase = "game-over";
    addLog(s, `${leaders[0].name} venceu com ${top} pontos`);
  }
}

export function nextRound(s, rnd = Math.random) {
  if (s.phase !== "round-end") return s;
  s.dealer = (s.dealer + 1) % Math.max(1, s.players.length);
  return startRound(s, rnd);
}

export function totalOf(s, id) {
  return s.players.find((p) => p.id === id)?.score || 0;
}

export function cardLabel(card) {
  if (card.t === "n") return String(card.n);
  if (card.t === "m") return card.v === 0 ? "×2" : `+${card.v}`;
  if (card.t === "freeze") return "Freeze";
  if (card.t === "three") return "Flip 3";
  return "2ª chance";
}
