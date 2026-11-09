// Telas do jogo online. A verdade fica em room.store.state; aqui só desenhamos,
// animamos o que mudou e devolvemos as jogadas para o app.

import * as store from "./room.js";
import * as game from "./game.js";
import { CARDS, MODS, X2_INK, ACTIONS, esc, cardArtSvg, modArtSvg, anyCard, cardBack, heroHand, brandMark } from "./art.js";
import { calmMotion, EASE, countUp, confetti, flash, buzz } from "./fx.js";

export const view = { screen: "start", roomDraft: "", error: "", dialog: null, copied: false, peek: null, peekTurn: null, hold: null };

const room = store.store;
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
// Quanto tempo a mão de quem comprou fica na tela e quanto a carta revelada demora.
const HOLD_MS = 1700;
const REVEAL_MS = 2100;

let rerender = () => {};
let seenCode = "";
let seenSeq = null;
let pendingReveal = null;

export function onRerender(fn) {
  rerender = fn;
}

export function go(screen) {
  view.screen = screen;
  view.error = "";
}

const ICONS = {
  stay: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hit: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.6" width="14" height="18.8" rx="2.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 8.2v7.6M8.2 12h7.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
};

// --- Leitura do estado ------------------------------------------------

function standings(s) {
  const rows = s.players.map((p, seat) => ({ ...p, total: p.score || 0, seat }));
  rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
  let lastTotal = null;
  let rank = 0;
  return rows.map((row, index) => {
    if (row.total !== lastTotal) rank = index + 1;
    lastTotal = row.total;
    return { ...row, rank };
  });
}

function handOf(s, id) {
  return s.hands[id] || { numbers: [], bonuses: [], x2: 0, chance: 0, active: false, bust: false, frozen: false, stayed: false, banked: 0 };
}

function pointsOf(h) {
  return h.bust ? 0 : game.roundPoints(h);
}

function hostName(s) {
  return s.players[0]?.id === room.me ? "você" : s.players[0]?.name || "o anfitrião";
}

function exists(s, id) {
  return Boolean(id && s.players.some((p) => p.id === id));
}

function focusId(s) {
  if (view.peek && view.peekTurn === s.turn && exists(s, view.peek)) return view.peek;
  view.peek = null;
  if (view.hold && performance.now() < view.hold.until && exists(s, view.hold.id)) return view.hold.id;
  return [s.pending[0]?.by, s.turn, room.me, s.players[0]?.id].find((id) => exists(s, id));
}

/** Percebe carta nova antes de desenhar: segura a mão de quem tirou por um instante. */
function trackDraw(s) {
  if (seenCode !== room.code) {
    seenCode = room.code;
    seenSeq = null;
  }
  const seq = s.seq || 0;
  if (seenSeq === null) {
    seenSeq = seq;
    return;
  }
  if (seq <= seenSeq) return;
  seenSeq = seq;
  if (!s.last || s.last.seq !== seq) return;
  pendingReveal = s.last;
  view.hold = { id: s.last.by, until: performance.now() + HOLD_MS };
  setTimeout(() => rerender(), HOLD_MS + 40);
}

// --- Telas fora da mesa -------------------------------------------------

function nameField(id, label = "Seu nome") {
  return `<label class="order" for="${id}">${label}</label>
    <div class="adder"><input id="${id}" name="player" maxlength="18" autocomplete="off" autocapitalize="words" autocorrect="off" enterkeyhint="go" placeholder="Quem joga" value="${esc(store.myName())}"><button type="submit">Entrar</button></div>`;
}

function startView() {
  return `<main class="setup" data-screen="start">
    ${heroHand()}
    <p class="eyebrow">Jogar online</p>
    <h1>Flip 7</h1>
    <form data-form="ol-open">
      <label class="order" for="ol-room">Sala</label>
      <div class="adder"><input id="ol-room" name="room" maxlength="32" autocomplete="off" autocapitalize="none" autocorrect="off" enterkeyhint="next" placeholder="mesa-do-bairro" value="${esc(view.roomDraft)}"></div>
      ${nameField("ol-player")}
    </form>
    ${view.error ? `<p class="warn" role="status">${esc(view.error)}</p>` : ""}
    <p class="fine">O nome da sala vira o código. Se ela ainda não existe, nasce agora. Usem sempre o mesmo nome e a turma volta para a mesma mesa.</p>
    <div class="stack"><button type="button" class="textbtn" data-action="ol-home">Voltar ao início</button></div>
  </main>`;
}

function rosterView(s, editable) {
  if (!s.players.length) return `<p class="empty">Ninguém ainda. Mande o link.</p>`;
  const host = store.isHost();
  return `<ul class="roster online">${s.players
    .map((p, i) => {
      const tags = `${p.id === room.me ? `<small>você</small>` : ""}${i === 0 ? `<small>anfitrião</small>` : ""}`;
      const kick = editable && host && p.id !== room.me ? `<button type="button" class="textbtn" data-action="ol-kick" data-id="${p.id}" aria-label="Tirar ${esc(p.name)}">tirar</button>` : "";
      return `<li data-id="${p.id}"><span class="seat">${i + 1}</span><span class="nm">${esc(p.name)}${tags}</span>${kick}</li>`;
    })
    .join("")}</ul>`;
}

function joinView() {
  const s = room.state;
  return `<main class="setup" data-screen="join">
    ${heroHand()}
    <p class="eyebrow">Sala ${esc(s?.name || room.code)}</p>
    <h1>Entre na mesa</h1>
    <form data-form="ol-join">${nameField("ol-name")}</form>
    ${view.error ? `<p class="warn" role="status">${esc(view.error)}</p>` : ""}
    ${s && s.phase !== "lobby" ? `<p class="fine">A partida já começou. Você entra na próxima rodada.</p>` : ""}
    ${s ? `<p class="order">Na mesa${s.players.length ? ` · ${s.players.length}` : ""}</p>${rosterView(s, false)}` : ""}
    <div class="stack"><button type="button" class="textbtn" data-action="ol-home">Voltar ao início</button></div>
  </main>`;
}

function statusView(title, hint) {
  return `<main class="setup" data-screen="status">
    ${heroHand()}
    <p class="eyebrow">Sala ${esc(room.code)}</p>
    <h1 class="status-title">${esc(title)}</h1>
    ${hint ? `<p class="fine">${esc(hint)}</p>` : ""}
    <div class="stack"><button type="button" class="ghost xl" data-action="ol-exit">Voltar</button></div>
  </main>`;
}

function lobbyView(s) {
  const host = store.isHost();
  const few = s.players.length < 2;
  const link = store.link(room.code);
  return `<main class="setup" data-screen="lobby">
    ${heroHand()}
    <p class="eyebrow">Sala aberta</p>
    <h1>${esc(s.name)}</h1>
    <div class="panel">
      <label class="order" for="share-link">Convide a turma</label>
      <div class="adder"><input id="share-link" readonly value="${esc(link)}" aria-label="Link da sala"><button type="button" data-action="ol-copy">${view.copied ? "Copiado" : "Copiar"}</button></div>
      ${canShare ? `<button type="button" class="ghost share-btn" data-action="ol-share">Compartilhar link</button>` : ""}
      <p class="code">Código <strong>${esc(room.code)}</strong></p>
    </div>
    <p class="order">Na mesa · ${s.players.length}</p>
    ${rosterView(s, true)}
    <div class="stack">
      ${host ? `<button type="button" class="primary xl" data-action="ol-start" ${few ? "disabled" : ""}>Começar partida</button>` : ""}
      ${few ? `<p class="fine">Precisa de pelo menos mais uma pessoa. Mande o link.</p>` : host ? "" : `<p class="fine">Esperando ${esc(hostName(s))} começar a partida.</p>`}
      <button type="button" class="ghost xl" data-action="ol-rename-open">Trocar meu nome</button>
      <button type="button" class="textbtn" data-action="ol-leave">Sair da sala</button>
    </div>
    ${room.error ? `<p class="warn" role="status">${esc(room.error)}</p>` : ""}
  </main>`;
}

// --- Mesa ---------------------------------------------------------------

function statusLine(s, id) {
  const h = handOf(s, id);
  const turn = s.phase === "playing" && s.turn === id;
  if (s.phase !== "playing") {
    const row = s.lastRound?.find((r) => r.id === id);
    if (!row) return { text: "·", cls: "zero" };
    return row.bust || !row.gained ? { text: "0", cls: "zero" } : { text: `+${row.gained}`, cls: "" };
  }
  if (h.waiting) return { text: "próxima", cls: "zero" };
  if (h.bust) return { text: "estourou", cls: "zero" };
  if (h.frozen) return { text: `congelou +${pointsOf(h)}`, cls: "" };
  if (h.stayed) return { text: `parou +${pointsOf(h)}`, cls: "" };
  if (turn) return { text: "na vez", cls: "pending" };
  return { text: String(pointsOf(h)), cls: "zero" };
}

function chipView(s, row, viewed) {
  const line = statusLine(s, row.id);
  const turn = s.phase === "playing" && s.turn === row.id;
  const cls = `${row.rank === 1 && row.total > 0 ? " leader" : ""}${turn ? " turn" : ""}${row.id === room.me ? " mine" : ""}`;
  return `<button type="button" class="chip${cls}" data-action="ol-peek" data-id="${row.id}" aria-current="${row.id === viewed}" aria-label="${row.rank}º ${esc(row.name)}, ${row.total} pontos, ${esc(line.text)}">
    <span class="rk">${row.rank}</span>
    <span class="nm">${esc(row.name)}</span>
    <span class="tot">${row.total}</span>
    <span class="delta ${line.cls}">${esc(line.text)}</span>
  </button>`;
}

function formulaOf(s, h) {
  if (h.waiting) return `<span>Entra na próxima rodada</span>`;
  const bits = [];
  if (h.bust) bits.push(`<span class="pill bad">Estourou no ${h.bustOn ?? "repetido"}</span>`);
  else if (h.frozen) bits.push(`<span class="pill ice">Congelou</span>`);
  else if (h.stayed) bits.push(`<span class="pill calm">Parou</span>`);
  if (h.chance && !h.bust) bits.push(`<span class="pill chance">2ª chance</span>`);
  if (!h.bust && h.numbers.length === 7) bits.push(`<span class="pill">Flip 7 +${game.FLIP_BONUS}</span>`);
  if (!h.bust) {
    const sum = h.numbers.reduce((a, n) => a + n, 0);
    if (h.numbers.length) bits.push(`<span>${h.numbers.join(" + ")} = ${sum}</span>`);
    if (h.x2) bits.push(`<span>×2 = ${sum * 2}</span>`);
    if (h.bonuses.length) bits.push(`<span>${h.bonuses.map((n) => `+${n}`).join(" ")}</span>`);
  }
  if (!bits.length) bits.push(`<span>Sem cartas ainda</span>`);
  return `${bits.join("")}<span class="left">${s.deck.length} no baralho</span>`;
}

function handView(s, id) {
  const h = handOf(s, id);
  const mine = id === room.me;
  const turn = s.phase === "playing" && s.turn === id;
  const name = esc(game.nameOf(s, id));
  const who = mine ? (turn ? `<strong>Sua vez</strong>` : `<strong>Sua mão</strong>`) : turn ? `Vez de <strong>${name}</strong>` : `Mão de <strong>${name}</strong>`;
  const full = h.numbers.length === 7;
  const slots = Array.from({ length: 7 }, (_, i) => {
    const n = h.numbers[i];
    return n === undefined ? `<span class="slot"></span>` : `<span class="slot on" style="--ink:${CARDS[n].ink};--i:${i}" data-n="${n}">${n}</span>`;
  }).join("");
  const held = new Set(h.numbers);
  const card = (c) => {
    const on = held.has(c.n);
    const dup = h.bust && h.bustOn === c.n;
    return `<div class="card${on ? " on" : ""}${dup ? " dup" : ""}" style="--ink:${c.ink};--i:${c.n}" data-k="n${c.n}" role="img" aria-label="${c.n}${on ? ", na mão" : ""}">${cardArtSvg(c)}</div>`;
  };
  const mod = (label, ink, on, key, i) =>
    `<div class="mod${on ? " on" : ""}" style="--ink:${ink};--i:${i}" data-k="${key}" role="img" aria-label="${label}${on ? ", na mão" : ""}">${modArtSvg(label)}</div>`;
  const mods = MODS.map((m, i) => mod(`+${m.v}`, m.ink, h.bonuses.includes(m.v), `m${m.v}`, 13 + i)).join("") + mod("×2", X2_INK, Boolean(h.x2), "x2", 18);
  return `<section class="calc deal${h.bust ? " busted-hand" : ""}" data-player="${id}">
    <div class="hand-head">
      <div class="hand-info">
        <p class="who">${who}</p>
        <div class="hand${full ? " flip" : ""}" role="img" aria-label="${h.numbers.length} de 7 números">${slots}</div>
      </div>
      <div class="score${full && !h.bust ? " flip" : ""}${h.bust ? " bust" : ""}"><b>${pointsOf(h)}</b></div>
    </div>
    <p class="formula">${formulaOf(s, h)}</p>
    <div class="entry view${h.bust ? " bust" : ""}"><div class="deck"><div class="grid">${CARDS.slice(0, 10).map(card).join("")}</div><div class="grid three">${CARDS.slice(10).map(card).join("")}</div><div class="mods">${mods}</div></div></div>
  </section>`;
}

function detailOf(h) {
  if (!h || h.waiting) return "entrou nesta rodada";
  if (h.bust) return `estourou no ${h.bustOn ?? "repetido"}`;
  const bits = [];
  if (h.numbers.length) bits.push(h.numbers.join("+"));
  if (h.x2) bits.push("×2");
  if (h.bonuses.length) bits.push(h.bonuses.map((n) => `+${n}`).join(" "));
  if (h.numbers.length === 7) bits.push(`+${game.FLIP_BONUS}`);
  if (h.frozen) bits.push("· congelou");
  return bits.join(" ") || "0";
}

function summaryView(s, rows) {
  const list = rows
    .map((row, i) => {
      const result = s.lastRound?.find((r) => r.id === row.id);
      const h = s.hands[row.id];
      return `<article class="sum-row${row.rank === 1 && row.total > 0 ? " leader" : ""}" style="--i:${i}">
        <span class="rk">${row.rank}</span>
        <div class="meta"><span class="nm">${esc(row.name)}${row.id === room.me ? " · você" : ""}</span><small>${esc(detailOf(h))}</small></div>
        <span class="round">${!result || result.bust ? "0" : `+${result.gained}`}</span>
        <span class="tot">total<br>${row.total}</span>
      </article>`;
    })
    .join("");
  return `<section class="calc"><h2>Rodada ${s.roundNo}</h2><div class="sum">${list}</div></section>`;
}

function waitBar(html) {
  return `<p class="wait" role="status"><span>${html}</span><i></i><i></i><i></i></p>`;
}

function dockView(s) {
  const float = room.error ? `<div class="float"><p class="warn" role="status">${esc(room.error)}</p></div>` : "";
  if (s.phase === "round-end") {
    const body = store.isHost()
      ? `<button type="button" class="primary xl" data-action="ol-next">Próxima rodada</button>`
      : waitBar(`Esperando <b>${esc(hostName(s))}</b> abrir a próxima rodada`);
    return `<footer class="dock">${float}${body}</footer>`;
  }
  const me = handOf(s, room.me);
  const pending = s.pending[0];
  const myTurn = s.turn === room.me && !pending;
  if (myTurn && game.isActive(s, room.me)) {
    const empty = !me.numbers.length && !me.bonuses.length && !me.x2 && !me.chance;
    return `<footer class="dock">${float}<div class="dock-row two">
      <button type="button" class="icon-btn clear lbl" data-action="ol-stay" aria-label="Parar com ${pointsOf(me)} pontos" ${empty ? "disabled" : ""}>${ICONS.stay}<span>Parar</span></button>
      <button type="button" class="icon-btn go lbl" data-action="ol-hit" aria-label="Pedir carta">${ICONS.hit}<span>Pedir carta</span></button>
    </div></footer>`;
  }
  let text;
  if (pending) {
    const what = ACTIONS[pending.kind].name;
    text = pending.by === room.me ? `Escolha quem recebe o <b>${what}</b>` : `<b>${esc(game.nameOf(s, pending.by))}</b> escolhe quem recebe o ${what}`;
  } else {
    const turn = s.turn ? `vez de <b>${esc(game.nameOf(s, s.turn))}</b>` : "";
    const mine = me.waiting ? "Você entra na próxima rodada" : me.bust ? "Você estourou" : me.frozen ? `Você congelou com ${pointsOf(me)}` : me.stayed ? `Você parou com ${pointsOf(me)}` : "";
    text = mine ? `${mine}${turn ? ` · ${turn}` : ""}` : turn ? turn.replace(/^v/, "V") : "Aguarde";
  }
  return `<footer class="dock">${float}${waitBar(text)}</footer>`;
}

function chooserView(s) {
  const item = s.pending[0];
  if (!item || item.by !== room.me || s.phase !== "playing") return "";
  const targets = game.activePlayers(s);
  const ask = item.kind === "freeze" ? "Quem para agora e guarda os pontos da mão?" : "Quem tem que virar três cartas?";
  return `<div class="modal"><div class="sheet pick" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="pick-head">${anyCard({ t: item.kind }, "pick-card")}<div><h2 id="sheet-title">${ACTIONS[item.kind].name}</h2><p>${ask}</p></div></div>
    <div class="targets">${targets
      .map((p) => {
        const h = handOf(s, p.id);
        return `<button type="button" data-action="ol-resolve" data-id="${p.id}"><span class="nm">${p.id === room.me ? "Você" : esc(p.name)}</span><small>${pointsOf(h)} na mão · ${h.numbers.length} de 7</small></button>`;
      })
      .join("")}</div>
  </div></div>`;
}

function dialogView(s) {
  if (!view.dialog) return "";
  let body = "";
  if (view.dialog === "menu") {
    body = `<h2 id="sheet-title">${esc(s?.name || "Sala")}</h2>
      <p class="sheet-note">Código <strong>${esc(room.code)}</strong></p>
      <div class="menu">
        <button type="button" data-action="ol-copy">${view.copied ? "Link copiado" : "Copiar link da sala"}</button>
        ${canShare ? `<button type="button" data-action="ol-share">Compartilhar link</button>` : ""}
        <button type="button" data-action="ol-rename-open">Trocar meu nome</button>
        <button type="button" class="danger" data-action="ol-leave">Sair da sala</button>
      </div>
      <button type="button" class="wide" data-action="ol-dismiss" style="margin-top:8px">Fechar</button>`;
  } else if (view.dialog === "rename") {
    body = `<h2 id="sheet-title">Seu nome</h2>
      <form class="adder" data-form="ol-rename">
        <input id="ol-rename" name="player" maxlength="18" autocomplete="off" autocapitalize="words" autocorrect="off" enterkeyhint="done" value="${esc(store.myName())}" aria-label="Seu nome">
        <button type="submit">Salvar</button>
      </form>
      ${view.error ? `<p class="warn" role="status">${esc(view.error)}</p>` : ""}
      <button type="button" class="wide" data-action="ol-dismiss" style="margin-top:8px">Cancelar</button>`;
  }
  return `<div class="modal" data-action="ol-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">${body}</div></div>`;
}

function tableView(s) {
  const rows = standings(s);
  const leader = rows[0]?.total || 0;
  const pct = Math.max(0, Math.min(100, (leader / s.target) * 100));
  const holding = view.hold && performance.now() < view.hold.until && exists(s, view.hold.id) ? view.hold.id : null;
  const viewed = s.phase === "playing" ? focusId(s) : holding;
  const top = rows.filter((r) => r.total === leader);
  const banner = s.phase === "round-end" && leader >= s.target && top.length > 1 ? `<p class="banner">Empate na meta. Mais uma rodada — só um pode ficar na frente.</p>` : "";
  const body = viewed ? handView(s, viewed) : summaryView(s, rows);
  return `<main class="play" data-screen="table">
    <header class="top">
      <div class="brandline">
        <div class="brand">${brandMark()}<div><h1>${esc(s.name)}</h1><p>Rodada ${s.roundNo}</p></div></div>
        <div class="metawrap"><p class="meta">${leader} / ${s.target}</p><button type="button" class="iconbtn" data-action="ol-menu" aria-label="Menu da sala">···</button></div>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${s.target}" aria-valuenow="${leader}" aria-label="Pontos de quem lidera, meta ${s.target}"><span style="width:${pct}%"></span></div>
      ${banner}
    </header>
    <nav class="rank" aria-label="Placar">${rows.map((row) => chipView(s, row, viewed)).join("")}</nav>
    ${body}
    ${dockView(s)}
  </main>${chooserView(s) || dialogView(s)}`;
}

function victoryView(s) {
  const rows = standings(s);
  const winner = rows.find((r) => r.id === s.winner) || rows[0];
  const host = store.isHost();
  const podium = rows
    .map((row, i) => `<li class="${row.rank === 1 ? "leader" : ""}" style="--i:${i}"><span class="rk">${row.rank}</span><span class="nm">${esc(row.name)}${row.id === room.me ? " · você" : ""}</span><span class="tot">${row.total}</span></li>`)
    .join("");
  return `<main class="victory" data-screen="victory">
    ${heroHand()}
    <p class="eyebrow">Fim de jogo · ${esc(s.name)}</p>
    <h1>${winner.id === room.me ? "Você venceu" : `${esc(winner.name)} venceu`}</h1>
    <p class="win-score">${winner.total}</p>
    <ol class="podium">${podium}</ol>
    <div class="stack">
      ${host ? `<button type="button" class="primary xl" data-action="ol-rematch">Jogar de novo</button>` : `<p class="fine">Esperando ${esc(hostName(s))} começar outra partida.</p>`}
      <button type="button" class="ghost xl" data-action="ol-leave">Sair da sala</button>
    </div>
  </main>${dialogView(s)}`;
}

export function onlineView() {
  if (!room.code) return startView();
  if (room.status === "loading" && !room.state) return statusView("Abrindo a sala…");
  if (room.status === "missing") return statusView("Sala não encontrada", "Confira o código ou crie uma sala nova.");
  if (room.status === "offline" && !room.state) return statusView("Sem conexão", "Confira a internet e tente de novo.");
  const s = room.state;
  if (!s) return statusView("Abrindo a sala…");
  if (!store.amIn()) return joinView();
  trackDraw(s);
  if (s.phase === "lobby") return lobbyView(s) + dialogView(s);
  if (s.phase === "game-over") return victoryView(s);
  return tableView(s);
}

export function title() {
  const s = room.state;
  if (!s || !room.code) return "Flip 7 — Online";
  if (s.phase === "playing" && s.turn === room.me && !s.pending.length) return `Sua vez · ${s.name}`;
  return `${s.name} · Flip 7`;
}

// --- Animação -----------------------------------------------------------

export function snapshot() {
  const main = document.querySelector("#app > main");
  if (!main) return null;
  const chips = new Map();
  const shown = (el) => el?.dataset.value ?? el?.textContent ?? null;
  main.querySelectorAll(".chip").forEach((chip) => {
    chips.set(chip.dataset.id, { rect: chip.getBoundingClientRect(), tot: shown(chip.querySelector(".tot")) });
  });
  return {
    screen: main.dataset.screen,
    player: main.querySelector(".calc.deal")?.dataset.player ?? null,
    held: new Set([...main.querySelectorAll(".entry .on")].map((el) => el.dataset.k)),
    slots: new Set([...main.querySelectorAll(".slot.on")].map((el) => el.dataset.n)),
    score: shown(main.querySelector(".score b")),
    chips,
    progress: main.querySelector(".progress span")?.style.width ?? null,
    round: main.querySelector(".brand p")?.textContent ?? null,
    sheet: document.querySelector(".sheet h2")?.textContent ?? null,
    roster: new Set([...main.querySelectorAll(".roster li")].map((li) => li.dataset.id)),
    summary: Boolean(main.querySelector(".sum")),
  };
}

export function animate(before) {
  const reveal = pendingReveal;
  pendingReveal = null;
  const main = document.querySelector("#app > main");
  if (!main || calmMotion.matches) return;

  const sheet = document.querySelector(".sheet h2");
  if (sheet && sheet.textContent !== before?.sheet) document.querySelector(".modal")?.classList.add(before?.sheet ? "swap" : "arrive");

  if (!before || before.screen !== main.dataset.screen) {
    main.classList.add("arrive");
    const win = main.querySelector(".win-score");
    if (win) {
      countUp(win, 0, Number(win.textContent), 350);
      setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.28, 110, 1.6), 300);
    }
    if (reveal && main.dataset.screen === "victory") showReveal(reveal);
    return;
  }

  main.querySelectorAll(".roster li").forEach((li) => {
    if (!before.roster.has(li.dataset.id)) li.classList.add("arrive");
  });

  const bar = main.querySelector(".progress span");
  if (bar && before.progress !== null && bar.style.width !== before.progress) {
    bar.animate([{ width: before.progress }, { width: bar.style.width }], { duration: 800, delay: 300, easing: EASE, fill: "backwards" });
  }
  const round = main.querySelector(".brand p");
  if (round && before.round !== null && round.textContent !== before.round) round.classList.add("bump");

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
      chip.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: 560, easing: EASE, fill: "backwards" });
    }
    const tot = chip.querySelector(".tot");
    if (tot && old.tot !== tot.textContent) {
      countUp(tot, Number(old.tot), Number(tot.textContent));
      chip.classList.add("gain");
    }
  });

  const sum = main.querySelector(".sum");
  if (sum && !before.summary) sum.classList.add("arrive");

  const calc = main.querySelector(".calc.deal");
  if (calc) {
    const switched = calc.dataset.player !== before.player;
    if (switched) calc.classList.add(before.player ? "next" : "deal-in");
    else {
      main.querySelectorAll(".entry .on").forEach((el) => {
        if (!before.held.has(el.dataset.k)) el.classList.add("pick");
      });
      main.querySelectorAll(".slot.on").forEach((slot) => {
        if (!before.slots.has(slot.dataset.n)) slot.classList.add("drop-in");
      });
      const score = calc.querySelector(".score b");
      if (score && before.score !== null && score.textContent !== before.score) {
        countUp(score, Number(before.score), Number(score.textContent));
        score.classList.add("bump");
      }
    }
  }

  if (reveal) {
    showReveal(reveal);
    const chip = main.querySelector(`.chip[data-id="${CSS.escape(reveal.by)}"]`);
    if (reveal.result === "bust") {
      setTimeout(() => flash("bust"), 380);
      chip?.style.setProperty("--delay", "380ms");
      chip?.classList.add("busted");
      main.querySelector(".card.dup")?.classList.add("shake");
      if (reveal.by === room.me) buzz(false);
    } else if (reveal.result === "flip7") {
      flash("gold");
      setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.4, 90, 1.2), 300);
      buzz(true);
    }
  }
}

function revealCaption(last) {
  const s = room.state;
  const who = last.by === room.me ? "Você" : game.nameOf(s, last.by);
  if (last.result === "bust") return `${who} estourou`;
  if (last.result === "flip7") return "Flip 7!";
  if (last.result === "saved") return `Segunda chance salvou ${last.by === room.me ? "você" : who}`;
  if (last.result === "frozen") return `${last.from === room.me ? "Você" : game.nameOf(s, last.from)} congelou ${last.by === room.me ? "você" : who}`;
  if (last.card.t === "chance") return `${who} ganhou 2ª chance`;
  if (last.card.t === "freeze" || last.card.t === "three") return `${who} tirou ${ACTIONS[last.card.t].name}`;
  return `${who} tirou`;
}

function showReveal(last) {
  document.querySelectorAll(".reveal").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = `reveal ${last.result || ""}`;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="reveal-card"><div class="face back">${cardBack()}</div><div class="face front">${anyCard(last.card)}</div></div><p class="reveal-cap">${esc(revealCaption(last))}</p>`;
  document.body.append(el);
  const card = el.querySelector(".reveal-card");
  const cap = el.querySelector(".reveal-cap");
  const bust = last.result === "bust";
  const still = calmMotion.matches;
  // Entra rápido, fica parada na mesa e só então sai: dá tempo de ler a carta.
  const rest = bust ? "translateY(0) scale(1) rotate(-3deg)" : "translateY(0) scale(1)";
  card.animate(
    still
      ? [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.88 }, { opacity: 0, offset: 1 }]
      : [
          { transform: "translateY(-70px) scale(0.55) rotateY(180deg)", opacity: 0, offset: 0 },
          { transform: "translateY(0) scale(1.06) rotateY(180deg)", opacity: 1, offset: 0.1 },
          { transform: "translateY(0) scale(1.1) rotateY(0deg)", offset: 0.19 },
          { transform: "translateY(0) scale(1) rotateY(0deg)", offset: 0.26 },
          { transform: rest, opacity: 1, offset: 0.32 },
          { transform: bust ? `${rest} scale(1.03)` : "translateY(0) scale(1.03)", opacity: 1, offset: 0.6 },
          { transform: rest, opacity: 1, offset: 0.88 },
          { transform: "translateY(34px) scale(0.66)", opacity: 0, offset: 1 },
        ],
    { duration: REVEAL_MS, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)", fill: "both" }
  );
  cap.animate(
    still
      ? [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.88 }, { opacity: 0, offset: 1 }]
      : [
          { opacity: 0, translate: "0 10px", offset: 0 },
          { opacity: 1, translate: "0 0", offset: 0.16 },
          { opacity: 1, translate: "0 0", offset: 0.88 },
          { opacity: 0, translate: "0 8px", offset: 1 },
        ],
    { duration: REVEAL_MS, easing: "ease-out", fill: "both" }
  );
  el.animate(
    [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.88 }, { opacity: 0, offset: 1 }],
    { duration: REVEAL_MS, fill: "both" }
  ).finished.then(
    () => el.remove(),
    () => el.remove()
  );
}
