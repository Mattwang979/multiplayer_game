// 環形戰場的地圖幾何：每個玩家的指揮部在一個頂點，相鄰兩個指揮部之間有一條路線。
// 2 人：上下兩條弧線；3 人：三角形；4 人：四方形。
// 路線上的位置一律用 0~LANE_LENGTH 表示（0 在 a 端），畫面上再換算成座標。

export const WORLD_W = 1600;
export const WORLD_H = 1000;
const LEN = 1000; // 跟 LANE_LENGTH 相同（避免循環 import）

export interface Vec {
  x: number;
  y: number;
}

export interface LaneGeom {
  a: number; // 起點的指揮部編號（位置 0）
  b: number; // 終點的指揮部編號（位置 LANE_LENGTH）
  pts: Vec[]; // 折線取樣點
  cum: number[]; // 每個取樣點的累積長度
  len: number; // 畫面上的總長度
}

export interface MapLayout {
  n: number;
  nodes: Vec[];
  lanes: LaneGeom[];
  center: Vec;
}

function bezierLane(a: number, b: number, p0: Vec, c: Vec, p1: Vec): LaneGeom {
  const pts: Vec[] = [];
  const cum: number[] = [];
  const steps = 40;
  let len = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const p = {
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    };
    if (i > 0) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    pts.push(p);
    cum.push(len);
  }
  return { a, b, pts, cum, len };
}

/** 依照玩家人數建立地圖 */
export function buildMap(n: number): MapLayout {
  const center = { x: WORLD_W / 2, y: WORLD_H / 2 };
  let nodes: Vec[];
  if (n <= 2) {
    nodes = [
      { x: 250, y: 520 },
      { x: 1350, y: 520 },
    ];
    return {
      n: 2,
      nodes,
      center,
      lanes: [
        bezierLane(0, 1, nodes[0], { x: 800, y: 60 }, nodes[1]),
        bezierLane(1, 0, nodes[1], { x: 800, y: 980 }, nodes[0]),
      ],
    };
  }
  // 上下各留空間給介面（上方玩家血條、下方按鈕列）
  if (n === 3) {
    nodes = [
      { x: 800, y: 175 },
      { x: 1290, y: 790 },
      { x: 310, y: 790 },
    ];
  } else {
    nodes = [
      { x: 310, y: 195 },
      { x: 1290, y: 195 },
      { x: 1290, y: 790 },
      { x: 310, y: 790 },
    ];
  }
  const lanes: LaneGeom[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const j = (i + 1) % nodes.length;
    const p0 = nodes[i];
    const p1 = nodes[j];
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    // 控制點往外推，讓路線微微彎曲
    const dx = mid.x - center.x;
    const dy = mid.y - center.y;
    const d = Math.hypot(dx, dy) || 1;
    const bow = 60;
    lanes.push(bezierLane(i, j, p0, { x: mid.x + (dx / d) * bow, y: mid.y + (dy / d) * bow }, p1));
  }
  return { n: nodes.length, nodes, lanes, center };
}

/** 路線上某個位置（0~LANE_LENGTH）在畫面上的座標與方向（弧度，朝 b 端） */
export function lanePoint(lane: LaneGeom, x: number): { x: number; y: number; angle: number } {
  const target = (Math.max(0, Math.min(LEN, x)) / LEN) * lane.len;
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

/** 路線上某點往旁邊偏移 offset（正值在前進方向的右手邊） */
export function laneOffsetPoint(lane: LaneGeom, x: number, offset: number): { x: number; y: number; angle: number } {
  const p = lanePoint(lane, x);
  return { x: p.x - Math.sin(p.angle) * offset, y: p.y + Math.cos(p.angle) * offset, angle: p.angle };
}

/** 跟某個指揮部相連的路線編號 */
export function nodeLanes(map: MapLayout, node: number): number[] {
  const out: number[] = [];
  map.lanes.forEach((l, i) => {
    if (l.a === node || l.b === node) out.push(i);
  });
  return out;
}

/** 指揮部在這條路線的哪一端（0 或 LANE_LENGTH） */
export function nodeEnd(lane: LaneGeom, node: number): number {
  return lane.a === node ? 0 : LEN;
}

/** 從某個指揮部出發，在這條路線上的前進方向 */
export function nodeDir(lane: LaneGeom, node: number): 1 | -1 {
  return lane.a === node ? 1 : -1;
}

/** 路線另一端的指揮部 */
export function otherEnd(lane: LaneGeom, node: number): number {
  return lane.a === node ? lane.b : lane.a;
}

/** 找出畫面上離某點最近的路線位置（點地圖下指令用） */
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
      const cx = p.x + vx * t;
      const cy = p.y + vy * t;
      const d = Math.hypot(px - cx, py - cy);
      if (d < best.dist) {
        const along = lane.cum[i] + Math.sqrt(l2) * t;
        best = { lane: li, x: (along / lane.len) * LEN, dist: d };
      }
    }
  });
  return best;
}
