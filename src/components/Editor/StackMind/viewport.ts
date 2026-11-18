/**
 * Restore the dock width and each document's pan and magnification. Only UI
 * geometry is stored, separately from the Markdown file.
 * @module components/Editor/StackMind/viewport
 */
import type { MindElixirInstance } from "mind-elixir";

const prefix = "vmark.stackmind.";
function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(prefix + key) ?? "null"); } catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch { /* Storage can be full or unavailable. */ }
}
export function readDockFraction(): number {
  const n = read("dockWidth");
  return typeof n === "number" && n >= 0.2 && n <= 0.8 ? n : 0.6;
}
export function saveDockFraction(n: number) { write("dockWidth", n); }

export function rememberViewport(mind: MindElixirInstance, identity: string) {
  const key = "viewport:" + identity;
  let timer: number | undefined;
  let active = false;
  function save() {
    clearTimeout(timer);
    timer = undefined;
    if (!active || !mind.map.style.transform || !mind.container.clientWidth) return;
    const m = new DOMMatrixReadOnly(mind.map.style.transform);
    write(key, { x: m.m41, y: m.m42, scale: mind.scaleVal });
  }
  function changed() {
    if (!active) return;
    clearTimeout(timer);
    timer = window.setTimeout(save, 150);
  }
  mind.bus.addListener("move", changed);
  mind.bus.addListener("scale", changed);
  window.addEventListener("pagehide", save);
  return {
    restore() {
      active = true;
      const state = read(key);
      if (!state || typeof state !== "object" || !("x" in state) || !("y" in state) || !("scale" in state)) return false;
      const { x, y, scale } = state;
      if (typeof x !== "number" || typeof y !== "number" || typeof scale !== "number" ||
        !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale) || scale <= 0) return false;
      mind.map.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      mind.scaleVal = scale;
      mind.bus.fire("scale", scale);
      return true;
    },
    dispose() { save(); window.removeEventListener("pagehide", save); },
  };
}
