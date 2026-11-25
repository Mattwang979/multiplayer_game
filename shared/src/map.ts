// 地圖：據點（大本營、堡壘）和連接它們的道路。
// 道路上的位置用「沿路的像素距離」表示：0 在 a 端，lane.len 在 b 端。
// 共 4 張不同地形的地圖；人數不足時，沒人用的大本營和堡壘會變成無主據點。

export const WORLD_W = 1600;
export const WORLD_H = 1000;

export interface Vec {
  x: number;
  y: number;
}

export type Theme = "grass" | "river" | "desert" | "highland";

export interface NodeDef {
  x: number;
  y: number;
  kind: "hq" | "fort";
  slot: number; // 屬於哪個玩家位置；-1 = 無主
  big?: boolean; // 大型堡壘（血多、收入多）
  name: string;
}

export interface EdgeDef {
  a: number;
  b: number;
  via?: [number, number][]; // 道路經過的點，讓路線彎曲
}

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  theme: Theme;
  slots: number; // 最多幾人
  minPlayers: number;
  slotOrder: Record<number, number[]>; // 幾個人時用哪些位置
  nodes: NodeDef[];
  edges: EdgeDef[];
  river?: [number, number][]; // 河流中線
  lakes?: [number, number, number, number][]; // x, y, rx, ry
  mountains?: [number, number][][]; // 山脈多邊形
}

export interface LaneGeom {
  a: number;
  b: number;
  pts: Vec[];
  cum: number[];
  len: number;
}

export interface MapNode extends NodeDef {
  index: number;
}

export interface MapLayout {
  id: string;
  def: MapDef;
  nodes: MapNode[];
  lanes: LaneGeom[];
  adj: number[][]; // 每個據點相連的道路
  center: Vec;
}

// ---------------------------------------------------------------- 地圖資料

export const MAPS: MapDef[] = [
  {
    id: "fortress",
    name: "四方要塞",
    desc: "草原。外圈環形道路加上通往中央要塞的十字路，路線最多。",
    theme: "grass",
    slots: 4,
    minPlayers: 2,
    slotOrder: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
    nodes: [
      { x: 210, y: 190, kind: "hq", slot: 0, name: "西北大本營" },
      { x: 1390, y: 190, kind: "hq", slot: 1, name: "東北大本營" },
      { x: 1390, y: 830, kind: "hq", slot: 2, name: "東南大本營" },
      { x: 210, y: 830, kind: "hq", slot: 3, name: "西南大本營" },
      { x: 530, y: 215, kind: "fort", slot: 0, name: "西北前哨" },
      { x: 230, y: 440, kind: "fort", slot: 0, name: "西北側堡" },
      { x: 1070, y: 215, kind: "fort", slot: 1, name: "東北前哨" },
      { x: 1370, y: 440, kind: "fort", slot: 1, name: "東北側堡" },
      { x: 1370, y: 580, kind: "fort", slot: 2, name: "東南側堡" },
      { x: 1070, y: 805, kind: "fort", slot: 2, name: "東南前哨" },
      { x: 530, y: 805, kind: "fort", slot: 3, name: "西南前哨" },
      { x: 230, y: 580, kind: "fort", slot: 3, name: "西南側堡" },
      { x: 800, y: 165, kind: "fort", slot: -1, name: "北堡" },
      { x: 1210, y: 510, kind: "fort", slot: -1, name: "東堡" },
      { x: 800, y: 855, kind: "fort", slot: -1, name: "南堡" },
      { x: 390, y: 510, kind: "fort", slot: -1, name: "西堡" },
      { x: 800, y: 510, kind: "fort", slot: -1, big: true, name: "中央要塞" },
    ],
    edges: [
      { a: 0, b: 4 }, { a: 0, b: 5 },
      { a: 4, b: 12, via: [[660, 150]] }, { a: 12, b: 6, via: [[940, 150]] },
      { a: 6, b: 1 }, { a: 1, b: 7 }, { a: 7, b: 13 }, { a: 13, b: 8 }, { a: 8, b: 2 },
      { a: 2, b: 9 }, { a: 9, b: 14, via: [[940, 870]] }, { a: 14, b: 10, via: [[660, 870]] },
      { a: 10, b: 3 }, { a: 3, b: 11 }, { a: 11, b: 15 }, { a: 15, b: 5 },
      { a: 12, b: 16, via: [[760, 330]] }, { a: 13, b: 16, via: [[1000, 460]] },
      { a: 14, b: 16, via: [[840, 690]] }, { a: 15, b: 16, via: [[600, 560]] },
    ],
    lakes: [[610, 360, 70, 40], [990, 660, 70, 40]],
  },
  {
    id: "river",
    name: "大河之戰",
    desc: "河谷。大河把戰場切成兩半，只有北、中、南三座橋能過。",
    theme: "river",
    slots: 4,
    minPlayers: 2,
    slotOrder: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
    nodes: [
      { x: 190, y: 230, kind: "hq", slot: 0, name: "西北大本營" },
      { x: 1410, y: 230, kind: "hq", slot: 1, name: "東北大本營" },
      { x: 1410, y: 790, kind: "hq", slot: 2, name: "東南大本營" },
      { x: 190, y: 790, kind: "hq", slot: 3, name: "西南大本營" },
      { x: 470, y: 175, kind: "fort", slot: 0, name: "北岸西堡" },
      { x: 400, y: 410, kind: "fort", slot: 0, name: "西岸北堡" },
      { x: 1130, y: 175, kind: "fort", slot: 1, name: "北岸東堡" },
      { x: 1200, y: 410, kind: "fort", slot: 1, name: "東岸北堡" },
      { x: 1200, y: 610, kind: "fort", slot: 2, name: "東岸南堡" },
      { x: 1130, y: 845, kind: "fort", slot: 2, name: "南岸東堡" },
      { x: 470, y: 845, kind: "fort", slot: 3, name: "南岸西堡" },
      { x: 400, y: 610, kind: "fort", slot: 3, name: "西岸南堡" },
      { x: 610, y: 510, kind: "fort", slot: -1, big: true, name: "西橋頭堡" },
      { x: 990, y: 510, kind: "fort", slot: -1, big: true, name: "東橋頭堡" },
    ],
    edges: [
      { a: 0, b: 4 }, { a: 0, b: 5 }, { a: 5, b: 12 }, { a: 12, b: 11 }, { a: 11, b: 3 }, { a: 3, b: 10 },
      { a: 4, b: 6, via: [[640, 120], [960, 130]] },
      { a: 10, b: 9, via: [[640, 900], [960, 890]] },
      { a: 12, b: 13 },
      { a: 1, b: 6 }, { a: 1, b: 7 }, { a: 7, b: 13 }, { a: 13, b: 8 }, { a: 8, b: 2 }, { a: 2, b: 9 },
    ],
    river: [[800, -40], [770, 120], [830, 260], [780, 400], [820, 560], [775, 720], [825, 880], [800, 1040]],
  },
  {
    id: "oasis",
    name: "沙漠綠洲",
    desc: "沙漠。三方對峙，中央綠洲是大型堡壘，誰拿下誰就有優勢。",
    theme: "desert",
    slots: 3,
    minPlayers: 2,
    slotOrder: { 2: [0, 1], 3: [0, 1, 2] },
    nodes: [
      { x: 800, y: 150, kind: "hq", slot: 0, name: "北方大本營" },
      { x: 1350, y: 830, kind: "hq", slot: 1, name: "東南大本營" },
      { x: 250, y: 830, kind: "hq", slot: 2, name: "西南大本營" },
      { x: 590, y: 255, kind: "fort", slot: 0, name: "北方西堡" },
      { x: 1010, y: 255, kind: "fort", slot: 0, name: "北方東堡" },
      { x: 1250, y: 600, kind: "fort", slot: 1, name: "東南北堡" },
      { x: 1070, y: 860, kind: "fort", slot: 1, name: "東南西堡" },
      { x: 530, y: 860, kind: "fort", slot: 2, name: "西南東堡" },
      { x: 350, y: 600, kind: "fort", slot: 2, name: "西南北堡" },
      { x: 1170, y: 380, kind: "fort", slot: -1, name: "東沙丘堡" },
      { x: 800, y: 880, kind: "fort", slot: -1, name: "南沙丘堡" },
      { x: 430, y: 380, kind: "fort", slot: -1, name: "西沙丘堡" },
      { x: 800, y: 540, kind: "fort", slot: -1, big: true, name: "綠洲要塞" },
    ],
    edges: [
      { a: 0, b: 3 }, { a: 0, b: 4 },
      { a: 4, b: 9, via: [[1120, 280]] }, { a: 9, b: 5 }, { a: 5, b: 1 },
      { a: 1, b: 6 }, { a: 6, b: 10, via: [[940, 910]] }, { a: 10, b: 7, via: [[660, 910]] }, { a: 7, b: 2 },
      { a: 2, b: 8 }, { a: 8, b: 11 }, { a: 11, b: 3, via: [[480, 280]] },
      { a: 9, b: 12, via: [[1010, 420]] }, { a: 10, b: 12, via: [[760, 720]] }, { a: 11, b: 12, via: [[600, 500]] },
    ],
    lakes: [[800, 640, 80, 34]],
  },
  {
    id: "pass",
    name: "山口突破",
    desc: "高地。兩軍隔著山脈對峙，只能走北山口、中央谷地、南山口三條路。",
    theme: "highland",
    slots: 2,
    minPlayers: 2,
    slotOrder: { 2: [0, 1] },
    nodes: [
      { x: 170, y: 510, kind: "hq", slot: 0, name: "西方大本營" },
      { x: 1430, y: 510, kind: "hq", slot: 1, name: "東方大本營" },
      { x: 420, y: 270, kind: "fort", slot: 0, name: "西北堡" },
      { x: 420, y: 750, kind: "fort", slot: 0, name: "西南堡" },
      { x: 1180, y: 270, kind: "fort", slot: 1, name: "東北堡" },
      { x: 1180, y: 750, kind: "fort", slot: 1, name: "東南堡" },
      { x: 800, y: 190, kind: "fort", slot: -1, name: "北山口" },
      { x: 800, y: 510, kind: "fort", slot: -1, big: true, name: "谷地要塞" },
      { x: 800, y: 830, kind: "fort", slot: -1, name: "南山口" },
    ],
    edges: [
      { a: 0, b: 2 }, { a: 0, b: 3 },
      { a: 2, b: 6, via: [[600, 165]] }, { a: 6, b: 4, via: [[1000, 165]] },
      { a: 3, b: 8, via: [[600, 855]] }, { a: 8, b: 5, via: [[1000, 855]] },
      { a: 4, b: 1 }, { a: 5, b: 1 },
      { a: 0, b: 7, via: [[420, 540], [620, 470]] }, { a: 7, b: 1, via: [[980, 550], [1180, 480]] },
    ],
    mountains: [
      [[560, 300], [700, 270], [900, 285], [1040, 300], [1080, 380], [980, 420], [800, 410], [620, 430], [520, 380]],
      [[520, 640], [620, 600], [800, 610], [980, 590], [1080, 640], [1040, 720], [900, 740], [700, 730], [560, 720]],
    ],
  },
];

export function getMapDef(id: string): MapDef | undefined {
  return MAPS.find((m) => m.id === id);
}

export function mapsFor(players: number): MapDef[] {
  return MAPS.filter((m) => m.slots >= players && m.minPlayers <= players);
}

// ---------------------------------------------------------------- 幾何

/** Catmull-Rom 平滑曲線，每 8px 取一點 */
function sampleRoad(points: Vec[]): Vec[] {
  if (points.length === 2) {
    const [p, q] = points;
    const n = Math.max(2, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
    const out: Vec[] = [];
    for (let i = 0; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n });
    return out;
  }
  const pts = [points[0], ...points, points[points.length - 1]];
  const out: Vec[] = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2];
    const n = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 8));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const cache = new Map<string, MapLayout>();

/** 依地圖 id 建立幾何資料（同一張地圖只算一次） */
export function buildMap(id: string): MapLayout {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = getMapDef(id) ?? MAPS[0];
  const nodes: MapNode[] = def.nodes.map((n, index) => ({ ...n, index }));
  const lanes: LaneGeom[] = def.edges.map((e) => {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const pts = sampleRoad([{ x: a.x, y: a.y }, ...(e.via ?? []).map(([x, y]) => ({ x, y })), { x: b.x, y: b.y }]);
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { a: e.a, b: e.b, pts, cum, len: cum[cum.length - 1] };
  });
  const adj: number[][] = nodes.map(() => []);
  lanes.forEach((l, i) => {
    adj[l.a].push(i);
    adj[l.b].push(i);
  });
  const layout: MapLayout = { id: def.id, def, nodes, lanes, adj, center: { x: WORLD_W / 2, y: WORLD_H / 2 } };
  cache.set(def.id, layout);
  return layout;
}

/** 道路上某個位置（0 ~ lane.len）在畫面上的座標與方向（弧度，朝 b 端） */
export function lanePoint(lane: LaneGeom, x: number): { x: number; y: number; angle: number } {
  const target = Math.max(0, Math.min(lane.len, x));
  const cum = lane.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (target - cum[lo]) / seg;
  const p = lane.pts[lo];
  const q = lane.pts[hi];
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, angle: Math.atan2(q.y - p.y, q.x - p.x) };
}

/** 道路上某點往旁邊偏移 offset（正值在朝 b 端的右手邊） */
export function laneOffsetPoint(lane: LaneGeom, x: number, offset: number): { x: number; y: number; angle: number } {
  const p = lanePoint(lane, x);
  return { x: p.x - Math.sin(p.angle) * offset, y: p.y + Math.cos(p.angle) * offset, angle: p.angle };
}

export function nodeLanes(map: MapLayout, node: number): number[] {
  return map.adj[node] ?? [];
}

/** 據點在這條路的哪一端（0 或 lane.len） */
export function nodeEnd(lane: LaneGeom, node: number): number {
  return lane.a === node ? 0 : lane.len;
}

/** 從某個據點出發，在這條路上的前進方向 */
export function nodeDir(lane: LaneGeom, node: number): 1 | -1 {
  return lane.a === node ? 1 : -1;
}

export function otherEnd(lane: LaneGeom, node: number): number {
  return lane.a === node ? lane.b : lane.a;
}

/** 兩條路共用的據點 */
export function sharedNodes(a: LaneGeom, b: LaneGeom): number[] {
  const out: number[] = [];
  if (a.a === b.a || a.a === b.b) out.push(a.a);
  if (a.b === b.a || a.b === b.b) out.push(a.b);
  return out;
}

/** 兩個道路位置之間沿路的距離（同一條路，或在路口相接）；接不到就是 Infinity */
export function roadDistance(map: MapLayout, la: number, xa: number, lb: number, xb: number): number {
  if (la === lb) return Math.abs(xa - xb);
  const A = map.lanes[la];
  const B = map.lanes[lb];
  let best = Infinity;
  for (const n of sharedNodes(A, B)) {
    const d = Math.abs(xa - nodeEnd(A, n)) + Math.abs(xb - nodeEnd(B, n));
    if (d < best) best = d;
  }
  return best;
}

/** 找出畫面上離某點最近的道路位置（點地圖下指令用） */
export function nearestLanePos(map: MapLayout, px: number, py: number): { lane: number; x: number; dist: number } {
  let best = { lane: 0, x: 0, dist: Infinity };
  map.lanes.forEach((lane, li) => {
    for (let i = 0; i < lane.pts.length - 1; i++) {
      const p = lane.pts[i];
      const q = lane.pts[i + 1];
      const vx = q.x - p.x;
      const vy = q.y - p.y;
      const l2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, ((px - p.x) * vx + (py - p.y) * vy) / l2));
      const d = Math.hypot(px - (p.x + vx * t), py - (p.y + vy * t));
      if (d < best.dist) best = { lane: li, x: lane.cum[i] + Math.sqrt(l2) * t, dist: d };
    }
  });
  return best;
}
