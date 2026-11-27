// 大地圖（2400×1500）：只畫西北四分之一，其他三塊用鏡射產生，四個角的條件完全一樣。
// 中線上的據點（北／南、西／東各一個）和正中央的據點只放一次。
import type { EdgeDef, MapDef, NodeDef, Theme } from "./map";

type Pt = [number, number];

/** 西北角的據點（另外三個角自動鏡射） */
interface QuadNode {
  x: number;
  y: number;
  name: string; // 前面會自動加上「西北／東北／東南／西南」
  hq?: true;
  own?: true; // 開局就屬於這個角的玩家
  big?: true;
}
/** 中線上的據點：top 在 x = w/2（給 y），left 在 y = h/2（給 x） */
interface AxisNode {
  at: number;
  names: [string, string]; // top：[北, 南]；left：[西, 東]
  big?: true;
}
/**
 * 道路兩端的寫法：
 * q3 = 西北角第 3 個據點；X3 = 它左右鏡射的那個（東北）；Y3 = 上下鏡射的那個（西南）；
 * t0 = 上下中線的第 0 個據點；l0 = 左右中線的第 0 個據點；c = 正中央。
 * via 一律用西北角的座標寫，會跟著鏡射。
 */
type Edge = [string, string, Pt[]?];

interface BigSpec {
  id: string;
  name: string;
  desc: string;
  theme: Theme;
  quad: QuadNode[];
  top?: AxisNode[];
  left?: AxisNode[];
  center?: { name: string; big?: true };
  edges: Edge[];
  lakes?: [number, number, number, number][]; // 西北角，鏡射成四個
  axisLakes?: [number, number, number, number][]; // 中線上的湖（鏡射後重複的只留一個）
  mountains?: Pt[][];
  axisMountains?: Pt[][];
  river?: Pt[];
}

const W = 2400;
const H = 1500;
const PREFIX = ["西北", "東北", "東南", "西南"];
/** 第 q 塊（0 西北、1 東北、2 東南、3 西南）的座標轉換 */
const tx = (q: number, x: number) => (q === 1 || q === 2 ? W - x : x);
const ty = (q: number, y: number) => (q >= 2 ? H - y : y);
const tp = (q: number, [x, y]: Pt): Pt => [tx(q, x), ty(q, y)];

function build(spec: BigSpec): MapDef {
  const Q = spec.quad.length;
  const nodes: NodeDef[] = [];
  for (let q = 0; q < 4; q++) {
    for (const n of spec.quad) {
      nodes.push({
        x: tx(q, n.x),
        y: ty(q, n.y),
        kind: n.hq ? "hq" : "fort",
        slot: n.hq || n.own ? q : -1,
        name: PREFIX[q] + n.name,
        ...(n.big ? { big: true } : {}),
      });
    }
  }
  const topIdx: [number, number][] = [];
  for (const t of spec.top ?? []) {
    topIdx.push([nodes.length, nodes.length + 1]);
    nodes.push({ x: W / 2, y: t.at, kind: "fort", slot: -1, name: t.names[0], ...(t.big ? { big: true } : {}) });
    nodes.push({ x: W / 2, y: H - t.at, kind: "fort", slot: -1, name: t.names[1], ...(t.big ? { big: true } : {}) });
  }
  const leftIdx: [number, number][] = [];
  for (const l of spec.left ?? []) {
    leftIdx.push([nodes.length, nodes.length + 1]);
    nodes.push({ x: l.at, y: H / 2, kind: "fort", slot: -1, name: l.names[0], ...(l.big ? { big: true } : {}) });
    nodes.push({ x: W - l.at, y: H / 2, kind: "fort", slot: -1, name: l.names[1], ...(l.big ? { big: true } : {}) });
  }
  const center = spec.center ? nodes.length : -1;
  if (spec.center) nodes.push({ x: W / 2, y: H / 2, kind: "fort", slot: -1, name: spec.center.name, ...(spec.center.big ? { big: true } : {}) });

  const quadAt = (q: number, i: number) => q * Q + i;
  const mirrorX = [1, 0, 3, 2];
  const mirrorY = [3, 2, 1, 0];
  /** 某一塊看到的中線據點 */
  const topFor = (q: number, j: number) => topIdx[j][q < 2 ? 0 : 1];
  const leftFor = (q: number, j: number) => leftIdx[j][q === 0 || q === 3 ? 0 : 1];
  const edges: EdgeDef[] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number, via: Pt[] | undefined, q: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, ...(via?.length ? { via: via.map((p) => tp(q, p)) } : {}) });
  };
  for (const [ra, rb, via] of spec.edges) {
    const kind = (r: string) => r[0];
    const num = (r: string) => Number(r.slice(1));
    // 把兩端排成固定順序，下面少寫一半的情況
    const order = "qXYtlc";
    const [a, b] = order.indexOf(kind(ra)) <= order.indexOf(kind(rb)) ? [ra, rb] : [rb, ra];
    const ka = kind(a);
    const kb = kind(b);
    if (ka === "q" && kb === "q") for (let q = 0; q < 4; q++) add(quadAt(q, num(a)), quadAt(q, num(b)), via, q);
    else if (ka === "q" && kb === "X") for (const q of [0, 3]) add(quadAt(q, num(a)), quadAt(mirrorX[q], num(b)), via, q);
    else if (ka === "q" && kb === "Y") for (const q of [0, 1]) add(quadAt(q, num(a)), quadAt(mirrorY[q], num(b)), via, q);
    else if (ka === "q" && kb === "t") for (let q = 0; q < 4; q++) add(quadAt(q, num(a)), topFor(q, num(b)), via, q);
    else if (ka === "q" && kb === "l") for (let q = 0; q < 4; q++) add(quadAt(q, num(a)), leftFor(q, num(b)), via, q);
    else if (ka === "q" && kb === "c") for (let q = 0; q < 4; q++) add(quadAt(q, num(a)), center, via, q);
    else if (ka === "t" && kb === "t") for (const q of [0, 3]) add(topFor(q, num(a)), topFor(q, num(b)), via, q);
    else if (ka === "t" && kb === "c") for (const q of [0, 3]) add(topFor(q, num(a)), center, via, q);
    else if (ka === "l" && kb === "l") for (const q of [0, 1]) add(leftFor(q, num(a)), leftFor(q, num(b)), via, q);
    else if (ka === "l" && kb === "c") for (const q of [0, 1]) add(leftFor(q, num(a)), center, via, q);
    else if (ka === "t" && kb === "l") for (let q = 0; q < 4; q++) add(topFor(q, num(a)), leftFor(q, num(b)), via, q);
    else throw new Error(`地圖 ${spec.id}：不支援的道路 ${ra}-${rb}`);
  }

  /** 鏡射成四份，重複的（剛好在中線上）只留一份 */
  const mirror4 = <T>(items: T[] | undefined, f: (q: number, it: T) => T, key: (it: T) => string) => {
    const out: T[] = [];
    const keys = new Set<string>();
    for (const it of items ?? [])
      for (let q = 0; q < 4; q++) {
        const m = f(q, it);
        const k = key(m);
        if (!keys.has(k)) {
          keys.add(k);
          out.push(m);
        }
      }
    return out;
  };
  const lakeT = (q: number, [x, y, rx, ry]: [number, number, number, number]): [number, number, number, number] => [tx(q, x), ty(q, y), rx, ry];
  const lakes = [
    ...mirror4(spec.lakes, lakeT, (l) => l.join(",")),
    ...mirror4(spec.axisLakes, lakeT, (l) => l.join(",")),
  ];
  const polyT = (q: number, poly: Pt[]) => {
    const p = poly.map((pt) => tp(q, pt));
    // 左右鏡射後頂點順序會反過來，畫起來一樣，不用處理
    return p;
  };
  const polyKey = (p: Pt[]) => p.map((v) => v.join(",")).sort().join(";");
  const mountains = [...mirror4(spec.mountains, polyT, polyKey), ...mirror4(spec.axisMountains, polyT, polyKey)];

  return {
    id: spec.id,
    name: spec.name,
    desc: spec.desc,
    theme: spec.theme,
    w: W,
    h: H,
    slots: 4,
    minPlayers: 2,
    slotOrder: { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
    nodes,
    edges,
    ...(lakes.length ? { lakes } : {}),
    ...(mountains.length ? { mountains } : {}),
    ...(spec.river ? { river: spec.river } : {}),
  };
}

const SPECS: BigSpec[] = [
  {
    id: "continent",
    name: "大陸會戰",
    desc: "草原。內外兩圈道路加上貫穿中央的十字大道，二十九座據點。",
    theme: "grass",
    quad: [
      { x: 260, y: 230, name: "大本營", hq: true },
      { x: 640, y: 210, name: "前哨", own: true },
      { x: 260, y: 560, name: "側堡", own: true },
      { x: 620, y: 520, name: "內堡", own: true },
      { x: 960, y: 380, name: "林堡" },
    ],
    top: [
      { at: 170, names: ["北關", "南關"] },
      { at: 480, names: ["北原要塞", "南原要塞"], big: true },
    ],
    left: [
      { at: 200, names: ["西關", "東關"] },
      { at: 780, names: ["西原堡", "東原堡"] },
    ],
    center: { name: "中央要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q1", "t0", [[930, 150]]], ["q4", "t1"], ["q2", "l0"], ["q3", "l1"],
      ["t0", "t1"], ["l0", "l1"], ["t1", "c"], ["l1", "c"],
    ],
    lakes: [[440, 380, 70, 40]],
  },
  {
    id: "bigriver",
    name: "大河三渡",
    desc: "河谷。大河縱貫戰場，只有北、南兩座橋和河心島要塞能過河。",
    theme: "river",
    quad: [
      { x: 260, y: 300, name: "大本營", hq: true },
      { x: 700, y: 190, name: "前哨", own: true },
      { x: 280, y: 640, name: "側堡", own: true },
      { x: 720, y: 500, name: "渡口堡", own: true },
      { x: 980, y: 320, name: "灘頭堡" },
      { x: 490, y: 430, name: "林堡" },
    ],
    left: [{ at: 560, names: ["西岸要塞", "東岸要塞"], big: true }],
    center: { name: "河心島要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q0", "q5"], ["q5", "q3"],
      ["q4", "X4", [[1200, 280]]],
      ["q2", "l0"], ["q3", "l0"], ["l0", "c", [[900, 790]]],
    ],
    river: [[1200, -60], [1170, 140], [1235, 330], [1180, 520], [1225, 700], [1175, 880], [1230, 1060], [1180, 1250], [1215, 1420], [1200, 1560]],
  },
  {
    id: "dunes",
    name: "沙海綠洲",
    desc: "沙漠。四角各有一片綠洲，北南的駝隊站和中央大綠洲是兵家必爭。",
    theme: "desert",
    quad: [
      { x: 280, y: 260, name: "大本營", hq: true },
      { x: 680, y: 220, name: "沙堡", own: true },
      { x: 300, y: 600, name: "石堡", own: true },
      { x: 700, y: 560, name: "綠洲堡" },
      { x: 1000, y: 420, name: "風蝕堡" },
    ],
    top: [{ at: 190, names: ["北方駝隊站", "南方駝隊站"] }],
    left: [{ at: 200, names: ["西井", "東井"] }],
    center: { name: "大綠洲", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q1", "t0", [[940, 170]]], ["q4", "t0"], ["q3", "c", [[960, 700]]], ["q2", "l0"],
    ],
    lakes: [[490, 410, 70, 34]],
    axisLakes: [[1200, 470, 90, 40]],
  },
  {
    id: "peaks",
    name: "群峰隘道",
    desc: "高原。山峰把戰場隔成幾塊，北南峰頂和中央天險是大型要塞。",
    theme: "highland",
    quad: [
      { x: 260, y: 250, name: "大本營", hq: true },
      { x: 640, y: 180, name: "嶺堡", own: true },
      { x: 250, y: 620, name: "谷堡", own: true },
      { x: 580, y: 560, name: "隘口", own: true },
      { x: 960, y: 520, name: "鷹巢" },
    ],
    top: [{ at: 230, names: ["北峰要塞", "南峰要塞"], big: true }],
    left: [{ at: 720, names: ["西谷堡", "東谷堡"] }],
    center: { name: "天險要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q1", "t0", [[930, 160]]], ["q4", "c"], ["q3", "l0"], ["q2", "l0", [[430, 720]]], ["l0", "c"],
    ],
    mountains: [[[340, 330], [480, 300], [540, 380], [470, 470], [350, 450]]],
    axisMountains: [[[1110, 400], [1200, 380], [1290, 400], [1310, 520], [1200, 590], [1090, 520]]],
  },
  {
    id: "hive",
    name: "蜂巢平原",
    desc: "草原。據點像蜂巢一樣密密麻麻，三十多條路四通八達。",
    theme: "grass",
    quad: [
      { x: 230, y: 230, name: "大本營", hq: true },
      { x: 560, y: 190, name: "前哨", own: true },
      { x: 220, y: 560, name: "側堡", own: true },
      { x: 520, y: 470, name: "內堡", own: true },
      { x: 880, y: 230, name: "北蜂堡" },
      { x: 860, y: 560, name: "南蜂堡" },
    ],
    top: [{ at: 390, names: ["北蜂巢", "南蜂巢"] }],
    left: [{ at: 380, names: ["西蜂巢", "東蜂巢"] }],
    center: { name: "蜂后要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q0", "q3"], ["q1", "q3"], ["q2", "q3"],
      ["q1", "q4"], ["q3", "q5"], ["q4", "q5"], ["q4", "t0"], ["q5", "t0"], ["q5", "c"],
      ["q2", "l0"], ["q3", "l0"], ["l0", "c", [[800, 790]]],
    ],
  },
  {
    id: "twinlakes",
    name: "雙子湖",
    desc: "湖區。東西兩座大湖擋在中線上，要繞湖或從中央要塞突破。",
    theme: "river",
    quad: [
      { x: 250, y: 250, name: "大本營", hq: true },
      { x: 650, y: 200, name: "前哨", own: true },
      { x: 230, y: 560, name: "側堡", own: true },
      { x: 600, y: 470, name: "內堡", own: true },
      { x: 950, y: 450, name: "湖畔堡" },
    ],
    top: [{ at: 150, names: ["北湖堡", "南湖堡"] }],
    left: [{ at: 200, names: ["西湖口", "東湖口"] }],
    center: { name: "雙湖要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q1", "t0", [[930, 150]]], ["q4", "c"], ["q2", "l0"],
    ],
    lakes: [[420, 360, 64, 36]],
    axisLakes: [[650, 750, 160, 70], [1200, 340, 110, 56]],
  },
  {
    id: "wall",
    name: "長城防線",
    desc: "高原。山嶺橫亙中線，南北只能從東西兩處關口或中央長城要塞過。",
    theme: "highland",
    quad: [
      { x: 300, y: 240, name: "大本營", hq: true },
      { x: 720, y: 230, name: "前哨", own: true },
      { x: 260, y: 520, name: "側堡", own: true },
      { x: 700, y: 500, name: "內堡", own: true },
      { x: 1000, y: 330, name: "烽火台" },
    ],
    top: [{ at: 190, names: ["北城", "南城"] }],
    left: [{ at: 420, names: ["西關口", "東關口"] }],
    center: { name: "長城要塞", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q3", "q4"],
      ["q1", "t0", [[960, 190]]], ["q4", "c"], ["q2", "l0"],
    ],
    // 跨過中線的完整山脈（上下對稱，鏡射後不會有接縫）
    axisMountains: [
      [[40, 660], [180, 645], [260, 650], [290, 750], [260, 850], [180, 855], [40, 840]],
      [[520, 650], [800, 630], [1050, 640], [1080, 750], [1050, 860], [800, 870], [520, 850]],
    ],
  },
  {
    id: "rings",
    name: "環形沙丘",
    desc: "沙漠。內外兩道環形道路，輻射狀的小路通往中央的沙丘之心。",
    theme: "desert",
    quad: [
      { x: 220, y: 220, name: "大本營", hq: true },
      { x: 620, y: 160, name: "前哨", own: true },
      { x: 180, y: 560, name: "側堡", own: true },
      { x: 560, y: 500, name: "內堡", own: true },
      { x: 880, y: 470, name: "內環堡" },
    ],
    top: [
      { at: 120, names: ["北外環", "南外環"] },
      { at: 380, names: ["北內環", "南內環"] },
    ],
    left: [
      { at: 140, names: ["西外環", "東外環"] },
      { at: 760, names: ["西內環", "東內環"] },
    ],
    center: { name: "沙丘之心", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q0", "q3"], ["q2", "q3"], ["q3", "q4"], ["q1", "q4"],
      ["q1", "t0", [[920, 110]]], ["q2", "l0"], ["q4", "t1"], ["q4", "l1"], ["t1", "c"], ["l1", "c"],
    ],
  },
  {
    id: "lakeland",
    name: "湖區迷宮",
    desc: "草原。湖泊散布各處，道路彎彎曲曲，很容易被包抄。",
    theme: "grass",
    quad: [
      { x: 260, y: 240, name: "大本營", hq: true },
      { x: 660, y: 260, name: "前哨", own: true },
      { x: 300, y: 600, name: "側堡", own: true },
      { x: 680, y: 600, name: "渡堡" },
      { x: 980, y: 200, name: "北湖堡" },
    ],
    top: [{ at: 420, names: ["北湖心堡", "南湖心堡"] }],
    left: [{ at: 490, names: ["西渡堡", "東渡堡"] }],
    center: { name: "湖區要塞", big: true },
    edges: [
      ["q0", "q1", [[460, 190]]], ["q0", "q2"], ["q1", "q3"], ["q2", "q3", [[490, 650]]], ["q1", "q4"],
      ["q4", "t0"], ["q3", "t0", [[940, 560]]], ["q2", "l0"], ["q3", "l0"], ["t0", "c"],
    ],
    lakes: [[460, 420, 80, 45], [880, 400, 64, 36]],
  },
  {
    id: "plateau",
    name: "高原三城",
    desc: "高原。中線上北城、王城、南城三座大型要塞一字排開，誰拿下誰就控制全場。",
    theme: "highland",
    quad: [
      { x: 240, y: 260, name: "大本營", hq: true },
      { x: 640, y: 200, name: "前哨", own: true },
      { x: 260, y: 620, name: "側堡", own: true },
      { x: 640, y: 560, name: "內堡", own: true },
      { x: 930, y: 330, name: "坡堡" },
    ],
    top: [{ at: 380, names: ["北城", "南城"], big: true }],
    left: [{ at: 900, names: ["西坡堡", "東坡堡"] }],
    center: { name: "王城", big: true },
    edges: [
      ["q0", "q1"], ["q0", "q2"], ["q1", "q3"], ["q2", "q3"], ["q1", "q4"], ["q4", "t0"],
      ["t0", "c"], ["q3", "l0"], ["q4", "l0"], ["l0", "c"], ["q2", "Y2", [[200, 750]]],
    ],
    mountains: [
      [[400, 360], [520, 330], [560, 420], [470, 480], [390, 450]],
      [[1000, 520], [1100, 500], [1120, 600], [1040, 640], [980, 600]],
    ],
  },
];

export const BIG_MAPS: MapDef[] = SPECS.map(build);
