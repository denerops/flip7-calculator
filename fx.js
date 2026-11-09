// Efeitos visuais compartilhados: contagem, confete, pontos voando e clarão.

export const calmMotion = matchMedia("(prefers-reduced-motion: reduce)");
export const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const CONFETTI = ["#e25038", "#f7b132", "#47b5d6", "#28ae52", "#8951a4", "#de4982", "#f6eed8", "#c8d627"];

export function countUp(el, from, to, delay = 0) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
  const duration = Math.min(700, 220 + Math.abs(to - from) * 10);
  const start = performance.now() + delay;
  el.textContent = String(from);
  el.dataset.value = String(to);
  setTimeout(() => {
    el.textContent = String(to);
  }, delay + duration + 50);
  const step = () => {
    if (!el.isConnected) return;
    const p = Math.min(1, Math.max(0, (performance.now() - start) / duration));
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function confetti(x, y, count, spread = 1) {
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement("i");
    const angle = Math.random() * Math.PI * 2;
    const dist = (70 + Math.random() * 170) * spread;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.8 - 70 * spread;
    const spin = (Math.random() - 0.5) * 900;
    bit.style.cssText = `left:${x}px;top:${y}px;background:${CONFETTI[i % CONFETTI.length]};${i % 3 === 0 ? "border-radius:50%;width:8px;height:8px;" : ""}`;
    layer.append(bit);
    bit.animate(
      [
        { translate: "0 0", rotate: "0deg", opacity: 1 },
        { translate: `${dx}px ${dy}px`, rotate: `${spin * 0.5}deg`, opacity: 1, offset: 0.45 },
        { translate: `${dx * 1.25}px ${dy + 260}px`, rotate: `${spin}deg`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 800, delay: Math.random() * 90, easing: "cubic-bezier(0.15, 0.6, 0.35, 1)", fill: "both" }
    );
  }
  setTimeout(() => layer.remove(), 2400);
}

export function flyPoints(from, to, text, bust) {
  const target = to.getBoundingClientRect();
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const dx = target.left + target.width / 2 - x0;
  const dy = target.top + target.height / 2 - y0;
  const el = document.createElement("div");
  el.className = `fly${bust ? " bust" : ""}`;
  el.setAttribute("aria-hidden", "true");
  el.textContent = text;
  el.style.cssText = `left:${x0}px;top:${y0}px`;
  document.body.append(el);
  el.animate(
    [
      { translate: "-50% -50%", scale: 1, opacity: 1 },
      { translate: `calc(-50% + ${dx * 0.35}px) calc(-50% + ${dy * 0.35 - 46}px)`, scale: 1.2, opacity: 1, offset: 0.4 },
      { translate: `calc(-50% + ${dx}px) calc(-50% + ${dy}px)`, scale: 0.35, opacity: 0.15 },
    ],
    { duration: 640, easing: "cubic-bezier(0.45, 0, 0.3, 1)" }
  ).finished.then(() => el.remove(), () => el.remove());
}

export function flash(kind) {
  const el = document.createElement("div");
  el.className = `flash ${kind}`;
  el.setAttribute("aria-hidden", "true");
  document.body.append(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

export function buzz(strong) {
  try {
    navigator.vibrate?.(strong ? [12, 40, 16] : 12);
  } catch {
    /* sem vibração */
  }
}
