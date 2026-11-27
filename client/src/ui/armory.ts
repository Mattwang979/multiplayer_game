// 兵種圖鑑：左邊卡片、右邊詳細資料（數值直接讀 shared 的定義，改平衡不用改這裡）
import {
  AIRCRAFT,
  BOMB,
  DAMAGE_TABLE,
  PARA_SQUADS,
  STRUCTURES,
  UNIT_GROUPS,
  UNITS,
  type ArmorClass,
  type WeaponClass,
} from "@frontline/shared";
import { play } from "../game/sound";
import { armoryArt, type ArmoryKind } from "./armory-art";
import { unitIcon } from "./icons";

type Group = "步兵" | "車砲" | "支援" | "空軍" | "工事";
interface Stat {
  label: string;
  value: string;
  ratio?: number; // 0–1，沒有就不畫長條
}
interface Entry {
  kind: ArmoryKind;
  group: Group;
  name: string;
  tag: string; // 卡片右上角的護甲
  armor: string; // 詳細頁的護甲
  cost: number;
  sub: string; // 人口／冷卻／施工
  stats: Stat[];
  weapon: WeaponClass | null; // 拿來算傷害倍率；null = 不打地面
  extra: string[];
  beats: string[];
  fears: string[];
  note: string;
  hotkey?: string;
}

const ARMOR: Record<ArmorClass, [string, string]> = {
  soft: ["軟", "無裝甲"],
  light: ["輕甲", "輕裝甲"],
  hard: ["重甲", "重裝甲"],
  building: ["建築", "建築"],
};

/** 剋誰、怕誰、一句話打法（根據傷害倍率和射程整理） */
const NOTES: Record<ArmoryKind, { beats: string[]; fears: string[]; note: string }> = {
  rifle: { beats: ["反戰車砲", "砲兵"], fears: ["機槍組", "火焰兵", "裝甲車", "戰車"], note: "便宜、人多耐打，適合擋在前面跟搶點。" },
  mg: { beats: ["步兵班", "火焰兵", "工兵", "醫療兵"], fears: ["狙擊手", "戰車", "砲兵"], note: "射程比步兵遠，架在前線就能壓住衝過來的步兵。" },
  sniper: { beats: ["機槍組", "砲兵", "反戰車砲"], fears: ["裝甲車", "戰車"], note: "射程是步兵裡最遠的，一槍一個；但打不穿裝甲。" },
  flame: { beats: ["步兵班", "工兵", "醫療兵"], fears: ["機槍組", "狙擊手", "戰車"], note: "要貼近才燒得到，一次燒一片；跟在戰車後面衝最好。" },
  car: { beats: ["步兵班", "狙擊手", "醫療兵", "砲兵"], fears: ["反戰車砲", "戰車"], note: "全場跑最快，適合搶空堡壘、追殺落單的步兵。" },
  tank: { beats: ["步兵班", "機槍組", "裝甲車", "火焰兵"], fears: ["反戰車砲", "反戰車砲陣地"], note: "機槍和步兵幾乎打不動，但兩門反戰車砲就能很快打掉一輛。" },
  at: { beats: ["戰車", "裝甲車", "防空砲車"], fears: ["步兵班", "機槍組", "狙擊手", "砲兵"], note: "打車輛傷害加倍，打步兵卻只剩三成多，要有步兵護著。" },
  flak: { beats: ["轟炸機", "空降"], fears: ["反戰車砲", "戰車"], note: "跟著部隊走，轟炸機和運輸機飛過就打；也能平射步兵。" },
  artillery: { beats: ["擠在一起的步兵", "反戰車砲", "工事"], fears: ["狙擊手", "裝甲車"], note: "射程最遠、一砲打一片，但太近打不到，要有人擋在前面。" },
  engineer: { beats: ["堡壘", "工事"], fears: ["機槍組", "火焰兵"], note: "爆破建築傷害三倍；待在旁邊能修理建築和車輛、加快蓋工事。" },
  medic: { beats: [], fears: ["機槍組", "砲兵"], note: "不會攻擊，跟著步兵走，幫附近的步兵回血。" },
  commando: { beats: ["指定的兵種"], fears: ["機槍組", "火焰兵", "戰車"], note: "派兵或調度時指定要獵殺的兵種：射程內有就先打它，傷害 +50%、射程 +20%。" },
  bomber: { beats: ["擠在路上的部隊", "工事", "堡壘"], fears: ["防空砲車", "防空砲", "防空要塞"], note: "選一條路地毯式轟炸。開局 30 秒後才能叫，用完要等冷卻。" },
  transport: { beats: ["敵後的砲兵", "沒人守的堡壘"], fears: ["防空砲車", "防空砲", "防空要塞"], note: "運輸機把空降兵丟到指定的地方，適合偷襲敵人後方。" },
  bunker: { beats: ["步兵班", "火焰兵", "工兵"], fears: ["戰車", "砲兵", "轟炸機"], note: "蓋在路邊的 ＋，施工時只有兩成五血、不能開火；附近有工兵蓋得快很多。" },
  atnest: { beats: ["戰車", "裝甲車"], fears: ["步兵班", "砲兵", "工兵"], note: "一發就很痛，戰車開過來會被擋住；但打步兵沒什麼用。" },
  aa: { beats: ["轟炸機", "運輸機"], fears: ["所有地面部隊（它不打地面）"], note: "對空射程比防空砲車還遠，守住重要的堡壘不被轟炸。" },
};

const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ""));
const clamp = (v: number) => Math.max(0.04, Math.min(1, v));

function buildEntries(): Entry[] {
  const out: Entry[] = [];
  for (const g of UNIT_GROUPS) {
    for (const t of g.types) {
      const u = UNITS[t];
      const dps = u.damage / u.cooldown;
      const stats: Stat[] = [
        { label: "生命", value: `${u.hp}`, ratio: clamp(u.hp / 500) },
        u.heal
          ? { label: "治療", value: `${u.heal}/秒×${u.healTargets ?? 1}`, ratio: clamp((u.heal * (u.healTargets ?? 1)) / 30) }
          : { label: "火力", value: `${fmt(dps)}/秒`, ratio: clamp(dps / 30) },
        { label: "射程", value: u.minRange ? `${u.minRange}–${u.range}` : `${u.range}`, ratio: clamp(u.range / 230) },
        { label: "速度", value: `${u.speed}`, ratio: clamp(u.speed / 60) },
      ];
      const extra: string[] = [];
      if (u.splash) extra.push(`範圍傷害 ${u.splash}`);
      if (u.airDamage) extra.push(`對空 ${fmt(u.airDamage / (u.airCooldown ?? 1))}/秒・射程 ${u.airRange}`);
      if (u.repair) extra.push(`修理 ${u.repair}/秒`);
      if (u.members > 1) extra.push(`一支 ${u.members} ${u.armor === "soft" ? "人" : "輛"}`);
      out.push({
        kind: t as ArmoryKind,
        group: g.name as Group,
        name: u.name,
        tag: ARMOR[u.armor][0],
        armor: ARMOR[u.armor][1],
        cost: u.cost,
        sub: `人口 ${u.pop}`,
        stats,
        weapon: u.weapon === "none" ? null : u.weapon,
        extra,
        hotkey: u.hotkey,
        ...NOTES[t as ArmoryKind],
      });
    }
  }
  const b = AIRCRAFT.bomber;
  out.push({
    kind: "bomber", group: "空軍", name: b.name, tag: "空中", armor: "飛機", cost: b.cost, sub: `冷卻 ${b.cooldown} 秒`,
    stats: [
      { label: "生命", value: `${b.hp}`, ratio: clamp(b.hp / 500) },
      { label: "炸彈", value: `${BOMB.count}×${BOMB.damage}` },
      { label: "冷卻", value: `${b.cooldown} 秒` },
      { label: "速度", value: `${b.speed}` },
    ],
    weapon: BOMB.weapon, extra: [`爆炸範圍 ${BOMB.radius}`], hotkey: b.hotkey, ...NOTES.bomber,
  });
  const tr = AIRCRAFT.transport;
  const para = UNITS.para;
  out.push({
    kind: "transport", group: "空軍", name: tr.name, tag: "空中", armor: "飛機", cost: tr.cost, sub: `冷卻 ${tr.cooldown} 秒`,
    stats: [
      { label: "生命", value: `${tr.hp}`, ratio: clamp(tr.hp / 500) },
      { label: "載運", value: `${PARA_SQUADS * para.members} 人` },
      { label: "冷卻", value: `${tr.cooldown} 秒` },
      { label: "速度", value: `${tr.speed}` },
    ],
    weapon: para.weapon, extra: [`丟下 ${PARA_SQUADS} 班空降兵，每班 ${para.members} 人・生命 ${para.hp}・射程 ${para.range}`], hotkey: tr.hotkey, ...NOTES.transport,
  });
  for (const k of ["bunker", "atnest", "aa"] as const) {
    const d = STRUCTURES[k];
    const ground = d.damage > 0;
    const dps = ground ? d.damage / d.cooldown : d.airDamage / d.airCooldown;
    out.push({
      kind: k, group: "工事", name: d.name, tag: "建築", armor: "建築", cost: d.cost, sub: `施工 ${d.buildTime} 秒`,
      stats: [
        { label: "生命", value: `${d.hp}`, ratio: clamp(d.hp / 1000) },
        { label: ground ? "火力" : "對空", value: `${fmt(dps)}/秒`, ratio: clamp(dps / 60) },
        { label: "射程", value: `${ground ? d.range : d.airRange}`, ratio: clamp((ground ? d.range : d.airRange) / 300) },
        { label: "施工", value: `${d.buildTime} 秒` },
      ],
      weapon: ground ? d.weapon : null, extra: [], ...NOTES[k],
    });
  }
  return out;
}

const TABS: ("全部" | Group)[] = ["全部", "步兵", "車砲", "支援", "空軍", "工事"];
const TARGETS: [ArmorClass, string][] = [
  ["soft", "步兵"],
  ["light", "輕甲"],
  ["hard", "重甲"],
  ["building", "建築"],
];

export class Armory {
  private entries = buildEntries();
  private tab: (typeof TABS)[number] = "全部";
  private sel: ArmoryKind = "tank";
  private tabsEl = document.getElementById("arm-tabs")!;
  private grid = document.getElementById("arm-grid")!;
  private detail = document.getElementById("arm-detail")!;

  constructor() {
    this.tabsEl.innerHTML = TABS.map(
      (t) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === this.tab}">${t}</button>`,
    ).join("");
    this.tabsEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
      if (!b) return;
      play("click");
      this.tab = b.dataset.tab as typeof this.tab;
      const list = this.visible();
      if (!list.some((x) => x.kind === this.sel)) this.sel = list[0].kind;
      this.render();
    });
    this.grid.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-kind]");
      if (!b) return;
      play("click");
      this.select(b.dataset.kind as ArmoryKind);
    });
    // 方向鍵換卡片（一排四張）
    this.grid.addEventListener("keydown", (e) => {
      const cols = getComputedStyle(this.grid).gridTemplateColumns.split(" ").filter(Boolean).length || 4;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!step) return;
      e.preventDefault();
      const list = this.visible();
      const i = list.findIndex((x) => x.kind === this.sel);
      const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
      this.select(next.kind);
      this.grid.querySelector<HTMLButtonElement>(`[data-kind="${next.kind}"]`)?.focus();
    });
  }

  open() {
    this.render();
  }

  private visible() {
    return this.tab === "全部" ? this.entries : this.entries.filter((x) => x.group === this.tab);
  }

  private select(kind: ArmoryKind) {
    this.sel = kind;
    this.grid.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    this.renderDetail();
  }

  private render() {
    this.tabsEl.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String((b as HTMLElement).dataset.tab === this.tab)));
    this.grid.innerHTML = this.visible()
      .map(
        (x) => `<button type="button" class="arm-card" data-kind="${x.kind}" aria-pressed="${x.kind === this.sel}">
          <span class="ac-top">${unitIcon(x.kind, 24)}<span class="ac-tag">${x.tag}</span></span>
          <span class="ac-name">${x.name}</span>
          <span class="ac-foot"><b>$${x.cost}</b><span>${x.sub}</span></span>
        </button>`,
      )
      .join("");
    this.renderDetail();
  }

  private renderDetail() {
    const x = this.entries.find((e) => e.kind === this.sel)!;
    const stats = x.stats
      .map(
        (st, i) => `<div class="as${i === 0 ? " hp" : ""}"><span class="as-l">${st.label}</span><span class="as-v">${st.value}</span>
        <span class="as-bar">${st.ratio !== undefined ? `<i style="width:${Math.round(st.ratio * 100)}%"></i>` : ""}</span></div>`,
      )
      .join("");
    const mult = x.weapon
      ? TARGETS.map(([a, label]) => {
          const m = DAMAGE_TABLE[x.weapon!][a];
          const cls = m >= 1.2 ? "good" : m <= 0.5 ? "bad" : "";
          return `<span class="am-chip ${cls}">${label}<b>×${m}</b></span>`;
        }).join("")
      : `<span class="am-none">${x.kind === "medic" ? "不會攻擊" : "不打地面，只打飛機"}</span>`;
    const chips = (list: string[]) => list.map((n) => `<span class="ab-chip">${n}</span>`).join("");
    this.detail.innerHTML = `${armoryArt(x.kind, `${x.name}側面圖`)}
      <div class="ad-head">
        <h3>${x.name}</h3><span class="ad-armor">${x.armor}</span>
        ${x.hotkey ? `<kbd class="ad-key" title="快捷鍵">${x.hotkey}</kbd>` : ""}
        <span class="ad-cost">$${x.cost}・${x.sub}</span>
      </div>
      <p class="ad-note">${x.note}</p>
      ${x.beats.length ? `<div class="ad-row"><span class="ad-k good">剋</span><span class="ad-chips">${chips(x.beats)}</span></div>` : ""}
      <div class="ad-row"><span class="ad-k bad">怕</span><span class="ad-chips">${chips(x.fears)}</span></div>
      <div class="ad-stats">${stats}</div>
      <div class="ad-row"><span class="ad-k">傷害</span><span class="ad-chips">${mult}</span></div>
      ${x.extra.length ? `<p class="ad-extra">${x.extra.join("・")}</p>` : ""}`;
  }
}
