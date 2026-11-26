// 戰場畫面：把伺服器同步來的狀態畫出來，並加上所有特效。
// 這裡只負責「看」，所有規則都在伺服器（server/src/game/Battle.ts）。
import Phaser from "phaser";
import {
  BOMB,
  BUILD_SLOTS,
  FACTIONS,
  FORT_SPEC_DEFS,
  type FortSpec,
  WORLD_H,
  WORLD_W,
  buildMap,
  lanePoint,
  laneOffsetPoint,
  nearestLanePos,
  nodeDir,
  nodeEnd,
  nodeLanes,
  otherEnd,
  planRoute,
  routePoints,
  slotFits,
  type AirKind,
  type Dest,
  type MapLayout,
  type RouteStart,
  type Vec,
} from "@frontline/shared";
import { isMobile } from "../device";
import { bus, session } from "../session";
import type { AircraftState, NodeState, StructureState, UnitState } from "../types";
import { DEPTH, FIRE_RAMP, Fx, rnd } from "./fx";
import { play } from "./sound";
import { makeTextures } from "./textures";

// 手機畫面小，部隊、工事、字都放大一點比較好認
const M = () => isMobile();
const UNIT_SCALE_DESKTOP = 1.2;
const UNIT_SCALE_MOBILE = 1.75;

// 部隊隊形（本地座標，朝右）
const FORMATION: Record<string, [number, number][]> = {
  rifle: [[7, 0], [-3, -8], [-3, 8], [-13, 0]],
  para: [[7, 0], [-3, -8], [-3, 8], [-13, 0]],
  mg: [[-4, -6], [-7, 6]],
  at: [[-16, -9], [-18, 9]],
  artillery: [[-24, -11], [-26, 11]],
  engineer: [[3, -6], [-4, 6]],
  medic: [[3, -6], [-4, 6]],
  sniper: [[0, 0]],
  flame: [[3, -6], [-4, 6]],
};
const MAN_TEX: Record<string, string> = { engineer: "engineer", medic: "medic", sniper: "sniper", flame: "flame" };
const VEHICLE_TEX: Record<string, string> = { car: "car", flak: "flakv" };

/**
 * 按下去之後的狀態：
 * - dispatch：從自己據點拖出去派兵（點一下 = 選據點）
 * - order：拖曳自己的部隊改目的地（點一下 = 選這一隊）
 * - pan：拖空地移動畫面（點一下 = 選著部隊時派去那裡、不然取消選取）
 * - slot：點路邊的 ＋ 開工事選單（拖曳 = 移動畫面）
 */
interface Drag {
  kind: "dispatch" | "order" | "pan" | "slot";
  node: number; // dispatch：從哪個據點
  units: string[]; // order：哪些部隊
  slot: number; // slot：this.slots 的索引
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean; // 拖超過門檻才算拖曳（不然是點一下）
  via: number[];
  dest: Dest | null;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.2;

interface UnitView {
  c: Phaser.GameObjects.Container;
  men: Phaser.GameObjects.Image[];
  gun?: Phaser.GameObjects.Image;
  turret?: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  chute?: Phaser.GameObjects.Image;
  x: number;
  lane: number;
  shots: number;
  hp: number;
  maxHp: number;
  type: string;
  wx: number;
  wy: number;
  angle: number;
}

interface StructView {
  building: boolean; // 施工中
  img: Phaser.GameObjects.Image;
  gun?: Phaser.GameObjects.Image;
  shots: number;
  airShots: number;
  hp: number;
  maxHp: number;
  kind: string;
  wx: number;
  wy: number;
}

interface NodeView {
  img: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text; // 自己據點的駐軍數
  key: string; // 目前的外觀（換主人時重畫）
  shots: number;
  airShots: number;
  hp: number;
  wx: number;
  wy: number;
  big: boolean;
}

interface AirView {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dropped: boolean;
  smokeT: number;
}

export class BattleScene extends Phaser.Scene {
  private map!: MapLayout;
  private mapId = "";
  private fx!: Fx;
  private ground?: Phaser.GameObjects.Image;
  private territory!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private units = new Map<string, UnitView>();
  private structs = new Map<string, StructView>();
  private planes = new Map<string, AirView>();
  private nodes: NodeView[] = [];
  private slots: { img: Phaser.GameObjects.Image; lane: number; node: number; slot: number; wx: number; wy: number }[] = [];
  private slotKey = "";
  private markers: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private crates = new Map<string, { img: Phaser.GameObjects.Image; chute: Phaser.GameObjects.Image }>();
  private warns: { x: number; y: number; start: number; until: number }[] = [];
  private weather!: Phaser.GameObjects.Graphics;
  private warnG!: Phaser.GameObjects.Graphics;
  private nextThunder = 0;
  private airShotsSeen = new Map<string, number>();
  private wrecks: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private crosshair!: Phaser.GameObjects.Image;
  private preview!: Phaser.GameObjects.Graphics;
  private previewText!: Phaser.GameObjects.Text;
  private drag: Drag | null = null;
  private pinch: { dist: number; zoom: number; wx: number; wy: number } | null = null;
  private gesture = false; // 雙指手勢進行中：放開前不當成點擊
  private zoomBtn: HTMLElement | null = null;
  private clock = 0;
  private unitScale = UNIT_SCALE_DESKTOP;
  private offs: (() => void)[] = [];

  constructor() {
    super("battle");
  }

  create() {
    makeTextures(this);
    this.unitScale = M() ? UNIT_SCALE_MOBILE : UNIT_SCALE_DESKTOP;
    this.cameras.main.setBackgroundColor("#7f9a4e");
    this.fx = new Fx(this);
    this.fx.scale = M() ? 1.3 : 1;
    this.territory = this.add.graphics().setDepth(DEPTH.territory);
    this.bars = this.add.graphics().setDepth(DEPTH.bars);
    this.crosshair = this.add.image(0, 0, "target").setDepth(DEPTH.overlay).setVisible(false);
    this.preview = this.add.graphics().setDepth(DEPTH.overlay);
    this.weather = this.add.graphics().setDepth(DEPTH.airFx + 2);
    this.warnG = this.add.graphics().setDepth(DEPTH.overlay - 1);
    this.previewText = this.add
      .text(0, 0, "", {
        fontFamily: '"Noto Sans TC", sans-serif',
        fontSize: M() ? "26px" : "16px",
        fontStyle: "900",
        color: "#f2c14e",
        stroke: "#1d1d17",
        strokeThickness: M() ? 7 : 5,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.overlay + 1)
      .setVisible(false);

    this.input.addPointer(2);
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on("pointerupoutside", (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const w = this.toWorld(p.x, p.y);
      this.setView(this.cameras.main.zoom * (dy > 0 ? 0.87 : 1.15), w.x, w.y, p.x, p.y);
    });
    // 「全圖」按鈕：放大後才出現
    this.zoomBtn = document.getElementById("btn-zoom");
    const resetZoom = () => this.setView(1, WORLD_W / 2, WORLD_H / 2, WORLD_W / 2, WORLD_H / 2);
    this.zoomBtn?.addEventListener("click", resetZoom);
    this.events.once("shutdown", () => this.zoomBtn?.removeEventListener("click", resetZoom));

    this.offs.push(
      bus.on("bomb", (m: { lane: number; x: number }) => this.onBomb(m)),
      bus.on("barrageMark", (m: { lane: number; x: number; delay: number }) => this.onBarrageMark(m)),
      bus.on("crateTaken", (m: { id: string; lane: number; x: number; faction: number }) => this.onCrateTaken(m)),
      bus.on("built", (m: { id: string }) => this.onBuilt(m)),
      bus.on("converted", (m: { node: number }) => {
        const nd = this.map?.nodes[m.node];
        if (nd) this.fx.dustRing(nd.x, nd.y, 1.4);
      }),
      bus.on("airDown", (m: { x: number; y: number; angle: number; kind: AirKind; faction: number }) => this.onAirDown(m)),
      bus.on("airIncoming", (m: { lane: number; x: number; kind: AirKind }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { node: number }) => this.onEliminated(m)),
      bus.on("captured", (m: { node: number; faction: number }) => this.onCaptured(m)),
      bus.on("fortFallen", (m: { node: number }) => this.onFortFallen(m)),
      bus.on("paradrop", () => play("plane", 0.6)),
      bus.on("newBattle", () => (this.mapId = "")),
      bus.on("cancelDrag", () => this.endDrag()),
    );
    this.events.once("shutdown", () => this.offs.forEach((f) => f()));
  }

  // ================================================================ 地圖

  private setupMap(id: string) {
    this.mapId = id;
    this.map = buildMap(id);
    this.units.forEach((v) => {
      v.c.destroy();
      v.shadow.destroy();
      v.chute?.destroy();
    });
    this.units.clear();
    this.structs.forEach((v) => {
      v.img.destroy();
      v.gun?.destroy();
    });
    this.structs.clear();
    this.planes.forEach((v) => {
      v.img.destroy();
      v.shadow.destroy();
    });
    this.planes.clear();
    this.nodes.forEach((n) => {
      n.img.destroy();
      n.label.destroy();
      n.badge.destroy();
    });
    this.endDrag();
    this.nodes = [];
    this.slots.forEach((s) => s.img.destroy());
    this.slots = [];
    this.slotKey = "";
    this.crates.forEach((c) => {
      c.img.destroy();
      c.chute.destroy();
    });
    this.crates.clear();
    this.warns = [];

    const key = `ground-${id}`;
    if (!this.textures.exists(key)) this.paintGround(key);
    this.ground?.destroy();
    this.ground = this.add.image(0, 0, key).setOrigin(0).setDepth(DEPTH.ground);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.setView(1, WORLD_W / 2, WORLD_H / 2, WORLD_W / 2, WORLD_H / 2);

    this.map.nodes.forEach((nd) => {
      const img = this.add.image(nd.x, nd.y, "fortNeutral").setDepth(DEPTH.structure);
      const below = nd.y < 300;
      const hq = nd.kind === "hq";
      const label = this.add
        .text(nd.x, nd.y + (below ? 1 : -1) * (hq ? (M() ? 96 : 80) : M() ? 66 : 52), "", {
          fontFamily: '"Noto Sans TC", sans-serif',
          fontSize: M() ? (hq ? "30px" : "24px") : hq ? "18px" : "14px",
          fontStyle: "900",
          color: "#ffffff",
          stroke: "#1d1d17",
          strokeThickness: M() ? 7 : 5,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.bars + 1);
      const badge = this.add
        .text(nd.x + (hq ? 44 : 30) * (M() ? 1.2 : 1), nd.y - (hq ? 40 : 28) * (M() ? 1.2 : 1), "", {
          fontFamily: '"Noto Sans TC", sans-serif',
          fontSize: M() ? "22px" : "13px",
          fontStyle: "900",
          color: "#1b1405",
          backgroundColor: "#f2c14e",
          padding: { x: M() ? 6 : 4, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.bars + 2)
        .setVisible(false);
      this.nodes.push({ img, label, badge, key: "", shots: 0, airShots: 0, hp: 0, wx: nd.x, wy: nd.y, big: !!nd.big || hq });
    });
  }

  /** 畫一次整張地面（地形、河流、湖、山、道路、橋、樹），之後當成一張圖用 */
  private paintGround(key: string) {
    const def = this.map.def;
    const tex = this.textures.createCanvas(key, WORLD_W, WORLD_H)!;
    const c = tex.getContext();
    const rand = mulberry(def.id.length * 977 + def.nodes.length * 13);
    const R = (a: number, b: number) => a + rand() * (b - a);
    const theme = def.theme;

    const base = { grass: "#a9c46c", river: "#a3c26a", desert: "#e2cf97", highland: "#b7c28a" }[theme];
    const patches =
      theme === "desert" ? ["rgba(212,189,128,0.55)", "rgba(236,220,170,0.55)"] :
      theme === "highland" ? ["rgba(150,160,110,0.5)", "rgba(200,205,160,0.45)"] :
      ["rgba(143,176,90,0.45)", "rgba(186,208,128,0.45)"];
    c.fillStyle = base;
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let i = 0; i < 90; i++) {
      c.fillStyle = patches[i % 2];
      c.beginPath();
      c.ellipse(R(0, WORLD_W), R(0, WORLD_H), R(40, 170), R(20, 80), R(0, 3), 0, Math.PI * 2);
      c.fill();
    }
    const sand = (x: number, y: number, r: number) => {
      const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, "rgba(226,207,151,1)");
      g.addColorStop(0.7, "rgba(226,207,151,0.8)");
      g.addColorStop(1, "rgba(226,207,151,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    if (theme !== "desert") {
      for (let i = 0; i < 6; i++) sand(R(100, WORLD_W - 100), R(100, WORLD_H - 100), R(80, 170));
      for (const nd of def.nodes) if (nd.kind === "hq") sand(nd.x, nd.y, 120);
    } else {
      // 沙丘紋路
      for (let i = 0; i < 60; i++) {
        const x = R(0, WORLD_W);
        const y = R(0, WORLD_H);
        const w = R(60, 160);
        c.strokeStyle = i % 2 ? "rgba(190,165,105,0.45)" : "rgba(245,232,190,0.6)";
        c.lineWidth = R(2, 4);
        c.beginPath();
        c.moveTo(x - w / 2, y);
        c.quadraticCurveTo(x, y - R(10, 24), x + w / 2, y);
        c.stroke();
      }
    }
    // 細碎草葉／小石子
    for (let i = 0; i < 2600; i++) {
      const x = R(0, WORLD_W);
      const y = R(0, WORLD_H);
      if (theme === "desert") {
        c.fillStyle = rand() < 0.5 ? "rgba(170,150,100,0.5)" : "rgba(250,240,210,0.6)";
        c.fillRect(x, y, 2, 2);
      } else {
        c.strokeStyle = rand() < 0.5 ? "rgba(120,150,70,0.5)" : "rgba(200,220,150,0.45)";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + R(-2, 2), y - R(3, 6));
        c.stroke();
      }
    }

    const strokePath = (pts: Vec[]) => {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    };
    // 河流
    const riverPts = def.river ? smooth(def.river.map(([x, y]) => ({ x, y }))) : [];
    if (riverPts.length) {
      c.lineCap = "round";
      c.lineJoin = "round";
      for (const [w, col] of [[92, "#c9b27a"], [70, "#5f9bbd"], [52, "#6fa8c8"]] as [number, string][]) {
        strokePath(riverPts);
        c.strokeStyle = col;
        c.lineWidth = w;
        c.stroke();
      }
      c.strokeStyle = "rgba(220,240,250,0.55)";
      c.lineWidth = 2;
      for (let k = 0; k < 40; k++) {
        const p = riverPts[Math.floor(R(0, riverPts.length - 1))];
        c.beginPath();
        c.moveTo(p.x + R(-18, 6), p.y);
        c.lineTo(p.x + R(8, 22), p.y + R(-3, 3));
        c.stroke();
      }
    }
    // 湖
    for (const [x, y, rx, ry] of def.lakes ?? []) {
      c.fillStyle = theme === "desert" ? "#8fbf6a" : "#c9b27a";
      c.beginPath();
      c.ellipse(x, y, rx + 12, ry + 10, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#5f9bbd";
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#7fb7d4";
      c.beginPath();
      c.ellipse(x - rx * 0.15, y - ry * 0.15, rx * 0.7, ry * 0.6, 0, 0, Math.PI * 2);
      c.fill();
    }
    // 山脈
    for (const poly of def.mountains ?? []) {
      const pts = poly.map(([x, y]) => ({ x, y }));
      const path = () => {
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
        c.closePath();
      };
      c.fillStyle = "rgba(0,0,0,0.18)";
      c.save();
      c.translate(10, 14);
      path();
      c.fill();
      c.restore();
      path();
      c.fillStyle = "#8d8573";
      c.fill();
      c.strokeStyle = "#5e574a";
      c.lineWidth = 3;
      c.stroke();
      // 山峰：亮面、暗面和積雪（限制在山脈多邊形裡）
      c.save();
      path();
      c.clip();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const peaks = Math.max(4, Math.round(((x1 - x0) * (y1 - y0)) / 9000));
      for (let k = 0; k < peaks; k++) {
        const px = R(x0, x1);
        const py = R(y0, y1);
        const w = R(40, 80);
        const h = R(40, 70);
        c.fillStyle = "#a39b88";
        c.beginPath();
        c.moveTo(px - w, py + h / 2);
        c.lineTo(px, py - h / 2);
        c.lineTo(px, py + h / 2);
        c.closePath();
        c.fill();
        c.fillStyle = "#6f6858";
        c.beginPath();
        c.moveTo(px, py - h / 2);
        c.lineTo(px + w, py + h / 2);
        c.lineTo(px, py + h / 2);
        c.closePath();
        c.fill();
        c.fillStyle = "#f4f6f8";
        c.beginPath();
        c.moveTo(px - w * 0.22, py - h * 0.2);
        c.lineTo(px, py - h / 2);
        c.lineTo(px + w * 0.22, py - h * 0.2);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    // 道路與橋
    const nearRiver = (p: Vec) => riverPts.length > 0 && distToPolyline(p, riverPts) < 44;
    for (const lane of this.map.lanes) {
      c.lineCap = "round";
      c.lineJoin = "round";
      strokePath(lane.pts);
      c.strokeStyle = "#9b804f";
      c.lineWidth = 50;
      c.stroke();
      strokePath(lane.pts);
      c.strokeStyle = theme === "desert" ? "#c4a870" : "#b79a63";
      c.lineWidth = 42;
      c.stroke();
      for (const off of [-8, 8]) {
        c.beginPath();
        for (let x = 0; x <= lane.len; x += 10) {
          const p = laneOffsetPoint(lane, x, off);
          if (x) c.lineTo(p.x, p.y);
          else c.moveTo(p.x, p.y);
        }
        c.strokeStyle = "rgba(140,112,70,0.5)";
        c.lineWidth = 3;
        c.stroke();
      }
      // 經過河流的地方畫木橋
      const bridge: Vec[] = [];
      for (let x = 0; x <= lane.len; x += 4) {
        const p = lanePoint(lane, x);
        if (nearRiver(p)) bridge.push(p);
      }
      if (bridge.length > 1) {
        c.lineCap = "butt";
        strokePath(bridge);
        c.strokeStyle = "#4a3a22";
        c.lineWidth = 58;
        c.stroke();
        strokePath(bridge);
        c.strokeStyle = "#8b6a3e";
        c.lineWidth = 48;
        c.stroke();
        for (let k = 0; k < bridge.length - 1; k += 2) {
          const p = bridge[k];
          const q = bridge[k + 1];
          const a = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2;
          c.strokeStyle = "rgba(60,44,24,0.6)";
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(p.x + Math.cos(a) * 23, p.y + Math.sin(a) * 23);
          c.lineTo(p.x - Math.cos(a) * 23, p.y - Math.sin(a) * 23);
          c.stroke();
        }
      }
    }

    // 樹叢（沙漠是枯灌木）、石頭，避開道路、據點、水和山
    const inPoly = (x: number, y: number, poly: [number, number][]) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const clear = (x: number, y: number, pad: number) => {
      if (nearestLanePos(this.map, x, y).dist < pad) return false;
      if (riverPts.length && distToPolyline({ x, y }, riverPts) < 70) return false;
      if ((def.lakes ?? []).some(([lx, ly, rx, ry]) => ((x - lx) / (rx + 30)) ** 2 + ((y - ly) / (ry + 30)) ** 2 < 1)) return false;
      if ((def.mountains ?? []).some((poly) => inPoly(x, y, poly))) return false;
      return def.nodes.every((nd) => Math.hypot(nd.x - x, nd.y - y) > 100);
    };
    const treeCount = theme === "desert" ? 22 : theme === "highland" ? 45 : 75;
    for (let i = 0; i < treeCount; i++) {
      const x = R(20, WORLD_W - 20);
      const y = R(20, WORLD_H - 20);
      if (!clear(x, y, 60)) continue;
      const n = 1 + Math.floor(rand() * (theme === "desert" ? 2 : 4));
      for (let k = 0; k < n; k++) {
        const tx = x + R(-24, 24);
        const ty = y + R(-18, 18);
        const r = theme === "desert" ? R(8, 13) : R(12, 23);
        c.fillStyle = "rgba(0,0,0,0.16)";
        c.beginPath();
        c.arc(tx + 7, ty + 9, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = theme === "desert" ? "#8a8a4a" : "#4f7d31";
        c.strokeStyle = theme === "desert" ? "#5b5a2c" : "#2f4f1c";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(tx, ty, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = theme === "desert" ? "#a6a660" : "#6a9a40";
        c.beginPath();
        c.arc(tx - r * 0.3, ty - r * 0.3, r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
    }
    // 綠洲的棕櫚樹
    if (theme === "desert") {
      for (const [lx, ly, rx, ry] of def.lakes ?? []) {
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          const x = lx + Math.cos(a) * (rx + 26);
          const y = ly + Math.sin(a) * (ry + 22);
          if (nearestLanePos(this.map, x, y).dist < 34) continue;
          c.fillStyle = "rgba(0,0,0,0.16)";
          c.beginPath();
          c.arc(x + 6, y + 8, 13, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = "#2f5a1c";
          c.lineWidth = 4;
          for (let j = 0; j < 6; j++) {
            const b = (j / 6) * Math.PI * 2 + k;
            c.beginPath();
            c.moveTo(x, y);
            c.quadraticCurveTo(x + Math.cos(b) * 10, y + Math.sin(b) * 10 - 3, x + Math.cos(b) * 15, y + Math.sin(b) * 15);
            c.stroke();
          }
          c.fillStyle = "#6b4a2a";
          c.beginPath();
          c.arc(x, y, 3, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    const rocks = theme === "grass" || theme === "river" ? 30 : 70;
    for (let i = 0; i < rocks; i++) {
      const x = R(20, WORLD_W - 20);
      const y = R(20, WORLD_H - 20);
      if (!clear(x, y, 46)) continue;
      c.fillStyle = theme === "desert" ? "#b9a37a" : "#a5a093";
      c.strokeStyle = theme === "desert" ? "#7a6646" : "#5e5a4e";
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(x, y, R(5, 13), R(4, 9), R(0, 3), 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // 舊彈坑
    for (let i = 0; i < 22; i++) {
      const lane = this.map.lanes[Math.floor(rand() * this.map.lanes.length)];
      const p = laneOffsetPoint(lane, R(lane.len * 0.2, lane.len * 0.8), R(-60, 60));
      if (riverPts.length && distToPolyline(p, riverPts) < 60) continue;
      c.fillStyle = "#7c6a45";
      c.beginPath();
      c.ellipse(p.x, p.y, R(10, 18), R(7, 12), R(0, 3), 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#5e5036";
      c.beginPath();
      c.ellipse(p.x, p.y + 1, R(6, 10), R(4, 7), 0, 0, Math.PI * 2);
      c.fill();
    }
    // 大本營外圍戰壕
    for (const nd of def.nodes) {
      if (nd.kind !== "hq") continue;
      c.strokeStyle = "#7c6a45";
      c.lineWidth = 7;
      c.setLineDash([26, 14]);
      c.beginPath();
      for (let a = 0; a <= 26; a++) {
        const ang = (a / 26) * Math.PI * 2;
        const r = 92 + Math.sin(a * 1.7) * 6;
        const x = nd.x + Math.cos(ang) * r;
        const y = nd.y + Math.sin(ang) * r;
        if (a) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
      c.setLineDash([]);
    }
    tex.refresh();
  }

  // ================================================================ 每一格

  update(_t: number, deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.clock += dt;
    const s = session.state;
    if (!s || s.phase === "lobby" || !s.mapId) {
      this.fx.update(dt);
      return;
    }
    try {
      if (s.mapId !== this.mapId) this.setupMap(s.mapId);
      this.syncNodes();
      this.syncStructures();
      this.syncUnits(dt);
      this.syncAircraft(dt);
      this.drawTerritory();
      this.drawBars();
      this.updateSlots();
      this.updateMarkers();
      this.syncCrates();
      this.drawWarnings();
      this.drawWeather(dt);
    } catch (e) {
      console.error(e); // 單一格出錯不要讓整個畫面停掉
    }
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- 據點

  private syncNodes() {
    const s = session.state!;
    const garrison = new Map<number, number>();
    s.units.forEach((u) => {
      if (u.inNode >= 0 && u.owner === session.myId) garrison.set(u.inNode, (garrison.get(u.inNode) ?? 0) + 1);
    });
    this.nodes.forEach((v, i) => {
      const n = s.nodes[i] as NodeState | undefined;
      if (!n) return;
      const nd = this.map.nodes[i];
      const owned = !!n.owner && n.hp > 0;
      const owner = owned ? s.players.get(n.owner) : undefined;
      const specOn = owned && n.spec && s.time >= n.specAt ? n.spec : "";
      const tex = owned ? (n.kind === "hq" ? `hq${n.faction}` : specOn ? `fort${n.faction}_${specOn}` : `fort${n.faction}`) : "fortNeutral";
      const mine = owner?.id === session.myId;
      let label =
        owned && n.kind === "hq" && owner
          ? M()
            ? mine ? "你的大本營" : owner.name
            : `${FACTIONS[owner.faction].name}・${owner.name}${mine ? "（你）" : ""}`
          : nd.name;
      if (owned && n.kind === "hq" && owner && owner.id === s.leaderId) label = `懸賞・${label}`;
      if (specOn) label += `・${FORT_SPEC_DEFS[specOn as Exclude<FortSpec, "">].name}`;
      const converting = owned && n.spec ? Math.ceil(n.specAt - s.time) : 0;
      if (converting > 0) label += ` 改建${converting}`;
      const grace = owned ? Math.ceil(n.incomeAt - s.time) : 0;
      if (grace > 0) label += ` 整頓${grace}`;
      const key = `${tex}|${label}`;
      if (v.key !== key) {
        v.key = key;
        const scale = (n.kind === "hq" ? 1 : v.big ? 1.3 : 1) * (M() ? 1.15 : 1);
        v.img.setTexture(tex).setScale(scale).setAlpha(owned ? 1 : 0.92);
        v.label.setText(label).setColor(owner ? FACTIONS[owner.faction].light : "#f4f1e6");
        // 靠近地圖邊緣時把名字往內推，不要被切掉
        const half = v.label.width / 2 + 6;
        v.label.setX(Math.max(half, Math.min(WORLD_W - half, nd.x)));
      }
      if (n.shots !== v.shots) {
        v.shots = n.shots;
        this.nodeFired(v, n);
      }
      if (n.airShots !== v.airShots) {
        v.airShots = n.airShots;
        this.fx.flak(n.ax, n.ay);
        play("flak", this.volumeAt(n.ax, n.ay) * 0.6);
      }
      if (owned && n.hp < v.hp - 25) this.fx.impact(v.wx + rnd(-26, 26), v.wy + rnd(-26, 26), 1.1);
      v.hp = n.hp;
      // 自己據點的駐軍人數
      const count = owned && owner?.id === session.myId ? (garrison.get(i) ?? 0) : 0;
      const badgeText = count > 0 ? `駐 ${count}` : "";
      if (v.badge.text !== badgeText) v.badge.setText(badgeText);
      v.badge.setVisible(count > 0);
    });
  }

  private nodeFired(v: NodeView, n: NodeState) {
    const lane = this.map.lanes[n.tl];
    if (!lane) return;
    const tp = laneOffsetPoint(lane, n.tx, rnd(-10, 10));
    const ang = Math.atan2(tp.y - v.wy, tp.x - v.wx);
    const mx = v.wx + Math.cos(ang) * 26;
    const my = v.wy + Math.sin(ang) * 26;
    this.fx.muzzle(mx, my, ang, 1.4);
    this.fx.tracer(mx, my, tp.x, tp.y, true);
    this.fx.explosion(tp.x, tp.y, 0.4);
    play("cannon", this.volumeAt(v.wx, v.wy) * 0.7);
  }

  // ---------------------------------------------------------------- 部隊

  private makeUnit(u: UnitState): UnitView {
    const f = u.faction;
    const c = this.add.container(0, 0).setDepth(DEPTH.unit).setScale(this.unitScale);
    const shadow = this.add
      .image(0, 0, "shadow")
      .setDepth(DEPTH.unitShadow)
      .setScale((u.type === "tank" ? 1 : VEHICLE_TEX[u.type] ? 0.85 : 0.7) * (this.unitScale / UNIT_SCALE_DESKTOP));
    const men: Phaser.GameObjects.Image[] = [];
    const v: UnitView = { c, men, shadow, x: u.x, lane: u.lane, shots: u.shots, hp: u.hp, maxHp: u.maxHp, type: u.type, wx: 0, wy: 0, angle: 0 };
    if (u.type === "tank") {
      v.gun = this.add.image(0, 0, `tank${f}`);
      v.turret = this.add.image(-2, 0, `turret${f}`).setOrigin(12 / 48, 0.5);
      c.add([v.gun, v.turret]);
    } else if (VEHICLE_TEX[u.type]) {
      v.gun = this.add.image(0, 0, `${VEHICLE_TEX[u.type]}${f}`);
      c.add(v.gun);
    } else {
      if (u.type === "mg") v.gun = this.add.image(8, 0, "mggun");
      if (u.type === "at") v.gun = this.add.image(4, 0, `atgun${f}`);
      if (u.type === "artillery") v.gun = this.add.image(2, 0, `howitzer${f}`);
      if (v.gun) c.add(v.gun);
      for (const [x, y] of FORMATION[u.type] ?? FORMATION.rifle) {
        const m = this.add.image(x, y, `${MAN_TEX[u.type] ?? "soldier"}${f}`);
        men.push(m);
        c.add(m);
      }
    }
    if (u.type === "para") v.chute = this.add.image(0, 0, "chute").setDepth(DEPTH.air - 1);
    return v;
  }

  private syncUnits(dt: number) {
    const s = session.state!;
    const seen = new Set<string>();
    s.units.forEach((u) => {
      if (u.inNode >= 0) return; // 駐紮在據點裡：看不到
      seen.add(u.id);
      let v = this.units.get(u.id);
      if (!v) {
        v = this.makeUnit(u);
        this.units.set(u.id, v);
        if (u.landT <= s.time) {
          const lane = this.map.lanes[u.lane];
          if (lane) {
            const p = lanePoint(lane, u.x);
            this.fx.dustRing(p.x, p.y, 0.45);
          }
        }
      }
      if (v.lane !== u.lane || Math.abs(v.x - u.x) > 60) {
        v.lane = u.lane;
        v.x = u.x;
      } else {
        v.x += (u.x - v.x) * Math.min(1, dt * 12);
      }
      const lane = this.map.lanes[u.lane];
      if (!lane) return;
      const p = laneOffsetPoint(lane, v.x, u.oy);
      const angle = p.angle + (u.dir < 0 ? Math.PI : 0);
      v.wx = p.x;
      v.wy = p.y;
      v.angle = angle;
      v.c.setPosition(p.x, p.y).setRotation(angle);
      v.shadow.setPosition(p.x + 3, p.y + 5);

      const left = u.landT - s.time;
      if (v.chute) {
        if (left > 0) {
          const k = Math.min(1, left / 1.6);
          v.chute
            .setVisible(true)
            .setPosition(p.x, p.y - 10 * k)
            .setScale((0.6 + 0.9 * k) * (M() ? 1.3 : 1))
            .setRotation(Math.sin(this.clock * 3 + u.x) * 0.15);
          v.c.setScale(this.unitScale * (0.7 + 0.3 * (1 - k))).setAlpha(0.85);
        } else {
          v.chute.destroy();
          v.chute = undefined;
          v.c.setScale(this.unitScale).setAlpha(1);
          this.fx.dustRing(p.x, p.y, 0.6);
        }
      }

      const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 0;
      if (v.men.length) {
        const visible = Math.max(1, Math.ceil(v.men.length * ratio - 0.01));
        const form = FORMATION[v.type] ?? FORMATION.rifle;
        v.men.forEach((m, i) => {
          m.setVisible(i < visible);
          if (!u.attacking) m.y = form[i][1] + Math.sin(this.clock * 10 + i * 1.7) * 0.8;
        });
      }
      v.hp = u.hp;
      v.maxHp = u.maxHp;
      if (u.shots !== v.shots) {
        v.shots = u.shots;
        this.unitFired(v, u);
      }
      if (u.type === "flak") {
        const seenShots = this.airShotsSeen.get(u.id);
        if (seenShots !== undefined && seenShots !== u.airShots) {
          this.fx.flak(u.ax, u.ay);
          this.fx.tracer(v.wx, v.wy, u.ax, u.ay);
          play("flak", this.volumeAt(u.ax, u.ay) * 0.5);
        }
        this.airShotsSeen.set(u.id, u.airShots);
      }
    });
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      if (!s.units.get(id)) this.unitDied(v); // 還在、只是進駐了就不放陣亡特效
      v.c.destroy();
      v.shadow.destroy();
      v.chute?.destroy();
      this.units.delete(id);
    }
  }

  private unitFired(v: UnitView, u: UnitState) {
    const lane = this.map.lanes[u.tl];
    if (!lane) return;
    const tp = laneOffsetPoint(lane, u.tx, rnd(-10, 10));
    const mx = v.wx + Math.cos(v.angle) * 14;
    const my = v.wy + Math.sin(v.angle) * 14;
    const vol = this.volumeAt(v.wx, v.wy);
    switch (u.type) {
      case "medic": {
        const tp0 = laneOffsetPoint(lane, u.tx, rnd(-8, 8));
        for (let k = 0; k < 3; k++) {
          this.fx.spawn("healplus", tp0.x + rnd(-10, 10), tp0.y + rnd(-6, 6), {
            life: 0.9, s0: 0.9, s1: 1.2, a0: 1, a1: 0, rise: 26, depth: DEPTH.overlay,
          });
        }
        break;
      }
      case "engineer":
        if (u.attacking) {
          // 爆破
          this.fx.explosion(tp.x, tp.y, 0.7);
          play("boom", vol * 0.55);
        } else {
          this.fx.spawn("wrench", tp.x + rnd(-8, 8), tp.y + rnd(-8, 8), { life: 0.7, s0: 1, s1: 1.2, a0: 1, a1: 0, rise: 18, vr: 4, depth: DEPTH.overlay });
          for (let k = 0; k < 4; k++) this.fx.spawn("spark", tp.x, tp.y, { life: 0.3, s0: 1, s1: 0.4, vx: rnd(-60, 60), vy: rnd(-60, 20), tint: 0xffd34a, depth: DEPTH.overlay });
        }
        break;
      case "sniper":
        this.fx.muzzle(mx + 6, my, v.angle, 0.8);
        this.fx.tracer(mx + 6, my, tp.x, tp.y);
        this.fx.impact(tp.x, tp.y, 0.8);
        play("sniper", vol);
        break;
      case "flame": {
        // 火焰：沿著噴射方向一串火球
        const steps = 7;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          this.fx.spawn("puff", mx + (tp.x - mx) * t + rnd(-4, 4), my + (tp.y - my) * t + rnd(-4, 4), {
            life: 0.25 + t * 0.25, s0: 0.12 + t * 0.12, s1: 0.3 + t * 0.25, a0: 1, a1: 0, fade: 0.5, tints: FIRE_RAMP, depth: DEPTH.groundFx,
          });
        }
        this.fx.spawn("smokepuff", tp.x, tp.y, { life: 0.9, s0: 0.15, s1: 0.4, a0: 0.5, a1: 0, rise: 14, depth: DEPTH.groundFx - 1 });
        play("flame", vol * 0.7);
        break;
      }
      case "car":
      case "flak":
        this.fx.muzzle(mx + 10, my, v.angle, 0.7);
        this.fx.tracer(mx + 10, my, tp.x, tp.y);
        this.fx.impact(tp.x, tp.y, 0.5);
        play("mg", vol * 0.45);
        break;
      case "rifle":
      case "para":
        this.fx.muzzle(mx, my, v.angle, 0.6);
        this.fx.tracer(mx, my, tp.x, tp.y);
        this.fx.impact(tp.x, tp.y, 0.5);
        play("rifle", vol * 0.5);
        break;
      case "mg":
        this.fx.muzzle(mx + 6, my, v.angle, 0.7);
        this.fx.tracer(mx, my, tp.x, tp.y);
        this.fx.tracer(mx, my, tp.x + rnd(-8, 8), tp.y + rnd(-8, 8));
        this.fx.impact(tp.x, tp.y, 0.5);
        play("mg", vol * 0.5);
        break;
      case "at":
        this.fx.muzzle(mx + 14, my, v.angle, 1.2);
        this.fx.tracer(mx + 14, my, tp.x, tp.y, true);
        this.fx.explosion(tp.x, tp.y, 0.35);
        play("at", vol);
        break;
      case "tank": {
        const bx = v.wx + Math.cos(v.angle) * 34;
        const by = v.wy + Math.sin(v.angle) * 34;
        this.fx.muzzle(bx, by, v.angle, 1.6);
        this.fx.tracer(bx, by, tp.x, tp.y, true);
        this.fx.explosion(tp.x, tp.y, 0.5);
        if (v.turret) this.tweens.add({ targets: v.turret, x: -7, duration: 60, yoyo: true, ease: "Quad.easeOut" });
        play("cannon", vol);
        break;
      }
      case "artillery": {
        const bx = v.wx + Math.cos(v.angle) * 36;
        const by = v.wy + Math.sin(v.angle) * 36;
        this.fx.muzzle(bx, by, v.angle, 2);
        this.fx.spawn("smokepuff", bx, by, { life: 1.3, s0: 0.18, s1: 0.6, a0: 0.75, a1: 0, fade: 0.3, rise: 10, vx: 14 });
        play("shell", vol);
        this.lobShell(bx, by, tp.x, tp.y, () => {
          this.fx.explosion(tp.x, tp.y, 0.9);
          play("boom", this.volumeAt(tp.x, tp.y) * 0.8);
        });
        break;
      }
    }
  }

  private lobShell(x1: number, y1: number, x2: number, y2: number, done: () => void) {
    const shell = this.add.image(x1, y1, "shell").setDepth(DEPTH.air).setRotation(Math.atan2(y2 - y1, x2 - x1));
    const shadow = this.add.image(x1, y1, "shadow").setDepth(DEPTH.unitShadow).setScale(0.2);
    const o = { t: 0 };
    this.tweens.add({
      targets: o,
      t: 1,
      duration: 650,
      onUpdate: () => {
        const h = Math.sin(o.t * Math.PI);
        const x = x1 + (x2 - x1) * o.t;
        const y = y1 + (y2 - y1) * o.t;
        shell.setPosition(x, y - h * 60).setScale(1 + h * 0.8);
        shadow.setPosition(x, y);
      },
      onComplete: () => {
        shell.destroy();
        shadow.destroy();
        done();
      },
    });
  }

  private unitDied(v: UnitView) {
    const ratio = v.maxHp > 0 ? v.hp / v.maxHp : 0;
    if (ratio > 0.4) return; // 不是被打死（例如陣營被消滅時直接移除）就不放特效
    const vol = this.volumeAt(v.wx, v.wy);
    if (v.type === "tank") {
      this.fx.explosion(v.wx, v.wy, 1.1);
      const w = this.add
        .image(v.wx, v.wy, "wreck")
        .setRotation(v.angle)
        .setDepth(DEPTH.structure - 1)
        .setScale(this.unitScale / UNIT_SCALE_DESKTOP);
      this.wrecks.push({ img: w, until: this.clock + 22 });
      this.fx.burn(v.wx, v.wy, 7);
      play("boom", vol);
    } else if (VEHICLE_TEX[v.type]) {
      this.fx.explosion(v.wx, v.wy, 0.9);
      this.fx.burn(v.wx, v.wy, 4);
      play("boom", vol * 0.8);
    } else if (v.type === "at" || v.type === "artillery") {
      this.fx.explosion(v.wx, v.wy, 0.6);
      play("boom", vol * 0.6);
    } else {
      this.fx.impact(v.wx, v.wy, 1);
      this.fx.spawn("dust", v.wx, v.wy, { life: 0.6, s0: 0.3, s1: 0.7, a0: 0.8, a1: 0, depth: DEPTH.decal + 1 });
    }
  }

  // ---------------------------------------------------------------- 工事

  private syncStructures() {
    const s = session.state!;
    const seen = new Set<string>();
    s.structures.forEach((st) => {
      seen.add(st.id);
      let v = this.structs.get(st.id);
      if (!v) {
        v = this.makeStructure(st);
        this.structs.set(st.id, v);
      }
      const building = st.progress < 1;
      if (building !== v.building) v.building = building;
      v.img.setAlpha(building ? 0.45 + st.progress * 0.35 : 1);
      v.gun?.setAlpha(building ? 0.45 : 1);
      if (building && Math.random() < 0.04) {
        // 施工中：敲打的火花和塵土
        this.fx.spawn("spark", v.wx + rnd(-10, 10), v.wy + rnd(-10, 10), { life: 0.3, s0: 1, s1: 0.4, vx: rnd(-40, 40), vy: rnd(-50, 0), tint: 0xffd34a, depth: DEPTH.overlay });
        this.fx.spawn("dust", v.wx + rnd(-12, 12), v.wy + rnd(-12, 12), { life: 0.6, s0: 0.15, s1: 0.35, a0: 0.5, a1: 0, depth: DEPTH.decal + 1 });
      }
      if (st.shots !== v.shots) {
        v.shots = st.shots;
        this.structureFired(v, st);
      }
      if (st.airShots !== v.airShots) {
        v.airShots = st.airShots;
        this.fx.flak(st.ax, st.ay);
        v.gun?.setRotation(Math.atan2(st.ay - v.wy, st.ax - v.wx));
        play("flak", this.volumeAt(st.ax, st.ay) * 0.6);
      }
      v.hp = st.hp;
      v.maxHp = st.maxHp;
    });
    for (const [id, v] of this.structs) {
      if (seen.has(id)) continue;
      if (v.hp / v.maxHp < 0.5) {
        this.fx.explosion(v.wx, v.wy, 1.3);
        play("boom", this.volumeAt(v.wx, v.wy));
      }
      v.img.destroy();
      v.gun?.destroy();
      this.structs.delete(id);
    }
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (this.clock > w.until) {
        w.img.destroy();
        this.wrecks.splice(i, 1);
      } else if (w.until - this.clock < 3) w.img.setAlpha((w.until - this.clock) / 3);
    }
  }

  private slotPos(lane: number, node: number, slot: number) {
    const geom = this.map.lanes[lane];
    const x = nodeEnd(geom, node) + nodeDir(geom, node) * BUILD_SLOTS[slot];
    const side = (slot === 0 ? 1 : -1) * nodeDir(geom, node);
    return laneOffsetPoint(geom, x, side * 44);
  }

  private makeStructure(st: StructureState): StructView {
    const geom = this.map.lanes[st.lane];
    const p = this.slotPos(st.lane, st.node, st.slot);
    const angle = p.angle + (nodeDir(geom, st.node) < 0 ? Math.PI : 0);
    const img = this.add
      .image(p.x, p.y, `${st.kind}${st.faction}`)
      .setDepth(DEPTH.structure)
      .setRotation(st.kind === "aa" ? 0 : angle)
      .setScale(M() ? 1.35 : 1);
    const v: StructView = { building: st.progress < 1, img, shots: st.shots, airShots: st.airShots, hp: st.hp, maxHp: st.maxHp, kind: st.kind, wx: p.x, wy: p.y };
    if (st.kind === "aa") {
      v.gun = this.add
        .image(p.x, p.y, "aagun")
        .setOrigin(6 / 30, 0.5)
        .setDepth(DEPTH.structure + 1)
        .setRotation(-Math.PI / 4)
        .setScale(M() ? 1.35 : 1);
    }
    this.fx.dustRing(p.x, p.y, 0.8);
    return v;
  }

  private structureFired(v: StructView, st: StructureState) {
    const lane = this.map.lanes[st.tl];
    if (!lane) return;
    const tp = laneOffsetPoint(lane, st.tx, rnd(-10, 10));
    const ang = Math.atan2(tp.y - v.wy, tp.x - v.wx);
    const mx = v.wx + Math.cos(ang) * 22;
    const my = v.wy + Math.sin(ang) * 22;
    const vol = this.volumeAt(v.wx, v.wy);
    if (st.kind === "bunker") {
      this.fx.muzzle(mx, my, ang, 0.8);
      this.fx.tracer(mx, my, tp.x, tp.y);
      this.fx.impact(tp.x, tp.y, 0.5);
      play("mg", vol * 0.5);
    } else {
      this.fx.muzzle(mx, my, ang, 1.4);
      this.fx.tracer(mx, my, tp.x, tp.y, true);
      this.fx.explosion(tp.x, tp.y, 0.45);
      play("at", vol * 0.8);
    }
  }

  // ---------------------------------------------------------------- 空軍

  private syncAircraft(dt: number) {
    const s = session.state!;
    const seen = new Set<string>();
    s.aircraft.forEach((a) => {
      seen.add(a.id);
      let v = this.planes.get(a.id);
      if (!v) {
        const tex = a.kind === "bomber" ? `bomber${a.faction}` : `transport${a.faction}`;
        v = {
          img: this.add.image(a.x, a.y, tex).setDepth(DEPTH.air),
          shadow: this.add.image(a.x, a.y, tex).setDepth(DEPTH.airShadow).setTint(0x000000).setAlpha(0.22).setScale(M() ? 1.0 : 0.8),
          x: a.x,
          y: a.y,
          dropped: a.dropped,
          smokeT: 0,
        };
        this.planes.set(a.id, v);
        play("plane", 0.8);
      }
      v.x += (a.x - v.x) * Math.min(1, dt * 10);
      v.y += (a.y - v.y) * Math.min(1, dt * 10);
      const bob = (M() ? 1.25 : 1) * (1 + Math.sin(this.clock * 2 + a.x * 0.01) * 0.015);
      v.img.setPosition(v.x, v.y).setRotation(a.angle).setScale(bob);
      v.shadow.setPosition(v.x + 40, v.y + 56).setRotation(a.angle);
      if (a.dropped && !v.dropped) {
        v.dropped = true;
        if (a.kind === "bomber") this.dropBombs(a);
      }
      if (a.hp / a.maxHp < 0.6) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = 0.05;
          const back = a.angle + Math.PI;
          this.fx.spawn("smokepuff", v.x + Math.cos(back) * 30 + rnd(-6, 6), v.y + Math.sin(back) * 30 + rnd(-6, 6), {
            life: 1.3, s0: 0.14, s1: 0.5, a0: 0.85, a1: 0, fade: 0.3, vr: rnd(-1, 1), depth: DEPTH.airFx,
          });
          if (a.hp / a.maxHp < 0.3) {
            this.fx.spawn("puff", v.x + rnd(-10, 10), v.y + rnd(-10, 10), { life: 0.35, s0: 0.2, s1: 0.08, tints: FIRE_RAMP, depth: DEPTH.airFx });
          }
        }
      }
    });
    for (const [id, v] of this.planes) {
      if (seen.has(id)) continue;
      v.img.destroy();
      v.shadow.destroy();
      this.planes.delete(id);
    }
  }

  private dropBombs(a: AircraftState) {
    const lane = this.map.lanes[a.lane];
    if (!lane) return;
    for (let i = 0; i < BOMB.count; i++) {
      const offset = (i - (BOMB.count - 1) / 2) * BOMB.spacing;
      const tp = lanePoint(lane, a.tx + offset);
      const start = lanePoint(lane, a.tx);
      const bomb = this.add.image(start.x, start.y, "bomb").setDepth(DEPTH.air - 1).setRotation(a.angle + Math.PI / 2).setScale(1.2);
      this.tweens.add({ targets: bomb, x: tp.x, y: tp.y, scale: 0.5, delay: i * BOMB.interval * 1000, duration: 250, onComplete: () => bomb.destroy() });
    }
    play("whistle", this.volumeAt(a.x, a.y));
  }

  private onBomb(m: { lane: number; x: number }) {
    const lane = this.map?.lanes[m.lane];
    if (!lane) return;
    const p = lanePoint(lane, m.x);
    this.fx.explosion(p.x, p.y, 1.6);
    this.fx.crater(p.x + rnd(-6, 6), p.y + rnd(-6, 6), rnd(0.8, 1.2));
    play("boom", this.volumeAt(p.x, p.y));
  }

  private onAirDown(m: { x: number; y: number; angle: number; kind: AirKind; faction: number }) {
    const img = this.add.image(m.x, m.y, `${m.kind}${m.faction ?? 0}`).setDepth(DEPTH.air).setRotation(m.angle).setTint(0x555555);
    const dx = Math.cos(m.angle) * 140;
    const dy = Math.sin(m.angle) * 140;
    const o = { t: 0 };
    this.tweens.add({
      targets: o,
      t: 1,
      duration: 1300,
      ease: "Quad.easeIn",
      onUpdate: () => {
        img.setPosition(m.x + dx * o.t, m.y + dy * o.t).setRotation(m.angle + o.t * 2.6).setScale(1 - o.t * 0.55);
        this.fx.spawn("puff", img.x + rnd(-8, 8), img.y + rnd(-8, 8), { life: 0.45, s0: 0.28, s1: 0.12, a0: 1, a1: 0, fade: 0.4, tints: FIRE_RAMP, depth: DEPTH.airFx });
        this.fx.spawn("smokepuff", img.x, img.y, { life: 1.6, s0: 0.2, s1: 0.65, a0: 0.85, a1: 0, fade: 0.3, vr: rnd(-1, 1), depth: DEPTH.airFx - 1 });
      },
      onComplete: () => {
        this.fx.explosion(img.x, img.y, 2.2);
        this.fx.burn(img.x, img.y, 5);
        play("bigboom", this.volumeAt(img.x, img.y));
        img.destroy();
      },
    });
    play("flak", 1);
  }

  private onAirIncoming(m: { lane: number; x: number; kind: AirKind }) {
    const lane = this.map?.lanes[m.lane];
    if (!lane) return;
    const p = lanePoint(lane, m.x);
    const img = this.add.image(p.x, p.y, "target").setDepth(DEPTH.overlay).setScale(m.kind === "bomber" ? 1.2 : 0.9).setAlpha(0.9);
    this.markers.push({ img, until: this.clock + 4 });
  }

  private onEliminated(m: { node: number }) {
    const nd = this.map?.nodes[m.node];
    if (!nd) return;
    for (let i = 0; i < 8; i++) {
      this.time.delayedCall(i * 160, () => {
        this.fx.explosion(nd.x + rnd(-50, 50), nd.y + rnd(-50, 50), 1.5 + rnd(0, 1.5));
        if (i % 2 === 0) play("boom", 0.9);
      });
    }
    this.time.delayedCall(1300, () => {
      this.fx.explosion(nd.x, nd.y, 4);
      this.fx.burn(nd.x, nd.y, 12);
      this.cameras.main.flash(250, 255, 240, 200);
      play("bigboom", 1);
    });
  }

  private onCaptured(m: { node: number; faction: number }) {
    const nd = this.map?.nodes[m.node];
    if (!nd) return;
    const color = FACTIONS[m.faction]?.color ?? 0xffffff;
    this.fx.spawn("ring", nd.x, nd.y, { life: 0.7, s0: 0.2, s1: 1.4, a0: 1, a1: 0, tint: color === 0xf2f4f6 ? 0xffffff : color, depth: DEPTH.overlay });
    this.fx.spawn("ring", nd.x, nd.y, { life: 0.9, s0: 0.1, s1: 1.0, a0: 0.8, a1: 0, tint: 0xffe14d, depth: DEPTH.overlay });
    this.fx.spawn("flashstar", nd.x, nd.y, { life: 0.25, s0: 0.3, s1: 0.8, a0: 1, a1: 0, depth: DEPTH.overlay });
    this.fx.dustRing(nd.x, nd.y, 1.4);
  }

  private onFortFallen(m: { node: number }) {
    const nd = this.map?.nodes[m.node];
    if (!nd) return;
    for (let i = 0; i < 4; i++) {
      this.time.delayedCall(i * 140, () => this.fx.explosion(nd.x + rnd(-30, 30), nd.y + rnd(-30, 30), 1.4 + rnd(0, 0.8)));
    }
    this.fx.burn(nd.x, nd.y, 6);
    play("bigboom", this.volumeAt(nd.x, nd.y));
  }

  // ---------------------------------------------------------------- 領土、血條、出兵點

  private drawTerritory() {
    const s = session.state!;
    const g = this.territory;
    g.clear();
    this.map.lanes.forEach((lane, li) => {
      const front = s.fronts[li] ?? lane.len / 2;
      const seg = (from: number, to: number, off = 0) => {
        const pts: Vec[] = [];
        const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 22));
        for (let i = 0; i <= steps; i++) pts.push(laneOffsetPoint(lane, from + ((to - from) * i) / steps, off));
        return pts as unknown as Phaser.Math.Vector2[];
      };
      const paint = (faction: number, from: number, to: number) => {
        if (Math.abs(to - from) < 4) return;
        const col = FACTIONS[faction].color;
        g.lineStyle(40, col, 0.18);
        g.strokePoints(seg(from, to));
        for (const off of [-25, 25]) {
          g.lineStyle(7, 0x1d1d17, 0.5);
          g.strokePoints(seg(from, to, off));
          g.lineStyle(4, col, 1);
          g.strokePoints(seg(from, to, off));
        }
      };
      const pa = session.ownerOf(lane.a);
      const pb = session.ownerOf(lane.b);
      if (pa) paint(pa.faction, 0, front);
      if (pb) paint(pb.faction, front, lane.len);
      // 交戰位置（兩端是不同主人時才畫）
      if ((pa || pb) && pa?.id !== pb?.id) {
        const fp = lanePoint(lane, front);
        const nx = -Math.sin(fp.angle);
        const ny = Math.cos(fp.angle);
        const pulse = 0.7 + Math.sin(this.clock * 6 + li) * 0.3;
        g.lineStyle(9, 0x1d1d17, 0.8);
        g.lineBetween(fp.x - nx * 30, fp.y - ny * 30, fp.x + nx * 30, fp.y + ny * 30);
        g.lineStyle(4, 0xffe14d, pulse);
        g.lineBetween(fp.x - nx * 28, fp.y - ny * 28, fp.x + nx * 28, fp.y + ny * 28);
      }
    });

    // 選到的據點：金色外圈
    const sel = session.selectedNode;
    if (sel >= 0 && session.ownsNode(sel)) {
      const nd = this.map.nodes[sel];
      g.lineStyle(5, 0xf2c14e, 0.6 + Math.sin(this.clock * 5) * 0.3);
      g.strokeCircle(nd.x, nd.y, nd.kind === "hq" ? (M() ? 78 : 66) : M() ? 54 : 46);
    }

    // 選到的部隊：腳下金圈＋目前要走的路
    const chosen = session.selectedUnits;
    if (chosen.length) {
      const pathsDrawn = new Set<string>();
      for (const id of chosen) {
        const v = this.units.get(id);
        const u = s.units.get(id);
        if (!v || !u) continue;
        g.lineStyle(3, 0xf2c14e, 0.95);
        g.strokeCircle(v.wx, v.wy, (u.type === "tank" ? 24 : 18) * (this.unitScale / UNIT_SCALE_DESKTOP));
        const key = `${u.destNode}|${u.destLane}|${Math.round(u.destX)}|${u.mode}`;
        if (pathsDrawn.has(key) || u.mode === "hold") continue;
        pathsDrawn.add(key);
        const pts = this.unitPath(u);
        if (pts.length > 1) {
          const color = u.mode === "retreat" ? 0xffffff : 0xf2c14e;
          g.lineStyle(7, 0x1d1d17, 0.45);
          g.strokePoints(pts as unknown as Phaser.Math.Vector2[]);
          g.lineStyle(3, color, 0.85);
          g.strokePoints(pts as unknown as Phaser.Math.Vector2[]);
          const end = pts[pts.length - 1];
          g.fillStyle(color, 0.9);
          g.fillCircle(end.x, end.y, 7);
        }
      }
    }
  }

  /** 一支部隊接下來要走的路（照伺服器同步的 route 畫） */
  private unitPath(u: UnitState): Vec[] {
    const pts: Vec[] = [];
    const walk = (li: number, from: number, to: number) => {
      const lane = this.map.lanes[li];
      if (!lane) return;
      const n = Math.max(1, Math.ceil(Math.abs(to - from) / 18));
      for (let i = 0; i <= n; i++) pts.push(lanePoint(lane, from + ((to - from) * i) / n));
    };
    const lane = this.map.lanes[u.lane];
    if (!lane) return pts;
    const route: number[] = [];
    for (let i = 0; i < u.route.length; i++) route.push(u.route[i]);
    if (route.length === 0 && u.destNode < 0 && u.destLane === u.lane) {
      walk(u.lane, u.x, u.destX);
      return pts;
    }
    walk(u.lane, u.x, u.dir > 0 ? lane.len : 0);
    let node = u.dir > 0 ? lane.b : lane.a;
    route.forEach((li, i) => {
      const L = this.map.lanes[li];
      if (!L) return;
      const from = nodeEnd(L, node);
      const last = i === route.length - 1;
      walk(li, from, last && u.destNode < 0 && u.destLane === li ? u.destX : L.len - from);
      node = otherEnd(L, node);
    });
    return pts;
  }

  private drawBars() {
    const s = session.state!;
    const g = this.bars;
    g.clear();
    const th = M() ? 7 : 4;
    const hpColor = (r: number) => (r > 0.6 ? 0x7ed957 : r > 0.3 ? 0xffd34a : 0xff5a3c);
    const bar = (x: number, y: number, w: number, ratio: number, color: number, h = th) => {
      g.fillStyle(0x1d1d17, 0.85);
      g.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
      g.fillStyle(color, 1);
      g.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, ratio)), h);
    };
    this.units.forEach((v) => {
      const r = v.maxHp > 0 ? v.hp / v.maxHp : 0;
      if (r < 0.999) bar(v.wx, v.wy - 22 * (this.unitScale / UNIT_SCALE_DESKTOP), M() ? 34 : 22, r, hpColor(r));
    });
    this.structs.forEach((v, id) => {
      const st = s.structures.get(id);
      if (st && st.progress < 1) {
        // 施工：虛線框＋黃色進度條
        const half = M() ? 26 : 20;
        g.lineStyle(2, 0xf2c14e, 0.9);
        for (let k = -half; k < half; k += 8) {
          g.lineBetween(v.wx + k, v.wy - half, v.wx + Math.min(half, k + 4), v.wy - half);
          g.lineBetween(v.wx + k, v.wy + half, v.wx + Math.min(half, k + 4), v.wy + half);
          g.lineBetween(v.wx - half, v.wy + k, v.wx - half, v.wy + Math.min(half, k + 4));
          g.lineBetween(v.wx + half, v.wy + k, v.wx + half, v.wy + Math.min(half, k + 4));
        }
        bar(v.wx, v.wy - half - 10, 40, st.progress, 0xf2c14e);
        return;
      }
      const r = v.maxHp > 0 ? v.hp / v.maxHp : 0;
      if (r < 0.999) bar(v.wx, v.wy - 30, 34, r, hpColor(r));
    });
    for (let i = 0; i < this.nodes.length; i++) {
      const n = s.nodes[i];
      if (!n) continue;
      const nd = this.map.nodes[i];
      const hq = n.kind === "hq";
      if (n.owner && n.hp > 0) {
        const w = hq ? 96 : 62;
        const below = nd.y < 300;
        const off = hq ? (M() ? 68 : 60) : M() ? 50 : 40;
        const y = below ? nd.y + off : nd.y - off - th;
        bar(nd.x, y, w, n.hp / n.maxHp, hpColor(n.hp / n.maxHp), hq ? th + 3 : th);
      }
      // 佔領進度圈
      if (n.progress > 0 && n.capFaction >= 0) {
        const r = M() ? 54 : 46;
        g.lineStyle(11, 0x1d1d17, 0.7);
        g.strokeCircle(nd.x, nd.y, r);
        const col = FACTIONS[n.capFaction].color;
        g.lineStyle(7, col === 0xf2f4f6 ? 0xffffff : col, 1);
        g.beginPath();
        g.arc(nd.x, nd.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, n.progress), false);
        g.strokePath();
      }
    }
  }

  private updateSlots() {
    const s = session.state!;
    const me = session.me();
    const owned: number[] = [];
    if (me && me.alive && s.phase === "playing") {
      for (let i = 0; i < s.nodes.length; i++) {
        const n = s.nodes[i];
        if (n && n.owner === me.id && n.hp > 0) owned.push(i);
      }
    }
    const key = owned.join(",");
    if (key !== this.slotKey) {
      this.slotKey = key;
      this.slots.forEach((sl) => sl.img.destroy());
      this.slots = [];
      for (const node of owned) {
        for (const lane of nodeLanes(this.map, node)) {
          BUILD_SLOTS.forEach((_, slot) => {
            if (!slotFits(this.map.lanes[lane].len, slot)) return;
            const p = this.slotPos(lane, node, slot);
            const img = this.add.image(p.x, p.y, "slot").setDepth(DEPTH.slot).setScale(M() ? 1.5 : 1);
            this.slots.push({ img, lane, node, slot, wx: p.x, wy: p.y });
          });
        }
      }
    }
    for (const sl of this.slots) {
      const taken = s.structures.get(`s${sl.lane}_${sl.node}_${sl.slot}`);
      sl.img.setVisible(!taken).setAlpha(0.6 + Math.sin(this.clock * 4) * 0.25);
    }
  }

  private onBuilt(m: { id: string }) {
    const v = this.structs.get(m.id);
    if (!v) return;
    this.fx.dustRing(v.wx, v.wy, 1);
    this.fx.spawn("ring", v.wx, v.wy, { life: 0.5, s0: 0.2, s1: 0.8, a0: 1, a1: 0, tint: 0xf2c14e, depth: DEPTH.overlay });
    play("deploy", this.volumeAt(v.wx, v.wy) * 0.6);
  }

  /** 補給箱：降落傘吊著落下，落地後閃著等人撿 */
  private syncCrates() {
    const s = session.state!;
    const seen = new Set<string>();
    s.crates?.forEach((c) => {
      seen.add(c.id);
      const lane = this.map.lanes[c.lane];
      if (!lane) return;
      const p = lanePoint(lane, c.x);
      let v = this.crates.get(c.id);
      if (!v) {
        v = {
          img: this.add.image(p.x, p.y, "crate").setDepth(DEPTH.unit + 1).setScale(M() ? 1.5 : 1.1),
          chute: this.add.image(p.x, p.y, "chute").setDepth(DEPTH.air - 1),
        };
        this.crates.set(c.id, v);
        play("plane", 0.5);
      }
      const left = c.landT - s.time;
      if (left > 0) {
        const k = Math.min(1, left / 2.5);
        v.img.setPosition(p.x, p.y - 70 * k).setAlpha(1);
        v.chute.setVisible(true).setPosition(p.x, p.y - 70 * k - 22).setScale((M() ? 1.3 : 1) * (0.7 + 0.3 * k)).setRotation(Math.sin(this.clock * 2) * 0.15);
      } else {
        if (v.chute.visible) {
          v.chute.setVisible(false);
          this.fx.dustRing(p.x, p.y, 0.8);
        }
        v.img.setPosition(p.x, p.y - Math.abs(Math.sin(this.clock * 4)) * 4);
      }
    });
    for (const [id, v] of this.crates) {
      if (seen.has(id)) continue;
      v.img.destroy();
      v.chute.destroy();
      this.crates.delete(id);
    }
    // 落地的補給箱外圍閃金圈
    s.crates?.forEach((c) => {
      if (c.landT > s.time) return;
      const p = lanePoint(this.map.lanes[c.lane], c.x);
      const r = (M() ? 30 : 24) + Math.sin(this.clock * 5) * 4;
      this.bars.lineStyle(3, 0xf2c14e, 0.85);
      this.bars.strokeCircle(p.x, p.y, r);
    });
  }

  private onCrateTaken(m: { id: string; lane: number; x: number; faction: number }) {
    const lane = this.map?.lanes[m.lane];
    if (!lane) return;
    const p = lanePoint(lane, m.x);
    this.fx.spawn("ring", p.x, p.y, { life: 0.6, s0: 0.2, s1: 1.1, a0: 1, a1: 0, tint: 0xf2c14e, depth: DEPTH.overlay });
    for (let k = 0; k < 10; k++) {
      this.fx.spawn("spark", p.x, p.y, { life: 0.6, s0: 1.2, s1: 0.4, vx: rnd(-90, 90), vy: rnd(-120, -20), tint: 0xf2c14e, depth: DEPTH.overlay });
    }
    play("capture", 0.4);
  }

  /** 砲擊彈幕：落彈前的紅圈 */
  private onBarrageMark(m: { lane: number; x: number; delay: number }) {
    const lane = this.map?.lanes[m.lane];
    if (!lane) return;
    const p = lanePoint(lane, m.x);
    this.warns.push({ x: p.x, y: p.y, start: this.clock, until: this.clock + m.delay });
    play("whistle", this.volumeAt(p.x, p.y) * 0.5);
  }

  private drawWarnings() {
    const g = this.warnG;
    g.clear();
    this.warns = this.warns.filter((w) => w.until > this.clock);
    for (const w of this.warns) {
      const t = (this.clock - w.start) / (w.until - w.start);
      const r = 40 * (M() ? 1.1 : 1);
      g.fillStyle(0xff3b2f, 0.12 + t * 0.2);
      g.fillCircle(w.x, w.y, r);
      g.lineStyle(3, 0xff3b2f, 0.6 + Math.sin(this.clock * 20) * 0.3);
      g.strokeCircle(w.x, w.y, r);
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(w.x, w.y, r * (1 - t));
    }
  }

  /** 暴風雨：畫面變暗、斜雨、偶爾打雷 */
  private drawWeather(_dt: number) {
    const g = this.weather;
    g.clear();
    const s = session.state!;
    if (s.event !== "storm") return;
    const view = this.cameras.main.worldView;
    g.fillStyle(0x1b2430, 0.28);
    g.fillRect(view.x, view.y, view.width, view.height);
    g.lineStyle(2, 0xd6e4f0, 0.45);
    const n = 160;
    for (let i = 0; i < n; i++) {
      const seed = i * 97.13;
      const x = view.x + ((seed * 13.7 + this.clock * 340) % view.width);
      const y = view.y + ((seed * 7.3 + this.clock * 900 + i * 31) % view.height);
      g.lineBetween(x, y, x - 8, y + 22);
    }
    if (this.clock > this.nextThunder) {
      if (this.nextThunder > 0) {
        this.cameras.main.flash(120, 230, 235, 255);
        play("bigboom", 0.35);
      }
      this.nextThunder = this.clock + 5 + Math.random() * 7;
    }
  }

  private updateMarkers() {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const left = m.until - this.clock;
      if (left <= 0) {
        m.img.destroy();
        this.markers.splice(i, 1);
        continue;
      }
      m.img.setRotation(this.clock * 1.5).setAlpha(Math.min(1, left) * (0.6 + Math.sin(this.clock * 12) * 0.3));
    }
  }

  // ---------------------------------------------------------------- 輸入

  // ================================================================ 鏡頭（雙指縮放、拖空地移動、滾輪縮放）

  /** 螢幕（遊戲畫布）座標 → 世界座標 */
  private toWorld(sx: number, sy: number) {
    const cam = this.cameras.main;
    return {
      x: (sx - cam.width / 2) / cam.zoom + cam.scrollX + cam.width / 2,
      y: (sy - cam.height / 2) / cam.zoom + cam.scrollY + cam.height / 2,
    };
  }

  /** 縮放到 zoom，並讓世界座標 (wx, wy) 留在畫布座標 (sx, sy) 底下 */
  private setView(zoom: number, wx: number, wy: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    cam.setZoom(z);
    cam.scrollX = wx - (sx - cam.width / 2) / z - cam.width / 2;
    cam.scrollY = wy - (sy - cam.height / 2) / z - cam.height / 2;
    this.clampCamera();
  }

  private clampCamera() {
    const cam = this.cameras.main;
    const z = cam.zoom;
    const mx = Math.max(0, WORLD_W / 2 - WORLD_W / (2 * z));
    const my = Math.max(0, WORLD_H / 2 - WORLD_H / (2 * z));
    cam.scrollX = Math.max(-mx, Math.min(mx, cam.scrollX));
    cam.scrollY = Math.max(-my, Math.min(my, cam.scrollY));
    this.zoomBtn?.classList.toggle("hidden", z < 1.02);
  }

  /** 1 個世界單位在螢幕上是幾個 CSS 像素 */
  private cssPerWorld() {
    const rect = this.game.canvas.getBoundingClientRect();
    return (rect.width / this.scale.width) * this.cameras.main.zoom;
  }

  /** 點擊範圍：物件本身大小（世界座標）和手指最小可點範圍（螢幕像素）取大的；放大後就能點得很準 */
  private touchR(objR: number, minCss: number) {
    return Math.max(objR, minCss / Math.max(0.05, this.cssPerWorld()));
  }

  private touches() {
    return [this.input.pointer1, this.input.pointer2].filter((pt): pt is Phaser.Input.Pointer => !!pt && pt.isDown);
  }

  private updatePinch() {
    const [a, b] = this.touches();
    if (!a || !b) return;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (!this.pinch) {
      const w = this.toWorld(mx, my);
      this.pinch = { dist, zoom: this.cameras.main.zoom, wx: w.x, wy: w.y };
      return;
    }
    // 兩指距離決定縮放、兩指中點決定位置（手指下的地圖跟著手指走）
    this.setView(this.pinch.zoom * (dist / this.pinch.dist), this.pinch.wx, this.pinch.wy, mx, my);
  }

  // ================================================================ 點擊／拖曳
  // - 點自己的據點 = 選這個據點（右邊面板買兵、選數量）；從據點拖出去 = 派兵，放開的地方是目的地
  // - 點自己的部隊 = 選整隊；拖曳部隊 = 改目的地；選著部隊時點地圖 = 直接派去那裡
  // - 拖曳途中經過的據點會變成必經點；拖空地 = 移動畫面
  // 部隊、據點、工事位重疊時，看點的位置離誰的中心比較近（用各自的點擊範圍換算）

  private nodeR(i: number) {
    const nd = this.map.nodes[i];
    return (nd.kind === "hq" ? 50 : nd.big ? 44 : 34) * (M() ? 1.15 : 1);
  }

  /** core = 只算據點本身的大小（選著部隊點地圖時用，避免點路上卻被當成點據點） */
  private hitNode(wx: number, wy: number, core = false): { index: number; score: number } | null {
    let best: { index: number; score: number } | null = null;
    this.map.nodes.forEach((nd, i) => {
      const r = core ? this.nodeR(i) : this.touchR(this.nodeR(i), M() ? 22 : 12);
      const score = Math.hypot(wx - nd.x, wy - nd.y) / r;
      if (score <= 1 && (!best || score < best.score)) best = { index: i, score };
    });
    return best;
  }

  /** strict = 已經選著別的部隊時，旁邊的兵要點得很準才算 */
  private hitOwnUnit(wx: number, wy: number, strict: boolean): { unit: UnitState; score: number } | null {
    const s = session.state!;
    const ratio = this.unitScale / UNIT_SCALE_DESKTOP;
    let best: { unit: UnitState; score: number } | null = null;
    this.units.forEach((v, id) => {
      const u = s.units.get(id);
      if (!u || u.owner !== session.myId || u.inNode >= 0 || u.landT > s.time) return;
      const objR = (u.type === "tank" ? 20 : 15) * ratio;
      const selected = session.selectedUnits.includes(id);
      const r = this.touchR(objR, M() ? 18 : 10) * (strict && !selected ? 0.55 : 1);
      const score = Math.hypot(wx - v.wx, wy - v.wy) / r;
      if (score <= 1 && (!best || score < best.score)) best = { unit: u, score };
    });
    return best;
  }

  private hitSlot(wx: number, wy: number): { index: number; score: number } | null {
    let best: { index: number; score: number } | null = null;
    this.slots.forEach((sl, i) => {
      if (!sl.img.visible) return;
      const r = this.touchR(18 * (M() ? 1.5 : 1), M() ? 18 : 10);
      const score = Math.hypot(wx - sl.wx, wy - sl.wy) / r;
      if (score <= 1 && (!best || score < best.score)) best = { index: i, score };
    });
    return best;
  }

  /** 選一整隊（同一個編號的部隊） */
  private selectGroup(u: UnitState) {
    const s = session.state!;
    const ids: string[] = [];
    if (u.group) {
      s.units.forEach((o) => {
        if (o.owner === session.myId && o.group === u.group && o.inNode < 0) ids.push(o.id);
      });
    }
    session.selectedUnits = ids.length ? ids : [u.id];
    bus.emit("unitsSelected", session.selectedUnits);
    play("click", 0.6);
  }

  /** 世界座標上的目的地：據點或路上的位置 */
  private destAt(wx: number, wy: number, core = false): Dest | null {
    const node = this.hitNode(wx, wy, core);
    if (node) return { node: node.index };
    const hit = nearestLanePos(this.map, wx, wy);
    if (hit.dist > this.touchR(30, M() ? 26 : 16)) return null;
    return { lane: hit.lane, x: hit.x };
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (!this.map) return;
    // 第二根手指放下：開始雙指縮放，取消正在進行的拖曳
    if (this.touches().length >= 2) {
      this.endDrag();
      this.gesture = true;
      this.pinch = null;
      this.updatePinch();
      return;
    }
    const w = this.toWorld(p.x, p.y);
    const base = { node: -1, units: [] as string[], slot: -1, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, active: false, via: [] as number[], dest: null };
    const playing = session.state?.phase === "playing" && !!session.me()?.alive;
    if (!playing) {
      this.drag = { kind: "pan", ...base };
      return;
    }
    if (p.rightButtonDown()) {
      session.airMode = null;
      bus.emit("airMode", null);
      this.crosshair.setVisible(false);
      this.clearUnitSelection();
      return;
    }
    if (session.airMode) {
      const hit = nearestLanePos(this.map, w.x, w.y);
      if (hit.dist > this.touchR(60, M() ? 40 : 24)) {
        bus.emit("toast", "請點在道路上");
        return;
      }
      session.send("air", { kind: session.airMode, lane: hit.lane, x: hit.x });
      session.airMode = null;
      bus.emit("airMode", null);
      this.crosshair.setVisible(false);
      return;
    }
    bus.emit("buildMenu", null);
    const hasSel = session.selectedUnits.length > 0;
    const unit = this.hitOwnUnit(w.x, w.y, hasSel);
    const node = this.hitNode(w.x, w.y, hasSel);
    const ownNode = node && session.ownsNode(node.index) ? node : null;
    const slot = hasSel ? null : this.hitSlot(w.x, w.y);
    // 重疊時選最靠近中心的那個
    const cands: { kind: Drag["kind"]; score: number }[] = [];
    if (unit) cands.push({ kind: "order", score: unit.score });
    if (ownNode) cands.push({ kind: "dispatch", score: ownNode.score });
    if (slot) cands.push({ kind: "slot", score: slot.score * 1.1 });
    cands.sort((a, b) => a.score - b.score);
    const pick = cands[0]?.kind ?? "pan";
    if (pick === "order" && unit) {
      if (!session.selectedUnits.includes(unit.unit.id)) this.selectGroup(unit.unit);
      this.drag = { ...base, kind: "order", units: [...session.selectedUnits] };
    } else if (pick === "dispatch" && ownNode) {
      this.drag = { ...base, kind: "dispatch", node: ownNode.index };
    } else if (pick === "slot" && slot) {
      this.drag = { ...base, kind: "slot", slot: slot.index };
    } else {
      this.drag = { ...base, kind: "pan" };
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (!this.map) return;
    if (this.gesture) {
      this.updatePinch();
      return;
    }
    const w = this.toWorld(p.x, p.y);
    if (session.airMode) {
      const hit = nearestLanePos(this.map, w.x, w.y);
      const pos = lanePoint(this.map.lanes[hit.lane], hit.x);
      this.crosshair.setVisible(true).setPosition(pos.x, pos.y).setScale(session.airMode === "bomber" ? 1.2 : 0.9).setRotation(this.clock);
      return;
    }
    this.crosshair.setVisible(false);
    const d = this.drag;
    if (!d || !p.isDown) return;
    if (!d.active) {
      const rect = this.game.canvas.getBoundingClientRect();
      const cssPerPx = rect.width / this.scale.width;
      if (Math.hypot(p.x - d.startX, p.y - d.startY) * cssPerPx < (M() ? 10 : 6)) return;
      d.active = true;
      bus.emit("buildMenu", null);
    }
    if (d.kind === "pan" || d.kind === "slot") {
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - d.lastX) / cam.zoom;
      cam.scrollY -= (p.y - d.lastY) / cam.zoom;
      this.clampCamera();
      d.lastX = p.x;
      d.lastY = p.y;
      return;
    }
    // 經過的據點變成必經點（出發點和最後一個必經點不重複加）
    const over = this.hitNode(w.x, w.y, true);
    if (over && over.index !== d.node && d.via[d.via.length - 1] !== over.index) d.via.push(over.index);
    d.dest = this.destAt(w.x, w.y);
    this.drawPreview(w.x, w.y);
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    if (this.gesture) {
      // 雙指手勢：全部手指都放開才結束，期間不算點擊
      this.pinch = null;
      if (this.touches().length === 0) this.gesture = false;
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    this.preview.clear();
    this.previewText.setVisible(false);
    if (!d || !this.map || session.state?.phase !== "playing" || !session.me()?.alive) return;
    const w = this.toWorld(p.x, p.y);
    if (!d.active) {
      // 只是點一下
      if (d.kind === "dispatch") {
        if (session.selectedUnits.length) this.sendOrder(session.selectedUnits, [], { node: d.node });
        else this.selectNode(d.node);
      } else if (d.kind === "slot") {
        const sl = this.slots[d.slot];
        if (!sl) return;
        const rect = this.game.canvas.getBoundingClientRect();
        bus.emit("buildMenu", {
          lane: sl.lane, node: sl.node, slot: sl.slot,
          x: rect.left + (p.x / this.scale.width) * rect.width,
          y: rect.top + (p.y / this.scale.height) * rect.height,
        });
      } else if (d.kind === "pan" && session.selectedUnits.length) {
        // 選著部隊點地圖：據點要點在據點本身上，不然就是路上的那個位置
        const dest = this.destAt(w.x, w.y, true);
        if (dest) this.sendOrder(session.selectedUnits, [], dest);
        else this.clearUnitSelection();
      }
      return;
    }
    if (d.kind === "pan" || d.kind === "slot") return;
    const dest = d.dest ?? this.destAt(w.x, w.y);
    if (!dest) {
      bus.emit("toast", "放在道路或據點上才能派兵");
      return;
    }
    // 放開的地方如果就是最後一個必經點，就不算必經點
    const via = d.via.filter((v, i) => !(i === d.via.length - 1 && "node" in dest && dest.node === v));
    if (d.kind === "dispatch") {
      if ("node" in dest && dest.node === d.node) return;
      this.selectNode(d.node, false);
      const counts = session.picks.slice();
      session.send("dispatch", { node: d.node, counts, via, dest, enter: session.enter });
      session.clearPicks();
      bus.emit("picksChanged");
      play("deploy", 0.8);
    } else {
      this.sendOrder(d.units, via, dest);
    }
  }

  private sendOrder(units: string[], via: number[], dest: Dest) {
    session.send("order", { units, via, dest, enter: session.enter });
    play("deploy", 0.6);
    const pos = "node" in dest ? this.map.nodes[dest.node] : lanePoint(this.map.lanes[dest.lane], dest.x);
    this.fx.spawn("ring", pos.x, pos.y, { life: 0.45, s0: 0.15, s1: 0.5, a0: 1, a1: 0, tint: 0xf2c14e, depth: DEPTH.overlay });
  }

  private selectNode(node: number, sound = true) {
    if (session.selectedNode !== node) {
      session.selectedNode = node;
      session.clearPicks();
    }
    bus.emit("nodeSelected", node);
    if (sound) play("click", 0.6);
  }

  private clearUnitSelection() {
    if (!session.selectedUnits.length) return;
    session.selectedUnits = [];
    bus.emit("unitsSelected", []);
  }

  private endDrag() {
    this.drag = null;
    this.preview?.clear();
    this.previewText?.setVisible(false);
  }

  /** 拖曳中的路線預覽 */
  private drawPreview(wx: number, wy: number) {
    const d = this.drag;
    const g = this.preview;
    g.clear();
    if (!d) return;
    const s = session.state!;
    let start: RouteStart | null = null;
    if (d.kind === "dispatch") start = { node: d.node };
    else {
      const u = s.units.get(d.units[0]);
      if (u && u.inNode < 0) start = { lane: u.lane, x: u.x };
    }
    // 必經點
    d.via.forEach((v, i) => {
      const nd = this.map.nodes[v];
      g.lineStyle(4, 0x1d1d17, 0.8);
      g.strokeCircle(nd.x, nd.y, 22);
      g.lineStyle(3, 0xf2c14e, 1);
      g.strokeCircle(nd.x, nd.y, 22);
      g.fillStyle(0xf2c14e, 1);
      g.fillCircle(nd.x + 18, nd.y - 18, 9);
      void i;
    });
    const dest = d.dest;
    if (!start || !dest) {
      g.lineStyle(3, 0xff5a3c, 0.8);
      g.strokeCircle(wx, wy, 14);
      this.previewText.setVisible(true).setPosition(wx, wy - 22).setText("放在道路或據點上").setColor("#ff9a5c");
      return;
    }
    const plan = planRoute(this.map, start, d.via, dest);
    if (!plan) {
      this.previewText.setVisible(true).setPosition(wx, wy - 22).setText("走不到這裡").setColor("#ff9a5c");
      return;
    }
    const pts = routePoints(this.map, start, plan, dest);
    if (pts.length > 1) {
      const line = pts as unknown as Phaser.Math.Vector2[];
      g.lineStyle(12, 0x1d1d17, 0.55);
      g.strokePoints(line);
      g.lineStyle(6, 0xf2c14e, 0.95);
      g.strokePoints(line);
      // 流動的箭頭
      for (let k = 0; k < pts.length - 1; k += 4) {
        const a = pts[k];
        const b = pts[k + 1];
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        g.fillStyle(0x1d1d17, 0.9);
        g.fillTriangle(
          a.x + Math.cos(ang) * 7, a.y + Math.sin(ang) * 7,
          a.x + Math.cos(ang + 2.4) * 6, a.y + Math.sin(ang + 2.4) * 6,
          a.x + Math.cos(ang - 2.4) * 6, a.y + Math.sin(ang - 2.4) * 6,
        );
      }
    }
    const end = "node" in dest ? this.map.nodes[dest.node] : lanePoint(this.map.lanes[dest.lane], dest.x);
    g.lineStyle(5, 0x1d1d17, 0.9);
    g.strokeCircle(end.x, end.y, "node" in dest ? 40 : 16);
    g.lineStyle(3, 0xf2c14e, 1);
    g.strokeCircle(end.x, end.y, "node" in dest ? 40 : 16);
    // 說明文字
    let text: string;
    if ("node" in dest) {
      const owner = session.ownerOf(dest.node);
      const name = this.map.nodes[dest.node].name;
      if (owner?.id === session.myId) text = session.enter ? `進駐 ${name}` : `守在 ${name}`;
      else text = `${owner ? "進攻" : "佔領"} ${name}${session.enter ? "（佔下後進駐）" : ""}`;
    } else text = "在這裡駐守";
    if (d.kind === "dispatch") {
      const total = session.picks.reduce((a, b) => a + b, 0);
      text = `${total > 0 ? `派 ${total} 支` : "全部派出"}・${text}`;
    } else text = `${d.units.length} 支・${text}`;
    this.previewText.setVisible(true).setPosition(end.x, end.y - ("node" in dest ? 46 : 22)).setText(text).setColor("#f2c14e");
  }

  private volumeAt(x: number, y: number) {
    const cam = this.cameras.main;
    const d = Math.hypot(x - cam.midPoint.x, y - cam.midPoint.y);
    return Math.max(0.15, 1 - d / 1400);
  }
}

function smooth(points: Vec[]): Vec[] {
  const out: Vec[] = [];
  const pts = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let k = 0; k < 12; k++) {
      const t = k / 12;
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

function distToPolyline(p: Vec, pts: Vec[]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
    if (d < best) best = d;
  }
  return best;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
