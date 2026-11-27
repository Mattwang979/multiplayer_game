// 地圖檢查：每張地圖都要連通、據點不擠在一起、道路不交叉、不穿過別的據點、湖和山
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS, buildMap, type Vec } from "@frontline/shared";

const segHit = (a: Vec, b: Vec, c: Vec, d: Vec) => {
  const cross = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  // 共線（例如兩條路從兩邊直直接到同一個據點）不算交叉：浮點誤差會讓乘積變成極小的負數
  return d1 * d2 < -1e-3 && d3 * d4 < -1e-3;
};
const distSeg = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};
const inPoly = (x: number, y: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/** 點到多邊形邊的最短距離 */
const distPoly = (p: Vec, poly: [number, number][]) => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    best = Math.min(best, distSeg(p, { x: ax, y: ay }, { x: bx, y: by }));
  }
  return best;
};

for (const def of MAPS) {
  test(`地圖 ${def.name}（${def.id}）`, () => {
    const m = buildMap(def.id);
    const problems: string[] = [];
    // 連通
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      for (const li of m.adj[n]) {
        const l = m.lanes[li];
        const o = l.a === n ? l.b : l.a;
        if (!seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    if (seen.size !== m.nodes.length) problems.push(`有 ${m.nodes.length - seen.size} 個據點走不到`);
    // 名字不重複、大本營至少兩條路、每個人數設定的位置都有大本營
    const names = new Set(m.nodes.map((n) => n.name));
    if (names.size !== m.nodes.length) problems.push("據點名字重複");
    m.nodes.forEach((n) => {
      if (m.adj[n.index].length === 0) problems.push(`${n.name} 沒有路`);
      if (n.kind === "hq" && m.adj[n.index].length < 2) problems.push(`${n.name} 只有一條路`);
      if (n.x < 80 || n.y < 80 || n.x > m.w - 80 || n.y > m.h - 80) problems.push(`${n.name} 太靠邊`);
    });
    for (const [k, slots] of Object.entries(def.slotOrder)) {
      for (const sl of slots) if (!m.nodes.some((n) => n.kind === "hq" && n.slot === sl)) problems.push(`${k} 人的位置 ${sl} 沒有大本營`);
    }
    // 大地圖才檢查間距和道路（舊地圖已經玩過很久，不動）
    if (m.w > 1600) {
      for (const a of m.nodes)
        for (const b of m.nodes)
          if (a.index < b.index && Math.hypot(a.x - b.x, a.y - b.y) < 170) problems.push(`${a.name} 和 ${b.name} 太近`);
      // 道路不交叉（共用端點附近不算）
      m.lanes.forEach((la, i) =>
        m.lanes.forEach((lb, j) => {
          if (j <= i) return;
          const shared = [la.a, la.b].filter((n) => n === lb.a || n === lb.b);
          for (let s = 0; s < la.pts.length - 1; s++)
            for (let t = 0; t < lb.pts.length - 1; t++) {
              const near = [la.pts[s], la.pts[s + 1], lb.pts[t], lb.pts[t + 1]];
              if (shared.some((n) => near.some((p) => Math.hypot(p.x - m.nodes[n].x, p.y - m.nodes[n].y) < 80))) continue;
              if (segHit(la.pts[s], la.pts[s + 1], lb.pts[t], lb.pts[t + 1])) {
                problems.push(`${m.nodes[la.a].name}—${m.nodes[la.b].name} 跟 ${m.nodes[lb.a].name}—${m.nodes[lb.b].name} 交叉`);
                return;
              }
            }
        }),
      );
      // 道路不穿過別的據點、湖、山
      m.lanes.forEach((l) => {
        const tag = `${m.nodes[l.a].name}—${m.nodes[l.b].name}`;
        m.nodes.forEach((n) => {
          if (n.index === l.a || n.index === l.b) return;
          const d = Math.min(...l.pts.map((p) => Math.hypot(p.x - n.x, p.y - n.y)));
          if (d < 75) problems.push(`${tag} 穿過 ${n.name}`);
        });
        for (const [x, y, rx, ry] of def.lakes ?? []) {
          if (l.pts.some((p) => ((p.x - x) / (rx + 34)) ** 2 + ((p.y - y) / (ry + 34)) ** 2 < 1)) problems.push(`${tag} 穿過湖 (${x},${y})`);
        }
        for (const poly of def.mountains ?? []) {
          if (l.pts.some((p) => inPoly(p.x, p.y, poly) || distPoly(p, poly) < 34)) problems.push(`${tag} 穿過山 (${poly[0]})`);
        }
      });
      // 據點不在湖裡、山上
      m.nodes.forEach((n) => {
        for (const [x, y, rx, ry] of def.lakes ?? []) if (((n.x - x) / (rx + 60)) ** 2 + ((n.y - y) / (ry + 60)) ** 2 < 1) problems.push(`${n.name} 在湖邊太近`);
        for (const poly of def.mountains ?? []) if (inPoly(n.x, n.y, poly) || distPoly(n, poly) < 60) problems.push(`${n.name} 在山邊太近`);
      });
    }
    assert.deepEqual([...new Set(problems)], []);
  });
}
