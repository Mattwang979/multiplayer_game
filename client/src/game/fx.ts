// 特效系統：自己管理的輕量粒子（火球、濃煙、火花、塵土、碎片）、曳光彈、焦痕、鏡頭震動。
// 背景是淺色草地，所以火球用一般混合（不用疊加發光，否則會被洗白），煙用深灰色。
import Phaser from "phaser";

export const DEPTH = {
  ground: 0,
  territory: 1,
  decal: 2,
  slot: 3,
  structure: 5,
  unitShadow: 6,
  unit: 10,
  projectile: 20,
  groundFx: 30,
  airShadow: 35,
  air: 40,
  airFx: 45,
  overlay: 50,
  bars: 60,
};

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
  a1: number;
  vr: number;
  drag: number;
  rise: number;
  tints?: number[];
  fade: number; // 從生命的哪個比例開始淡出
  stretch: number; // 依速度拉長（火花）
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  width: number;
  color: number;
}

interface Emitter {
  x: number;
  y: number;
  until: number;
  next: number;
  every: number;
  fire: boolean;
}

export class Fx {
  private pool: Phaser.GameObjects.Image[] = [];
  private parts: Particle[] = [];
  private tracers: Tracer[] = [];
  private emitters: Emitter[] = [];
  private decals: { img: Phaser.GameObjects.Image; until: number }[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private time = 0;
  private shakeMag = 0;
  scale = 1; // 手機上特效整體放大

  constructor(private scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.projectile);
  }

  private get(tex: string, depth: number) {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, tex);
    img.setTexture(tex).setVisible(true).setActive(true).setDepth(depth).setBlendMode(Phaser.BlendModes.NORMAL).setRotation(0).clearTint();
    return img;
  }

  spawn(
    tex: string,
    x: number,
    y: number,
    o: {
      vx?: number; vy?: number; life?: number; s0?: number; s1?: number; a0?: number; a1?: number; vr?: number; drag?: number;
      rise?: number; depth?: number; add?: boolean; tint?: number; rot?: number; tints?: number[]; fade?: number; stretch?: number;
    },
  ) {
    if (this.parts.length > 1400) return;
    const img = this.get(tex, o.depth ?? DEPTH.groundFx);
    img.setPosition(x, y);
    if (o.add) img.setBlendMode(Phaser.BlendModes.ADD);
    if (o.tint !== undefined) img.setTint(o.tint);
    if (o.rot !== undefined) img.setRotation(o.rot);
    const p: Particle = {
      img,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      life: 0,
      max: o.life ?? 0.6,
      s0: o.s0 ?? 1,
      s1: o.s1 ?? o.s0 ?? 1,
      a0: o.a0 ?? 1,
      a1: o.a1 ?? 0,
      vr: o.vr ?? 0,
      drag: o.drag ?? 0,
      rise: o.rise ?? 0,
      tints: o.tints,
      fade: o.fade ?? 0,
      stretch: o.stretch ?? 0,
    };
    if (p.tints) img.setTint(p.tints[0]);
    img.setScale(p.s0).setAlpha(p.a0);
    this.parts.push(p);
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) {
        p.img.setVisible(false).setActive(false);
        this.pool.push(p.img);
        this.parts.splice(i, 1);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.vy -= p.rise * dt;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.img.rotation += p.vr * dt;
      const e = 1 - (1 - t) * (1 - t);
      const sc = p.s0 + (p.s1 - p.s0) * e;
      if (p.stretch) {
        const sp = Math.hypot(p.vx, p.vy);
        p.img.setRotation(Math.atan2(p.vy, p.vx)).setScale(sc * (0.4 + (sp / 300) * p.stretch), sc);
      } else p.img.setScale(sc);
      const ft = p.fade > 0 ? Math.max(0, (t - p.fade) / (1 - p.fade)) : t;
      p.img.setAlpha(p.a0 + (p.a1 - p.a0) * ft);
      if (p.tints) p.img.setTint(ramp(p.tints, t));
    }

    // 持續冒煙、燃燒的殘骸
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (this.time > em.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      if (this.time >= em.next) {
        em.next = this.time + em.every;
        this.spawn("smokepuff", em.x + rnd(-4, 4), em.y + rnd(-4, 4), {
          vx: rnd(10, 24), vy: rnd(-8, 4), rise: 14, life: rnd(1.8, 2.8), s0: 0.22, s1: rnd(0.8, 1.15), a0: 0.85, a1: 0, fade: 0.4, vr: rnd(-0.5, 0.5),
        });
        if (em.fire)
          this.spawn("puff", em.x + rnd(-5, 5), em.y + rnd(-5, 5), {
            life: rnd(0.4, 0.6), s0: rnd(0.16, 0.24), s1: 0.1, a0: 1, a1: 0, fade: 0.5, rise: 34, tints: FIRE_RAMP, vr: rnd(-2, 2),
          });
      }
    }

    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      const left = d.until - this.time;
      if (left <= 0) {
        d.img.destroy();
        this.decals.splice(i, 1);
      } else if (left < 4) {
        d.img.setAlpha((left / 4) * 0.9);
      }
    }

    // 曳光彈
    this.gfx.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life += dt;
      if (tr.life >= tr.max) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = 1 - tr.life / tr.max;
      // 只畫子彈前段，看起來像在飛
      const head = Math.min(1, (tr.life / tr.max) * 1.6 + 0.35);
      const tail = Math.max(0, head - 0.45);
      const hx = tr.x1 + (tr.x2 - tr.x1) * head;
      const hy = tr.y1 + (tr.y2 - tr.y1) * head;
      const tx = tr.x1 + (tr.x2 - tr.x1) * tail;
      const ty = tr.y1 + (tr.y2 - tr.y1) * tail;
      this.gfx.lineStyle(tr.width + 2.5, 0x5a2a00, 0.5 * a);
      this.gfx.lineBetween(tx, ty, hx, hy);
      this.gfx.lineStyle(tr.width, tr.color, a);
      this.gfx.lineBetween(tx, ty, hx, hy);
    }

    if (this.shakeMag > 0.0005) {
      this.scene.cameras.main.shake(90, this.shakeMag, true);
      this.shakeMag *= 0.5;
    } else this.shakeMag = 0;
  }

  shake(amount: number) {
    this.shakeMag = Math.min(0.02, this.shakeMag + amount);
  }

  // ---------------------------------------------------------------- 組合特效

  muzzle(x: number, y: number, angle: number, size = 1) {
    this.spawn("flashstar", x + Math.cos(angle) * 4, y + Math.sin(angle) * 4, { life: 0.07, s0: 0.1 * size, s1: 0.16 * size, a0: 1, a1: 0, rot: angle, depth: DEPTH.projectile });
    this.spawn("glow", x, y, { life: 0.07, s0: 0.25 * size, s1: 0.4 * size, a0: 0.9, a1: 0, depth: DEPTH.projectile, add: true, tint: 0xffe08a });
  }

  tracer(x1: number, y1: number, x2: number, y2: number, heavy = false) {
    this.tracers.push({ x1, y1, x2, y2, life: 0, max: heavy ? 0.16 : 0.11, width: (heavy ? 3 : 1.6) * this.scale * this.scale, color: heavy ? 0xfff2b0 : 0xffe14d });
  }

  impact(x: number, y: number, size = 1) {
    for (let i = 0; i < 3; i++) {
      const a = rnd(0, Math.PI * 2);
      const s = rnd(60, 140) * size;
      this.spawn("spark", x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.18, s0: 0.9, s1: 0.3, rot: a, drag: 4, depth: DEPTH.projectile });
    }
    this.spawn("dust", x, y, { life: 0.45, s0: 0.15 * size, s1: 0.45 * size, a0: 0.8, a1: 0, rise: 10 });
  }

  /** 爆炸：size 1 = 砲彈，2 = 炸彈，4 = 指揮部。五個階段：爆閃 → 火球 → 衝擊波 → 濃煙 → 焦痕 */
  explosion(x: number, y: number, size = 1) {
    size *= this.scale;
    const sq = Math.sqrt(size);
    // 1. 星芒爆閃
    this.spawn("flashstar", x, y, { life: 0.13, s0: 0.35 * size, s1: 0.75 * size, a0: 1, a1: 0, rot: rnd(0, 1), depth: DEPTH.groundFx + 4 });
    // 2. 翻騰火球：每一團從白熱開始，邊擴大邊往上飄，顏色一路變成黑煙
    const fireballs = Math.round(6 + size * 5);
    for (let i = 0; i < fireballs; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(15, 75) * sq;
      this.spawn("puff", x + rnd(-7, 7) * sq, y + rnd(-7, 7) * sq, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3.2, rise: 26, life: rnd(0.55, 0.95) + size * 0.06,
        s0: rnd(0.22, 0.38) * size, s1: rnd(0.55, 0.85) * size, a0: 1, a1: 0, fade: 0.55, vr: rnd(-1.5, 1.5),
        tints: FIRE_RAMP, depth: DEPTH.groundFx + 3,
      });
    }
    // 3. 地面塵土衝擊波
    this.spawn("shock", x, y + 4 * sq, { life: 0.5, s0: 0.12 * size, s1: 0.7 * size, a0: 0.95, a1: 0, depth: DEPTH.decal + 1 });
    for (let i = 0; i < Math.round(4 + size * 3); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(90, 160) * sq;
      this.spawn("dust", x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, drag: 4, life: rnd(0.6, 0.9), s0: 0.2 * sq, s1: 0.7 * sq, a0: 0.75, a1: 0, depth: DEPTH.decal + 1 });
    }
    // 4. 濃煙：比火球晚一點冒出來、待得比較久
    const smokes = Math.round(4 + size * 3.5);
    for (let i = 0; i < smokes; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(8, 36) * sq;
      this.scene.time.delayedCall(rnd(60, 220), () =>
        this.spawn("smokepuff", x + rnd(-10, 10) * sq, y + rnd(-10, 10) * sq, {
          vx: Math.cos(a) * sp + 12, vy: Math.sin(a) * sp, drag: 1.2, rise: 16, life: rnd(1.6, 2.8) + size * 0.35,
          s0: rnd(0.25, 0.4) * size, s1: rnd(0.8, 1.25) * size, a0: 0.88, a1: 0, fade: 0.35, vr: rnd(-0.5, 0.5), depth: DEPTH.groundFx + 2,
        }),
      );
    }
    // 火花（拉出殘影）與碎片
    for (let i = 0; i < Math.round(8 + size * 6); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(200, 420) * sq;
      this.spawn("streak", x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 3, life: rnd(0.3, 0.55), s0: 0.9 * sq, s1: 0.5, a0: 1, a1: 0, stretch: 1.2, depth: DEPTH.groundFx + 5 });
    }
    for (let i = 0; i < Math.round(4 + size * 4); i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(110, 230) * sq;
      this.spawn("debris", x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 2.5, life: rnd(0.5, 0.9), s0: rnd(1.2, 1.8), s1: 0.8, a0: 1, a1: 0.6, fade: 0.7, vr: rnd(-12, 12), depth: DEPTH.groundFx + 3 });
    }
    // 5. 焦痕與彈坑
    this.scorch(x, y, 0.3 * size + 0.2);
    this.shake((0.0028 * size) / this.scale);
  }

  scorch(x: number, y: number, scale: number, seconds = 25) {
    const img = this.scene.add.image(x, y, "scorch").setDepth(DEPTH.decal).setScale(scale).setRotation(rnd(0, 6.28)).setAlpha(0.9);
    this.decals.push({ img, until: this.time + seconds });
    if (this.decals.length > 120) {
      const old = this.decals.shift();
      old?.img.destroy();
    }
  }

  crater(x: number, y: number, scale = 1) {
    const img = this.scene.add.image(x, y, "crater").setDepth(DEPTH.decal).setScale(scale).setRotation(rnd(-0.4, 0.4)).setAlpha(0.9);
    this.decals.push({ img, until: this.time + 60 });
  }

  burn(x: number, y: number, seconds: number, fire = true) {
    this.emitters.push({ x, y, until: this.time + seconds, next: this.time, every: 0.12, fire });
  }

  flak(x: number, y: number) {
    const fx = x + rnd(-28, 28);
    const fy = y + rnd(-28, 28);
    this.spawn("flashstar", fx, fy, { life: 0.09, s0: 0.12, s1: 0.22, a0: 1, a1: 0, rot: rnd(0, 1), depth: DEPTH.airFx + 1 });
    this.spawn("smokepuff", fx, fy, { life: rnd(1.0, 1.5), s0: 0.12, s1: rnd(0.38, 0.5), a0: 1, a1: 0, fade: 0.4, tint: 0x55524a, depth: DEPTH.airFx, vx: rnd(-6, 6), vy: rnd(-6, 6), vr: rnd(-1, 1) });
  }

  dustRing(x: number, y: number, size = 1) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.spawn("dust", x, y, { vx: Math.cos(a) * 60 * size, vy: Math.sin(a) * 60 * size, drag: 3, life: 0.7, s0: 0.2 * size, s1: 0.6 * size, a0: 0.8, a1: 0 });
    }
  }
}

// 火的顏色：白熱 → 黃 → 橘 → 暗紅 → 焦褐 → 黑煙
export const FIRE_RAMP = [0xffffff, 0xfff0a0, 0xffb02e, 0xff6a1a, 0xc8321e, 0x6a3a26, 0x3c3a33];

function ramp(colors: number[], t: number) {
  const f = Math.min(0.9999, Math.max(0, t)) * (colors.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = colors[i];
  const b = colors[i + 1];
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export function rnd(a: number, b: number) {
  return a + Math.random() * (b - a);
}
