// 兵種圖鑑的側面插圖：同一套橄欖綠漸層、深色描邊，畫面 260×80，地面在 y = 72
import type { BuildKind, UnitType } from "@frontline/shared";

export type ArmoryKind = Exclude<UnitType, "para"> | "bomber" | "transport" | BuildKind;

const OL = "#20241a"; // 描邊
const DARK = "#2c3121";
const METAL = "#2a2e22";
const SKIN = "#b99c76";

const DEFS = `<defs>
  <linearGradient id="aa-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a8552"/><stop offset="1" stop-color="#3f4630"/></linearGradient>
  <linearGradient id="aa-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#555b44"/><stop offset="1" stop-color="#25281d"/></linearGradient>
  <linearGradient id="aa-concrete" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a39b88"/><stop offset="1" stop-color="#5e574a"/></linearGradient>
  <linearGradient id="aa-flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff1a8"/><stop offset=".35" stop-color="#ffb04a"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></linearGradient>
</defs>`;

const shadow = (cx = 130, rx = 100) => `<ellipse cx="${cx}" cy="74" rx="${rx}" ry="4.5" fill="#000" opacity=".35"/>`;
const s = (w = 1.5) => `stroke="${OL}" stroke-width="${w}" stroke-linejoin="round"`;

type P = [number, number];
/** 一個人的關節位置（面向右）：b = 後面那隻手腳，f = 前面那隻 */
interface Pose {
  hip: P; neck: P; head: P; sh: P;
  bk: P; bf: P; fk: P; ff: P; // 膝、腳
  be: P; bh: P; fe: P; fh: P; // 手肘、手
  boots?: [P, P][]; // 鞋子的方向，預設平放在地上
  bare?: boolean; // 沒戴鋼盔（傷兵）
}
const UNIFORM = "#6b7650";
const UNIFORM_BACK = "#4f5939";
const LEG = "#454d34";
const LEG_BACK = "#353c28";
const HELMET = "#5d6842";

const path = (pts: P[]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
/** 一段有描邊的圓頭肢體：先畫粗一點的深色，再畫顏色 */
const limb = (pts: P[], w: number, color: string) =>
  `<path d="${path(pts)}" stroke="${OL}" stroke-width="${w + 2.6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${path(pts)}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

function helmet([hx, hy]: P, color = HELMET, mark = "") {
  return `<path d="M${hx - 5.8} ${hy - 0.6} Q${hx - 0.2} ${hy - 10.8} ${hx + 5.8} ${hy - 0.6}Z" fill="${color}" ${s(1.4)}/>
    <path d="M${hx - 7} ${hy - 0.4}H${hx + 7.2}" stroke="${OL}" stroke-width="2" stroke-linecap="round"/>${mark}`;
}

/**
 * 依關節畫人：後腳 → 後手 → 背包 → 身體 → 前腳 → 手上的東西 → 頭 → 前手。
 * gear 畫在身體後面（背包、油桶），held 畫在前手底下（槍、箱子）
 */
function person(p: Pose, opts: { gear?: string; held?: string; helmetColor?: string; mark?: string; armband?: boolean } = {}) {
  const boots = p.boots ?? [
    [p.bf, [p.bf[0] + 4.5, p.bf[1]]],
    [p.ff, [p.ff[0] + 4.5, p.ff[1]]],
  ];
  // 腰帶：身體從臀部往上兩成的位置
  const bx = p.hip[0] + (p.neck[0] - p.hip[0]) * 0.22;
  const by = p.hip[1] + (p.neck[1] - p.hip[1]) * 0.22;
  const dx = p.neck[0] - p.hip[0];
  const dy = p.neck[1] - p.hip[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * 6;
  const ny = (dx / len) * 6;
  const [hx, hy] = p.head;
  return `<g>
    ${limb([p.hip, p.bk, p.bf], 6.2, LEG_BACK)}${limb(boots[0], 3.6, "#1c1e16")}
    ${limb([p.sh, p.be, p.bh], 4.4, UNIFORM_BACK)}
    ${opts.gear ?? ""}
    ${limb([p.hip, p.neck], 11, UNIFORM)}
    <path d="M${(bx - nx).toFixed(1)} ${(by - ny).toFixed(1)}L${(bx + nx).toFixed(1)} ${(by + ny).toFixed(1)}" stroke="${DARK}" stroke-width="2"/>
    ${limb([p.hip, p.fk, p.ff], 6.6, LEG)}${limb(boots[1], 3.8, "#1c1e16")}
    ${opts.held ?? ""}
    <circle cx="${hx}" cy="${hy + 0.8}" r="4.3" fill="${SKIN}" ${s(1.3)}/>
    ${p.bare ? `<path d="M${hx - 4} ${hy - 1}h8" stroke="#e8e4d6" stroke-width="2.4"/>` : helmet(p.head, opts.helmetColor, opts.mark)}
    ${limb([p.sh, p.fe, p.fh], 4.6, UNIFORM)}
    ${opts.armband ? `<circle cx="${p.fe[0]}" cy="${p.fe[1]}" r="2.6" fill="#f4f1e6"/><path d="M${p.fe[0]} ${p.fe[1] - 1.6}v3.2M${p.fe[0] - 1.6} ${p.fe[1]}h3.2" stroke="#c8352b" stroke-width="1.1"/>` : ""}
    <circle cx="${p.fh[0]}" cy="${p.fh[1]}" r="1.9" fill="${SKIN}" ${s(1)}/>
  </g>`;
}

/** 平移一個姿勢 */
const at = (x: number, y: number, pose: Pose): Pose => {
  const m = (q: P): P => [q[0] + x, q[1] + y];
  return {
    ...pose,
    hip: m(pose.hip), neck: m(pose.neck), head: m(pose.head), sh: m(pose.sh),
    bk: m(pose.bk), bf: m(pose.bf), fk: m(pose.fk), ff: m(pose.ff),
    be: m(pose.be), bh: m(pose.bh), fe: m(pose.fe), fh: m(pose.fh),
    boots: pose.boots?.map(([a, b]) => [m(a), m(b)] as [P, P]),
  };
};

/** 一把步槍：穿過兩隻手，往後是槍托、往前是槍管 */
function rifleThrough(a: P, b: P, back = 8, front = 12) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const stock: P = [a[0] - ux * back, a[1] - uy * back];
  const mid: P = [b[0] + ux * 3, b[1] + uy * 3];
  const muzzle: P = [b[0] + ux * front, b[1] + uy * front];
  return limb([stock, mid], 2.6, "#5a4128") + limb([mid, muzzle], 1.4, METAL);
}

/** 背包 */
const pack = (p: Pose) => `<rect x="${p.neck[0] - 10.5}" y="${p.neck[1] + 1}" width="6.5" height="12" rx="2" fill="#4b5236" ${s(1.2)}/>`;

// ---------- 姿勢（腳在 y = 72，臀部約在 x = 0） ----------
const STAND: Pose = {
  hip: [0, 48], neck: [1, 31], head: [2.5, 25], sh: [1.5, 33],
  bk: [-3, 60], bf: [-6, 71.5], fk: [4.5, 60], ff: [6.5, 71.5],
  be: [-1, 41], bh: [6, 43], fe: [8, 41], fh: [15, 38],
};
const AIM: Pose = {
  ...STAND,
  head: [3.5, 25], bk: [-4, 60], bf: [-8, 71.5], fk: [5, 60], ff: [8, 71.5],
  be: [-2, 38], bh: [5, 33], fe: [10, 37], fh: [15, 32],
};
const ADVANCE: Pose = {
  hip: [0, 48], neck: [4.5, 31.5], head: [7, 25.5], sh: [5, 33.5],
  bk: [-6, 59], bf: [-12, 71], fk: [7.5, 58.5], ff: [8.5, 71.5],
  be: [1, 41], bh: [8, 44], fe: [11.5, 42], fh: [16, 37],
  boots: [[[-12, 71], [-8, 72]], [[8.5, 71.5], [13, 71.5]]],
};
const KNEEL: Pose = {
  hip: [0, 58], neck: [2.5, 40.5], head: [4, 34.5], sh: [3, 42.5],
  bk: [-7, 70.5], bf: [-17, 71.5], fk: [9, 56.5], ff: [10, 71.5],
  be: [5, 51], bh: [13, 49], fe: [10, 50], fh: [18, 48],
  boots: [[[-17, 71.5], [-20, 70]], [[10, 71.5], [14.5, 71.5]]],
};

/** 一排沙包 */
function sandbags(x0: number, x1: number, y: number, rows = 2) {
  let out = "";
  for (let r = 0; r < rows; r++) {
    const yy = y - r * 9;
    for (let x = x0 + (r % 2) * 9; x < x1 - 8; x += 18) out += `<rect x="${x}" y="${yy}" width="20" height="10" rx="5" fill="#8a7a55" ${s(1.2)}/>`;
  }
  return out;
}

/** 有輻條的輪子 */
function spokeWheel(cx: number, cy: number, r: number) {
  let spokes = "";
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI;
    spokes += `<path d="M${(cx - Math.cos(a) * (r - 2)).toFixed(1)} ${(cy - Math.sin(a) * (r - 2)).toFixed(1)}L${(cx + Math.cos(a) * (r - 2)).toFixed(1)} ${(cy + Math.sin(a) * (r - 2)).toFixed(1)}" stroke="${OL}" stroke-width="1.3"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#3a3f2c" ${s(2)}/>${spokes}<circle cx="${cx}" cy="${cy}" r="${r * 0.28}" fill="${DARK}" ${s(1.2)}/>`;
}

/** 畫在 x 的人，k 倍大（以腳底 y = 72 為準縮放） */
function fig(x: number, k: number, pose: Pose, o: { rifle?: [number, number]; pack?: boolean; gear?: string; held?: string; helmetColor?: string; mark?: string; armband?: boolean } = {}) {
  const held = (o.rifle ? rifleThrough(pose.bh, pose.fh, o.rifle[0], o.rifle[1]) : "") + (o.held ?? "");
  const gear = (o.pack ? pack(pose) : "") + (o.gear ?? "");
  return `<g transform="translate(${x} 72) scale(${k}) translate(0 -72)">${person(pose, { ...o, held, gear })}</g>`;
}

const LOADER: Pose = { ...KNEEL, be: [6, 53], bh: [12, 60], fe: [11, 54], fh: [17, 59] };
const PRONE: Pose = {
  hip: [0, 65], neck: [19, 61.5], head: [25, 57], sh: [18, 62.5],
  bk: [-9, 62.5], bf: [-19, 66], fk: [-12, 68], ff: [-25, 69.5], // 後腳彎起來，前腳伸直
  be: [23, 69.5], bh: [29, 63.5], fe: [27, 69.5], fh: [34, 62.5],
  boots: [[[-19, 66], [-22, 63.5]], [[-25, 69.5], [-28, 67]]],
};
const FLAME: Pose = {
  hip: [0, 48], neck: [0, 31], head: [1.5, 25], sh: [0.5, 33],
  bk: [-5, 60], bf: [-9, 71.5], fk: [6, 60], ff: [10, 71.5],
  be: [1, 41], bh: [7, 45], fe: [9, 40], fh: [15, 43],
};
const CARRY: Pose = { ...STAND, be: [-1, 42], bh: [5, 40], fe: [9, 42], fh: [13, 37] };
const ENG: Pose = { ...STAND, be: [-3, 41], bh: [-3, 50], fe: [6, 42], fh: [11, 49] };
const MEDIC: Pose = {
  ...KNEEL, neck: [9, 43], head: [12.5, 37.5], sh: [9, 45],
  be: [14, 54], bh: [23, 62], fe: [18, 53], fh: [27, 63],
};
const SUPINE: Pose = {
  head: [0, 64.5], neck: [5, 66.5], hip: [24, 67.5], sh: [6, 66.5],
  fk: [33, 59], ff: [41, 70.5], bk: [34, 61], bf: [43, 71],
  be: [8, 70], bh: [3, 70.5], fe: [13, 70.5], fh: [20, 70],
  boots: [[[43, 71], [47, 71]], [[41, 70.5], [45, 70.5]]],
  bare: true,
};
const HANG: Pose = {
  hip: [0, 48], neck: [0, 31], head: [0.5, 25], sh: [0, 33],
  bk: [-1.5, 60], bf: [-3, 71], fk: [1.5, 60], ff: [2.5, 71],
  be: [-5, 26], bh: [-6, 17], fe: [5, 26], fh: [6, 17],
  boots: [[[-3, 71], [-1, 73]], [[2.5, 71], [5, 73]]],
};

function plane(x: number, y: number, k: number, kind: "bomber" | "transport") {
  const nose =
    kind === "bomber" ? `<path d="M202 31 Q220 32 232 38 Q222 40 206 39Z" fill="#9fb4c0" opacity=".85" ${s(1.2)}/>`
    : `<path d="M196 31 L214 32 L218 37 L198 36Z" fill="#9fb4c0" opacity=".85" ${s(1.2)}/>`;
  const windows = kind === "transport" ? [90, 110, 130, 150, 170].map((wx) => `<rect x="${wx}" y="33" width="7" height="4" rx="1" fill="#9fb4c0" opacity=".8"/>`).join("") : "";
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <path d="M40 33 L26 10 L44 10 L64 31Z" fill="url(#aa-body)" ${s()}/>
    <path d="M30 38 Q40 30 70 30 L200 31 Q222 33 232 38 Q222 44 200 45 L70 46 Q40 46 30 38Z" fill="url(#aa-body)" ${s()}/>
    ${nose}${windows}
    <path d="M40 40 L74 40" stroke="${DARK}" stroke-width="2"/>
    <ellipse cx="140" cy="41" rx="38" ry="4.5" fill="#5e6a42" ${s(1.4)}/>
    <rect x="118" y="40" width="24" height="9" rx="4" fill="url(#aa-metal)" ${s(1.2)}/>
    <ellipse cx="116" cy="44.5" rx="2" ry="11" fill="#c9c2a8" opacity=".35"/>
    <circle cx="44" cy="22" r="0" />
  </g>`;
}

const ART: Record<ArmoryKind, () => string> = {
  rifle: () =>
    shadow(128, 84) +
    fig(70, 1.18, AIM, { rifle: [9, 15], pack: true }) +
    fig(124, 1.18, ADVANCE, { rifle: [8, 12], pack: true }) +
    fig(176, 1.18, STAND, { rifle: [8, 12], pack: true }),

  mg: () =>
    shadow(142, 92) +
    `<path d="M164 54 L154 72 M164 54 L174 72 M202 51 L198 72 M202 51 L208 72" stroke="${METAL}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="144" y="46" width="34" height="8" rx="1.5" fill="url(#aa-metal)" ${s()}/>
    <rect x="178" y="48" width="40" height="4" fill="${METAL}" ${s(1)}/>
    <path d="M184 48v4M190 48v4M196 48v4M202 48v4M208 48v4" stroke="#555b44" stroke-width="1.2"/>
    <rect x="158" y="54" width="12" height="8" fill="#5a5236" ${s(1.2)}/>
    <path d="M113 59 Q132 70 160 56" stroke="#b08a3a" stroke-width="2.2" fill="none" stroke-dasharray="2 1.5"/>` +
    fig(92, 1.12, LOADER, { held: `<rect x="9" y="56" width="13" height="8" rx="1" fill="#5a5236" ${s(1.2)}/>` }) +
    fig(128, 1.12, KNEEL, { pack: true }),

  sniper: () =>
    shadow(150, 92) +
    `<path d="M196 72 q5 -9 9 0 M208 72 q4 -7 8 0 M84 72 q4 -6 8 0" stroke="#5e6a42" stroke-width="2" fill="none"/>` +
    fig(118, 1.3, PRONE, {
      rifle: [10, 30],
      held: `${limb([[23, 60.5], [33, 58.6]], 2.8, METAL)}<path d="M50 59 L47.5 71 M50 59 L53 71" stroke="${METAL}" stroke-width="1.6"/>`,
    }),

  flame: () =>
    shadow(126, 76) +
    `<path d="M127 33 Q160 20 196 28 Q230 24 246 34 Q228 40 206 44 Q176 50 150 42 Q134 40 127 36Z" fill="url(#aa-flame)"/>
    <path d="M128 34 Q152 29 176 33 Q160 39 130 37Z" fill="#fff1a8" opacity=".8"/>` +
    fig(90, 1.2, FLAME, {
      gear: `<rect x="-14.5" y="29" width="6.5" height="21" rx="3.2" fill="url(#aa-metal)" ${s(1.2)}/><rect x="-9.5" y="29" width="6.5" height="21" rx="3.2" fill="url(#aa-metal)" ${s(1.2)}/>
        <path d="M-7 50 Q-3 58 3 47" stroke="${METAL}" stroke-width="2" fill="none"/>`,
      held: limb([[2.2, 46.2], [30.5, 39.1]], 2.8, METAL),
    }),

  car: () =>
    shadow(128, 96) +
    `<path d="M150 34 L180 33" stroke="${METAL}" stroke-width="3" stroke-linecap="round"/>
    <path d="M108 40 L114 28 L148 28 L154 40Z" fill="url(#aa-body)" ${s()}/>
    <path d="M38 58 L50 40 L172 40 L198 50 L216 54 L216 62 L38 62Z" fill="url(#aa-body)" ${s()}/>
    <path d="M60 46h20M176 46 l14 5" stroke="${DARK}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M44 52 H210" stroke="#97a26c" stroke-width="1.4" opacity=".6"/>
    <circle cx="212" cy="55" r="2.6" fill="#e8dca0" ${s(1)}/>
    ${[62, 92, 158, 190].map((cx) => `<circle cx="${cx}" cy="64" r="10" fill="#1c1e16" ${s(2)}/><circle cx="${cx}" cy="64" r="4" fill="#3a3f2c"/>`).join("")}`,

  tank: () =>
    shadow(128, 108) +
    `<rect x="150" y="27" width="86" height="6" rx="2" fill="${METAL}" ${s(1.2)}/><rect x="228" y="25" width="15" height="10" rx="2" fill="${DARK}" ${s(1.2)}/>
    <path d="M84 38 L96 18 H156 L168 38Z" fill="url(#aa-body)" ${s(2)}/>
    <rect x="110" y="12" width="22" height="7" rx="2" fill="#4a5236" ${s(2)}/>
    <path d="M26 40 H212 L226 52 L212 56 H30 L18 50Z" fill="url(#aa-body)" ${s(2)}/>
    <rect x="24" y="52" width="196" height="21" rx="10.5" fill="#1c1e16" stroke="#0d0e0a" stroke-width="2"/>
    ${[40, 66, 92, 118, 144, 170, 196].map((cx) => `<circle cx="${cx}" cy="62.5" r="7.5" fill="#3a3f2c" stroke="#0d0e0a" stroke-width="1.5"/>`).join("")}
    <path d="M32 44 H206" stroke="#97a26c" stroke-width="1.5" opacity=".6"/>`,

  at: () =>
    shadow(132, 100) +
    `<path d="M130 58 L60 71 M130 61 L76 73" stroke="${METAL}" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="134" y="38" width="94" height="5" fill="url(#aa-metal)" ${s(1.2)}/>
    <rect x="224" y="36" width="12" height="9" rx="1.5" fill="${DARK}" ${s(1.2)}/>
    <path d="M120 30 L138 27 L142 58 L124 61Z" fill="url(#aa-body)" ${s(1.6)}/>
    ${spokeWheel(130, 61, 11)}` +
    fig(98, 1.12, KNEEL, { pack: true }),

  flak: () =>
    shadow(128, 100) +
    `<path d="M98 44 L156 9 M103 47 L161 12" stroke="${METAL}" stroke-width="3.6" stroke-linecap="round"/>
    <circle cx="100" cy="46" r="9" fill="url(#aa-metal)" ${s(1.4)}/>
    <path d="M36 50 H178 V62 H36Z" fill="url(#aa-body)" ${s()}/>
    <path d="M178 36 H200 L216 50 V62 H178Z" fill="url(#aa-body)" ${s()}/>
    <path d="M184 40 H198 L208 49 H184Z" fill="#9fb4c0" opacity=".8" ${s(1.2)}/>
    <rect x="36" y="58" width="96" height="14" rx="7" fill="#1c1e16" stroke="#0d0e0a" stroke-width="2"/>
    ${[48, 66, 84, 102, 120].map((cx) => `<circle cx="${cx}" cy="65" r="5" fill="#3a3f2c"/>`).join("")}
    <circle cx="198" cy="65" r="9" fill="#1c1e16" ${s(2)}/><circle cx="198" cy="65" r="3.5" fill="#3a3f2c"/>`,

  artillery: () =>
    shadow(132, 100) +
    `<path d="M128 56 L52 72" stroke="${METAL}" stroke-width="5" stroke-linecap="round"/>
    <path d="M120 50 L216 16" stroke="${OL}" stroke-width="10" stroke-linecap="round"/>
    <path d="M120 50 L216 16" stroke="#4a5038" stroke-width="7.4" stroke-linecap="round"/>
    <path d="M122 46 L172 28" stroke="#5e6548" stroke-width="4.6" stroke-linecap="round"/>
    <path d="M110 36 L132 32 L136 52 L114 55Z" fill="url(#aa-body)" ${s(1.4)}/>
    ${spokeWheel(126, 58, 14)}
    <rect x="44" y="63" width="6" height="9" rx="2" fill="#b08a3a" ${s(1)}/><rect x="52" y="63" width="6" height="9" rx="2" fill="#b08a3a" ${s(1)}/>` +
    fig(82, 1.15, CARRY, { pack: true, held: `${limb([[2, 42.5], [15, 35.5]], 4.8, "#b08a3a")}<path d="M15 35.5 l3.4 -1.8" stroke="${OL}" stroke-width="3.6" stroke-linecap="round"/>` }),

  engineer: () =>
    shadow(144, 90) +
    fig(108, 1.2, ENG, {
      gear: `${limb([[-10, 17], [-4, 50]], 2, "#6b5a3a")}<path d="M-13.5 12 L-7.5 10 L-8 18 L-12 19Z" fill="${METAL}" ${s(1)}/>${pack(ENG)}`,
      held: `<path d="M11 49 v3" stroke="${OL}" stroke-width="1.4"/><rect x="5" y="51" width="13" height="9" rx="1.5" fill="#6b5a3a" ${s(1.2)}/>`,
    }) +
    `<rect x="178" y="62" width="18" height="10" rx="1.5" fill="#6b5a3a" ${s(1.2)}/>
    <path d="M181 62v-3h12v3" stroke="${OL}" stroke-width="1.2" fill="none"/>
    <path d="M196 67 Q210 58 216 66 T232 64" stroke="#2a2418" stroke-width="1.4" fill="none"/>
    <circle cx="232" cy="64" r="3" fill="#ffb04a"/><circle cx="232" cy="64" r="6" fill="#ff7a1a" opacity=".35"/>`,

  medic: () =>
    shadow(150, 90) +
    fig(166, 1.2, SUPINE) +
    fig(140, 1.2, MEDIC, {
      helmetColor: "#e8e4d6",
      mark: `<path d="M12.5 30.4v5M10 32.9h5" stroke="#c8352b" stroke-width="1.7"/>`,
      armband: true,
    }) +
    `<rect x="104" y="61" width="13" height="11" rx="2" fill="#e8e4d6" ${s(1.2)}/><path d="M110.5 63.5v6M107.5 66.5h6" stroke="#c8352b" stroke-width="1.8"/>`,

  bomber: () =>
    `<ellipse cx="130" cy="76" rx="70" ry="3" fill="#000" opacity=".2"/>` +
    plane(4, -2, 1, "bomber") +
    [
      [150, 54, 20],
      [166, 62, 28],
      [184, 70, 36],
    ]
      .map(([bx, by, r]) => `<g transform="translate(${bx} ${by}) rotate(${r})"><path d="M-7 0 Q-7 -3 0 -3 L5 -2 L5 2 L0 3 Q-7 3 -7 0Z" fill="${DARK}" ${s(1)}/><path d="M5 -3 l3 -2 v10 l-3 -2" fill="${DARK}"/></g>`)
      .join(""),

  transport: () =>
    `<ellipse cx="130" cy="76" rx="70" ry="3" fill="#000" opacity=".2"/>` +
    plane(70, -6, 0.72, "transport") +
    [
      [44, 8],
      [88, 24],
    ]
      .map(
        ([px, py]) => `<g transform="translate(${px} ${py})">
          <path d="M-16 0 A16 12 0 0 1 16 0 Q8 -3 0 0 Q-8 -3 -16 0Z" fill="#d8d2bc" ${s(1.2)}/>
          <path d="M-15 0 L-2.5 18 M15 0 L2.5 18 M0 0 L0 17" stroke="#8f8970" stroke-width="0.9"/>
          <g transform="translate(0 10.9) scale(.42)">${person(HANG)}</g>
        </g>`,
      )
      .join(""),

  bunker: () =>
    shadow(130, 104) +
    `<path d="M58 70 L70 32 Q130 18 190 32 L202 70Z" fill="url(#aa-concrete)" ${s(2)}/>
    <path d="M74 34 Q130 22 186 34" stroke="#c9c2b0" stroke-width="1.5" fill="none" opacity=".6"/>
    <rect x="104" y="42" width="52" height="7" rx="2" fill="#0d0e0a"/>
    <rect x="150" y="44" width="30" height="3.5" fill="${METAL}" ${s(1)}/>
    <path d="M88 60 l6 -8 M168 58 l5 6" stroke="#5e574a" stroke-width="1.4"/>` +
    sandbags(36, 226, 62, 1),

  atnest: () =>
    shadow(130, 104) +
    `<rect x="128" y="36" width="96" height="5" fill="url(#aa-metal)" ${s(1.2)}/>
    <rect x="220" y="34" width="12" height="9" rx="1.5" fill="${DARK}" ${s(1.2)}/>
    <path d="M112 28 L132 25 L134 50 L114 52Z" fill="url(#aa-body)" ${s(1.6)}/>` +
    sandbags(50, 214, 62, 3),

  aa: () =>
    shadow(130, 100) +
    `<path d="M128 48 L198 6" stroke="url(#aa-metal)" stroke-width="6" stroke-linecap="round"/>
    <path d="M128 48 L198 6" stroke="${OL}" stroke-width="7.5" stroke-linecap="round" opacity=".35"/>
    <rect x="192" y="4" width="10" height="7" rx="1.5" transform="rotate(-31 197 7.5)" fill="${DARK}"/>
    <path d="M112 54 L144 54 L136 40 L118 40Z" fill="url(#aa-body)" ${s(1.4)}/>
    <circle cx="128" cy="46" r="7" fill="url(#aa-metal)" ${s(1.4)}/>` +
    sandbags(56, 206, 62, 2),
};

/** 圖鑑右側的大插圖 */
export function armoryArt(kind: ArmoryKind, label: string) {
  return `<svg class="arm-art" viewBox="0 0 260 80" role="img" aria-label="${label}">${DEFS}${ART[kind]()}</svg>`;
}
