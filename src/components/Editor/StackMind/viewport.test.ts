import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MindElixirInstance } from "mind-elixir";
import { readDockFraction, rememberViewport, saveDockFraction } from "./viewport";

function surface() {
  const events = new Map<string, () => void>();
  const map = document.createElement("div");
  const mind = {
    map, scaleVal: 1.25, container: {clientWidth: 400},
    bus: {
      addListener: (type: string, fn: () => void) => events.set(type, fn),
      fire: (type: string) => events.get(type)?.(),
    },
  };
  return { mind, open: (id: string) => rememberViewport(mind as unknown as MindElixirInstance, id) };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m41: number;
    m42: number;
    constructor(transform: string) {
      const offset = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(transform)!;
      this.m41 = Number(offset[1]);
      this.m42 = Number(offset[2]);
    }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("map reading position", () => {
  it("persists dock width and ignores data outside the supported size range", () => {
    expect(readDockFraction()).toBe(0.6);
    saveDockFraction(0.75);
    expect(readDockFraction()).toBe(0.75);
    localStorage.setItem("vmark.stackmind.dockWidth", "2");
    expect(readDockFraction()).toBe(0.6);
    localStorage.setItem("vmark.stackmind.dockWidth", "{");
    expect(readDockFraction()).toBe(0.6);
  });
  it("flushes pan and scale per document on idle, page hide, and close", () => {
    const {mind, open} = surface();
    const a = open("a");
    expect(a.restore()).toBe(false);
    mind.map.style.transform = "translate3d(12px, -20px, 0) scale(1.25)";
    mind.bus.fire("move");
    vi.advanceTimersByTime(160);
    expect(JSON.parse(localStorage.getItem("vmark.stackmind.viewport:a")!)).toEqual({ x:12, y:-20, scale:1.25 });
    mind.scaleVal = 2;
    window.dispatchEvent(new Event("pagehide"));
    a.dispose();
    const b = open("b");
    expect(b.restore()).toBe(false);
    b.dispose();
    mind.scaleVal = 1;
    const reopened = open("a");
    expect(reopened.restore()).toBe(true);
    expect(mind.scaleVal).toBe(2);
    reopened.dispose();
  });
  it("refuses incomplete or nonpositive saved viewports", () => {
    const {open} = surface();
    for (const data of [{x:1}, { x:0, y:0, scale:0 }, { x:"0", y:1, scale:1 }]) {
      localStorage.setItem("vmark.stackmind.viewport:x", JSON.stringify(data));
      const v = open("x"); expect(v.restore()).toBe(false); v.dispose();
    }
  });
});
