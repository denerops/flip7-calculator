// Acesso ao Supabase por REST puro, sem SDK: são poucas chamadas e assim
// não pesa no carregamento do app. A chave abaixo é pública por natureza.

export const SUPABASE_URL = "https://tppkppdkjhlgwfkpmirw.supabase.co";
export const SUPABASE_KEY = "sb_publishable_vjaU74ZiS4orcGbFrSruBg__zQ-KpYp";

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

export function slug(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function request(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...HEADERS, ...options.headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`supabase ${res.status} ${text}`.trim());
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

export async function fetchRoom(code) {
  const rows = await request(`rooms?code=eq.${encodeURIComponent(code)}&select=code,name,state,version`);
  return rows?.[0] || null;
}

export async function insertRoom(code, name, state) {
  const rows = await request("rooms?select=code,name,state,version", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ code, name, state, version: 1 }]),
  });
  return rows?.[0] || null;
}

export async function saveRoom(code, version, state) {
  const next = await request("rpc/room_save", {
    method: "POST",
    body: JSON.stringify({ p_code: code, p_version: version, p_state: state }),
  });
  return typeof next === "number" ? next : null;
}

export function roomLink(code) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("sala", code);
  return url.toString();
}
