// Sala online: carrega, entra, sincroniza e aplica jogadas.

import * as api from "./net.js";
import * as game from "./game.js";

export const store = {
  code: "",
  name: "",
  version: 0,
  state: null,
  me: "",
  status: "idle",
  error: "",
  saving: false,
};

const listeners = new Set();
let socket = null;
let pollTimer = 0;

export function onRoom(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function myId() {
  const KEY = "flip7-player-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `p-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function myName() {
  return localStorage.getItem("flip7-player-name") || "";
}

export function rememberName(name) {
  localStorage.setItem("flip7-player-name", name);
}

export function amIn() {
  return Boolean(store.state?.players?.some((p) => p.id === store.me));
}

export function isHost() {
  return store.state?.players?.[0]?.id === store.me;
}

export const link = api.roomLink;

function apply(row) {
  if (!row) return;
  store.version = row.version;
  store.state = row.state;
  store.name = row.name || store.name;
  emit();
}

function stopLive() {
  try {
    socket?.close();
  } catch {
    /* já fechado */
  }
  socket = null;
  clearInterval(pollTimer);
  pollTimer = 0;
}

function startLive(code) {
  stopLive();
  try {
    const base = api.SUPABASE_URL.replace(/^https/, "wss");
    const url = `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(api.SUPABASE_KEY)}&vsn=1.0.0`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          topic: `realtime:room-${code}`,
          event: "phx_join",
          payload: {
            config: {
              broadcast: { self: false },
              postgres_changes: [{ event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }],
            },
            access_token: api.SUPABASE_KEY,
          },
          ref: "1",
          join_ref: "1",
        })
      );
    });
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const record = msg?.payload?.record || msg?.payload?.new || msg?.payload?.data?.record;
      if (record && record.version > store.version) {
        store.version = record.version;
        store.state = record.state;
        store.name = record.name || store.name;
        emit();
      }
    });
    ws.addEventListener("close", () => {
      if (store.code === code) setTimeout(() => store.code === code && startLive(code), 4000);
    });
  } catch {
    socket = null;
  }
  // Rede de segurança: se o websocket não entregar, busca a sala de tempo em tempo.
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    void refresh();
  }, 2500);
}

export async function openRoom(code) {
  store.code = code;
  store.me = myId();
  store.status = "loading";
  store.error = "";
  emit();
  try {
    const row = await api.fetchRoom(code);
    if (!row) {
      store.status = "missing";
      emit();
      return false;
    }
    store.status = "ready";
    apply(row);
    startLive(code);
    return true;
  } catch (error) {
    store.status = "offline";
    store.error = String(error?.message || error);
    emit();
    return false;
  }
}

export async function createRoom(name) {
  const code = api.slug(name);
  if (!code) throw new Error("Escolha um nome com letras ou números.");
  store.code = code;
  store.me = myId();
  store.status = "loading";
  store.error = "";
  emit();
  const existing = await api.fetchRoom(code);
  if (existing) {
    store.status = "ready";
    apply(existing);
    startLive(code);
    return { code, existing: true };
  }
  const fresh = game.createRoom(name.trim().slice(0, 32), code);
  const row = await api.insertRoom(code, fresh.name, fresh);
  store.status = "ready";
  apply(row);
  startLive(code);
  return { code, existing: false };
}

export function exitRoom() {
  stopLive();
  store.code = "";
  store.state = null;
  store.version = 0;
  store.name = "";
  store.status = "idle";
  store.error = "";
  emit();
}

/** Aplica uma jogada local e grava. Se outro gravou antes, recarrega e avisa. */
export async function play(mutate, options = {}) {
  if (!store.state || store.saving) return false;
  const next = structuredClone(store.state);
  mutate(next, store.me);
  store.state = next;
  emit();
  return persist(next, options.force);
}

async function persist(state, force = false) {
  store.saving = true;
  try {
    let version = await api.saveRoom(store.code, force ? store.version : store.version, state);
    if (version === null) {
      const row = await api.fetchRoom(store.code);
      if (row) apply(row);
      return false;
    }
    store.version = version;
    return true;
  } catch {
    store.error = "Não consegui salvar. Confira a internet.";
    return false;
  } finally {
    store.saving = false;
    emit();
  }
}

export async function joinSelf(name) {
  const clean = String(name || "").trim().slice(0, 18);
  if (!clean) return;
  rememberName(clean);
  store.me = myId();
  await play((state, id) => game.join(state, id, clean));
}

export async function refresh() {
  if (!store.code || store.saving) return;
  const row = await api.fetchRoom(store.code).catch(() => null);
  if (row && row.version > store.version) apply(row);
}
