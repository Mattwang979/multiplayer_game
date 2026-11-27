// 對局中的介面：上方玩家血量與計時、下方據點面板（買兵、選派出數量）／空軍／升級、
// 選到部隊時的指令列（撤退、進駐）、提示條、工事選單、結算畫面。
import {
  AIRCRAFT,
  AIR_KINDS,
  BOT_LEVEL_DEFS,
  BUILD_KINDS,
  BARRACKS_CAP,
  BARRACKS_DISCOUNT,
  BATTERY_CAP,
  EVENTS,
  FACTIONS,
  FORT_SPECS,
  FORT_SPEC_DEFS,
  GARRISON_CAP,
  GARRISON_FIRE_BONUS,
  GARRISON_FIRE_MAX,
  UNIT_GROUPS,
  MAX_UPGRADE_LEVEL,
  POP_CAP,
  STRUCTURES,
  HUNTERS,
  UNITS,
  UNIT_TYPES,
  UPGRADES,
  UPGRADE_KINDS,
  WINNER_DRAW,
  buildMap,
  isBotLevel,
  type AirKind,
  type BattleHistory,
  type EventKind,
  type FortSpec,
  type MapLayout,
  type UnitType,
} from "@frontline/shared";
import { enterFullscreen, exitFullscreen, isFullscreen, isMobile, isStandalone } from "../device";
import { initAudio, isMusicOn, isMuted, play, setMusicIntensity, stopMusic, toggleMusic, toggleMute } from "../game/sound";
import { bus, session } from "../session";
import { mountHistory } from "./chart";
import { emblem, unitIcon } from "./icons";
import type { PlayerState, UnitState } from "../types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON_SOUND = svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>');
const ICON_MUTED = svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>');
const ICON_MUSIC = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>');
const ICON_MUSIC_OFF = svg('<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M3 3l18 18"/>');
const ICON_FS = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>');
const ICON_FS_EXIT = svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>');
const ICON_MENU = svg('<path d="M4 7h16M4 12h16M4 17h16"/>');
const ICON_X = svg('<path d="M6 6l12 12M18 6L6 18"/>');
const ICON_UP = svg('<path d="M12 19V5M6 11l6-6 6 6"/>');
const ICON_STOP = svg('<rect x="6" y="6" width="12" height="12" rx="1"/>');
const ICON_BACK = svg('<path d="M10 7L5 12l5 5M5 12h10a4 4 0 0 1 4 4v1"/>');
const ICON_CHECK = svg('<path d="M5 12l5 5 9-10"/>');
const ICON_TARGET = svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>');
/** 獵殺目標的下拉選單選項 */
const huntOptions = () => `<option value="">不指定</option>${UNIT_TYPES.map((t) => `<option value="${t}">${UNITS[t].name}</option>`).join("")}`;
const isHunter = (type: string) => HUNTERS.includes(type as UnitType);
const ICON_FORT = svg('<path d="M4 20V9l4 2V7l4 2 4-2v4l4-2v11z"/><path d="M10 20v-4h4v4"/>');
const ICON_DRAG = svg('<path d="M9 11V5a2 2 0 0 1 4 0v6M13 10a2 2 0 0 1 4 0v3M9 11a2 2 0 0 0-4 0v3c0 4 3 7 7 7h1a5 5 0 0 0 5-5v-3"/>');
const setText = (el: Element, t: string) => {
  if (el.textContent !== t) el.textContent = t;
};

export class Hud {
  private top = $("hud-top");
  private bottom = $("hud-bottom");
  private banner = $("banner");
  private toast = $("toast");
  private feed = $("feed");
  private buildMenu = $("build-menu");
  private groupBar = $("group-bar");
  private tab = 0; // 兵種分頁
  private drawerOpen = false; // 下方據點抽屜（點堡壘才出現）
  private padNode = -1; // 抽屜剛打開時要捲到抽屜上方的據點
  private lastPad = -1;
  private specOpen = false;
  private suppressClick = false; // 長按買 5 之後，放開的那一下不要再買 1
  private pressTimer = 0;
  private history: BattleHistory | null = null; // 結算的勢力變化圖資料
  private targetHint = $("target-hint");
  private result = $("result");
  private map: MapLayout | null = null;
  private mapId = "";
  private builtFor = "";
  private toastTimer = 0;
  private lastHq = new Map<string, number>();
  private resultShown = false;
  private offs: (() => void)[] = [];
  onLeave: () => void = () => {};

  constructor() {
    this.offs.push(
      bus.on("toast", (t: string) => this.showToast(t)),
      bus.on("banner", (b: { kind: string; text: string; sub?: string; color?: string }) => this.showBanner(b.kind, b.text, b.sub, b.color)),
      bus.on("nodeSelected", () => play("click", 0.4)),
      bus.on("fortTap", (node: number) => this.openDrawer(node)),
      bus.on("mapTap", () => {
        this.closeDrawer();
        this.closePops();
      }),
      bus.on("unitsSelected", (ids: string[]) => {
        if (ids.length) this.closeDrawer();
      }),
      bus.on("leader", (m: { id: string; faction: number }) => this.onLeader(m)),
      bus.on("airMode", () => this.refreshAir()),
      bus.on("buildMenu", (m: { lane: number; node: number; slot: number; x: number; y: number } | null) => this.openBuildMenu(m)),
      bus.on("notice", (m: { text: string }) => {
        this.showToast(m.text);
        play("error", 0.6);
      }),
      bus.on("airIncoming", (m: { owner: string; faction: number; kind: AirKind; lane: number }) => this.onAirIncoming(m)),
      bus.on("eliminated", (m: { name: string; faction: number; by: string; id: string }) => this.onEliminated(m)),
      bus.on("hqAlert", (m: { owner: string; level: number }) => this.onHqAlert(m)),
      bus.on("captured", (m: { node: number; by: string; faction: number }) => this.onCaptured(m)),
      bus.on("fortFallen", (m: { node: number; owner: string; faction: number; by: string }) => this.onFortFallen(m)),
      bus.on("airDown", (m: { kind: AirKind }) => this.addFeed(`${AIRCRAFT[m.kind].name === "空降" ? "運輸機" : "轟炸機"}被擊落！`, "#ff9a5c")),
      bus.on("newBattle", () => this.resetForBattle()),
      bus.on("history", (h: BattleHistory) => {
        const first = !this.history;
        this.history = h;
        // 結算已經開著：重畫一次（出局時間在這份資料裡）
        if (first && !this.result.classList.contains("hidden")) this.showResult(false);
        else {
          const mount = this.result.querySelector<HTMLElement>(".hist-mount");
          if (mount) mountHistory(mount, h, session.myId);
        }
      }),
      bus.on("event", (m: { kind: EventKind; players?: string[] }) => this.onEvent(m)),
      bus.on("eventEnd", () => this.addFeed("事件結束", "#bfb9a6")),
      bus.on("crateTaken", (m: { by: string; faction: number; amount: number }) => {
        const f = FACTIONS[m.faction];
        if (m.by === session.myId) {
          this.addFeed(`搶到補給箱 +$${m.amount}`, "#f2c14e");
          play("capture", 0.7);
        } else this.addFeed(`${f?.name ?? ""}搶到補給箱`, f?.light);
      }),
      bus.on("built", (m: { owner: string; kind: string }) => {
        if (m.owner === session.myId) this.addFeed(`${STRUCTURES[m.kind as keyof typeof STRUCTURES]?.name ?? "工事"}完工`, "#7ed957");
      }),
      bus.on("converted", (m: { node: number; spec: string; owner: string }) => {
        if (m.owner !== session.myId) return;
        const def = FORT_SPEC_DEFS[m.spec as Exclude<FortSpec, "">];
        if (def) this.addFeed(`${this.map?.nodes[m.node]?.name ?? "堡壘"}改建成${def.name}`, "#7ed957");
        play("deploy", 0.6);
      }),
    );
    window.addEventListener("keydown", this.onKey);
    document.addEventListener("pointerdown", this.onOutside, true);
    this.top.addEventListener("click", this.onTopClick);
    this.bottom.addEventListener("click", this.onClick);
    this.bottom.addEventListener("pointerdown", this.onPress);
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) this.bottom.addEventListener(ev, this.onRelease);
    this.bottom.addEventListener("contextmenu", this.onContext);
    this.buildMenu.addEventListener("click", this.onBuildClick);
    this.groupBar.addEventListener("click", this.onGroupClick);
    // 特種部隊的獵殺目標（下拉選單）
    this.bottom.addEventListener("change", (e) => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-hunt]");
      if (!sel) return;
      session.hunt = sel.value;
      play("click", 0.5);
    });
    this.groupBar.addEventListener("change", (e) => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>("select[data-gb-hunt]");
      if (!sel) return;
      const s = session.state;
      const ids = session.selectedUnits.filter((id) => isHunter(s?.units.get(id)?.type ?? ""));
      if (ids.length) session.send("hunt", { units: ids, type: sel.value });
      play("click", 0.5);
      sel.blur();
    });
    this.result.addEventListener("click", this.onResultClick);
    $("target-cancel").addEventListener("click", () => {
      session.airMode = null;
      bus.emit("airMode", null);
    });
  }

  destroy() {
    this.offs.forEach((f) => f());
    window.removeEventListener("keydown", this.onKey);
    document.removeEventListener("pointerdown", this.onOutside, true);
  }

  resetForBattle() {
    this.builtFor = "";
    this.resultShown = false;
    this.result.classList.add("hidden");
    this.lastHq.clear();
    this.hpSeen.clear();
    this.hurtUntil = 0;
    this.feed.innerHTML = "";
    session.airMode = null;
    session.selectedNode = -1;
    session.selectedUnits = [];
    session.enter = true;
    session.hunt = "";
    session.clearPicks();
    this.groupBar.classList.add("hidden");
    this.history = null;
    this.closeDrawer();
    this.closePops();
  }

  // ================================================================ 每一格更新

  update() {
    const s = session.state;
    const me = session.me();
    if (!s || !me) return;
    if (!s.mapId) return;
    if (s.mapId !== this.mapId) {
      this.mapId = s.mapId;
      this.map = buildMap(s.mapId);
    }
    if (!this.map) return;
    if (this.builtFor !== this.mapId) this.buildBottom();
    this.ensureSelection(me);
    this.renderTop(me);
    this.renderBottom(me);
    this.renderGroupBar();
    this.syncViewPad();

    this.updateMusic(me);
    if (s.phase === "ended" && !this.resultShown) {
      this.resultShown = true;
      stopMusic(1);
      setTimeout(() => this.showResult(), 1200);
    }
  }

  /** 配樂強度：平時 0；開打一陣子、自己的據點掉血 → 1；大本營危急或最後一分半 → 2 */
  private hpSeen = new Map<number, number>();
  private hurtUntil = 0;
  private updateMusic(me: PlayerState) {
    const s = session.state!;
    if (s.phase !== "playing") return;
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      if (!n || n.owner !== me.id) {
        this.hpSeen.delete(i);
        continue;
      }
      const prev = this.hpSeen.get(i);
      if (prev !== undefined && n.hp < prev - 1) this.hurtUntil = s.time + 8;
      this.hpSeen.set(i, n.hp);
    }
    const hq = me.hq >= 0 ? s.nodes[me.hq] : undefined;
    const hqRatio = hq && hq.owner === me.id ? hq.hp / hq.maxHp : 1;
    let level = s.time > 150 || s.time < this.hurtUntil ? 1 : 0;
    if (hqRatio < 0.5 || (s.duration > 0 && s.duration - s.time < 90)) level = 2;
    if (!me.alive) level = 0;
    setMusicIntensity(level);
  }

  private renderTop(me: PlayerState) {
    const s = session.state!;
    const players: PlayerState[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => a.faction - b.faction);
    const cards = players
      .map((p) => {
        const f = FACTIONS[p.faction];
        const hq = p.alive && p.hq >= 0 ? s.nodes[p.hq] : undefined;
        const ratio = hq && hq.owner === p.id ? hq.hp / hq.maxHp : 0;
        const prev = this.lastHq.get(p.id) ?? ratio;
        this.lastHq.set(p.id, ratio);
        const hit = ratio < prev - 0.002;
        const status = !p.alive ? "出局" : !p.connected ? "斷線" : "";
        return `<div class="pcard${p.id === me.id ? " me" : ""}${p.alive ? "" : " out"}" title="${f.name}・${esc(p.name)}：大本營血量、擁有的堡壘數">
          <div class="pc-head">${emblem(f.emblem, f.css, f.mark, 14)}<span class="pc-name">${esc(p.name)}${p.id === me.id ? "（你）" : ""}</span>${p.alive && p.id === s.leaderId ? '<em class="pc-bounty">懸賞</em>' : ""}${status ? `<em class="pc-status">${status}</em>` : ""}<b class="pc-forts">${p.alive ? p.forts : ""}</b></div>
          <div class="bar${hit ? " hit" : ""}"><i style="width:${(ratio * 100).toFixed(1)}%;background:${f.bar}"></i></div>
        </div>`;
      })
      .join("");
    if (!this.top.querySelector(".pcards")) {
      this.top.innerHTML = `<div class="pcards"></div>
        <div class="hud-right">
          <div class="timer"><strong></strong><span>剩餘</span></div>
          <div class="funds"><strong></strong><span class="fsub"></span></div>
          <button class="menu-btn" data-act="menu" aria-label="選單" aria-expanded="false" aria-haspopup="menu">${ICON_MENU}</button>
          <div class="menu-pop hidden" role="menu">
            <button data-act="music" role="menuitem"></button>
            <button data-act="mute" role="menuitem"></button>
            <button data-act="fs" role="menuitem"></button>
            <button data-act="quit" role="menuitem" class="danger">離開對局</button>
          </div>
          <em class="event-chip hidden"></em>
        </div>`;
    }
    // 進行中的隨機事件
    const chip = this.top.querySelector<HTMLElement>(".event-chip")!;
    const ev = s.event ? EVENTS[s.event as EventKind] : undefined;
    if (ev) {
      setText(chip, `${ev.name} ${Math.max(0, Math.ceil(s.eventEnd - s.time))}s`);
      chip.title = ev.desc;
    }
    chip.classList.toggle("hidden", !ev);
    const pc = this.top.querySelector<HTMLElement>(".pcards")!;
    if (pc.dataset.html !== cards) {
      pc.dataset.html = cards;
      pc.innerHTML = cards;
    }
    // 有時限：倒數剩餘時間；不限時：顯示已經打了多久
    const unlimited = s.duration <= 0;
    const left = unlimited ? s.time : Math.max(0, s.duration - s.time);
    const mm = Math.floor(left / 60);
    const ss = Math.floor(left % 60).toString().padStart(2, "0");
    const timer = this.top.querySelector<HTMLElement>(".timer")!;
    timer.classList.toggle("urgent", !unlimited && left < 60);
    setText(timer.querySelector("strong")!, `${mm}:${ss}`);
    const tsub = timer.querySelector("span");
    if (tsub) setText(tsub, unlimited ? "不限時" : "剩餘");
    setText(this.top.querySelector(".funds strong")!, `$${me.funds.toLocaleString()}`);
    const net = me.income - me.upkeep;
    const fsub = this.top.querySelector<HTMLElement>(".fsub")!;
    setText(fsub, `${net >= 0 ? "+" : ""}${net.toFixed(1)}/秒・兵力 ${me.pop}/${POP_CAP}`);
    fsub.title = `收入 +${me.income.toFixed(1)}/秒，養兵 -${me.upkeep.toFixed(1)}/秒`;
    fsub.classList.toggle("warn", me.upkeep >= me.income * 0.5 && me.upkeep > 0);
    // 選單裡的開關
    const menuItem = (act: string, html: string) => {
      const el = this.top.querySelector<HTMLElement>(`[data-act="${act}"]`)!;
      if (el.dataset.html !== html) {
        el.dataset.html = html;
        el.innerHTML = html;
      }
      return el;
    };
    menuItem("music", `${isMusicOn() ? ICON_MUSIC : ICON_MUSIC_OFF}配樂：${isMusicOn() ? "開" : "關"}<kbd>N</kbd>`);
    menuItem("mute", `${isMuted() ? ICON_MUTED : ICON_SOUND}音效：${isMuted() ? "關" : "開"}<kbd>M</kbd>`);
    const fs = menuItem("fs", document.fullscreenElement ? `${ICON_FS_EXIT}離開全螢幕` : `${ICON_FS}全螢幕`);
    fs.classList.toggle("hidden", isStandalone());
  }

  private onTopClick = async (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    initAudio();
    const act = el.dataset.act;
    if (act === "menu") {
      const pop = this.top.querySelector<HTMLElement>(".menu-pop")!;
      const open = pop.classList.contains("hidden");
      this.closePops();
      pop.classList.toggle("hidden", !open);
      el.setAttribute("aria-expanded", String(open));
      play("click", 0.5);
    } else if (act === "music") toggleMusic();
    else if (act === "mute") toggleMute();
    else if (act === "fs") {
      if (isFullscreen()) await exitFullscreen();
      else {
        const tip = await enterFullscreen();
        if (tip) this.showToast(tip, 5000);
      }
    } else if (act === "quit") {
      // 按兩下才離開，避免誤觸
      if (el.dataset.confirm) this.onLeave();
      else {
        el.dataset.confirm = "1";
        el.textContent = "確定離開？電腦會接手";
      }
    }
  };

  /** 點到選單、升級、改建以外的地方就收起來 */
  private onOutside = (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest?.(".menu-pop, .menu-btn, .ups-pop, [data-act='ups'], .spec-pop, [data-act='spec']")) return;
    this.closePops();
  };

  private closePops() {
    const pop = this.top.querySelector<HTMLElement>(".menu-pop");
    if (pop && !pop.classList.contains("hidden")) {
      pop.classList.add("hidden");
      this.top.querySelector('[data-act="menu"]')?.setAttribute("aria-expanded", "false");
      const quit = pop.querySelector<HTMLElement>('[data-act="quit"]');
      if (quit) {
        delete quit.dataset.confirm;
        quit.textContent = "離開對局";
      }
    }
    this.bottom.querySelector(".hud-actions")?.classList.remove("ups-open");
    this.bottom.querySelector('[data-act="ups"]')?.setAttribute("aria-expanded", "false");
    this.specOpen = false;
    this.bottom.querySelector(".spec-pop")?.classList.add("hidden");
  }

  /** 打開下方的據點抽屜（點自己的堡壘、或 Tab 切換據點） */
  private openDrawer(node: number) {
    if (node < 0 || !session.ownsNode(node)) return;
    this.drawerOpen = true;
    this.padNode = node;
    this.lastPad = -1;
    this.specOpen = false;
    this.bottom.querySelector(".spec-pop")?.classList.add("hidden");
  }

  private closeDrawer() {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    this.specOpen = false;
    this.bottom.querySelector(".spec-pop")?.classList.add("hidden");
  }

  private buildBottom() {
    this.builtFor = this.mapId;
    const hk = !isMobile();
    const cards = UNIT_TYPES.map((t) => {
      const d = UNITS[t];
      const gi = UNIT_GROUPS.findIndex((g) => g.types.includes(t));
      return `<button class="ucard" data-buy="${t}" data-group="${gi}" title="${d.name}：${d.short}（人口 ${d.pop}）">${hk ? `<b class="hk">${d.hotkey}</b>` : ""}<span class="uc-have"></span>${unitIcon(t, 26)}<span class="cn">${d.name}</span><span class="cc">$${d.cost}</span></button>`;
    }).join("");
    const air = AIR_KINDS.map((k) => {
      const d = AIRCRAFT[k];
      return `<button class="act air a-${k}" data-air="${k}" title="${d.short}${hk ? `（${d.hotkey}）` : ""}"><span class="act-in">${unitIcon(k, k === "bomber" ? 24 : 20)}<span class="an">${d.name}</span><span class="ac">$${d.cost}</span></span></button>`;
    }).join("");
    const ups = UPGRADE_KINDS.map((k) => {
      const d = UPGRADES[k];
      return `<button class="up-card" data-up="${k}" title="${d.short}"><b data-up-name="${k}"></b><small>${d.short}</small><em data-up-cost="${k}"></em>${hk ? `<i class="hk">${d.hotkey}</i>` : ""}</button>`;
    }).join("");
    this.bottom.innerHTML = `
      <div class="hud-actions">${air}
        <button class="act ups" data-act="ups" aria-expanded="false"><span class="act-in">${ICON_UP}<span class="an">升級</span><span class="ac" data-ups-n></span></span></button>
        <div class="ups-pop"><p class="pop-title">升級<span>全軍生效</span></p>${ups}</div>
      </div>
      <div class="drawer hidden" role="region" aria-label="據點">
        <section class="dr-fort">
          <div class="dr-head"><span data-fort-emb></span><b class="fort-name" data-fort-name></b><span class="fort-kind" data-fort-kind></span></div>
          <div class="dr-meter"><span>駐軍</span><b data-fort-used></b></div>
          <div class="gbar"><i data-fort-bar></i></div>
          <p class="fort-sub" data-fort-sub></p>
          <div class="dr-ctl">
            <button class="fort-spec" data-act="spec">改建</button>
            <button class="fort-toggle" data-act="enter" aria-pressed="true"></button>
          </div>
        </section>
        <section class="dr-buy">
          <div class="dr-tabs"><span class="dr-label">買兵</span>${UNIT_GROUPS.map((g, i) => `<button data-tab="${i}">${g.name}</button>`).join("")}<span class="dr-hint">${hk ? "數字鍵也能買・Shift 點一次買 5" : "點一下買 1・長按買 5"}</span></div>
          <div class="ucards">${cards}</div>
        </section>
        <section class="dr-send">
          <div class="dr-send-head"><span class="dr-label" data-send-label></span><button data-act="pick-all">全選</button><button data-act="pick-none">清除</button></div>
          <div class="pick-chips" data-chips></div>
          <label class="hunt-row hidden" data-hunt-row>${ICON_TARGET}<span>特種部隊獵殺</span><select data-hunt aria-label="特種部隊要獵殺的兵種">${huntOptions()}</select></label>
          <p class="drag-hint">${ICON_DRAG}<span>從堡壘<b>拖曳</b>到目的地派兵</span></p>
        </section>
        <button class="dr-close" data-act="close-drawer" aria-label="收起據點面板">${ICON_X}</button>
      </div>
      <div class="spec-pop hidden"></div>`;
  }

  /** 選到的據點丟了就換回大本營；選到的部隊死了或進駐了就移出選取 */
  private ensureSelection(me: PlayerState) {
    const s = session.state!;
    if (!session.ownsNode(session.selectedNode)) {
      this.closeDrawer();
      let next = session.ownsNode(me.hq) ? me.hq : -1;
      if (next < 0) for (let i = 0; i < s.nodes.length; i++) if (session.ownsNode(i)) { next = i; break; }
      session.selectedNode = next;
      session.clearPicks();
    }
    if (session.selectedUnits.length) {
      const alive = session.selectedUnits.filter((id) => {
        const u = s.units.get(id);
        return !!u && u.inNode < 0 && u.owner === me.id;
      });
      if (alive.length !== session.selectedUnits.length) {
        session.selectedUnits = alive;
        bus.emit("unitsSelected", alive);
      }
    }
  }

  private renderBottom(me: PlayerState) {
    const s = session.state!;
    const dead = !me.alive || s.phase !== "playing";
    this.bottom.classList.toggle("dead", dead);
    if (dead) this.drawerOpen = false;
    // 右下：空軍（外圈是冷卻）、升級
    AIR_KINDS.forEach((k, i) => {
      const el = this.bottom.querySelector<HTMLElement>(`[data-air="${k}"]`);
      if (!el) return;
      const d = AIRCRAFT[k];
      const left = (me.airReady[i] ?? 0) - s.time;
      const cooling = left > 0.05;
      el.style.setProperty("--p", cooling ? Math.max(0, Math.min(1, 1 - left / d.cooldown)).toFixed(3) : "1");
      el.classList.toggle("cooling", cooling);
      el.classList.toggle("poor", me.funds < d.cost);
      el.classList.toggle("ready", !cooling && me.funds >= d.cost);
      el.classList.toggle("armed", session.airMode === k);
      setText(el.querySelector(".ac")!, cooling ? `${left >= 10 ? Math.ceil(left) : left.toFixed(1)}s` : `$${d.cost}`);
    });
    let canUp = 0;
    UPGRADE_KINDS.forEach((k) => {
      const lvl = me[k];
      const max = lvl >= MAX_UPGRADE_LEVEL;
      const price = max ? 0 : UPGRADES[k].costs[lvl];
      if (!max && me.funds >= price) canUp++;
      setText(this.bottom.querySelector(`[data-up-name="${k}"]`)!, `${UPGRADES[k].name} Lv${lvl}`);
      setText(this.bottom.querySelector(`[data-up-cost="${k}"]`)!, max ? "已滿級" : `$${price}`);
      const el = this.bottom.querySelector<HTMLButtonElement>(`[data-up="${k}"]`)!;
      el.classList.toggle("poor", !max && me.funds < price);
      el.disabled = max;
    });
    setText(this.bottom.querySelector("[data-ups-n]")!, canUp ? `可升 ${canUp}` : `Lv ${me.firepower + me.armor + me.logistics}`);
    this.bottom.querySelector('[data-act="ups"]')!.classList.toggle("hot", canUp > 0);

    // 下方抽屜：點堡壘才出現
    const drawer = this.bottom.querySelector<HTMLElement>(".drawer")!;
    drawer.classList.toggle("hidden", !this.drawerOpen);
    document.body.classList.toggle("drawer-open", this.drawerOpen);
    if (!this.drawerOpen) return;
    const node = session.selectedNode;
    const n = node >= 0 ? s.nodes[node] : undefined;
    const nd = node >= 0 ? this.map?.nodes[node] : undefined;
    const inside = node >= 0 ? session.garrison(node) : [];
    const have = UNIT_TYPES.map((t) => inside.filter((u) => u.type === t).length);
    // 選的數量不能超過駐軍
    UNIT_TYPES.forEach((_, i) => {
      if (session.picks[i] > have[i]) session.picks[i] = have[i];
    });
    let used = 0;
    s.units.forEach((u) => {
      if (u.owner === me.id && u.inNode === node) used += UNITS[u.type as UnitType]?.pop ?? 1;
    });
    const specOn = n && n.spec && s.time >= n.specAt ? (n.spec as FortSpec) : "";
    const cap = n ? (GARRISON_CAP[n.kind] ?? GARRISON_CAP.fort) + (specOn === "barracks" ? BARRACKS_CAP : specOn === "battery" ? BATTERY_CAP : 0) : 0;
    const f = FACTIONS[me.faction];
    const emb = this.bottom.querySelector<HTMLElement>("[data-fort-emb]")!;
    if (!emb.firstChild) emb.innerHTML = emblem(f.emblem, f.css, f.mark, 16);
    setText(this.bottom.querySelector("[data-fort-name]")!, node >= 0 ? this.nodeName(node) : "沒有據點");
    const kindName = specOn ? FORT_SPEC_DEFS[specOn as Exclude<FortSpec, "">].name : n?.kind === "hq" ? "" : nd?.big ? "大型堡壘" : "一般堡壘";
    setText(this.bottom.querySelector("[data-fort-kind]")!, kindName);
    setText(this.bottom.querySelector("[data-fort-used]")!, `${used} / ${cap}`);
    this.bottom.querySelector<HTMLElement>("[data-fort-bar]")!.style.width = `${cap ? Math.min(100, (used / cap) * 100) : 0}%`;
    const grace = n ? Math.ceil(n.incomeAt - s.time) : 0;
    const converting = n && n.spec ? Math.ceil(n.specAt - s.time) : 0;
    const fire = Math.round(Math.min(GARRISON_FIRE_MAX, used * GARRISON_FIRE_BONUS) * 100);
    const sub = !n ? "" : converting > 0 ? `改建中，還要 ${converting} 秒` : grace > 0 ? `剛佔下，整頓 ${grace} 秒才有收入` : `火力 +${fire}%・血 ${Math.round(n.hp).toLocaleString()}/${Math.round(n.maxHp).toLocaleString()}`;
    setText(this.bottom.querySelector("[data-fort-sub]")!, sub);
    const specBtn = this.bottom.querySelector<HTMLButtonElement>('[data-act="spec"]')!;
    specBtn.disabled = !n || n.kind === "hq" || converting > 0;
    setText(specBtn, n?.kind === "hq" ? "大本營不能改建" : converting > 0 ? "改建中" : "改建");
    specBtn.setAttribute("aria-expanded", String(this.specOpen));
    if (specBtn.disabled && this.specOpen) {
      this.specOpen = false;
      this.bottom.querySelector(".spec-pop")?.classList.add("hidden");
    }
    const tog = this.bottom.querySelector<HTMLElement>('[data-act="enter"]')!;
    setText(tog, session.enter ? "佔領後進駐 ✓" : "佔領後進駐 ✗");
    tog.classList.toggle("on", session.enter);
    tog.setAttribute("aria-pressed", String(session.enter));
    // 買兵：分頁＋卡片
    this.bottom.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => {
      const on = Number(b.dataset.tab) === this.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    UNIT_TYPES.forEach((t, i) => {
      const card = this.bottom.querySelector<HTMLElement>(`.ucard[data-buy="${t}"]`);
      if (!card) return;
      const d = UNITS[t];
      const price = specOn === "barracks" ? Math.round(d.cost * BARRACKS_DISCOUNT) : d.cost;
      setText(card.querySelector(".cc")!, `$${price}`);
      setText(card.querySelector(".uc-have")!, have[i] ? `×${have[i]}` : "");
      card.classList.toggle("off", Number(card.dataset.group) !== this.tab);
      card.classList.toggle("poor", me.funds < price);
      card.classList.toggle("full", used + d.pop > cap || me.pop + d.pop > POP_CAP);
    });
    // 派出：駐軍有的兵種，點一下多選一支（到上限回到 0）
    const total = have.reduce((a, b) => a + b, 0);
    const picked = session.picks.reduce((a, b) => a + b, 0);
    const sendLabel = this.bottom.querySelector<HTMLElement>("[data-send-label]")!;
    setText(sendLabel, picked ? `派出 ${picked} 支` : total ? `派出：全部 ${total} 支` : "派出");
    sendLabel.title = "沒選數量就是全部派出";
    const chips = UNIT_TYPES.map((t, i) => (have[i] ? `<button class="pick-chip${session.picks[i] ? " on" : ""}" data-pick="${t}" aria-pressed="${session.picks[i] > 0}">${UNITS[t].name} ${session.picks[i]}/${have[i]}</button>` : "")).join("");
    const huntRow = this.bottom.querySelector<HTMLElement>("[data-hunt-row]")!;
    const hasHunter = UNIT_TYPES.some((t, i) => isHunter(t) && have[i] > 0);
    huntRow.classList.toggle("hidden", !hasHunter);
    const huntSel = huntRow.querySelector<HTMLSelectElement>("select")!;
    if (document.activeElement !== huntSel && huntSel.value !== session.hunt) huntSel.value = session.hunt;
    huntSel.classList.toggle("on", !!session.hunt);
    const box = this.bottom.querySelector<HTMLElement>("[data-chips]")!;
    const html = chips || '<p class="pick-empty">堡壘裡還沒有兵，先在左邊買</p>';
    if (box.dataset.html !== html) {
      box.dataset.html = html;
      box.innerHTML = html;
    }
  }

  /**
   * 下方被蓋住多高（據點抽屜，或選部隊時的指令列）：告訴地圖，地圖就能多往上捲，
   * 被蓋住的據點、部隊捲上來還是點得到；抽屜剛打開時把選的據點捲到抽屜上方
   */
  private syncViewPad() {
    let pad = 0;
    if (this.drawerOpen) {
      pad = this.bottom.querySelector<HTMLElement>(".drawer")!.offsetHeight;
      if (pad) document.documentElement.style.setProperty("--drawer-h", `${pad}px`);
    } else if (!this.groupBar.classList.contains("hidden")) {
      const r = this.groupBar.getBoundingClientRect();
      pad = Math.max(0, window.innerHeight - r.top + 8);
    }
    pad = Math.round(pad);
    if (pad === this.lastPad && this.padNode < 0) return;
    this.lastPad = pad;
    bus.emit("viewPad", { bottom: pad, node: this.drawerOpen ? this.padNode : -1 });
    if (pad > 0 || !this.drawerOpen) this.padNode = -1;
  }

  /** 選到部隊時的指令列（左下，全圖鈕旁邊）：組成、平均血量、去哪，停下／撤退／到了進駐／取消 */
  private renderGroupBar() {
    const s = session.state!;
    const ids = session.selectedUnits;
    const bar = this.groupBar;
    if (!ids.length || s.phase !== "playing") {
      bar.classList.add("hidden");
      return;
    }
    const units = ids.map((id) => s.units.get(id)).filter((u): u is UnitState => !!u);
    const byType = new Map<string, number>();
    let hp = 0;
    let maxHp = 0;
    units.forEach((u) => {
      byType.set(u.type, (byType.get(u.type) ?? 0) + 1);
      hp += u.hp;
      maxHp += u.maxHp;
    });
    const comp = [...byType.entries()].map(([t, c]) => `${UNITS[t as UnitType]?.name ?? t} ×${c}`).join("・");
    const first = units[0];
    let where = "";
    if (first) {
      if (first.mode === "retreat") where = "撤退中";
      else if (first.destNode >= 0) where = `${first.mode === "hold" ? "守在" : "前往"} ${this.nodeName(first.destNode)}`;
      else where = first.mode === "hold" ? "原地待命" : "前往路上";
    }
    const ratio = maxHp ? hp / maxHp : 0;
    const hpColor = ratio > 0.6 ? "#9fd48a" : ratio > 0.3 ? "#e0a83c" : "#ff8a70";
    // 停在自己據點上、還沒進去的部隊：直接進駐（這時「到了進駐」用不到，換成它）
    const parked =
      !!first && units.every((u) => u.mode === "hold" && u.destNode === first.destNode) && first.destNode >= 0 && session.ownsNode(first.destNode);
    // 按鈕只建一次，之後只改文字和狀態：重畫按鈕會讓剛好按下去的那一下失效
    if (!bar.querySelector(".gb-info")) {
      const hk = (k: string) => (isMobile() ? "" : `<kbd>${k}</kbd>`);
      bar.innerHTML = `<div class="gb-info">
          <span class="gb-title"><b data-gb-n></b><span class="gb-where" data-gb-where></span></span>
          <span class="gb-sub"><span class="gb-hp"><i data-gb-hp></i></span><span class="gb-comp" data-gb-comp></span></span>
        </div>
        <label class="gb-hunt hidden" data-gb-huntrow title="特種部隊要獵殺的兵種">${ICON_TARGET}<select data-gb-hunt aria-label="特種部隊要獵殺的兵種">${huntOptions()}</select></label>
        <button data-g="garrison" class="on">${ICON_FORT}進駐</button>
        <button data-g="halt">${ICON_STOP}停下${hk("S")}</button>
        <button data-g="retreat">${ICON_BACK}撤退${hk("R")}</button>
        <button data-g="enter"><span data-gb-check>${ICON_CHECK}</span><span data-gb-enter></span>${hk("E")}</button>
        <button data-g="close" class="gb-x" aria-label="取消選取">${ICON_X}</button>`;
    }
    const q = <T extends HTMLElement>(sel: string) => bar.querySelector<T>(sel)!;
    setText(q("[data-gb-n]"), `${units.length} 支`);
    setText(q("[data-gb-comp]"), `${Math.round(ratio * 100)}%・${comp}`);
    q("[data-gb-comp]").title = comp;
    setText(q("[data-gb-where]"), where);
    const hpBar = q("[data-gb-hp]");
    hpBar.style.width = `${Math.round(ratio * 100)}%`;
    hpBar.style.background = hpColor;
    // 有特種部隊才出現「獵殺目標」選單；選單打開時不要去改它的值
    const hunters = units.filter((u) => isHunter(u.type));
    q("[data-gb-huntrow]").classList.toggle("hidden", hunters.length === 0);
    const huntSel = q<HTMLSelectElement>("[data-gb-hunt]");
    if (hunters.length && document.activeElement !== huntSel) huntSel.value = hunters[0].hunt ?? "";
    huntSel.classList.toggle("on", !!huntSel.value);
    q("[data-g='garrison']").classList.toggle("hidden", !parked);
    q<HTMLButtonElement>("[data-g='halt']").disabled = first?.mode === "hold" && first.destNode < 0;
    q<HTMLButtonElement>("[data-g='retreat']").disabled = first?.mode === "retreat";
    const enter = q("[data-g='enter']");
    enter.classList.toggle("hidden", parked);
    enter.classList.toggle("on", session.enter);
    enter.setAttribute("aria-pressed", String(session.enter));
    q("[data-gb-check]").classList.toggle("hidden", !session.enter);
    setText(q("[data-gb-enter]"), session.enter ? "到了進駐" : "不進駐");
    bar.classList.remove("hidden");
  }

  private nodeName(node: number) {
    const me = session.me();
    if (me && node === me.hq) return "大本營";
    const owner = session.ownerOf(node);
    const nd = this.map?.nodes[node];
    if (owner && nd?.kind === "hq") return `${FACTIONS[owner.faction].name}大本營`;
    return nd?.name ?? "";
  }

  private refreshAir() {
    const mode = session.airMode;
    this.targetHint.classList.toggle("hidden", !mode);
    if (mode)
      $("target-text").textContent = isMobile()
        ? `${mode === "bomber" ? "轟炸機" : "運輸機"}待命：點任一條道路下令`
        : `${mode === "bomber" ? "轟炸機" : "運輸機"}待命：點地圖上任一條道路下令（右鍵或 Esc 取消）`;
  }

  // ================================================================ 操作

  private onClick = (e: MouseEvent) => {
    initAudio();
    const el = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!el) return;
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const act = el.dataset.act;
    if (act === "ups") {
      const box = this.bottom.querySelector(".hud-actions")!;
      const open = !box.classList.contains("ups-open");
      this.closePops();
      box.classList.toggle("ups-open", open);
      el.setAttribute("aria-expanded", String(open));
      play("click");
      return;
    }
    if (act === "close-drawer") {
      this.closeDrawer();
      play("click", 0.4);
      return;
    }
    if (el.dataset.tab !== undefined) {
      this.tab = Number(el.dataset.tab);
      play("click", 0.4);
      return;
    }
    if (act === "spec") {
      this.specOpen = !this.specOpen;
      const pop = this.bottom.querySelector<HTMLElement>(".spec-pop")!;
      pop.classList.toggle("hidden", !this.specOpen);
      if (this.specOpen) this.renderSpecPop();
      play("click", 0.5);
      return;
    }
    if (el.dataset.spec !== undefined) {
      session.send("convert", { node: session.selectedNode, spec: el.dataset.spec });
      this.specOpen = false;
      this.bottom.querySelector(".spec-pop")?.classList.add("hidden");
      play("click", 0.7);
      return;
    }
    if (el.dataset.buy) this.buy(el.dataset.buy as UnitType, e.shiftKey ? 5 : 1, el);
    else if (el.dataset.pick) this.pick(el.dataset.pick as UnitType, 1, true);
    else if (act === "pick-all") this.pickAll();
    else if (act === "pick-none") {
      session.clearPicks();
      play("click", 0.5);
    } else if (act === "enter") {
      session.enter = !session.enter;
      play("click", 0.5);
    } else if (el.dataset.air) this.armAir(el.dataset.air as AirKind);
    else if (el.dataset.up) {
      session.send("upgrade", { kind: el.dataset.up });
      play("click");
    }
  };

  /** 手機：在兵種卡上長按 = 一次買 5 支 */
  private onPress = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-buy]");
    window.clearTimeout(this.pressTimer);
    if (!el || e.pointerType === "mouse") return;
    this.pressTimer = window.setTimeout(() => {
      this.buy(el.dataset.buy as UnitType, 5, el);
      this.suppressClick = true;
      navigator.vibrate?.(15);
    }, 450);
  };

  private onRelease = () => {
    window.clearTimeout(this.pressTimer);
  };

  /** 改建選單：五種堡壘＋改回標準（在抽屜上方、右邊，不蓋住剛選的堡壘） */
  private renderSpecPop() {
    const s = session.state!;
    const n = s.nodes[session.selectedNode];
    const cur = n?.spec ?? "";
    const me = session.me();
    const rows = [
      ...FORT_SPECS.map((k) => {
        const d = FORT_SPEC_DEFS[k];
        const poor = (me?.funds ?? 0) < d.cost;
        return `<button class="spec-row${cur === k ? " cur" : ""}${poor ? " poor" : ""}" data-spec="${k}"${cur === k ? " disabled" : ""}>
          <span class="sr-icon sr-${k}"></span><b>${d.name}</b><em>$${d.cost}</em><small>${d.short}</small></button>`;
      }),
      `<button class="spec-row${cur === "" ? " cur" : ""}" data-spec=""${cur === "" ? " disabled" : ""}><span class="sr-icon"></span><b>標準堡壘</b><em>免費</em><small>拆掉改建，回到一般堡壘</small></button>`,
    ].join("");
    const pop = this.bottom.querySelector<HTMLElement>(".spec-pop")!;
    pop.innerHTML = `<p class="sp-title">改建 ${this.nodeName(session.selectedNode)}<span>施工 10 秒，期間被攻破就變回標準堡壘</span></p>${rows}`;
  }

  /** 右鍵點數量 = 減一 */
  private onContext = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-pick]");
    if (!el) return;
    e.preventDefault();
    this.pick(el.dataset.pick as UnitType, -1, false);
  };

  private onGroupClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-g]");
    if (!el) return;
    const ids = session.selectedUnits;
    if (el.dataset.g === "retreat") this.retreat();
    else if (el.dataset.g === "halt") this.halt();
    else if (el.dataset.g === "garrison") {
      const first = session.state!.units.get(ids[0]);
      if (first && first.destNode >= 0) {
        session.send("order", { units: ids, via: [], dest: { node: first.destNode }, enter: true });
        play("click", 0.6);
      }
    } else if (el.dataset.g === "enter") {
      session.enter = !session.enter;
      // 已經在往某個據點走的部隊：用新的設定再下一次同樣的指令
      const s = session.state!;
      const first = s.units.get(ids[0]);
      if (first && first.destNode >= 0 && first.mode !== "retreat") {
        session.send("order", { units: ids, via: [], dest: { node: first.destNode }, enter: session.enter });
      }
      play("click", 0.5);
    } else if (el.dataset.g === "close") {
      session.selectedUnits = [];
      bus.emit("unitsSelected", []);
    }
  };

  private halt() {
    if (!session.selectedUnits.length) return;
    session.send("halt", { units: session.selectedUnits });
    play("click", 0.6);
  }

  private retreat() {
    if (!session.selectedUnits.length) return;
    session.send("retreat", { units: session.selectedUnits });
    play("click", 0.7);
    this.addFeed("部隊撤退中，回到最近的據點會自動進駐回血", "#f4f1e6");
  }

  private buy(type: UnitType, count: number, el: HTMLElement | null) {
    const node = session.selectedNode;
    if (node < 0) return;
    session.send("buy", { node, type, count });
    el?.classList.remove("flash");
    void el?.offsetWidth;
    el?.classList.add("flash");
    play("deploy", 0.6);
  }

  /** 調整要派出的數量；wrap = 加到超過駐軍數就回到 0（手機點一下循環） */
  private pick(type: UnitType, step: number, wrap: boolean) {
    const i = UNIT_TYPES.indexOf(type);
    const have = session.garrison(session.selectedNode).filter((u) => u.type === type).length;
    if (have === 0) {
      this.showToast("這座據點裡沒有這種兵，先點左邊買");
      return;
    }
    let v = session.picks[i] + step;
    if (v > have) v = wrap ? 0 : have;
    if (v < 0) v = 0;
    session.picks[i] = v;
    play("click", 0.4);
  }

  private pickAll() {
    const inside = session.garrison(session.selectedNode);
    session.picks = UNIT_TYPES.map((t) => inside.filter((u) => u.type === t).length);
    play("click", 0.5);
  }

  private cycleNode(step: number) {
    const s = session.state!;
    const list: number[] = [];
    for (let i = 0; i < s.nodes.length; i++) if (session.ownsNode(i)) list.push(i);
    if (!list.length) return;
    const idx = list.indexOf(session.selectedNode);
    session.selectedNode = list[(idx + step + list.length) % list.length];
    session.clearPicks();
    bus.emit("nodeSelected", session.selectedNode);
    this.openDrawer(session.selectedNode);
  }

  private onKey = (e: KeyboardEvent) => {
    if (session.state?.phase !== "playing") return;
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    initAudio();
    const k = e.key.toUpperCase();
    const me = session.me();
    if (!me || !this.map) return;
    if (k === "ESCAPE") {
      this.closePops();
      this.closeDrawer();
      session.airMode = null;
      bus.emit("airMode", null);
      bus.emit("cancelDrag");
      this.openBuildMenu(null);
      if (session.selectedUnits.length) {
        session.selectedUnits = [];
        bus.emit("unitsSelected", []);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return this.cycleNode(e.shiftKey ? -1 : 1);
    }
    if (k === "R") return this.retreat();
    if (k === "S") return this.halt();
    if (k === "E") {
      session.enter = !session.enter;
      return;
    }
    if (k === "A") return this.pickAll();
    // 數字鍵：買兵（Shift + 數字 = 多選一支要派出的）
    const code = /^Digit(\d)$/.exec(e.code)?.[1] ?? (e.code === "Minus" ? "-" : e.code === "Equal" ? "=" : undefined);
    const unit = UNIT_TYPES.find((t) => UNITS[t].hotkey === (code ?? k));
    if (unit) {
      this.tab = Math.max(0, UNIT_GROUPS.findIndex((g) => g.types.includes(unit)));
      if (e.shiftKey) return this.pick(unit, 1, false);
      return this.buy(unit, 1, this.bottom.querySelector(`[data-buy="${unit}"]`));
    }
    const air = AIR_KINDS.find((a) => AIRCRAFT[a].hotkey === k);
    if (air) return this.armAir(air);
    const up = UPGRADE_KINDS.find((u) => UPGRADES[u].hotkey === k);
    if (up) {
      session.send("upgrade", { kind: up });
      play("click");
    }
    if (k === "M") toggleMute();
    if (k === "N") toggleMusic();
  };

  private armAir(kind: AirKind) {
    this.closeDrawer();
    this.closePops();
    session.airMode = session.airMode === kind ? null : kind;
    bus.emit("airMode", session.airMode);
    play("click");
  }

  private openBuildMenu(m: { lane: number; node: number; slot: number; x: number; y: number } | null) {
    if (!m) {
      this.buildMenu.classList.add("hidden");
      return;
    }
    const me = session.me();
    this.buildMenu.innerHTML =
      `<p>蓋工事<small style="display:block;color:#a89f84;font-weight:500;font-size:11px">要施工一段時間，派工兵到旁邊會蓋得比較快</small></p>` +
      BUILD_KINDS.map((k) => {
        const d = STRUCTURES[k];
        const poor = (me?.funds ?? 0) < d.cost;
        return `<button data-build="${k}" data-lane="${m.lane}" data-node="${m.node}" data-slot="${m.slot}"${poor ? ' style="opacity:.6"' : ""}><span>${d.name}<br><small style="color:#a89f84;font-weight:500">${d.short}・施工 ${d.buildTime ?? 10} 秒</small></span><em>$${d.cost}</em></button>`;
      }).join("");
    const w = 220;
    this.buildMenu.style.left = `${Math.min(window.innerWidth - w - 8, m.x + 12)}px`;
    this.buildMenu.style.top = `${Math.max(8, Math.min(window.innerHeight - 220, m.y - 40))}px`;
    this.buildMenu.classList.remove("hidden");
  }

  private onBuildClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-build]");
    if (!el) return;
    session.send("build", { kind: el.dataset.build, lane: Number(el.dataset.lane), node: Number(el.dataset.node), slot: Number(el.dataset.slot) });
    this.buildMenu.classList.add("hidden");
    play("deploy", 0.7);
  };

  // ================================================================ 提示

  showToast(text: string, ms = 1800) {
    this.toast.textContent = text;
    this.toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), ms);
  }

  /** 大提示字：顯示在上方，點一下就關掉，幾秒後自己消失 */
  showBanner(kind: string, text: string, sub?: string, color?: string, ms = 2400) {
    const div = document.createElement("div");
    div.className = `b ${kind}`;
    div.setAttribute("role", "status");
    div.title = "點一下關閉";
    if (color) div.style.setProperty("--fc", color);
    div.style.setProperty("--life", `${ms}ms`);
    div.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ""}<span class="b-x" aria-hidden="true">✕</span>`;
    const close = () => {
      div.classList.add("closing");
      setTimeout(() => div.remove(), 180);
    };
    div.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      close();
    });
    this.banner.innerHTML = "";
    this.banner.appendChild(div);
    setTimeout(() => div.isConnected && div.remove(), ms + 400);
  }

  private onEvent(m: { kind: EventKind; players?: string[] }) {
    const ev = EVENTS[m.kind];
    if (!ev) return;
    if (m.kind === "reinforce") {
      const mine = m.players?.includes(session.myId);
      if (mine) this.showBanner("gold", "援軍抵達！", "大本營多了 2 個步兵班、1 個機槍組", undefined, 3500);
      else this.addFeed(`援軍抵達：堡壘最少的玩家獲得援軍`, "#f2c14e");
      play("event", 0.8);
      return;
    }
    const danger = m.kind === "barrage" || m.kind === "storm";
    this.showBanner(danger ? "red" : "gold", ev.name, ev.desc, undefined, 3500);
    play(m.kind === "barrage" ? "siren" : "event", 0.8);
  }

  addFeed(text: string, color = "#f2c14e") {
    const p = document.createElement("p");
    p.style.borderLeftColor = color;
    p.textContent = text;
    this.feed.prepend(p);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => p.remove(), 7000);
  }

  private onAirIncoming(m: { owner: string; faction: number; kind: AirKind; lane: number }) {
    const me = session.me();
    if (!me || !this.map) return;
    const f = FACTIONS[m.faction];
    const name = m.kind === "bomber" ? "轟炸機" : "運輸機";
    if (m.owner === me.id) {
      this.addFeed(`${name}起飛！`, f.light);
      return;
    }
    const lane = this.map.lanes[m.lane];
    const threatened = !!lane && (session.ownsNode(lane.a) || session.ownsNode(lane.b));
    if (threatened) {
      this.showBanner("red", m.kind === "bomber" ? "空襲警報！" : "敵軍空降！", `${f.name}的${name}來了`);
      play("siren", 0.8);
    } else {
      this.addFeed(`${f.name}出動${name}`, f.light);
    }
  }

  private onEliminated(m: { name: string; faction: number; by: string; id: string }) {
    const f = FACTIONS[m.faction];
    if (m.id === session.myId) {
      this.showBanner("red", "大本營淪陷", "你已出局，可以繼續觀戰");
      play("defeat", 0.8);
    } else {
      this.showBanner("dark", `<s>${f.name}</s>`, m.by ? `被 ${esc(m.by)} 殲滅` : "已被殲滅", f.light);
    }
    this.addFeed(`${f.name}（${m.name}）出局`, f.light);
  }

  private onHqAlert(m: { owner: string; level: number }) {
    const me = session.me();
    const p = session.state?.players.get(m.owner);
    if (!p) return;
    if (me && m.owner === me.id) {
      this.showBanner("red", m.level >= 2 ? "大本營岌岌可危！" : "大本營遭受猛攻！", m.level >= 2 ? "血量剩不到 25%" : "血量剩一半");
      play("siren", 0.6);
    } else {
      this.addFeed(`${FACTIONS[p.faction].name}大本營血量剩${m.level >= 2 ? "不到 25%" : "一半"}`, FACTIONS[p.faction].light);
    }
  }

  private onCaptured(m: { node: number; by: string; faction: number }) {
    const f = FACTIONS[m.faction];
    const name = this.map?.nodes[m.node]?.name ?? "堡壘";
    if (m.by === session.myId) {
      this.showBanner("gold", `佔領 ${name}！`, "15 秒後開始產錢・可以在據點面板「改建」");
      play("capture", 1);
    } else {
      this.addFeed(`${f?.name ?? ""}佔領了${name}`, f?.light);
      play("capture", 0.35);
    }
  }

  private onFortFallen(m: { node: number; owner: string; faction: number; by: string }) {
    const name = this.map?.nodes[m.node]?.name ?? "堡壘";
    const f = FACTIONS[m.faction];
    if (m.owner === session.myId) {
      this.showBanner("red", `${name}失守！`, "派兵奪回來");
      play("fortLost", 1);
    } else if (m.by === session.myId) {
      this.showBanner("gold", `攻破 ${name}！`, "部隊在旁邊站 3 秒就能佔領");
      play("capture", 0.6);
    } else {
      this.addFeed(`${f?.name ?? ""}的${name}被攻破`, f?.light);
    }
  }

  private onLeader(m: { id: string; faction: number }) {
    const s = session.state;
    if (!s || s.phase !== "playing" || s.time < 5) return;
    if (!m.id) {
      this.addFeed("懸賞解除：沒有人的堡壘比別人多", "#f2c14e");
      return;
    }
    const p = s.players.get(m.id);
    if (m.id === session.myId) {
      this.showBanner("gold", "你被懸賞了！", "堡壘最多：攻破你的堡壘賞金加倍");
      play("siren", 0.5);
    } else if (p) {
      this.addFeed(`懸賞 ${FACTIONS[p.faction].name}：攻破他的堡壘賞金加倍`, FACTIONS[p.faction].light);
    }
  }

  // ================================================================ 結算

  /** 結算：左邊勝負與排名，右邊勢力變化圖，按鈕固定在右下（不會被捲走或被系統提示蓋住） */
  private showResult(sound = true) {
    const s = session.state;
    const me = session.me();
    if (!s || !me) return;
    const win = s.winnerId === me.id;
    const draw = s.winnerId === WINNER_DRAW;
    const [title, en] = draw ? ["平手", "DRAW"] : win ? ["勝利", "VICTORY"] : ["戰敗", "DEFEAT"];
    const players: PlayerState[] = [];
    s.players.forEach((p) => players.push(p));
    players.sort((a, b) => (a.rank || 9) - (b.rank || 9));
    const money = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`);
    const rows = players
      .map((p) => {
        const f = FACTIONS[p.faction];
        const out = this.history?.out.find((o) => o.id === p.id);
        // 陣營看徽章顏色就知道；有電腦難度、出局時間時就不寫陣營名，免得被截掉
        const tags: string[] = [];
        if (p.isBot && isBotLevel(p.botLevel)) tags.push(`電腦 ${BOT_LEVEL_DEFS[p.botLevel].name}`);
        if (!p.alive) tags.push(out ? `${Math.floor(out.t / 60)}:${String(Math.floor(out.t % 60)).padStart(2, "0")} 出局` : "出局");
        if (!tags.length) tags.push(f.name);
        return `<li class="${p.id === me.id ? "me" : ""}${p.alive ? "" : " out"}">
          <span class="rk">${p.rank || "-"}</span>${emblem(f.emblem, f.css, f.mark, 22)}
          <span class="rn"><b>${esc(p.name)}${p.id === me.id ? "（你）" : ""}</b><small style="color:${f.light}">${tags.join("・")}</small></span>
          <span class="rs"><small>佔領</small><b>${p.captures}</b></span>
          <span class="rs"><small>擊殺</small><b>${p.kills}</b></span>
          <span class="rs"><small>花費</small><b>${money(p.spent)}</b></span>
        </li>`;
      })
      .join("");
    const isHost = s.hostId === me.id;
    this.result.innerHTML = `<div class="result-screen">
      <section class="res-left">
        <h2 class="res-title ${draw ? "draw" : win ? "win" : "lose"}">${title}</h2>
        <p class="res-sub"><span class="res-en">${en}</span><span>${esc(s.endReason)}</span></p>
        <ol class="res-rank">${rows}</ol>
      </section>
      <section class="res-chart"><div class="hist-mount"><p class="hist-empty">載入勢力變化圖…</p></div></section>
      <div class="res-foot">
        <p class="res-me">你這局：買兵 ${me.deployed}・花費 $${me.spent.toLocaleString()}・佔領 ${me.captures} 座・擊殺 ${me.kills}</p>
        <div class="res-actions">
          <button class="btn" data-act="leave">離開房間</button>
          ${isHost ? '<button class="btn primary" data-act="again">再戰一局</button>' : '<p class="res-wait">等房主開下一局…</p>'}
        </div>
      </div>
    </div>`;
    this.result.classList.remove("hidden");
    const mount = this.result.querySelector<HTMLElement>(".hist-mount")!;
    if (this.history) mountHistory(mount, this.history, me.id);
    else session.send("history"); // 中途重連的人沒收到廣播，跟伺服器要
    if (sound) play(win ? "victory" : "defeat", 1);
  }

  private onResultClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]");
    if (!el) return;
    if (el.dataset.act === "again") session.send("backToLobby");
    if (el.dataset.act === "leave") this.onLeave();
  };
}
