// 結算畫面的「勢力隨時間變化圖」：手刻 SVG 折線圖。
// - 一次看一個指標（勢力／兵力／據點），只有一個 y 軸
// - 顏色跟遊戲裡的陣營一樣；線尾另外畫陣營徽章＋名字，不只靠顏色分辨
// - 滑過（手機用手指按住拖）會出現十字線，列出那個時間點每個人的數值
// - 下面有數據表，不用滑也看得到數字
import { FACTIONS, type BattleHistory } from "@frontline/shared";

const METRICS = [
  { name: "勢力", note: "部隊、工事、據點的價值加總", step: false },
  { name: "兵力", note: "所有部隊的價值（造價 × 剩下的血量）", step: false },
  { name: "據點", note: "擁有的大本營與堡壘數", step: true },
];

const W = 640;
const H = 240;
const M = { l: 48, r: 92, t: 12, b: 28 };
const SVG_NS = "http://www.w3.org/2000/svg";
const GRID = "#34301f";
const SURFACE = "#1a1912";
const MUTED = "#a89f84";
const TEXT = "#ece4cf";

interface Series {
  id: string;
  name: string;
  faction: number;
  color: string;
  emblem: string;
  mine: boolean;
  outAt: number | null;
  pts: { t: number; v: number }[];
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** 刻度：整數指標每 1（或 2）一格；其他取 1/2/2.5/5 × 10ⁿ 的整齊間距，大約 4 格 */
function niceScale(v: number, integer: boolean) {
  if (integer) {
    const top = Math.max(2, Math.ceil(v) + 1);
    const step = top > 8 ? 2 : 1;
    return { max: Math.ceil(top / step) * step, step };
  }
  const raw = Math.max(1, v) / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * p;
  for (const k of [1, 2, 2.5, 5, 10]) {
    if (k * p >= raw) {
      step = k * p;
      break;
    }
  }
  return { max: Math.max(step, Math.ceil(v / step) * step), step };
}

const fmtValue = (v: number) => (v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(Math.round(v)));

/** 陣營徽章（跟遊戲裡一樣的形狀），中心 (x, y)，半徑 r */
function emblemPath(kind: string, x: number, y: number, r: number) {
  switch (kind) {
    case "cross":
      return `M${x - r * 0.35},${y - r}h${r * 0.7}v${r * 0.65}h${r * 0.65}v${r * 0.7}h${-r * 0.65}v${r * 0.65}h${-r * 0.7}v${-r * 0.65}h${-r * 0.65}v${-r * 0.7}h${r * 0.65}z`;
    case "triangle":
      return `M${x},${y - r}L${x + r},${y + r * 0.8}L${x - r},${y + r * 0.8}z`;
    case "star": {
      let d = "";
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        d += `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(2)},${(y + Math.sin(a) * rr).toFixed(2)}`;
      }
      return `${d}z`;
    }
    default: // ring
      return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0zM${x - r * 0.45},${y}a${r * 0.45},${r * 0.45} 0 1,1 ${r * 0.9},0a${r * 0.45},${r * 0.45} 0 1,1 ${-r * 0.9},0z`;
  }
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 線的圖例小圖：一小段線＋徽章 */
function lineKey(s: Series) {
  const svg = el("svg", { width: 22, height: 12, viewBox: "0 0 22 12", "aria-hidden": "true" });
  svg.appendChild(el("line", { x1: 1, y1: 6, x2: 21, y2: 6, stroke: s.color, "stroke-width": 2, "stroke-linecap": "round" }));
  svg.appendChild(el("path", { d: emblemPath(s.emblem, 11, 6, 4.2), fill: s.color, stroke: "#1d1d17", "stroke-width": 1 }));
  return svg;
}

export function mountHistory(root: HTMLElement, h: BattleHistory, myId: string) {
  root.innerHTML = "";
  if (!h || h.samples.length < 2) {
    const p = document.createElement("p");
    p.className = "hist-empty";
    p.textContent = "這一局太短，沒有勢力變化圖";
    root.appendChild(p);
    return;
  }
  let metric = 0;
  const series: Series[] = h.players.map((p) => {
    const f = FACTIONS[p.faction] ?? FACTIONS[0];
    const out = h.out.find((o) => o.id === p.id);
    return { id: p.id, name: p.name, faction: p.faction, color: f.bar, emblem: f.emblem, mine: p.id === myId, outAt: out ? out.t : null, pts: [] };
  });
  const tMax = Math.max(1, h.samples[h.samples.length - 1].t);

  // ---- 版面
  const wrap = document.createElement("div");
  wrap.className = "hist";
  const head = document.createElement("div");
  head.className = "hist-head";
  const title = document.createElement("h3");
  title.textContent = "勢力變化";
  const tabs = document.createElement("div");
  tabs.className = "hist-tabs";
  tabs.setAttribute("role", "tablist");
  const note = document.createElement("p");
  note.className = "hist-note";
  head.append(title, tabs);
  const legend = document.createElement("div");
  legend.className = "hist-legend";
  const plot = document.createElement("div");
  plot.className = "hist-plot";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: 0 });
  const tip = document.createElement("div");
  tip.className = "hist-tip hidden";
  plot.append(svg, tip);
  const details = document.createElement("details");
  details.className = "hist-table";
  const summary = document.createElement("summary");
  summary.textContent = "看數據表";
  const tableWrap = document.createElement("div");
  details.append(summary, tableWrap);
  wrap.append(head, note, legend, plot, details);
  root.appendChild(wrap);

  // ---- 圖例（陣營＋名字；出局的寫出局時間）
  for (const s of series) {
    const item = document.createElement("span");
    item.className = `hist-li${s.mine ? " me" : ""}`;
    const name = document.createElement("span");
    name.textContent = `${FACTIONS[s.faction]?.name ?? ""}・${s.name}${s.mine ? "（你）" : ""}`;
    item.append(lineKey(s), name);
    if (s.outAt !== null) {
      const out = document.createElement("em");
      out.textContent = `${fmtTime(s.outAt)} 出局`;
      item.appendChild(out);
    }
    legend.appendChild(item);
  }

  METRICS.forEach((m, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = m.name;
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => {
      metric = i;
      draw();
    });
    tabs.appendChild(b);
  });

  let xs: (t: number) => number = () => 0;
  let ys: (v: number) => number = () => 0;
  let hoverLayer: SVGGElement | null = null;
  let hoverIdx = -1;

  function draw() {
    const m = METRICS[metric];
    tabs.querySelectorAll("button").forEach((b, i) => {
      b.classList.toggle("on", i === metric);
      b.setAttribute("aria-selected", String(i === metric));
    });
    note.textContent = m.note;
    for (const s of series) {
      s.pts = [];
      for (const smp of h.samples) {
        const v = smp.v[s.id];
        if (v) s.pts.push({ t: smp.t, v: v[metric] });
      }
    }
    const scale = niceScale(Math.max(1, ...series.flatMap((s) => s.pts.map((p) => p.v))), m.step);
    const max = scale.max;
    xs = (t) => M.l + (t / tMax) * (W - M.l - M.r);
    ys = (v) => H - M.b - (v / max) * (H - M.t - M.b);
    svg.setAttribute("aria-label", `${m.name}隨時間變化的折線圖，共 ${series.length} 位玩家`);
    svg.replaceChildren();

    // 格線與 y 軸數字
    for (let v = 0; v <= max + 1e-6; v += scale.step) {
      const y = ys(v);
      svg.appendChild(el("line", { x1: M.l, x2: W - M.r, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
      const label = el("text", { x: M.l - 8, y: y + 4, "text-anchor": "end", fill: MUTED, "font-size": 11 });
      label.textContent = fmtValue(v);
      svg.appendChild(label);
    }
    // x 軸時間
    const every = tMax > 360 ? 120 : 60;
    for (let t = 0; t <= tMax + 0.1; t += every) {
      const x = xs(t);
      const label = el("text", { x, y: H - 8, "text-anchor": "middle", fill: MUTED, "font-size": 11 });
      label.textContent = fmtTime(t);
      svg.appendChild(label);
    }

    // 線：先畫一條底色粗線當作「隔開」，交叉的地方才看得清楚
    // 據點數是整數，好幾條線常常完全重疊：每條線上下錯開一點點，才看得到每一條
    const nudge = (i: number) => (m.step ? (i - (series.length - 1) / 2) * 2.5 : 0);
    const ends: { s: Series; x: number; y: number }[] = [];
    series.forEach((s, si) => {
      if (s.pts.length === 0) return;
      let d = "";
      s.pts.forEach((p, i) => {
        const x = xs(p.t);
        const y = ys(p.v) + nudge(si);
        if (i === 0) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
        else if (m.step) d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
        else d += `L${x.toFixed(1)},${y.toFixed(1)}`;
      });
      svg.appendChild(el("path", { d, fill: "none", stroke: SURFACE, "stroke-width": 6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.mine ? 3 : 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const last = s.pts[s.pts.length - 1];
      ends.push({ s, x: xs(last.t), y: ys(last.v) + nudge(si) });
    });

    // 線尾：出局的畫 ✕，活著的畫陣營徽章；名字放在右邊，太擠就用細線拉開
    const labels = ends.map((e) => ({ ...e, ly: e.y })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 15);
    const overflow = labels.length ? labels[labels.length - 1].ly - (H - M.b) : 0;
    if (overflow > 0) labels.forEach((l) => (l.ly -= overflow));
    for (const l of labels) {
      const lx = W - M.r + 10;
      const out = l.s.outAt !== null;
      if (out) {
        const r = 4.5;
        svg.appendChild(el("path", { d: `M${l.x - r},${l.y - r}L${l.x + r},${l.y + r}M${l.x + r},${l.y - r}L${l.x - r},${l.y + r}`, stroke: SURFACE, "stroke-width": 5, "stroke-linecap": "round" }));
        svg.appendChild(el("path", { d: `M${l.x - r},${l.y - r}L${l.x + r},${l.y + r}M${l.x + r},${l.y - r}L${l.x - r},${l.y + r}`, stroke: l.s.color, "stroke-width": 2, "stroke-linecap": "round" }));
      } else {
        svg.appendChild(el("path", { d: emblemPath(l.s.emblem, l.x, l.y, 5.5), fill: l.s.color, stroke: SURFACE, "stroke-width": 2 }));
      }
      // 只有活到最後的人在右邊標名字；出局的人看圖例
      if (out) continue;
      if (Math.abs(l.ly - l.y) > 1) svg.appendChild(el("path", { d: `M${l.x + 7},${l.y}L${lx - 3},${l.ly}`, stroke: MUTED, "stroke-width": 1, fill: "none" }));
      const t = el("text", { x: lx, y: l.ly + 4, fill: TEXT, "font-size": 12, "font-weight": l.s.mine ? 900 : 500 });
      t.textContent = l.s.name.length > 6 ? `${l.s.name.slice(0, 6)}…` : l.s.name;
      svg.appendChild(t);
    }

    // 滑過時的十字線圖層
    hoverLayer = el("g", { "pointer-events": "none" });
    svg.appendChild(hoverLayer);
    svg.appendChild(el("rect", { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: "transparent", class: "hist-hit" }));
    renderTable();
    if (hoverIdx >= 0) showAt(hoverIdx);
  }

  function showAt(idx: number) {
    hoverIdx = Math.max(0, Math.min(h.samples.length - 1, idx));
    const smp = h.samples[hoverIdx];
    const x = xs(smp.t);
    if (!hoverLayer) return;
    hoverLayer.replaceChildren();
    hoverLayer.appendChild(el("line", { x1: x, x2: x, y1: M.t, y2: H - M.b, stroke: TEXT, "stroke-width": 1, opacity: 0.6 }));
    const rows: { s: Series; v: number }[] = [];
    for (const s of series) {
      const v = smp.v[s.id];
      if (!v) continue;
      rows.push({ s, v: v[metric] });
      hoverLayer.appendChild(el("circle", { cx: x, cy: ys(v[metric]), r: 4.5, fill: s.color, stroke: SURFACE, "stroke-width": 2 }));
    }
    rows.sort((a, b) => b.v - a.v);
    tip.replaceChildren();
    const time = document.createElement("p");
    time.className = "ht-time";
    time.textContent = fmtTime(smp.t);
    tip.appendChild(time);
    for (const r of rows) {
      const row = document.createElement("p");
      row.className = "ht-row";
      const val = document.createElement("strong");
      val.textContent = METRICS[metric].step ? `${r.v} 座` : r.v.toLocaleString();
      const name = document.createElement("span");
      name.textContent = r.s.name;
      row.append(lineKey(r.s), val, name);
      tip.appendChild(row);
    }
    if (!rows.length) {
      const row = document.createElement("p");
      row.className = "ht-row";
      row.textContent = "沒有資料";
      tip.appendChild(row);
    }
    tip.classList.remove("hidden");
    // 放在十字線旁邊，靠右時改放左邊
    const box = svg.getBoundingClientRect();
    const scale = box.width / W;
    const px = x * scale;
    const tw = tip.offsetWidth || 150;
    tip.style.left = `${px + 12 + tw > box.width ? Math.max(0, px - tw - 12) : px + 12}px`;
    tip.style.top = `${M.t * scale}px`;
  }

  function hide() {
    hoverIdx = -1;
    hoverLayer?.replaceChildren();
    tip.classList.add("hidden");
  }

  function idxAt(clientX: number) {
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * W;
    const t = ((x - M.l) / (W - M.l - M.r)) * tMax;
    let best = 0;
    h.samples.forEach((s, i) => {
      if (Math.abs(s.t - t) < Math.abs(h.samples[best].t - t)) best = i;
    });
    return best;
  }

  svg.addEventListener("pointermove", (e) => showAt(idxAt(e.clientX)));
  svg.addEventListener("pointerdown", (e) => showAt(idxAt(e.clientX)));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("focus", () => showAt(h.samples.length - 1));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showAt(hoverIdx - 1);
    else if (e.key === "ArrowRight") showAt(hoverIdx + 1);
    else return;
    e.preventDefault();
  });

  /** 數據表：每分鐘一列＋最後一筆 */
  function renderTable() {
    const table = document.createElement("table");
    const thead = document.createElement("tr");
    const th0 = document.createElement("th");
    th0.textContent = "時間";
    thead.appendChild(th0);
    for (const s of series) {
      const th = document.createElement("th");
      th.textContent = s.name;
      thead.appendChild(th);
    }
    table.appendChild(thead);
    const picked = h.samples.filter((s, i) => i === h.samples.length - 1 || Math.round(s.t) % 60 === 0);
    for (const smp of picked) {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.textContent = fmtTime(smp.t);
      tr.appendChild(td0);
      for (const s of series) {
        const td = document.createElement("td");
        const v = smp.v[s.id];
        td.textContent = v ? v[metric].toLocaleString() : "—";
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    tableWrap.replaceChildren(table);
  }

  draw();
}
