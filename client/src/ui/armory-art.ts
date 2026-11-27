// 兵種圖鑑的側面插圖：同一套橄欖綠漸層、深色描邊，畫面 260×80，地面在 y = 72
import type { BuildKind, UnitType } from "@frontline/shared";

export type ArmoryKind = Exclude<UnitType, "para"> | "bomber" | "transport" | BuildKind;

const OL = "#20241a"; // 描邊
const DARK = "#2c3121";
const METAL = "#2a2e22";
const SKIN = "#b99c76";
const TROUSERS = "#3d4430";

const DEFS = `<defs>
  <linearGradient id="aa-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a8552"/><stop offset="1" stop-color="#3f4630"/></linearGradient>
  <linearGradient id="aa-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#555b44"/><stop offset="1" stop-color="#25281d"/></linearGradient>
  <linearGradient id="aa-concrete" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a39b88"/><stop offset="1" stop-color="#5e574a"/></linearGradient>
  <linearGradient id="aa-flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff1a8"/><stop offset=".35" stop-color="#ffb04a"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></linearGradient>
</defs>`;

const shadow = (cx = 130, rx = 100) => `<ellipse cx="${cx}" cy="74" rx="${rx}" ry="4.5" fill="#000" opacity=".35"/>`;
const s = (w = 1.5) => `stroke="${OL}" stroke-width="${w}" stroke-linejoin="round"`;

/** 頭和鋼盔（中心 x，頭頂附近 y） */
function head(x: number, y: number, helmet = "#5d6842", mark = "") {
  return `<circle cx="${x + 1}" cy="${y}" r="4.6" fill="${SKIN}" ${s(1.2)}/>
    <path d="M${x - 6.5} ${y - 1} Q${x + 0.5} ${y - 12} ${x + 8} ${y - 1}Z" fill="${helmet}" ${s()}/>
    <path d="M${x - 8} ${y - 1}H${x + 9.5}" stroke="${OL}" stroke-width="2" stroke-linecap="round"/>${mark}`;
}

/** 站著的士兵，面向右；x 是腳的中心 */
function standing(x: number, gear: "rifle" | "none" | "flame" | "satchel" = "rifle", pack = true) {
  const arm =
    gear === "rifle" ? `<path d="M${x - 4} 41 L${x + 26} 33" stroke="#2a2418" stroke-width="3" stroke-linecap="round"/>
      <path d="M${x + 1} 34 L${x + 10} 39 L${x + 17} 36" stroke="#55603d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : gear === "flame" ? `<path d="M${x + 2} 42 L${x + 30} 39" stroke="${METAL}" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M${x - 8} 40 Q${x - 4} 50 ${x + 8} 43" stroke="${METAL}" stroke-width="2" fill="none"/>
      <path d="M${x + 1} 34 L${x + 8} 41 L${x + 16} 40" stroke="#55603d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : gear === "satchel" ? `<path d="M${x + 1} 34 L${x + 8} 42 L${x + 12} 48" stroke="#55603d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="${x + 6}" y="47" width="13" height="9" rx="1.5" fill="#6b5a3a" ${s(1.2)}/><path d="M${x + 12} 47 v-3" stroke="${OL}" stroke-width="1.4"/>`
    : `<path d="M${x + 1} 34 L${x + 4} 44" stroke="#55603d" stroke-width="4" stroke-linecap="round"/>`;
  const back =
    gear === "flame" ? `<rect x="${x - 15}" y="29" width="6" height="21" rx="3" fill="url(#aa-metal)" ${s(1.2)}/><rect x="${x - 10}" y="29" width="6" height="21" rx="3" fill="url(#aa-metal)" ${s(1.2)}/>`
    : pack ? `<rect x="${x - 11}" y="32" width="5.5" height="13" rx="1.5" fill="#4b5236" ${s(1.2)}/>` : "";
  return `<g>${back}
    <path d="M${x - 5} 50 L${x - 8} 72 L${x - 3} 72 L${x} 57 L${x + 3} 72 L${x + 8} 72 L${x + 5} 50Z" fill="${TROUSERS}" ${s()}/>
    <path d="M${x - 9} 70h7v3h-7zM${x + 2} 70h8v3h-8z" fill="#1c1e16"/>
    <path d="M${x - 6} 31 L${x + 6} 31 L${x + 7} 51 L${x - 6} 51Z" fill="url(#aa-body)" ${s()}/>
    <rect x="${x - 6.5}" y="45" width="13.5" height="3" fill="${DARK}"/>
    ${head(x, 26)}${arm}</g>`;
}

/** 單膝跪著的士兵（砲組、機槍手），面向右 */
function kneeling(x: number, arms: "forward" | "down" = "forward", helmet = "#5d6842", mark = "") {
  const arm =
    arms === "forward" ? `<path d="M${x + 1} 46 L${x + 10} 51 L${x + 19} 50" stroke="#55603d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M${x + 1} 46 L${x + 8} 55 L${x + 16} 58" stroke="#55603d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<g>
    <path d="M${x - 5} 61 L${x - 12} 72 L${x - 4} 72 L${x + 1} 64Z" fill="${TROUSERS}" ${s()}/>
    <path d="M${x + 1} 59 L${x + 13} 60 L${x + 13} 72 L${x + 18} 72 L${x + 17} 57 L${x + 4} 55Z" fill="${TROUSERS}" ${s()}/>
    <path d="M${x - 6} 43 L${x + 6} 43 L${x + 7} 62 L${x - 6} 62Z" fill="url(#aa-body)" ${s()}/>
    <rect x="${x - 11}" y="44" width="5.5" height="12" rx="1.5" fill="#4b5236" ${s(1.2)}/>
    ${head(x, 38, helmet, mark)}${arm}</g>`;
}

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

const MEDIC_MARK = (x: number, y: number) =>
  `<circle cx="${x + 1}" cy="${y - 5}" r="3.2" fill="#f4f1e6"/><path d="M${x + 1} ${y - 7.2}v4.4M${x - 1.2} ${y - 5}h4.4" stroke="#c8352b" stroke-width="1.6"/>`;

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
  rifle: () => shadow(130, 80) + standing(84) + standing(126) + standing(168),

  mg: () =>
    shadow(140, 90) +
    `<path d="M168 56 L158 72 M168 56 L178 72 M200 57 L204 72" stroke="${METAL}" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="150" y="49" width="32" height="8" rx="1.5" fill="url(#aa-metal)" ${s()}/>
    <rect x="182" y="51" width="38" height="4" fill="${METAL}" ${s(1)}/>
    <path d="M188 51v4M194 51v4M200 51v4M206 51v4" stroke="#555b44" stroke-width="1.2"/>
    <rect x="160" y="57" width="12" height="9" fill="#5a5236" ${s(1.2)}/>
    <path d="M166 57 Q160 64 150 66" stroke="#b08a3a" stroke-width="2" fill="none"/>` +
    kneeling(138) +
    kneeling(96, "down") +
    `<rect x="110" y="64" width="13" height="8" fill="#5a5236" ${s(1.2)}/>`,

  sniper: () =>
    shadow(140, 96) +
    `<path d="M60 72 q6 -9 10 0 M74 72 q4 -7 8 0 M220 72 q5 -8 9 0 M232 72 q4 -6 8 0" stroke="#5e6a42" stroke-width="2" fill="none"/>
    <path d="M70 70 L80 62 L150 60 L156 70Z" fill="${TROUSERS}" ${s()}/>
    <path d="M92 60 Q120 54 152 58 L156 68 L96 69Z" fill="url(#aa-body)" ${s()}/>
    <path d="M64 70 l8 -3 l3 4z" fill="#1c1e16"/>
    ${head(160, 56)}
    <path d="M150 60 L232 56" stroke="#2a2418" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="176" y="51" width="22" height="4" rx="2" fill="${METAL}" ${s(1)}/>
    <path d="M214 57 L210 70 M214 57 L220 70" stroke="${METAL}" stroke-width="1.8"/>
    <path d="M158 62 L172 60" stroke="#55603d" stroke-width="4" stroke-linecap="round"/>`,

  flame: () =>
    shadow(120, 70) +
    `<path d="M126 38 Q160 26 196 34 Q230 30 246 40 Q228 46 206 50 Q176 56 150 48 Q134 46 126 42Z" fill="url(#aa-flame)"/>
    <path d="M128 39 Q152 34 176 38 Q160 44 130 42Z" fill="#fff1a8" opacity=".8"/>` +
    standing(98, "flame", false),

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
    shadow(130, 100) +
    `<path d="M128 58 L58 71 M128 61 L74 73" stroke="${METAL}" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="132" y="38" width="94" height="5" fill="url(#aa-metal)" ${s(1.2)}/>
    <rect x="222" y="36" width="12" height="9" rx="1.5" fill="${DARK}" ${s(1.2)}/>
    <path d="M118 30 L136 27 L140 58 L122 61Z" fill="url(#aa-body)" ${s(1.6)}/>
    ${spokeWheel(128, 61, 11)}` +
    kneeling(96),

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
    shadow(130, 100) +
    `<path d="M126 56 L46 72" stroke="${METAL}" stroke-width="5" stroke-linecap="round"/>
    <path d="M118 50 L214 16" stroke="url(#aa-metal)" stroke-width="8" stroke-linecap="round"/>
    <path d="M118 50 L214 16" stroke="${OL}" stroke-width="9.5" stroke-linecap="round" opacity=".35"/>
    <path d="M120 46 L170 28" stroke="#555b44" stroke-width="5" stroke-linecap="round"/>
    <path d="M108 36 L130 32 L134 52 L112 55Z" fill="url(#aa-body)" ${s(1.4)}/>
    ${spokeWheel(124, 58, 14)}
    <rect x="62" y="64" width="6" height="8" rx="2" fill="#b08a3a" ${s(1)}/><rect x="70" y="64" width="6" height="8" rx="2" fill="#b08a3a" ${s(1)}/>` +
    standing(88, "none"),

  engineer: () =>
    shadow(140, 90) +
    `<path d="M106 29 L94 12" stroke="#6b5a3a" stroke-width="2.6" stroke-linecap="round"/><path d="M90 10 l8 -2 l1 5z" fill="${METAL}"/>` +
    standing(112, "satchel") +
    `<rect x="176" y="62" width="18" height="10" rx="1.5" fill="#6b5a3a" ${s(1.2)}/>
    <path d="M176 66 h-6 M174 63 l-2 -2" stroke="${OL}" stroke-width="1.2"/>
    <path d="M194 66 Q210 58 216 66 T232 64" stroke="#2a2418" stroke-width="1.4" fill="none"/>
    <circle cx="232" cy="64" r="3" fill="#ffb04a"/><circle cx="232" cy="64" r="6" fill="#ff7a1a" opacity=".35"/>`,

  medic: () =>
    shadow(140, 90) +
    `<path d="M148 66 L210 64 L214 72 L150 73Z" fill="url(#aa-body)" ${s()}/>
    <path d="M206 64 L226 66 L228 72 L212 72Z" fill="${TROUSERS}" ${s()}/>
    <circle cx="146" cy="66" r="4.6" fill="${SKIN}" ${s(1.2)}/>
    <path d="M128 72 L232 72" stroke="#c9c2a8" stroke-width="2"/>` +
    kneeling(122, "down", "#e8e4d6", MEDIC_MARK(122, 38)) +
    `<rect x="100" y="60" width="13" height="11" rx="2" fill="#e8e4d6" ${s(1.2)}/><path d="M106.5 62.5v6M103.5 65.5h6" stroke="#c8352b" stroke-width="1.8"/>
    <rect x="116" y="48" width="5" height="5" fill="#f4f1e6"/><path d="M118.5 48.6v3.8M116.6 50.5h3.8" stroke="#c8352b" stroke-width="1.2"/>`,

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
      [44, 30],
      [84, 46],
    ]
      .map(
        ([px, py]) => `<g transform="translate(${px} ${py})">
          <path d="M-16 0 A16 12 0 0 1 16 0 Q8 -3 0 0 Q-8 -3 -16 0Z" fill="#d8d2bc" ${s(1.2)}/>
          <path d="M-15 0 L0 20 M15 0 L0 20 M0 0 L0 20" stroke="#8f8970" stroke-width="1"/>
          <circle cx="0" cy="22" r="2.6" fill="#5d6842" ${s(1)}/><rect x="-2.5" y="24" width="5" height="8" rx="1.5" fill="url(#aa-body)" ${s(1)}/>
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
