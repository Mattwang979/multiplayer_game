// 戰場畫面：把伺服器同步來的狀態畫出來，並加上所有特效。
// 這裡只負責「看」，所有規則都在伺服器（server/src/game/Battle.ts）。
import Phaser from "phaser";
import {
  BOMB,
  BUILD_SLOTS,
  FACTIONS,
  WORLD_H,
  WORLD_W,
  buildMap,
  lanePoint,
  laneOffsetPoint,
  nearestLanePos,
  nodeDir,
  nodeEnd,
  nodeLanes,
  slotFits,
  type AirKind,
  type MapLayout,
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
};

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
  private wrecks: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private crosshair!: Phaser.GameObjects.Image;
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

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onPointerMove(p));

    this.offs.push(
      bus.on("bomb", (m: { lane: number; x: number }) => this.onBomb(m)),
      bus.on("airDown", (m: { x: number; y: number; angle: number; kind: AirKind; faction: number }) => this.onAirDown(m)),
      bus.on("airIncoming", (m: { lane: number; x: number; kind: AirKind }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { node: number }) => this.onEliminated(m)),
      bus.on("captured", (m: { node: number; faction: number }) => this.onCaptured(m)),
      bus.on("fortFallen", (m: { node: number }) => this.onFortFallen(m)),
      bus.on("paradrop", () => play("plane", 0.6)),
      bus.on("newBattle", () => (this.mapId = "")),
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
    });
    this.nodes = [];
    this.slots.forEach((s) => s.img.destroy());
    this.slots = [];
    this.slotKey = "";

    const key = `ground-${id}`;
    if (!this.textures.exists(key)) this.paintGround(key);
    this.ground?.destroy();
    this.ground = this.add.image(0, 0, key).setOrigin(0).setDepth(DEPTH.ground);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

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
      this.nodes.push({ img, label, key: "", shots: 0, airShots: 0, hp: 0, wx: nd.x, wy: nd.y, big: !!nd.big || hq });
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
    } catch (e) {
      console.error(e); // 單一格出錯不要讓整個畫面停掉
    }
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- 據點

  private syncNodes() {
    const s = session.state!;
    this.nodes.forEach((v, i) => {
      const n = s.nodes[i] as NodeState | undefined;
      if (!n) return;
      const nd = this.map.nodes[i];
      const owned = !!n.owner && n.hp > 0;
      const owner = owned ? s.players.get(n.owner) : undefined;
      const tex = owned ? (n.kind === "hq" ? `hq${n.faction}` : `fort${n.faction}`) : "fortNeutral";
      const mine = owner?.id === session.myId;
      const label =
        owned && n.kind === "hq" && owner
          ? M()
            ? mine ? "你的大本營" : owner.name
            : `${FACTIONS[owner.faction].name}・${owner.name}${mine ? "（你）" : ""}`
          : nd.name;
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
      .setScale((u.type === "tank" ? 1 : 0.7) * (this.unitScale / UNIT_SCALE_DESKTOP));
    const men: Phaser.GameObjects.Image[] = [];
    const v: UnitView = { c, men, shadow, x: u.x, lane: u.lane, shots: u.shots, hp: u.hp, maxHp: u.maxHp, type: u.type, wx: 0, wy: 0, angle: 0 };
    if (u.type === "tank") {
      v.gun = this.add.image(0, 0, `tank${f}`);
      v.turret = this.add.image(-2, 0, `turret${f}`).setOrigin(12 / 48, 0.5);
      c.add([v.gun, v.turret]);
    } else {
      if (u.type === "mg") v.gun = this.add.image(8, 0, "mggun");
      if (u.type === "at") v.gun = this.add.image(4, 0, `atgun${f}`);
      if (u.type === "artillery") v.gun = this.add.image(2, 0, `howitzer${f}`);
      if (v.gun) c.add(v.gun);
      for (const [x, y] of FORMATION[u.type] ?? FORMATION.rifle) {
        const m = this.add.image(x, y, `soldier${f}`);
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
      seen.add(u.id);
      let v = this.units.get(u.id);
      if (!v) {
        v = this.makeUnit(u);
        this.units.set(u.id, v);
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
    });
    for (const [id, v] of this.units) {
      if (seen.has(id)) continue;
      this.unitDied(v);
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
    const v: StructView = { img, shots: st.shots, airShots: st.airShots, hp: st.hp, maxHp: st.maxHp, kind: st.kind, wx: p.x, wy: p.y };
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
    const route = session.route;
    this.map.lanes.forEach((lane, li) => {
      const front = s.fronts[li] ?? lane.len / 2;
      const seg = (from: number, to: number, off = 0) => {
        const pts: Vec[] = [];
        const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 22));
        for (let i = 0; i <= steps; i++) pts.push(laneOffsetPoint(lane, from + ((to - from) * i) / steps, off));
        return pts as unknown as Phaser.Math.Vector2[];
      };
      if (route && route.lane === li) {
        g.lineStyle(58, 0xf2c14e, 0.35);
        g.strokePoints(seg(0, lane.len));
      }
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
      // 交戰位置
      if (pa || pb) {
        const fp = lanePoint(lane, front);
        const nx = -Math.sin(fp.angle);
        const ny = Math.cos(fp.angle);
        const pulse = 0.7 + Math.sin(this.clock * 6 + li) * 0.3;
        g.lineStyle(9, 0x1d1d17, 0.8);
        g.lineBetween(fp.x - nx * 30, fp.y - ny * 30, fp.x + nx * 30, fp.y + ny * 30);
        g.lineStyle(4, 0xffe14d, pulse);
        g.lineBetween(fp.x - nx * 28, fp.y - ny * 28, fp.x + nx * 28, fp.y + ny * 28);
      }
      // 選到的出兵路線：從據點往外流動的箭頭
      if (route && route.lane === li) {
        const dir = nodeDir(lane, route.node);
        const start = nodeEnd(lane, route.node);
        const span = Math.max(90, lane.len - 80);
        for (let k = 0; k < 10; k++) {
          const along = ((this.clock * 70 + k * 90) % span) + 40;
          if (along > lane.len - 40) continue;
          const p = lanePoint(lane, start + dir * along);
          const a = p.angle + (dir < 0 ? Math.PI : 0);
          const pts = [
            { x: p.x + Math.cos(a + 2.5) * 10, y: p.y + Math.sin(a + 2.5) * 10 },
            { x: p.x + Math.cos(a) * 8, y: p.y + Math.sin(a) * 8 },
            { x: p.x + Math.cos(a - 2.5) * 10, y: p.y + Math.sin(a - 2.5) * 10 },
          ] as unknown as Phaser.Math.Vector2[];
          g.lineStyle(6, 0x1d1d17, 0.6);
          g.strokePoints(pts);
          g.lineStyle(3.5, 0xf2c14e, 0.95);
          g.strokePoints(pts);
        }
        // 出兵據點外圈
        const nd = this.map.nodes[route.node];
        g.lineStyle(5, 0xf2c14e, 0.6 + Math.sin(this.clock * 5) * 0.3);
        g.strokeCircle(nd.x, nd.y, nd.kind === "hq" ? (M() ? 78 : 66) : M() ? 54 : 46);
      }
    });
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
    this.structs.forEach((v) => {
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

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (!session.airMode || !this.map) {
      this.crosshair.setVisible(false);
      return;
    }
    const hit = nearestLanePos(this.map, p.worldX, p.worldY);
    const pos = lanePoint(this.map.lanes[hit.lane], hit.x);
    this.crosshair.setVisible(true).setPosition(pos.x, pos.y).setScale(session.airMode === "bomber" ? 1.2 : 0.9).setRotation(this.clock);
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (!this.map || session.state?.phase !== "playing") return;
    if (p.rightButtonDown()) {
      session.airMode = null;
      bus.emit("airMode", null);
      this.crosshair.setVisible(false);
      return;
    }
    if (session.airMode) {
      const hit = nearestLanePos(this.map, p.worldX, p.worldY);
      if (hit.dist > (M() ? 150 : 90)) {
        bus.emit("toast", "請點在道路上");
        return;
      }
      session.send("air", { kind: session.airMode, lane: hit.lane, x: hit.x });
      session.airMode = null;
      bus.emit("airMode", null);
      this.crosshair.setVisible(false);
      return;
    }
    // 點到空的工事位：開建造選單（選單位置換算成螢幕座標）
    const rect = this.game.canvas.getBoundingClientRect();
    const sx = rect.left + (p.x / this.scale.width) * rect.width;
    const sy = rect.top + (p.y / this.scale.height) * rect.height;
    for (const sl of this.slots) {
      if (!sl.img.visible) continue;
      if (Math.hypot(p.worldX - sl.wx, p.worldY - sl.wy) < (M() ? 44 : 24)) {
        bus.emit("buildMenu", { lane: sl.lane, node: sl.node, slot: sl.slot, x: sx, y: sy });
        return;
      }
    }
    bus.emit("buildMenu", null);
    // 點自己的據點：輪流切換這個據點出去的道路
    for (let i = 0; i < this.map.nodes.length; i++) {
      const nd = this.map.nodes[i];
      const r = (nd.kind === "hq" ? 60 : 40) * (M() ? 1.3 : 1);
      if (Math.hypot(p.worldX - nd.x, p.worldY - nd.y) > r) continue;
      if (!session.ownsNode(i)) break;
      const lanes = nodeLanes(this.map, i);
      const cur = session.route?.node === i ? lanes.indexOf(session.route.lane) : -1;
      session.route = { node: i, lane: lanes[(cur + 1) % lanes.length] };
      bus.emit("routeChanged", session.route);
      play("click", 0.6);
      return;
    }
    // 點道路：選這條路當出兵路線，從路上離點擊處較近的自己據點出發
    const hit = nearestLanePos(this.map, p.worldX, p.worldY);
    if (hit.dist > (M() ? 110 : 70)) return;
    const lane = this.map.lanes[hit.lane];
    const ownA = session.ownsNode(lane.a);
    const ownB = session.ownsNode(lane.b);
    if (!ownA && !ownB) {
      bus.emit("toast", "這條路沒有連到你的據點");
      return;
    }
    const node = ownA && ownB ? (hit.x < lane.len / 2 ? lane.a : lane.b) : ownA ? lane.a : lane.b;
    session.route = { node, lane: hit.lane };
    bus.emit("routeChanged", session.route);
    play("click", 0.6);
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
