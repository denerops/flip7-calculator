// Telas do jogo online. A verdade fica em room.store.state;
// aqui só desenhamos e mandamos jogadas.

import * as store from "./room.js";
import * as game from "./game.js";

export const view = { screen: "home", roomDraft: "", codeDraft: "" };

const room = store.store;
const INK = ["#d9383a", "#d89648", "#c8d627", "#de4982", "#47b5d6", "#28ae52", "#8951a4", "#e25038", "#76be43", "#ee9433", "#dc2929", "#7381b8", "#8d8078"];

export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function numberChip(n) {
  return `<span class="num-chip" style="--ink:${INK[n]}">${n}</span>`;
}

function modChip(value) {
  return value === 0 ? `<span class="mod-chip x2">×2</span>` : `<span class="mod-chip">+${value}</span>`;
}

function handChips(hand) {
  if (!hand) return `<div class="chips"></div>`;
  const numbers = hand.numbers.map(numberChip).join("");
  const mods = `${hand.bonuses.map(modChip).join("")}${hand.x2 ? modChip(0) : ""}${hand.chance ? `<span class="mod-chip chance">2ª</span>` : ""}`;
  return `<div class="chips">${numbers}${mods}</div>`;
}

function seatView(s, player, mine) {
  const hand = s.hands[player.id];
  const playing = s.phase === "playing";
  const turn = playing && s.turn === player.id && !s.pending.length;
  const bust = Boolean(hand?.bust);
  const frozen = Boolean(hand?.frozen);
  const stayed = Boolean(hand?.stayed);
  const points = playing ? (bust ? 0 : game.roundPoints(hand || {})) : 0;
  const tag = bust ? "estourou" : frozen ? "congelado" : stayed ? "parou" : turn ? "na vez" : "";
  return `<article class="seat${mine ? " mine" : ""}${bust || frozen || stayed ? " out" : ""}${turn ? " turn" : ""}">
    <header><span class="nm">${esc(player.name)}${mine ? " · você" : ""}</span><span class="tot">${player.score || 0}</span></header>
    ${handChips(hand)}
    <footer><span class="round-pts">${playing ? `${points} nesta rodada` : ""}</span>${tag ? `<span class="tag${bust ? " bad" : ""}">${tag}</span>` : ""}</footer>
  </article>`;
}

function homeView() {
  const name = store.myName();
  return `<main class="setup online">
    <p class="eyebrow">Flip 7</p>
    <h1>Como vamos jogar?</h1>
    <div class="mode-list">
      <button type="button" class="mode" data-action="ol-marker">
        <strong>Marcador de mesa</strong>
        <span>Cartas de verdade. O app só soma e ordena o placar.</span>
      </button>
      <button type="button" class="mode primary-mode" data-action="ol-create-screen">
        <strong>Jogar online</strong>
        <span>Crie uma sala, mande o link e jogue com os amigos de qualquer lugar.</span>
      </button>
      <button type="button" class="mode" data-action="ol-enter-screen">
        <strong>Entrar numa sala</strong>
        <span>Já tem o código ou o link? Entre direto.</span>
      </button>
    </div>
    ${name ? `<p class="fine">Você joga como <strong>${esc(name)}</strong>.</p>` : ""}
  </main>`;
}

function createView() {
  return `<main class="setup online">
    <button type="button" class="back" data-action="ol-home">Voltar</button>
    <p class="eyebrow">Nova sala</p>
    <h1>Nome da sala</h1>
    <p class="fine">O nome vira o código. Use o mesmo toda semana e a mesa continua a mesma.</p>
    <form data-form="ol-create">
      <label class="order" for="room-name">Sala</label>
      <div class="adder">
        <input id="room-name" name="room" maxlength="32" autocomplete="off" autocapitalize="words" autocorrect="off" enterkeyhint="next" placeholder="Ex.: mesa do bairro" value="${esc(view.roomDraft)}">
      </div>
      <label class="order" for="ol-name-create">Seu nome</label>
      <div class="adder">
        <input id="ol-name-create" name="player" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Quem joga" value="${esc(store.myName())}">
        <button type="submit">Criar</button>
      </div>
    </form>
  </main>`;
}

function enterView() {
  return `<main class="setup online">
    <button type="button" class="back" data-action="ol-home">Voltar</button>
    <p class="eyebrow">Entrar</p>
    <h1>Código da sala</h1>
    <form data-form="ol-enter">
      <label class="order" for="room-code">Código</label>
      <div class="adder">
        <input id="room-code" name="room" maxlength="32" autocomplete="off" autocapitalize="none" autocorrect="off" enterkeyhint="next" placeholder="mesa-do-bairro" value="${esc(view.codeDraft)}">
      </div>
      <label class="order" for="ol-name-enter">Seu nome</label>
      <div class="adder">
        <input id="ol-name-enter" name="player" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Quem joga" value="${esc(store.myName())}">
        <button type="submit">Entrar</button>
      </div>
    </form>
  </main>`;
}

function joinView() {
  return `<main class="setup online">
    <p class="eyebrow">${esc(room.name || room.code)}</p>
    <h1>Entre na mesa</h1>
    <form data-form="ol-join">
      <label class="order" for="ol-name">Seu nome</label>
      <div class="adder">
        <input id="ol-name" name="player" maxlength="18" autocomplete="off" autocapitalize="words" placeholder="Quem joga" value="${esc(store.myName())}" autofocus>
        <button type="submit">Entrar</button>
      </div>
    </form>
  </main>`;
}

function statusView(message, hint) {
  return `<main class="setup online"><p class="eyebrow">Sala</p><h1>${esc(message)}</h1>${hint ? `<p class="fine">${esc(hint)}</p>` : ""}<button type="button" class="ghost xl" data-action="ol-home">Voltar</button></main>`;
}

function lobbyView(s) {
  const host = store.isHost();
  const people = s.players.length
    ? `<ul class="roster online-roster">${s.players
        .map((p) => `<li><span class="seat">${p.seat + 1}</span><span class="nm">${esc(p.name)}${p.id === room.me ? " (você)" : ""}</span>${host && p.id !== room.me && s.players.length > 1 ? `<button type="button" class="textbtn" data-action="ol-kick" data-id="${p.id}">tirar</button>` : ""}</li>`)
        .join("")}</ul>`
    : `<p class="empty">Ninguém ainda.</p>`;
  return `<main class="setup online">
    <button type="button" class="back" data-action="ol-leave">Sair</button>
    <p class="eyebrow">${esc(s.name)}</p>
    <h1>Sala aberta</h1>
    <div class="share-box">
      <label class="order" for="share-link">Link para convidar</label>
      <div class="adder">
        <input id="share-link" readonly value="${esc(store.link(room.code))}">
        <button type="button" data-action="ol-copy">Copiar</button>
      </div>
      <p class="fine">Código: <strong>${esc(room.code)}</strong></p>
    </div>
    <p class="order">Na mesa${s.players.length ? ` · ${s.players.length}` : ""}</p>
    ${people}
    <div class="stack">
      <button type="button" class="primary xl" data-action="ol-start" ${s.players.length < 2 || !host ? "disabled" : ""}>Começar rodada</button>
      <button type="button" class="ghost xl" data-action="ol-rename">Trocar meu nome</button>
    </div>
    ${!host && s.players.length ? `<p class="fine">Quem começa a rodada é ${esc(s.players[0].name)}.</p>` : ""}
    ${room.error ? `<p class="warn">${esc(room.error)}</p>` : ""}
  </main>`;
}

function chooserView(s) {
  const item = s.pending[0];
  if (!item) return "";
  const mine = item.by === room.me;
  const targets = game.activePlayers(s);
  const title = item.kind === "freeze" ? "Freeze" : "Flip Three";
  return `<div class="modal"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pick-title">
    <h2 id="pick-title">${title}</h2>
    <p>${mine ? "Escolha quem recebe a carta." : `Esperando ${esc(game.nameOf(s, item.by))} escolher.`}</p>
    ${mine ? `<div class="targets">${targets.map((p) => `<button type="button" data-action="ol-resolve" data-id="${p.id}">${esc(p.name)}</button>`).join("")}</div>` : ""}
  </div></div>`;
}

function roundEndView(s) {
  const host = store.isHost();
  const rows = (s.lastRound || [])
    .map((row) => `<li class="${row.bust ? "bust" : ""}"><span class="nm">${esc(row.name)}</span><span class="gain">${row.bust ? "0" : `+${row.gained}`}</span><span class="tot">${row.total}</span></li>`)
    .join("");
  return `<div class="modal"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="round-title">
    <h2 id="round-title">Fim da rodada ${s.roundNo}</h2>
    <ul class="round-list">${rows}</ul>
    <button type="button" class="primary wide" data-action="ol-next" ${host ? "" : "disabled"}>${host ? "Próxima rodada" : "Esperando a próxima rodada"}</button>
  </div></div>`;
}

function gameOverView(s) {
  const winner = s.players.find((p) => p.id === s.winner);
  const host = store.isHost();
  const podium = [...s.players]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((p, i) => `<li class="${i === 0 ? "leader" : ""}"><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="tot">${p.score || 0}</span></li>`)
    .join("");
  return `<div class="modal"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="win-title">
    <h2 id="win-title">${winner ? `${esc(winner.name)} venceu` : "Fim de jogo"}</h2>
    <ol class="podium">${podium}</ol>
    <button type="button" class="primary wide" data-action="ol-rematch" ${host ? "" : "disabled"}>Jogar de novo</button>
    <button type="button" class="wide" data-action="ol-leave" style="margin-top:8px">Sair da sala</button>
  </div></div>`;
}

export function onlineView() {
  if (!room.code) {
    if (view.screen === "create") return createView();
    if (view.screen === "enter") return enterView();
    return homeView();
  }
  if (room.status === "loading") return statusView("Abrindo a sala…");
  if (room.status === "missing") return statusView("Sala não encontrada", "Confira o código ou crie uma sala nova.");
  if (room.status === "offline") return statusView("Sem conexão", room.error);
  if (!store.amIn()) return joinView();
  const s = room.state;
  if (!s) return statusView("Abrindo a sala…");
  if (s.phase === "lobby") return lobbyView(s);
  return tableView(s);
}

function tableView(s) {
  const playing = s.phase === "playing";
  const myHand = s.hands[room.me];
  const myTurn = playing && s.turn === room.me && !s.pending.length;
  const canAct = Boolean(myTurn && myHand && myHand.active && !myHand.bust && !myHand.frozen && !myHand.stayed);
  const myPoints = myHand ? (myHand.bust ? 0 : game.roundPoints(myHand)) : 0;
  const waitNote = s.pending.length ? "Resolvendo uma carta de ação." : playing && s.turn ? `Vez de ${game.nameOf(s, s.turn)}` : "";
  return `<main class="play online-play">
    <header class="top">
      <div class="brandline">
        <div class="brand"><div><h1>${esc(s.name)}</h1><p>Rodada ${s.roundNo}</p></div></div>
        <div class="metawrap"><p class="meta">${myPoints} pts</p><button type="button" class="iconbtn" data-action="ol-leave" aria-label="Sair da sala ou voltar ao marcador">···</button></div>
      </div>
      <div class="progress" role="img" aria-label="${s.players.length} jogadores"><span style="width:${Math.min(100, (myPoints / s.target) * 100)}%"></span></div>
    </header>
    <section class="seats">${s.players.map((p) => seatView(s, p, p.id === room.me)).join("")}</section>
    <section class="feed" aria-live="polite">${(s.log || []).slice(-3).map((line) => `<p>${esc(line)}</p>`).join("")}</section>
    ${playing ? `<footer class="dock"><div class="dock-row two">
      <button type="button" class="icon-btn bust" data-action="ol-stay" aria-label="Parar e guardar os pontos" title="Parar" ${canAct ? "" : "disabled"}>${ICON_STOP}</button>
      <button type="button" class="icon-btn go" data-action="ol-hit" aria-label="Pedir carta" title="Pedir carta" ${canAct ? "" : "disabled"}>${ICON_PLUS}</button>
    </div>${waitNote && !canAct ? `<p class="turn-note">${esc(waitNote)}</p>` : ""}</footer>` : ""}
    ${s.phase === "round-end" ? roundEndView(s) : ""}
    ${s.phase === "game-over" ? gameOverView(s) : ""}
    ${chooserView(s)}
  </main>`;
}

const ICON_STOP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="currentColor"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>`;

export function go(screen) {
  view.screen = screen;
}
