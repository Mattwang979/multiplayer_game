// 戰場畫面：把伺服器同步來的狀態畫出來，並加上所有特效。
// 這裡只負責「看」，所有規則都在伺服器（server/src/game/Battle.ts）。
import Phaser from "phaser";
import {
  BOMB,
  BUILD_SLOTS,
  FACTIONS,
  LANE_LENGTH,
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
  type AirKind,
  type MapLayout,
} from "@frontline/shared";
import { bus, session } from "../session";
import type { AircraftState, StructureState, UnitState } from "../types";
import { DEPTH, FIRE_RAMP, Fx, rnd } from "./fx";
import { play } from "./sound";
import { makeTextures } from "./textures";

const UNIT_SCALE = 1.2; // 部隊畫大一點比較好認

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
  faction: number;
  wx: number;
  wy: number;
  angle: number;
  landed: boolean;
}

interface StructView {
  img: Phaser.GameObjects.Image;
  gun?: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  shots: number;
  airShots: number;
  hp: number;
  maxHp: number;
  kind: string;
  wx: number;
  wy: number;
  angle: number;
  name: string;
}

interface AirView {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dropped: boolean;
  smokeT: number;
  kind: string;
}

export class BattleScene extends Phaser.Scene {
  private map!: MapLayout;
  private fx!: Fx;
  private nodeCount = 0;
  private ground?: Phaser.GameObjects.Image;
  private territory!: Phaser.GameObjects.Graphics;
  private bars!: Phaser.GameObjects.Graphics;
  private units = new Map<string, UnitView>();
  private structs = new Map<string, StructView>();
  private planes = new Map<string, AirView>();
  private slots: { img: Phaser.GameObjects.Image; lane: number; slot: number; wx: number; wy: number }[] = [];
  private ruins: Phaser.GameObjects.Image[] = [];
  private markers: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private crosshair!: Phaser.GameObjects.Image;
  private wrecks: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private clock = 0;
  private lastShare: number[] = [];
  private breakthroughCd = 0;
  private offs: (() => void)[] = [];

  constructor() {
    super("battle");
  }

  create() {
    makeTextures(this);
    this.cameras.main.setBackgroundColor("#7f9a4e");
    this.fx = new Fx(this);
    this.territory = this.add.graphics().setDepth(DEPTH.territory);
    this.bars = this.add.graphics().setDepth(DEPTH.bars);
    this.crosshair = this.add.image(0, 0, "target").setDepth(DEPTH.overlay).setVisible(false);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => this.onPointerMove(p));

    this.offs.push(
      bus.on("bomb", (m: { lane: number; x: number }) => this.onBomb(m)),
      bus.on("airDown", (m: { x: number; y: number; angle: number; kind: AirKind }) => this.onAirDown(m)),
      bus.on("airIncoming", (m: { side: number; kind: AirKind; lane: number; x: number }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { id: string }) => this.onEliminated(m)),
      bus.on("paradrop", () => play("plane", 0.6)),
      bus.on("newBattle", () => this.reset()),
    );
    this.events.once("shutdown", () => this.offs.forEach((f) => f()));
  }

  // ================================================================ 地圖

  private reset() {
    this.nodeCount = 0;
  }

  private setupMap(n: number) {
    this.nodeCount = n;
    this.map = buildMap(n);
    this.units.forEach((v) => v.c.destroy());
    this.units.forEach((v) => v.shadow.destroy());
    this.units.clear();
    this.structs.forEach((v) => {
      v.img.destroy();
      v.gun?.destroy();
      v.label?.destroy();
    });
    this.structs.clear();
    this.planes.forEach((v) => {
      v.img.destroy();
      v.shadow.destroy();
    });
    this.planes.clear();
    this.ruins.forEach((r) => r.destroy());
    this.ruins = [];
    this.slots.forEach((s) => s.img.destroy());
    this.slots = [];
    this.lastShare = [];

    const key = `ground${n}`;
    if (!this.textures.exists(key)) this.paintGround(key);
    this.ground?.destroy();
    this.ground = this.add.image(0, 0, key).setOrigin(0).setDepth(DEPTH.ground);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
  }

  /** 畫一次整張地面（草地、沙地、黃土路、樹叢、彈坑），之後當成一張圖用 */
  private paintGround(key: string) {
    const tex = this.textures.createCanvas(key, WORLD_W, WORLD_H)!;
    const c = tex.getContext();
    const rand = mulberry(this.map.n * 977 + 13);
    const R = (a: number, b: number) => a + rand() * (b - a);

    c.fillStyle = "#a9c46c";
    c.fillRect(0, 0, WORLD_W, WORLD_H);
    // 草地明暗斑塊
    for (let i = 0; i < 90; i++) {
      c.fillStyle = rand() < 0.5 ? "rgba(143,176,90,0.45)" : "rgba(186,208,128,0.45)";
      c.beginPath();
      c.ellipse(R(0, WORLD_W), R(0, WORLD_H), R(40, 160), R(20, 80), R(0, 3), 0, Math.PI * 2);
      c.fill();
    }
    // 沙地：中央和指揮部周圍
    const sand = (x: number, y: number, r: number) => {
      const g = c.createRadialGradient(x, y, r * 0.2, x, y, r);
      g.addColorStop(0, "rgba(226,207,151,1)");
      g.addColorStop(0.7, "rgba(226,207,151,0.85)");
      g.addColorStop(1, "rgba(226,207,151,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    sand(this.map.center.x, this.map.center.y, this.map.n <= 2 ? 260 : 330);
    for (let i = 0; i < 5; i++) sand(R(100, WORLD_W - 100), R(100, WORLD_H - 100), R(80, 170));
    for (const nd of this.map.nodes) sand(nd.x, nd.y, 130);
    // 細碎草葉
    for (let i = 0; i < 2600; i++) {
      const x = R(0, WORLD_W);
      const y = R(0, WORLD_H);
      c.strokeStyle = rand() < 0.5 ? "rgba(120,150,70,0.5)" : "rgba(200,220,150,0.45)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + R(-2, 2), y - R(3, 6));
      c.stroke();
    }
    // 道路
    for (const lane of this.map.lanes) {
      const path = () => {
        c.beginPath();
        lane.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      };
      c.lineCap = "round";
      c.lineJoin = "round";
      path();
      c.strokeStyle = "#9b804f";
      c.lineWidth = 56;
      c.stroke();
      path();
      c.strokeStyle = "#b79a63";
      c.lineWidth = 48;
      c.stroke();
      // 車轍
      for (const off of [-9, 9]) {
        c.beginPath();
        for (let i = 0; i <= 80; i++) {
          const p = laneOffsetPoint(lane, (i / 80) * LANE_LENGTH, off);
          if (i) c.lineTo(p.x, p.y);
          else c.moveTo(p.x, p.y);
        }
        c.strokeStyle = "rgba(140,112,70,0.55)";
        c.lineWidth = 3;
        c.stroke();
      }
    }
    // 樹叢與石頭（避開道路和指揮部）
    const clear = (x: number, y: number, pad: number) => {
      if (nearestLanePos(this.map, x, y).dist < pad) return false;
      return this.map.nodes.every((nd) => Math.hypot(nd.x - x, nd.y - y) > 120);
    };
    for (let i = 0; i < 70; i++) {
      const x = R(20, WORLD_W - 20);
      const y = R(20, WORLD_H - 20);
      if (!clear(x, y, 70)) continue;
      const n = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const tx = x + R(-26, 26);
        const ty = y + R(-20, 20);
        const r = R(12, 24);
        c.fillStyle = "rgba(0,0,0,0.16)";
        c.beginPath();
        c.arc(tx + 7, ty + 9, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#4f7d31";
        c.strokeStyle = "#2f4f1c";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(tx, ty, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = "#6a9a40";
        c.beginPath();
        c.arc(tx - r * 0.3, ty - r * 0.3, r * 0.45, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (let i = 0; i < 40; i++) {
      const x = R(20, WORLD_W - 20);
      const y = R(20, WORLD_H - 20);
      if (!clear(x, y, 50)) continue;
      c.fillStyle = "#a5a093";
      c.strokeStyle = "#5e5a4e";
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(x, y, R(5, 11), R(4, 8), R(0, 3), 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // 舊彈坑
    for (let i = 0; i < 26; i++) {
      const lane = this.map.lanes[Math.floor(rand() * this.map.lanes.length)];
      const p = laneOffsetPoint(lane, R(200, 800), R(-70, 70));
      c.fillStyle = "#7c6a45";
      c.beginPath();
      c.ellipse(p.x, p.y, R(10, 18), R(7, 12), R(0, 3), 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#5e5036";
      c.beginPath();
      c.ellipse(p.x, p.y + 1, R(6, 10), R(4, 7), 0, 0, Math.PI * 2);
      c.fill();
    }
    // 戰壕
    this.map.nodes.forEach((nd) => {
      c.strokeStyle = "#7c6a45";
      c.lineWidth = 7;
      c.beginPath();
      for (let a = 0; a <= 26; a++) {
        const ang = (a / 26) * Math.PI * 2;
        const r = 96 + Math.sin(a * 1.7) * 6;
        const x = nd.x + Math.cos(ang) * r;
        const y = nd.y + Math.sin(ang) * r;
        if (a) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.setLineDash([26, 14]);
      c.stroke();
      c.setLineDash([]);
    });
    tex.refresh();
  }

  // ================================================================ 每一格畫面

  update(_t: number, deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.clock += dt;
    const s = session.state;
    if (!s || s.phase === "lobby" || s.nodeCount < 2) {
      this.fx.update(dt);
      return;
    }
    try {
      if (s.nodeCount !== this.nodeCount) this.setupMap(s.nodeCount);
      this.syncStructures(dt);
      this.syncUnits(dt);
      this.syncAircraft(dt);
      this.drawTerritory();
      this.drawBars();
      this.updateSlots();
      this.updateMarkers();
      this.checkBreakthrough(dt);
    } catch (e) {
      // 單一格出錯不要讓整個畫面停掉
      console.error(e);
    }
    this.fx.update(dt);
  }

  // ---------------------------------------------------------------- 部隊

  private makeUnit(u: UnitState): UnitView {
    const faction = this.factionOf(u.side);
    const c = this.add.container(0, 0).setDepth(DEPTH.unit).setScale(UNIT_SCALE);
    const shadow = this.add.image(0, 0, "shadow").setDepth(DEPTH.unitShadow).setScale(u.type === "tank" ? 1 : 0.7);
    const men: Phaser.GameObjects.Image[] = [];
    const v: UnitView = {
      c, men, shadow, x: u.x, lane: u.lane, shots: u.shots, hp: u.hp, maxHp: u.maxHp, type: u.type, faction,
      wx: 0, wy: 0, angle: 0, landed: u.landT <= (session.state?.time ?? 0),
    };
    if (u.type === "tank") {
      v.gun = this.add.image(0, 0, `tank${faction}`);
      v.turret = this.add.image(-2, 0, `turret${faction}`).setOrigin(12 / 48, 0.5);
      c.add([v.gun, v.turret]);
    } else {
      if (u.type === "mg") v.gun = this.add.image(8, 0, "mggun");
      if (u.type === "at") v.gun = this.add.image(4, 0, `atgun${faction}`);
      if (u.type === "artillery") v.gun = this.add.image(2, 0, `howitzer${faction}`);
      if (v.gun) c.add(v.gun);
      for (const [x, y] of FORMATION[u.type] ?? FORMATION.rifle) {
        const m = this.add.image(x, y, `soldier${faction}`);
        men.push(m);
        c.add(m);
      }
    }
    if (u.type === "para") {
      v.chute = this.add.image(0, 0, "chute").setDepth(DEPTH.air - 1);
    }
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
      // 平滑移動；換路線（穿過廢墟）時直接跳過去
      if (v.lane !== u.lane || Math.abs(v.x - u.x) > 80) {
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

      // 空降：降落傘慢慢縮小代表下降
      const left = u.landT - s.time;
      if (v.chute) {
        if (left > 0) {
          const k = Math.min(1, left / 1.6);
          v.chute.setVisible(true).setPosition(p.x, p.y - 10 * k).setScale(0.6 + 0.9 * k).setRotation(Math.sin(this.clock * 3 + u.x) * 0.15);
          v.c.setScale(UNIT_SCALE * (0.7 + 0.3 * (1 - k))).setAlpha(0.85);
          v.shadow.setScale(0.3 + 0.4 * (1 - k)).setAlpha(0.6);
        } else {
          v.chute.destroy();
          v.chute = undefined;
          v.c.setScale(UNIT_SCALE).setAlpha(1);
          v.shadow.setScale(0.7).setAlpha(1);
          this.fx.dustRing(p.x, p.y, 0.6);
        }
      }

      // 人數跟著血量減少
      const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 0;
      if (v.men.length) {
        const visible = Math.max(1, Math.ceil(v.men.length * ratio - 0.01));
        v.men.forEach((m, i) => m.setVisible(i < visible));
      }
      v.hp = u.hp;
      v.maxHp = u.maxHp;

      if (u.shots !== v.shots) {
        v.shots = u.shots;
        this.unitFired(v, u);
      }
      // 步兵走路時輕微晃動
      if (!u.attacking && v.men.length) {
        v.men.forEach((m, i) => (m.y = (FORMATION[v!.type] ?? FORMATION.rifle)[i][1] + Math.sin(this.clock * 10 + i * 1.7) * 0.8));
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
    const lane = this.map.lanes[u.lane];
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

  /** 砲彈拋物線：放大再縮小假裝有高度，地上有影子 */
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
    if (ratio > 0.4) return; // 不是被打死（例如整隊出局）就不放特效
    const vol = this.volumeAt(v.wx, v.wy);
    if (v.type === "tank") {
      this.fx.explosion(v.wx, v.wy, 1.1);
      const w = this.add.image(v.wx, v.wy, "wreck").setRotation(v.angle).setDepth(DEPTH.structure - 1);
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

  // ---------------------------------------------------------------- 工事與指揮部

  private syncStructures(dt: number) {
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
        if (v.gun) v.gun.setRotation(Math.atan2(st.ay - v.wy, st.ax - v.wx));
        play("flak", this.volumeAt(st.ax, st.ay) * 0.6);
      }
      if (st.hp < v.hp - 30 && st.kind === "hq") {
        this.fx.impact(v.wx + rnd(-30, 30), v.wy + rnd(-30, 30), 1.2);
      }
      v.hp = st.hp;
      v.maxHp = st.maxHp;
    });
    for (const [id, v] of this.structs) {
      if (seen.has(id)) continue;
      if (v.kind === "hq") {
        const ruin = this.add.image(v.wx, v.wy, "ruin").setDepth(DEPTH.structure);
        this.ruins.push(ruin);
      } else if (v.hp / v.maxHp < 0.5) {
        this.fx.explosion(v.wx, v.wy, 1.3);
        play("boom", this.volumeAt(v.wx, v.wy));
      }
      v.img.destroy();
      v.gun?.destroy();
      v.label?.destroy();
      this.structs.delete(id);
    }
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (this.clock > w.until) {
        w.img.destroy();
        this.wrecks.splice(i, 1);
      } else if (w.until - this.clock < 3) w.img.setAlpha((w.until - this.clock) / 3);
    }
    void dt;
  }

  private makeStructure(st: StructureState): StructView {
    const faction = this.factionOf(st.side);
    let wx: number;
    let wy: number;
    let angle = 0;
    if (st.kind === "hq") {
      const nd = this.map.nodes[st.side];
      wx = nd.x;
      wy = nd.y;
    } else {
      const lane = this.map.lanes[st.lane];
      const p = laneOffsetPoint(lane, st.x, st.slot === 0 ? 46 : -46);
      wx = p.x;
      wy = p.y;
      angle = p.angle + (nodeDir(lane, st.side) < 0 ? Math.PI : 0);
    }
    const tex = st.kind === "hq" ? `hq${faction}` : `${st.kind}${faction}`;
    const img = this.add.image(wx, wy, tex).setDepth(DEPTH.structure).setRotation(st.kind === "aa" || st.kind === "hq" ? 0 : angle);
    const v: StructView = { img, shots: st.shots, airShots: st.airShots, hp: st.hp, maxHp: st.maxHp, kind: st.kind, wx, wy, angle, name: "" };
    if (st.kind === "aa") v.gun = this.add.image(wx, wy, "aagun").setOrigin(6 / 30, 0.5).setDepth(DEPTH.structure + 1).setRotation(-Math.PI / 4);
    if (st.kind === "hq") {
      const p = session.playerAtNode(st.side);
      v.name = p?.name ?? "";
      const isMe = p?.id === session.myId;
      const below = wy < this.map.center.y; // 上半部的指揮部把名字放下面，免得被介面擋住
      v.label = this.add
        .text(wx, below ? wy + 82 : wy - 82, `${FACTIONS[faction].name}・${v.name}${isMe ? "（你）" : ""}`, {
          fontFamily: '"Noto Sans TC", sans-serif',
          fontSize: "18px",
          fontStyle: "900",
          color: "#ffffff",
          stroke: "#1d1d17",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.bars + 1);
    } else {
      this.fx.dustRing(wx, wy, 0.8);
    }
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
      play(st.kind === "hq" ? "cannon" : "at", vol * 0.8);
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
        const f = this.factionOf(a.side);
        const tex = a.kind === "bomber" ? `bomber${f}` : `transport${f}`;
        v = {
          img: this.add.image(a.x, a.y, tex).setDepth(DEPTH.air),
          shadow: this.add.image(a.x, a.y, tex).setDepth(DEPTH.airShadow).setTint(0x000000).setAlpha(0.22).setScale(0.8),
          x: a.x, y: a.y, dropped: a.dropped, smokeT: 0, kind: a.kind,
        };
        this.planes.set(a.id, v);
        play("plane", 0.8);
      }
      v.x += (a.x - v.x) * Math.min(1, dt * 10);
      v.y += (a.y - v.y) * Math.min(1, dt * 10);
      const bob = 1 + Math.sin(this.clock * 2 + a.x * 0.01) * 0.015;
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
          if (a.hp / a.maxHp < 0.3) this.fx.spawn("puff", v.x + rnd(-10, 10), v.y + rnd(-10, 10), { life: 0.35, s0: 0.2, s1: 0.08, tints: FIRE_RAMP, depth: DEPTH.airFx });
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
    for (let i = 0; i < BOMB.count; i++) {
      const offset = (i - (BOMB.count - 1) / 2) * BOMB.spacing;
      const tp = lanePoint(lane, a.tx + offset);
      const start = lanePoint(lane, a.tx);
      const bomb = this.add.image(start.x, start.y, "bomb").setDepth(DEPTH.air - 1).setRotation(a.angle + Math.PI / 2).setScale(1.2);
      this.tweens.add({
        targets: bomb,
        x: tp.x,
        y: tp.y,
        scale: 0.5,
        delay: i * BOMB.interval * 1000,
        duration: 250,
        onComplete: () => bomb.destroy(),
      });
    }
    play("whistle", this.volumeAt(a.x, a.y));
  }

  private onBomb(m: { lane: number; x: number }) {
    if (!this.map?.lanes[m.lane]) return;
    const p = lanePoint(this.map.lanes[m.lane], m.x);
    this.fx.explosion(p.x, p.y, 1.6);
    this.fx.crater(p.x + rnd(-6, 6), p.y + rnd(-6, 6), rnd(0.8, 1.2));
    play("boom", this.volumeAt(p.x, p.y));
  }

  private onAirDown(m: { x: number; y: number; angle: number; kind: AirKind }) {
    // 墜機：一邊旋轉一邊冒火，落地爆炸
    const img = this.add.image(m.x, m.y, m.kind === "bomber" ? "bomber2" : "transport2").setDepth(DEPTH.air).setRotation(m.angle).setTint(0x3a3a3a);
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

  private onAirIncoming(m: { side: number; kind: AirKind; lane: number; x: number }) {
    if (!this.map?.lanes[m.lane]) return;
    const p = lanePoint(this.map.lanes[m.lane], m.x);
    const img = this.add.image(p.x, p.y, "target").setDepth(DEPTH.overlay).setScale(m.kind === "bomber" ? 1.3 : 0.9).setAlpha(0.9);
    this.markers.push({ img, until: this.clock + 4 });
  }

  private onEliminated(m: { id: string }) {
    const p = session.state?.players.get(m.id);
    if (!p || p.node < 0 || !this.map) return;
    const nd = this.map.nodes[p.node];
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

  // ---------------------------------------------------------------- 領土、血條、介面

  private drawTerritory() {
    const s = session.state!;
    const g = this.territory;
    g.clear();
    const me = session.me();
    this.map.lanes.forEach((lane, li) => {
      const front = s.fronts[li] ?? LANE_LENGTH / 2;
      const pa = session.playerAtNode(lane.a);
      const pb = session.playerAtNode(lane.b);
      const seg = (from: number, to: number) => {
        const pts: { x: number; y: number }[] = [];
        const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 25));
        for (let i = 0; i <= steps; i++) pts.push(lanePoint(lane, from + ((to - from) * i) / steps));
        return pts;
      };
      // 我選的路線：金色底
      if (me && li === session.selectedLane) {
        g.lineStyle(60, 0xf2c14e, 0.35);
        g.strokePoints(seg(0, LANE_LENGTH) as unknown as Phaser.Math.Vector2[]);
      }
      // 領土：路面淡淡上色，兩側再畫一條陣營色的邊線（深色描邊），淺色地面上也看得清楚
      const paint = (faction: number, from: number, to: number) => {
        const col = FACTIONS[faction].color;
        g.lineStyle(44, col, 0.2);
        g.strokePoints(seg(from, to) as unknown as Phaser.Math.Vector2[]);
        for (const off of [-27, 27]) {
          const pts: { x: number; y: number }[] = [];
          const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 25));
          for (let i = 0; i <= steps; i++) pts.push(laneOffsetPoint(lane, from + ((to - from) * i) / steps, off));
          g.lineStyle(7, 0x1d1d17, 0.55);
          g.strokePoints(pts as unknown as Phaser.Math.Vector2[]);
          g.lineStyle(4, col, 1);
          g.strokePoints(pts as unknown as Phaser.Math.Vector2[]);
        }
      };
      if (pa?.alive) paint(pa.faction, 0, front);
      if (pb?.alive) paint(pb.faction, front, LANE_LENGTH);
      // 前線標記
      const fp = lanePoint(lane, front);
      const nx = -Math.sin(fp.angle);
      const ny = Math.cos(fp.angle);
      const pulse = 0.7 + Math.sin(this.clock * 6 + li) * 0.3;
      g.lineStyle(9, 0x1d1d17, 0.85);
      g.lineBetween(fp.x - nx * 34, fp.y - ny * 34, fp.x + nx * 34, fp.y + ny * 34);
      g.lineStyle(4, 0xffe14d, pulse);
      g.lineBetween(fp.x - nx * 32, fp.y - ny * 32, fp.x + nx * 32, fp.y + ny * 32);
      // 我方路線上，從指揮部往前的箭頭
      if (me && me.alive && li === session.selectedLane) {
        const dir = nodeDir(lane, me.node);
        const start = nodeEnd(lane, me.node);
        for (let k = 0; k < 6; k++) {
          const along = ((this.clock * 70 + k * 120) % 720) + 60;
          const px = start + dir * along;
          if ((dir > 0 && px > front) || (dir < 0 && px < front)) continue;
          const p = lanePoint(lane, px);
          const a = p.angle + (dir < 0 ? Math.PI : 0);
          const c1 = { x: p.x + Math.cos(a) * 8, y: p.y + Math.sin(a) * 8 };
          const l1 = { x: p.x + Math.cos(a + 2.5) * 10, y: p.y + Math.sin(a + 2.5) * 10 };
          const r1 = { x: p.x + Math.cos(a - 2.5) * 10, y: p.y + Math.sin(a - 2.5) * 10 };
          g.lineStyle(5, 0x1d1d17, 0.6);
          g.strokePoints([l1, c1, r1] as unknown as Phaser.Math.Vector2[]);
          g.lineStyle(3, 0xf2c14e, 0.95);
          g.strokePoints([l1, c1, r1] as unknown as Phaser.Math.Vector2[]);
        }
      }
    });
  }

  private drawBars() {
    const g = this.bars;
    g.clear();
    const bar = (x: number, y: number, w: number, ratio: number, color: number) => {
      g.fillStyle(0x1d1d17, 0.85);
      g.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
      g.fillStyle(color, 1);
      g.fillRect(x - w / 2, y, w * Math.max(0, ratio), 4);
    };
    const hpColor = (r: number) => (r > 0.6 ? 0x7ed957 : r > 0.3 ? 0xffd34a : 0xff5a3c);
    this.units.forEach((v) => {
      const r = v.maxHp > 0 ? v.hp / v.maxHp : 0;
      if (r < 0.999) bar(v.wx, v.wy - 22, 22, r, hpColor(r));
    });
    this.structs.forEach((v) => {
      const r = v.maxHp > 0 ? v.hp / v.maxHp : 0;
      if (v.kind === "hq") {
        const by = v.wy < this.map.center.y ? v.wy + 58 : v.wy - 66;
        g.fillStyle(0x1d1d17, 0.9);
        g.fillRect(v.wx - 51, by, 102, 12);
        g.fillStyle(hpColor(r), 1);
        g.fillRect(v.wx - 49, by + 2, 98 * r, 8);
      } else if (r < 0.999) bar(v.wx, v.wy - 28, 34, r, hpColor(r));
    });
  }

  private updateSlots() {
    const me = session.me();
    const s = session.state!;
    if (!me || me.node < 0 || !me.alive || s.phase !== "playing") {
      this.slots.forEach((sl) => sl.img.setVisible(false));
      return;
    }
    if (this.slots.length === 0) {
      for (const li of nodeLanes(this.map, me.node)) {
        const lane = this.map.lanes[li];
        BUILD_SLOTS.forEach((dist, slot) => {
          const x = nodeEnd(lane, me.node) + nodeDir(lane, me.node) * dist;
          const p = laneOffsetPoint(lane, x, slot === 0 ? 46 : -46);
          const img = this.add.image(p.x, p.y, "slot").setDepth(DEPTH.slot);
          this.slots.push({ img, lane: li, slot, wx: p.x, wy: p.y });
        });
      }
    }
    for (const sl of this.slots) {
      const taken = s.structures.get(`s${me.node}_${sl.lane}_${sl.slot}`);
      sl.img.setVisible(!taken).setAlpha(0.65 + Math.sin(this.clock * 4) * 0.25);
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

  /** 我方在某條線的領土超過 72%：跳出「前線突破！」 */
  private checkBreakthrough(dt: number) {
    const me = session.me();
    const s = session.state!;
    this.breakthroughCd -= dt;
    if (!me || !me.alive || me.node < 0) return;
    for (const li of nodeLanes(this.map, me.node)) {
      const lane = this.map.lanes[li];
      const f = (s.fronts[li] ?? 500) / LANE_LENGTH;
      const share = lane.a === me.node ? f : 1 - f;
      const prev = this.lastShare[li] ?? share;
      if (prev < 0.72 && share >= 0.72 && this.breakthroughCd <= 0 && s.time > 5) {
        this.breakthroughCd = 25;
        const enemy = session.playerAtNode(otherEnd(lane, me.node));
        bus.emit("banner", { kind: "gold", text: "前線突破！", sub: enemy ? `往 ${FACTIONS[enemy.faction].name} 推進中` : "" });
      }
      this.lastShare[li] = share;
    }
  }

  // ---------------------------------------------------------------- 輸入

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (!session.airMode || !this.map) {
      this.crosshair.setVisible(false);
      return;
    }
    const hit = nearestLanePos(this.map, p.worldX, p.worldY);
    const lane = this.map.lanes[hit.lane];
    const pos = lanePoint(lane, Math.max(60, Math.min(LANE_LENGTH - 60, hit.x)));
    this.crosshair.setVisible(true).setPosition(pos.x, pos.y).setScale(session.airMode === "bomber" ? 1.3 : 0.9).setRotation(this.clock);
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
      if (hit.dist > 90) {
        bus.emit("toast", "請點在道路上");
        return;
      }
      session.send("air", { kind: session.airMode, lane: hit.lane, x: hit.x });
      session.airMode = null;
      bus.emit("airMode", null);
      this.crosshair.setVisible(false);
      return;
    }
    const ev = p.event as MouseEvent;
    for (const sl of this.slots) {
      if (!sl.img.visible) continue;
      if (Math.hypot(p.worldX - sl.wx, p.worldY - sl.wy) < 24) {
        bus.emit("buildMenu", { lane: sl.lane, slot: sl.slot, x: ev.clientX, y: ev.clientY });
        return;
      }
    }
    bus.emit("buildMenu", null);
    const me = session.me();
    if (!me) return;
    const hit = nearestLanePos(this.map, p.worldX, p.worldY);
    if (hit.dist < 70 && nodeLanes(this.map, me.node).includes(hit.lane)) {
      session.selectedLane = hit.lane;
      bus.emit("laneChanged", hit.lane);
    }
  }

  // ---------------------------------------------------------------- 小工具

  private factionOf(node: number) {
    return session.playerAtNode(node)?.faction ?? 0;
  }

  private volumeAt(x: number, y: number) {
    const cam = this.cameras.main;
    const cx = cam.midPoint.x;
    const cy = cam.midPoint.y;
    const d = Math.hypot(x - cx, y - cy);
    return Math.max(0.15, 1 - d / 1400);
  }
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
