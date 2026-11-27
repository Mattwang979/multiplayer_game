// 所有圖都是程式畫出來的（Canvas 2D），不需要外部圖檔。
// 造型對應美術參考板：俯視角、朝右前進、陣營色 + 2px 深色描邊。
import Phaser from "phaser";
import { FACTIONS, type Faction } from "@frontline/shared";

const OUT = "#1d1d17";

type Ctx = CanvasRenderingContext2D;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.save();
  draw(ctx);
  ctx.restore();
  tex.refresh();
}

function emblem(ctx: Ctx, kind: Faction["emblem"], x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === "cross") {
    const t = r * 0.38;
    ctx.fillRect(-t, -r, t * 2, r * 2);
    ctx.fillRect(-r, -t, r * 2, t * 2);
  } else if (kind === "triangle") {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.95, r * 0.75);
    ctx.lineTo(-r * 0.95, r * 0.75);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "star") {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.42;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineWidth = r * 0.42;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function fillStroke(ctx: Ctx, path: Path2D, fill: string | CanvasGradient, lw = 2) {
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUT;
  ctx.stroke(path);
}

// ---------------------------------------------------------------- 飛機（跟美術板同一組路徑）

const BOMBER = {
  wings: "M14 -6 L4 -47 Q2 -51 -2 -51 L-7 -50 Q-10 -48 -9 -45 L-6 -6 Z M14 6 L4 47 Q2 51 -2 51 L-7 50 Q-10 48 -9 45 L-6 6 Z",
  tail: "M-38 -4 L-46 -20 Q-48 -23 -51 -22 L-53 -20 L-50 -4 Z M-38 4 L-46 20 Q-48 23 -51 22 L-53 20 L-50 4 Z",
  body: "M54 0 C54 -4 50 -7 44 -7 L-34 -5 C-44 -4 -52 -2 -54 0 C-52 2 -44 4 -34 5 L44 7 C50 7 54 4 54 0 Z",
  nose: "M54 0 C54 -4 51 -6.5 46 -6.8 L46 6.8 C51 6.5 54 4 54 0 Z",
  engines: [[-2, -19.5, 22], [-2, -35.5, 20], [-2, 12.5, 22], [-2, 28.5, 20]] as [number, number, number][],
  props: [[22, -16], [20, -32], [22, 16], [20, 32]] as [number, number][],
  roundels: [[1, -36], [1, 36]] as [number, number][],
  w: 116, h: 108, s: 1,
};
const TRANSPORT = {
  wings: "M12 -8 L8 -42 Q7 -46 3 -46 L-4 -45 Q-7 -44 -6 -40 L-4 -8 Z M12 8 L8 42 Q7 46 3 46 L-4 45 Q-7 44 -6 40 L-4 8 Z",
  tail: "M-34 -5 L-40 -18 Q-41 -21 -44 -20 L-46 -18 L-44 -5 Z M-34 5 L-40 18 Q-41 21 -44 20 L-46 18 L-44 5 Z",
  body: "M44 0 C44 -6 40 -9 32 -9 L-30 -6 C-40 -5 -46 -2 -47 0 C-46 2 -40 5 -30 6 L32 9 C40 9 44 6 44 0 Z",
  nose: "M42 -2.5 L36 -5.5 L36 5.5 L42 2.5 Z",
  engines: [[-6, -23, 26], [-6, 13, 26]] as [number, number, number][],
  props: [[23, -18], [23, 18]] as [number, number][],
  roundels: [[3, -32], [3, 32]] as [number, number][],
  w: 100, h: 96, s: 1,
};

function drawPlane(ctx: Ctx, spec: typeof BOMBER, f: Faction, scale: number) {
  ctx.translate((spec.w * scale) / 2, (spec.h * scale) / 2);
  ctx.scale(scale, scale);
  const wings = new Path2D(spec.wings);
  const tail = new Path2D(spec.tail);
  const body = new Path2D(spec.body);
  const nose = new Path2D(spec.nose);
  const base = f.css;

  // 機翼：前緣亮、後緣暗
  fillStroke(ctx, wings, base, 1.6);
  const wg = ctx.createLinearGradient(14, 0, -10, 0);
  wg.addColorStop(0, "rgba(255,255,255,0.38)");
  wg.addColorStop(0.45, "rgba(255,255,255,0)");
  wg.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = wg;
  ctx.fill(wings);
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(6, -10); ctx.lineTo(-1, -44); ctx.moveTo(6, 10); ctx.lineTo(-1, 44);
  ctx.stroke();
  fillStroke(ctx, tail, base, 1.3);

  // 引擎短艙與螺旋槳殘影
  for (const [x, y, len] of spec.engines) {
    const h = spec === BOMBER ? 7 : 10;
    const p = new Path2D();
    p.roundRect(x, y, len, h, h / 2);
    fillStroke(ctx, p, "#4a4c45", 1);
    ctx.fillStyle = "#7d8076";
    ctx.fillRect(x + 4, y + 1.5, len - 8, 1.6);
  }
  for (const [x, y] of spec.props) {
    ctx.fillStyle = "rgba(17,17,17,0.32)";
    ctx.beginPath();
    ctx.ellipse(x, y, 1.9, spec === BOMBER ? 9.5 : 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b2c27";
    ctx.beginPath();
    ctx.arc(x - 1.5, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 機身：中線亮、兩側暗
  fillStroke(ctx, body, base, 1.6);
  const bg = ctx.createLinearGradient(0, -9, 0, 9);
  bg.addColorStop(0, "rgba(0,0,0,0.3)");
  bg.addColorStop(0.45, "rgba(255,255,255,0.35)");
  bg.addColorStop(0.6, "rgba(255,255,255,0.1)");
  bg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = bg;
  ctx.fill(body);

  const glass = ctx.createLinearGradient(30, -7, 54, 7);
  glass.addColorStop(0, "#e8f6ff");
  glass.addColorStop(0.5, "#7fb7dc");
  glass.addColorStop(1, "#2c5876");
  fillStroke(ctx, nose, glass, 1);
  if (spec === BOMBER) {
    const cockpit = new Path2D();
    cockpit.roundRect(30, -4, 8, 8, 2.5);
    fillStroke(ctx, cockpit, glass, 0.8);
    const turret = new Path2D();
    turret.arc(15, 0, 3.4, 0, Math.PI * 2);
    fillStroke(ctx, turret, glass, 0.8);
  }
  ctx.fillStyle = "#f2c14e";
  ctx.fillRect(spec === BOMBER ? -30 : -26, -5.4, 4, 10.8);

  for (const [x, y] of spec.roundels) {
    const r = new Path2D();
    r.arc(x, y, 6, 0, Math.PI * 2);
    fillStroke(ctx, r, "#f4f1e6", 1);
    emblem(ctx, f.emblem, x, y, 3.6, f.color === 0xf2f4f6 ? OUT : f.css);
  }
}

// ---------------------------------------------------------------- 地面單位

function soldier(ctx: Ctx, f: Faction) {
  ctx.translate(9, 9);
  ctx.fillStyle = "#5a4e36";
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(-1, 0, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#1d1d17";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 3.5);
  ctx.lineTo(9, 3.5);
  ctx.stroke();
  ctx.fillStyle = f.css;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(-1, -1.4, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/** 工兵：背著炸藥包（黃色）、手上拿工具，沒有步槍 */
function engineerMan(ctx: Ctx, f: Faction) {
  ctx.translate(9, 9);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.fillStyle = "#5a4e36";
  ctx.beginPath();
  ctx.ellipse(-1, 0, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 炸藥包
  ctx.fillStyle = "#e0a530";
  ctx.fillRect(-7.5, -3.5, 4, 7);
  ctx.strokeRect(-7.5, -3.5, 4, 7);
  // 工具
  ctx.strokeStyle = "#b9b4a6";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(1, -4);
  ctx.lineTo(8, -4);
  ctx.stroke();
  ctx.fillStyle = "#b9b4a6";
  ctx.fillRect(7, -6, 2.5, 4);
  ctx.strokeStyle = OUT;
  ctx.fillStyle = f.css;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e0a530";
  ctx.fillRect(-1, -4.4, 2, 8.8);
}

/** 醫療兵：白色鋼盔上有紅十字，背著醫療包 */
function medicMan(ctx: Ctx, f: Faction) {
  ctx.translate(9, 9);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.fillStyle = "#5a4e36";
  ctx.beginPath();
  ctx.ellipse(-1, 0, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = f.css;
  ctx.fillRect(-7.5, -3, 4, 6);
  ctx.strokeRect(-7.5, -3, 4, 6);
  ctx.fillStyle = "#f4f1e6";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#d8322a";
  ctx.fillRect(-0.9, -3, 1.8, 6);
  ctx.fillRect(-3, -0.9, 6, 1.8);
}

function tankHull(ctx: Ctx, f: Faction) {
  ctx.translate(28, 19);
  // 履帶
  for (const y of [-17, 9]) {
    const t = new Path2D();
    t.rect(-26, y, 50, 8);
    fillStroke(ctx, t, "#2f302a", 1.2);
    ctx.strokeStyle = "#4a4b43";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = -24; x < 24; x += 4) {
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x, y + 7);
    }
    ctx.stroke();
  }
  const hull = new Path2D();
  hull.roundRect(-24, -12, 46, 24, 3);
  fillStroke(ctx, hull, f.css, 2);
  const g = ctx.createLinearGradient(0, -12, 0, 12);
  g.addColorStop(0, "rgba(255,255,255,0.25)");
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g;
  ctx.fill(hull);
  // 引擎蓋
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(-22, -8, 9, 16);
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  for (let y = -6; y <= 6; y += 3) {
    ctx.beginPath();
    ctx.moveTo(-21, y);
    ctx.lineTo(-14, y);
    ctx.stroke();
  }
}

function tankTurret(ctx: Ctx, f: Faction) {
  ctx.translate(12, 11);
  const barrel = new Path2D();
  barrel.rect(6, -2.2, 26, 4.4);
  fillStroke(ctx, barrel, "#2b2c26", 1);
  ctx.fillStyle = OUT;
  ctx.fillRect(30, -3.4, 4, 6.8);
  const t = new Path2D();
  t.arc(0, 0, 9.5, 0, Math.PI * 2);
  fillStroke(ctx, t, f.css, 2);
  const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 10);
  g.addColorStop(0, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0.2)");
  ctx.fillStyle = g;
  ctx.fill(t);
  emblem(ctx, f.emblem, -1, 0, 3.6, f.mark);
}

function atGun(ctx: Ctx, f: Faction) {
  ctx.translate(14, 14);
  ctx.strokeStyle = "#3a3a30";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-13, -10); ctx.lineTo(-3, -3); ctx.moveTo(-13, 10); ctx.lineTo(-3, 3);
  ctx.stroke();
  const wheels = new Path2D();
  wheels.rect(-6, -13, 6, 26);
  fillStroke(ctx, wheels, "#2f302a", 1.2);
  const shield = new Path2D("M-1 -12 L6 -8 L6 8 L-1 12 Z");
  fillStroke(ctx, shield, f.css, 1.5);
  const barrel = new Path2D();
  barrel.rect(5, -1.8, 24, 3.6);
  fillStroke(ctx, barrel, "#2b2c26", 1);
  ctx.fillStyle = OUT;
  ctx.fillRect(27, -2.8, 3.5, 5.6);
}

function howitzer(ctx: Ctx, f: Faction) {
  ctx.translate(20, 18);
  ctx.strokeStyle = "#3a3a30";
  ctx.lineCap = "round";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(-19, -14); ctx.lineTo(-3, -3); ctx.moveTo(-19, 14); ctx.lineTo(-3, 3);
  ctx.stroke();
  const wheels = new Path2D();
  wheels.rect(-7, -16, 7, 32);
  fillStroke(ctx, wheels, "#2f302a", 1.2);
  const cradle = new Path2D();
  cradle.rect(-3, -7, 12, 14);
  fillStroke(ctx, cradle, f.css, 1.5);
  const barrel = new Path2D();
  barrel.rect(6, -3, 30, 6);
  fillStroke(ctx, barrel, "#2b2c26", 1.2);
}

function mgGun(ctx: Ctx) {
  ctx.translate(4, 7);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(20, 0);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(14, 5); ctx.moveTo(10, 0); ctx.lineTo(14, -5);
  ctx.stroke();
  ctx.fillStyle = "#4a4c45";
  ctx.fillRect(-2, -2.5, 7, 5);
}

function sandbags(ctx: Ctx, cx: number, cy: number, r: number, from: number, to: number) {
  const n = Math.ceil(((to - from) * r) / 9);
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    const p = new Path2D();
    p.roundRect(-5, -3.5, 10, 7, 3);
    fillStroke(ctx, p, "#c2ad78", 1);
    ctx.restore();
  }
}

function hq(ctx: Ctx, f: Faction) {
  ctx.translate(60, 60);
  const hex = (r: number) => {
    const p = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      if (i === 0) p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else p.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.closePath();
    return p;
  };
  sandbags(ctx, 0, 0, 52, 0, Math.PI * 2);
  stoneWall(ctx, hex(44), "#b3ab96", 3);
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = f.css;
  ctx.stroke(hex(36));
  ctx.restore();
  fillStroke(ctx, hex(32), "#8d887a", 1.5);
  const g = ctx.createRadialGradient(-10, -10, 4, 0, 0, 34);
  g.addColorStop(0, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g;
  ctx.fill(hex(32));
  const plate = new Path2D();
  plate.arc(0, 0, 15, 0, Math.PI * 2);
  fillStroke(ctx, plate, f.css, 2);
  emblem(ctx, f.emblem, 0, 0, 9, f.mark);
  // 天線與旗子
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(22, -30); ctx.lineTo(22, -12);
  ctx.stroke();
  const flag = new Path2D();
  flag.rect(22, -30, 14, 9);
  fillStroke(ctx, flag, f.css, 1.2);
}

/** 石牆：先畫落在地上的影子，再畫牆、上亮下暗的光影、內緣亮線、深色外框 */
function stoneWall(ctx: Ctx, path: Path2D, base: string, lw: number) {
  ctx.save();
  ctx.shadowColor = "rgba(42,29,12,0.55)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = base;
  ctx.fill(path);
  ctx.restore();
  const g = ctx.createLinearGradient(0, -40, 0, 40);
  g.addColorStop(0, "rgba(255,255,255,0.3)");
  g.addColorStop(0.55, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.translate(0, 1.5);
  ctx.stroke(path);
  ctx.restore();
  ctx.lineWidth = lw;
  ctx.strokeStyle = "#2c2a22";
  ctx.lineJoin = "round";
  ctx.stroke(path);
}

/** 星形稜堡（十六角，四個稜角）：faction = null 是無主（灰色、白旗）；spec 是改建後的樣式 */
function fort(ctx: Ctx, f: Faction | null, spec = "") {
  ctx.translate(46, 46);
  const star = new Path2D();
  const B = [[0, -54], [18, -32], [32, -32], [32, -18], [54, 0], [32, 18], [32, 32], [18, 32], [0, 54], [-18, 32], [-32, 32], [-32, 18], [-54, 0], [-32, -18], [-32, -32], [-18, -32]];
  B.forEach(([x, y], i) => (i ? star.lineTo(x * 0.63, y * 0.63) : star.moveTo(x * 0.63, y * 0.63)));
  star.closePath();
  // 改建後的外觀：牆的顏色和外圍裝飾不同
  const wall: Record<string, string> = { battery: "#8f8a7c", barracks: "#a79a7a", depot: "#a8946a", flak: "#8d9196", hospital: "#d9d4c4" };
  // 砲台：四個角伸出砲管
  if (spec === "battery") {
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(-Math.PI / 4 + (i * Math.PI) / 2);
      const b = new Path2D();
      b.rect(18, -3, 22, 6);
      fillStroke(ctx, b, "#3a3b34", 1.5);
      ctx.restore();
    }
  }
  stoneWall(ctx, star, wall[spec] ?? "#b3ab96", 2.5);
  if (spec === "depot") {
    // 補給站：黃黑警示線＋木箱
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    for (const [x, y] of [[-22, 14], [16, 18], [-18, -20]]) {
      const box = new Path2D();
      box.rect(x, y, 9, 8);
      fillStroke(ctx, box, "#b07a3a", 1.2);
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 9, y + 8);
      ctx.stroke();
    }
  }
  if (spec === "barracks") {
    // 兵營：兩排營房屋頂
    for (const y of [-24, 18]) {
      const roof = new Path2D();
      roof.rect(-13, y, 26, 7);
      fillStroke(ctx, roof, "#6f7a3e", 1.2);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.moveTo(-13, y + 3.5);
      ctx.lineTo(13, y + 3.5);
      ctx.stroke();
    }
  }
  if (spec === "flak") {
    // 防空要塞：兩組朝天的砲管
    for (const [x, y, a] of [[-16, 12, -2.2], [16, 12, -0.95]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      for (const off of [-2.5, 2.5]) {
        const b = new Path2D();
        b.rect(0, off - 1.2, 15, 2.4);
        fillStroke(ctx, b, "#2b2c27", 1);
      }
      ctx.restore();
      const base = new Path2D();
      base.arc(x, y, 4.5, 0, Math.PI * 2);
      fillStroke(ctx, base, "#55574e", 1.2);
    }
  }
  const yard = new Path2D();
  yard.arc(0, 0, 15, 0, Math.PI * 2);
  if (spec === "hospital") {
    fillStroke(ctx, yard, "#f4f1e6", 2);
    ctx.strokeStyle = f ? f.css : "#8d887a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#d8322a";
    ctx.fillRect(-2.5, -8, 5, 16);
    ctx.fillRect(-8, -2.5, 16, 5);
  } else {
    fillStroke(ctx, yard, f ? f.css : "#8d887a", 2);
    const ink = f ? f.mark : "#f4f1e6";
    if (!spec) {
      if (f) emblem(ctx, f.emblem, 0, 0, 8, f.mark);
    } else if (spec === "battery") {
      // 砲彈
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-3, 7);
      ctx.lineTo(-3, -3);
      ctx.quadraticCurveTo(0, -10, 3, -3);
      ctx.lineTo(3, 7);
      ctx.closePath();
      ctx.fill();
    } else if (spec === "barracks") {
      // 鋼盔
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(0, 2, 7, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-9, 2, 18, 2.5);
    } else if (spec === "depot") {
      // 箱子
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(-6, -5, 12, 10);
      ctx.beginPath();
      ctx.moveTo(-6, -5);
      ctx.lineTo(6, 5);
      ctx.moveTo(6, -5);
      ctx.lineTo(-6, 5);
      ctx.stroke();
    } else if (spec === "flak") {
      // 爆炸星芒
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const r = i % 2 ? 3 : 8;
        if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  // 旗子
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, -30);
  ctx.lineTo(14, -12);
  ctx.stroke();
  const flag = new Path2D();
  flag.rect(14, -30, 13, 8);
  fillStroke(ctx, flag, f ? f.css : "#f4f1e6", 1.2);
}

/** 狙擊手：偽裝網斗篷、長槍管 */
function sniperMan(ctx: Ctx, f: Faction) {
  ctx.translate(11, 9);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.fillStyle = "#56603a";
  ctx.beginPath();
  ctx.ellipse(-1, 0, 6, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#3f4a2a";
  for (const [x, y] of [[-4, -4], [-3, 4], [2, -5], [1, 5]]) {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#2a2a24";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 1.5);
  ctx.lineTo(11, 1.5);
  ctx.stroke();
  ctx.fillStyle = "#2a2a24";
  ctx.fillRect(3, -0.5, 3, 1.5);
  ctx.strokeStyle = OUT;
  ctx.fillStyle = f.css;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** 火焰兵：背兩支燃料罐、手上噴嘴 */
function flameMan(ctx: Ctx, f: Faction) {
  ctx.translate(9, 9);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1;
  ctx.fillStyle = "#5a4e36";
  ctx.beginPath();
  ctx.ellipse(-1, 0, 4.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#d9661f";
  for (const y of [-4, 1]) {
    ctx.fillRect(-8.5, y, 4, 3.6);
    ctx.strokeRect(-8.5, y, 4, 3.6);
  }
  ctx.strokeStyle = "#3a3a32";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.lineTo(8.5, 3);
  ctx.stroke();
  ctx.fillStyle = "#ff9a3c";
  ctx.beginPath();
  ctx.arc(9, 3, 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUT;
  ctx.fillStyle = f.css;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** 裝甲車：四輪、斜面車頭、小砲塔 */
function armoredCar(ctx: Ctx, f: Faction) {
  ctx.translate(22, 13);
  for (const [x, y] of [[-12, -12], [8, -12], [-12, 8], [8, 8]]) {
    const w = new Path2D();
    w.roundRect(x, y, 9, 5, 2);
    fillStroke(ctx, w, "#2f302a", 1);
  }
  const body = new Path2D();
  body.moveTo(-17, -9);
  body.lineTo(12, -9);
  body.lineTo(19, -4);
  body.lineTo(19, 4);
  body.lineTo(12, 9);
  body.lineTo(-17, 9);
  body.closePath();
  fillStroke(ctx, body, f.css, 2);
  const g = ctx.createLinearGradient(0, -9, 0, 9);
  g.addColorStop(0, "rgba(255,255,255,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.strokeStyle = "#2a2a24";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(16, 0);
  ctx.stroke();
  const tur = new Path2D();
  tur.arc(-1, 0, 5.5, 0, Math.PI * 2);
  fillStroke(ctx, tur, shade(f.css, -0.12), 1.5);
}

/** 防空砲車：卡車＋後面平台上的雙聯裝砲 */
function flakTruck(ctx: Ctx, f: Faction) {
  ctx.translate(23, 13);
  for (const [x, y] of [[-16, -12], [-6, -12], [10, -12], [-16, 8], [-6, 8], [10, 8]]) {
    const w = new Path2D();
    w.roundRect(x, y, 7, 4.5, 2);
    fillStroke(ctx, w, "#2f302a", 1);
  }
  const bed = new Path2D();
  bed.rect(-19, -9, 26, 18);
  fillStroke(ctx, bed, shade(f.css, -0.08), 2);
  const cab = new Path2D();
  cab.roundRect(8, -8, 12, 16, 2);
  fillStroke(ctx, cab, f.css, 2);
  ctx.fillStyle = "rgba(170,210,230,0.8)";
  ctx.fillRect(16, -6, 3, 12);
  const base = new Path2D();
  base.arc(-6, 0, 6, 0, Math.PI * 2);
  fillStroke(ctx, base, "#55574e", 1.4);
  for (const off of [-2.5, 2.5]) {
    const b = new Path2D();
    b.rect(-6, off - 1.2, 18, 2.4);
    fillStroke(ctx, b, "#2b2c27", 1);
  }
}

/** 補給箱（降落傘吊著的木箱） */
function crate(ctx: Ctx) {
  ctx.translate(16, 16);
  const box = new Path2D();
  box.rect(-11, -11, 22, 22);
  fillStroke(ctx, box, "#b07a3a", 2.5);
  ctx.strokeStyle = "#7a4f20";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-11, -11);
  ctx.lineTo(11, 11);
  ctx.moveTo(11, -11);
  ctx.lineTo(-11, 11);
  ctx.stroke();
  ctx.fillStyle = "#f2c14e";
  ctx.fillRect(-11, -3, 22, 6);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-11, -3, 22, 6);
}

function bunker(ctx: Ctx, f: Faction) {
  ctx.translate(24, 24);
  sandbags(ctx, 0, 0, 19, Math.PI * 0.55, Math.PI * 1.45);
  const p = new Path2D();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    if (i === 0) p.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
    else p.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
  }
  p.closePath();
  fillStroke(ctx, p, "#a5a090", 2.5);
  ctx.fillStyle = "#0c0c09";
  ctx.fillRect(8, -2.5, 7, 5);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(23, 0);
  ctx.stroke();
  const roof = new Path2D();
  roof.arc(-2, 0, 6, 0, Math.PI * 2);
  fillStroke(ctx, roof, f.css, 1.5);
}

function atNest(ctx: Ctx, f: Faction) {
  ctx.translate(26, 26);
  sandbags(ctx, 0, 0, 19, 0, Math.PI * 2);
  const pit = new Path2D();
  pit.arc(0, 0, 13, 0, Math.PI * 2);
  fillStroke(ctx, pit, "#8a7b55", 1.2);
  const shield = new Path2D("M-4 -8 L4 -5 L4 5 L-4 8 Z");
  fillStroke(ctx, shield, f.css, 1.5);
  const barrel = new Path2D();
  barrel.rect(3, -1.8, 21, 3.6);
  fillStroke(ctx, barrel, "#2b2c26", 1);
}

function aaBase(ctx: Ctx, f: Faction) {
  ctx.translate(24, 24);
  sandbags(ctx, 0, 0, 18, 0, Math.PI * 2);
  const plat = new Path2D();
  plat.arc(0, 0, 12, 0, Math.PI * 2);
  fillStroke(ctx, plat, "#8d887a", 1.5);
  const hub = new Path2D();
  hub.arc(0, 0, 7, 0, Math.PI * 2);
  fillStroke(ctx, hub, f.css, 1.5);
}

function aaGun(ctx: Ctx) {
  ctx.translate(6, 12);
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (const y of [-7, -2.5, 2.5, 7]) {
    ctx.moveTo(0, y * 0.5);
    ctx.lineTo(22, y);
  }
  ctx.stroke();
}

function chute(ctx: Ctx) {
  ctx.translate(28, 28);
  const c = new Path2D();
  c.arc(0, 0, 25, 0, Math.PI * 2);
  fillStroke(ctx, c, "#f4f1e6", 1.8);
  ctx.strokeStyle = "#a49e88";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    ctx.moveTo(Math.cos(a) * 25, Math.sin(a) * 25);
    ctx.lineTo(-Math.cos(a) * 25, -Math.sin(a) * 25);
  }
  ctx.stroke();
  const g = ctx.createRadialGradient(-8, -8, 2, 0, 0, 26);
  g.addColorStop(0, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = g;
  ctx.fill(c);
}

// ---------------------------------------------------------------- 特效素材

/** 用很多顆不規則的小圓疊出一團翻騰的雲（火團、煙團共用） */
function billow(ctx: Ctx, size: number, seed: number, rgb: string, alpha: number) {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const c = size / 2;
  const blobs = 18;
  for (let i = 0; i < blobs; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * size * 0.2;
    const r = size * (0.14 + rnd() * 0.16);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(0.65, `rgba(${rgb},${alpha * 0.85})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 邊緣的小泡泡，讓輪廓不是正圓
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    const d = size * (0.26 + rnd() * 0.08);
    const r = size * (0.07 + rnd() * 0.06);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha * 0.9})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function radial(ctx: Ctx, size: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

export function makeTextures(scene: Phaser.Scene) {
  FACTIONS.forEach((f, i) => {
    canvasTex(scene, `soldier${i}`, 18, 18, (c) => soldier(c, f));
    canvasTex(scene, `engineer${i}`, 18, 18, (c) => engineerMan(c, f));
    canvasTex(scene, `medic${i}`, 18, 18, (c) => medicMan(c, f));
    canvasTex(scene, `tank${i}`, 56, 38, (c) => tankHull(c, f));
    canvasTex(scene, `turret${i}`, 48, 22, (c) => tankTurret(c, f));
    canvasTex(scene, `atgun${i}`, 46, 28, (c) => atGun(c, f));
    canvasTex(scene, `howitzer${i}`, 60, 36, (c) => howitzer(c, f));
    canvasTex(scene, `hq${i}`, 120, 120, (c) => hq(c, f));
    canvasTex(scene, `bunker${i}`, 48, 48, (c) => bunker(c, f));
    canvasTex(scene, `fort${i}`, 92, 92, (c) => fort(c, f));
    for (const spec of ["battery", "barracks", "depot", "flak", "hospital"]) canvasTex(scene, `fort${i}_${spec}`, 92, 92, (c) => fort(c, f, spec));
    canvasTex(scene, `sniper${i}`, 24, 18, (c) => sniperMan(c, f));
    canvasTex(scene, `flame${i}`, 20, 18, (c) => flameMan(c, f));
    canvasTex(scene, `car${i}`, 44, 26, (c) => armoredCar(c, f));
    canvasTex(scene, `flakv${i}`, 46, 26, (c) => flakTruck(c, f));
    canvasTex(scene, `atnest${i}`, 52, 52, (c) => atNest(c, f));
    canvasTex(scene, `aa${i}`, 48, 48, (c) => aaBase(c, f));
    canvasTex(scene, `bomber${i}`, 116, 108, (c) => drawPlane(c, BOMBER, f, 1));
    canvasTex(scene, `transport${i}`, 100, 96, (c) => drawPlane(c, TRANSPORT, f, 1));
  });
  canvasTex(scene, "fortNeutral", 92, 92, (c) => fort(c, null));
  // 領土光暈：陣營色往外淡出（直接畫好顏色，Canvas 模式不支援上色也一樣）。
  // 黑鷹旅用灰色（純黑會把地面弄髒）
  ["255,255,255", "79,134,232", "242,107,33", "107,107,107", "255,255,255"].forEach((rgb, j) => {
    const i = j - 1; // glow = 白色（WebGL 用上色）；glow0–3 = 已經上好顏色（Canvas 模式用）
    canvasTex(scene, i < 0 ? "glow" : `glow${i}`, 128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, `rgba(${rgb},1)`);
      g.addColorStop(0.45, `rgba(${rgb},0.7)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    });
  });
  canvasTex(scene, "healplus", 18, 18, (c) => {
    const p = new Path2D();
    p.rect(6.5, 2, 5, 14);
    p.rect(2, 6.5, 14, 5);
    c.fillStyle = "#1d1d17";
    c.fillRect(5.5, 1, 7, 16);
    c.fillRect(1, 5.5, 16, 7);
    c.fillStyle = "#6fe07a";
    c.fill(p);
  });
  canvasTex(scene, "wrench", 18, 18, (c) => {
    c.translate(9, 9);
    c.rotate(-Math.PI / 4);
    c.fillStyle = "#1d1d17";
    c.fillRect(-2.5, -7, 5, 14);
    c.fillStyle = "#ffd34a";
    c.fillRect(-1.5, -6, 3, 12);
    c.beginPath();
    c.arc(0, -6, 3.5, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  });
  canvasTex(scene, "mggun", 28, 14, mgGun);
  canvasTex(scene, "aagun", 30, 24, aaGun);
  canvasTex(scene, "chute", 56, 56, chute);
  canvasTex(scene, "crate", 32, 32, crate);
  canvasTex(scene, "wreck", 56, 38, (c) => {
    c.translate(28, 19);
    for (const y of [-17, 9]) {
      c.fillStyle = "#1e1e1a";
      c.fillRect(-26, y, 50, 8);
    }
    const h = new Path2D();
    h.roundRect(-24, -12, 46, 24, 3);
    fillStroke(c, h, "#3a3832", 2);
    c.fillStyle = "#22211c";
    c.beginPath();
    c.arc(-2, 0, 9, 0, Math.PI * 2);
    c.fill();
  });
  canvasTex(scene, "ruin", 120, 120, (c) => {
    c.translate(60, 60);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 18 + ((i * 37) % 28);
      c.fillStyle = i % 3 === 0 ? "#5e5a4e" : "#8d887a";
      c.strokeStyle = OUT;
      c.lineWidth = 1;
      c.beginPath();
      c.rect(Math.cos(a) * r - 5, Math.sin(a) * r - 4, 10 + (i % 4) * 2, 8);
      c.fill();
      c.stroke();
    }
    c.fillStyle = "rgba(20,18,14,0.55)";
    c.beginPath();
    c.arc(0, 0, 22, 0, Math.PI * 2);
    c.fill();
  });

  canvasTex(scene, "shadow", 64, 32, (c) => {
    const g = c.createRadialGradient(32, 16, 2, 32, 16, 30);
    g.addColorStop(0, "rgba(0,0,0,0.38)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.scale(1, 0.5);
    c.fillRect(0, 0, 64, 64);
  });
  canvasTex(scene, "glow", 64, 64, (c) => radial(c, 64, [[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.6)"], [1, "rgba(255,255,255,0)"]]));
  canvasTex(scene, "fire", 64, 64, (c) =>
    radial(c, 64, [[0, "#fffbe6"], [0.2, "#ffe066"], [0.48, "#ff8a1f"], [0.76, "rgba(200,50,30,0.85)"], [1, "rgba(90,26,12,0)"]]),
  );
  canvasTex(scene, "smoke", 64, 64, (c) => {
    radial(c, 64, [[0, "rgba(60,58,51,0.9)"], [0.6, "rgba(60,58,51,0.45)"], [1, "rgba(60,58,51,0)"]]);
    c.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4;
      c.fillStyle = "rgba(0,0,0,0.18)";
      c.beginPath();
      c.arc(32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20, 9 + (i % 3) * 3, 0, Math.PI * 2);
      c.fill();
    }
  });
  // 翻騰的火團／煙團：白色（之後用 tint 上色，從白熱一路變成黑煙）
  canvasTex(scene, "puff", 96, 96, (c) => billow(c, 96, 1, "255,255,255", 0.95));
  canvasTex(scene, "smokepuff", 96, 96, (c) => {
    billow(c, 96, 7, "86,82,72", 0.9);
    // 左上受光、右下陰影，煙團才有立體感
    c.globalCompositeOperation = "source-atop";
    const g = c.createLinearGradient(10, 10, 86, 86);
    g.addColorStop(0, "rgba(150,144,128,0.55)");
    g.addColorStop(0.5, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(20,18,14,0.45)");
    c.fillStyle = g;
    c.fillRect(0, 0, 96, 96);
  });
  canvasTex(scene, "flashstar", 128, 128, (c) => {
    c.translate(64, 64);
    const glow = c.createRadialGradient(0, 0, 0, 0, 0, 60);
    glow.addColorStop(0, "rgba(255,255,240,1)");
    glow.addColorStop(0.3, "rgba(255,240,160,0.7)");
    glow.addColorStop(1, "rgba(255,217,90,0)");
    c.fillStyle = glow;
    c.fillRect(-64, -64, 128, 128);
    c.beginPath();
    for (let i = 0; i < 32; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 16;
      const r = i % 2 === 0 ? (i % 4 === 0 ? 62 : 40) : 15;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = "#ffe066";
    c.fill();
    c.strokeStyle = "rgba(200,50,30,0.7)";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(0, 0, 14, 0, Math.PI * 2);
    c.fill();
  });
  canvasTex(scene, "streak", 32, 6, (c) => {
    const g = c.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, "rgba(255,138,31,0)");
    g.addColorStop(0.5, "rgba(255,200,60,0.9)");
    g.addColorStop(1, "rgba(255,255,230,1)");
    c.fillStyle = "rgba(90,42,0,0.45)";
    c.fillRect(6, 0, 26, 6);
    c.fillStyle = g;
    c.fillRect(0, 1.5, 32, 3);
  });
  canvasTex(scene, "shock", 160, 160, (c) => {
    c.translate(80, 80);
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const r = 66 + Math.sin(i * 1.9) * 5;
      const g = c.createRadialGradient(Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(a) * r, Math.sin(a) * r, 11);
      g.addColorStop(0, "rgba(243,230,187,0.9)");
      g.addColorStop(1, "rgba(216,196,142,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(Math.cos(a) * r, Math.sin(a) * r, 11, 0, Math.PI * 2);
      c.fill();
    }
  });
  canvasTex(scene, "dust", 64, 64, (c) => radial(c, 64, [[0, "rgba(214,196,150,0.85)"], [0.6, "rgba(200,182,136,0.4)"], [1, "rgba(200,182,136,0)"]]));
  canvasTex(scene, "flak", 48, 48, (c) => radial(c, 48, [[0, "rgba(35,34,30,0.95)"], [0.55, "rgba(35,34,30,0.6)"], [1, "rgba(35,34,30,0)"]]));
  canvasTex(scene, "ring", 128, 128, (c) => {
    c.strokeStyle = "rgba(255,248,220,0.95)";
    c.lineWidth = 6;
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgba(255,248,220,0.35)";
    c.lineWidth = 12;
    c.beginPath();
    c.arc(64, 64, 52, 0, Math.PI * 2);
    c.stroke();
  });
  canvasTex(scene, "scorch", 96, 96, (c) => {
    radial(c, 96, [[0, "rgba(30,26,18,0.85)"], [0.5, "rgba(58,50,34,0.55)"], [1, "rgba(94,80,54,0)"]]);
    c.strokeStyle = "rgba(30,26,18,0.5)";
    c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = i * 0.7;
      c.beginPath();
      c.moveTo(48, 48);
      c.lineTo(48 + Math.cos(a) * (30 + (i % 3) * 8), 48 + Math.sin(a) * (30 + (i % 3) * 8));
      c.stroke();
    }
  });
  canvasTex(scene, "crater", 40, 30, (c) => {
    c.fillStyle = "#7c6a45";
    c.beginPath();
    c.ellipse(20, 15, 19, 14, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#5e5036";
    c.beginPath();
    c.ellipse(20, 16, 13, 9, 0, 0, Math.PI * 2);
    c.fill();
  });
  canvasTex(scene, "spark", 10, 3, (c) => {
    c.fillStyle = "#fff2b0";
    c.fillRect(0, 0, 10, 3);
  });
  canvasTex(scene, "debris", 6, 6, (c) => {
    c.fillStyle = "#3a3832";
    c.fillRect(0, 0, 6, 6);
  });
  canvasTex(scene, "px", 4, 4, (c) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 4, 4);
  });
  canvasTex(scene, "bomb", 10, 22, (c) => {
    const b = new Path2D();
    b.ellipse(5, 12, 4, 8, 0, 0, Math.PI * 2);
    fillStroke(c, b, "#3f4139", 1.2);
    c.fillStyle = "#2b2c27";
    c.fillRect(1, 0, 8, 4);
  });
  canvasTex(scene, "shell", 10, 6, (c) => {
    const b = new Path2D();
    b.ellipse(5, 3, 4.5, 2.4, 0, 0, Math.PI * 2);
    fillStroke(c, b, "#ffe066", 1);
  });
  canvasTex(scene, "slot", 40, 40, (c) => {
    c.setLineDash([5, 4]);
    c.strokeStyle = "rgba(29,29,23,0.85)";
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(20, 20, 16, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.beginPath();
    c.arc(20, 20, 14, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = OUT;
    c.fillRect(18, 11, 4, 18);
    c.fillRect(11, 18, 18, 4);
  });
  canvasTex(scene, "target", 128, 128, (c) => {
    c.strokeStyle = "#c8321e";
    c.lineWidth = 5;
    c.setLineDash([12, 8]);
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(64, 20); c.lineTo(64, 44); c.moveTo(64, 84); c.lineTo(64, 108);
    c.moveTo(20, 64); c.lineTo(44, 64); c.moveTo(84, 64); c.lineTo(108, 64);
    c.stroke();
  });
}

export { emblem, shade };
