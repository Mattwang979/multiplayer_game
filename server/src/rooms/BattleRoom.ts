// 一個房間 = 一局遊戲。負責大廳（加入、加電腦、開始）、轉送玩家指令給模擬、斷線代管。
import { Room, matchMaker, type Client } from "colyseus";
import {
  FORT_SPECS,
  KICK_CODE,
  type FortSpec,
  type Dest,
  AIR_KINDS,
  MAPS,
  BUILD_KINDS,
  FACTIONS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TICK_RATE,
  UNIT_TYPES,
  UPGRADE_KINDS,
  type AirKind,
  type BuildKind,
  type UnitType,
  type UpgradeKind,
} from "@frontline/shared";
import { Battle } from "../game/Battle";
import { BotBrain } from "../game/Bot";
import { BattleState, Player } from "../game/schema";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BOT_NAMES = ["隆美爾", "巴頓", "朱可夫", "蒙哥馬利", "古德里安", "麥克阿瑟", "艾森豪", "曼施坦因"];

function randomCode(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return Array.from(s).slice(0, 10).join("") || "新兵";
}

const num = (v: unknown) => (typeof v === "number" ? v : NaN);

export class BattleRoom extends Room<{ state: BattleState }> {
  maxClients = MAX_PLAYERS;
  maxMessagesPerSecond = 40;
  state = new BattleState();

  private battle!: Battle;
  private bots = new Map<string, BotBrain>();
  private botCounter = 0;

  messages = {
    // ---------- 大廳 ----------
    addBot: (client: Client, msg: { faction?: number }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      const faction = typeof msg?.faction === "number" && this.factionFree(msg.faction) ? msg.faction : this.freeFaction();
      if (faction < 0) return this.notice(client, "房間已滿");
      const p = new Player();
      p.id = `bot${++this.botCounter}`;
      p.name = BOT_NAMES[(this.botCounter - 1) % BOT_NAMES.length];
      p.faction = faction;
      p.isBot = p.wasBot = true;
      this.state.players.set(p.id, p);
      this.syncMatchmaking();
    },
    removePlayer: (client: Client, msg: { id?: string }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      const p = typeof msg?.id === "string" ? this.state.players.get(msg.id) : undefined;
      if (!p || p.id === client.sessionId) return;
      if (p.wasBot) {
        this.state.players.delete(p.id);
        this.syncMatchmaking();
      } else {
        const c = this.clients.getById(p.id);
        c?.leave(KICK_CODE);
      }
    },
    setFaction: (client: Client, msg: { faction?: number }) => {
      if (this.state.phase !== "lobby") return;
      const p = this.state.players.get(client.sessionId);
      const f = num(msg?.faction);
      if (p && Number.isInteger(f) && f >= 0 && f < FACTIONS.length && this.factionFree(f)) p.faction = f;
    },
    setMap: (client: Client, msg: { map?: string }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      const id = typeof msg?.map === "string" ? msg.map : "random";
      if (id === "random" || MAPS.some((m) => m.id === id)) this.state.mapChoice = id;
    },
    start: (client: Client) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      if (this.state.players.size < MIN_PLAYERS) return this.notice(client, "至少要兩方才能開戰，可以先加電腦");
      this.startBattle();
    },
    backToLobby: (client: Client) => {
      if (!this.isHost(client) || this.state.phase !== "ended") return;
      this.toLobby();
    },

    // ---------- 戰鬥指令 ----------
    convert: (client: Client, msg: { node?: number; spec?: string }) => {
      const spec = typeof msg?.spec === "string" ? (msg.spec as FortSpec) : null;
      if (spec === null || (spec !== "" && !FORT_SPECS.includes(spec))) return;
      this.reply(client, this.battle.convert(client.sessionId, num(msg?.node), spec));
    },
    buy: (client: Client, msg: { node?: number; type?: string; count?: number }) => {
      const type = msg?.type as UnitType;
      if (!UNIT_TYPES.includes(type)) return;
      this.reply(client, this.battle.buy(client.sessionId, num(msg?.node), type, num(msg?.count)));
    },
    dispatch: (client: Client, msg: { node?: number; counts?: number[]; via?: number[]; dest?: unknown; enter?: boolean }) => {
      const dest = cleanDest(msg?.dest);
      if (!dest) return;
      const counts = Array.isArray(msg?.counts) ? msg.counts.slice(0, UNIT_TYPES.length).map(num) : [];
      this.reply(client, this.battle.dispatch(client.sessionId, num(msg?.node), counts, numList(msg?.via), dest, msg?.enter !== false));
    },
    order: (client: Client, msg: { units?: unknown; via?: number[]; dest?: unknown; enter?: boolean }) => {
      const dest = cleanDest(msg?.dest);
      if (!dest) return;
      this.reply(client, this.battle.order(client.sessionId, idList(msg?.units), numList(msg?.via), dest, msg?.enter !== false));
    },
    retreat: (client: Client, msg: { units?: unknown }) => {
      this.reply(client, this.battle.retreat(client.sessionId, idList(msg?.units)));
    },
    build: (client: Client, msg: { lane?: number; node?: number; slot?: number; kind?: string }) => {
      const kind = msg?.kind as BuildKind;
      if (!BUILD_KINDS.includes(kind)) return;
      this.reply(client, this.battle.build(client.sessionId, num(msg?.lane), num(msg?.node), num(msg?.slot), kind));
    },
    upgrade: (client: Client, msg: { kind?: string }) => {
      const kind = msg?.kind as UpgradeKind;
      if (!UPGRADE_KINDS.includes(kind)) return;
      this.reply(client, this.battle.upgrade(client.sessionId, kind));
    },
    air: (client: Client, msg: { kind?: string; lane?: number; x?: number }) => {
      const kind = msg?.kind as AirKind;
      if (!AIR_KINDS.includes(kind)) return;
      this.reply(client, this.battle.callAir(client.sessionId, kind, num(msg?.lane), num(msg?.x)));
    },
  };

  async onCreate() {
    // 用好記的 4 碼房間代碼取代預設的長 ID
    for (let i = 0; i < 20; i++) {
      const code = randomCode();
      const taken = await matchMaker.query({ roomId: code });
      if (taken.length === 0) {
        this.roomId = code;
        break;
      }
    }
    this.battle = new Battle(this.state, (type, payload) => this.broadcast(type, payload));
    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), 1000 / TICK_RATE);
  }

  onJoin(client: Client, options: { name?: string }) {
    if (this.state.phase !== "lobby") throw new Error("這局已經開打了");
    let faction = this.freeFaction();
    if (faction < 0) {
      // 滿了就把一個電腦踢掉讓真人進來
      const bot = [...this.state.players.values()].find((p) => p.wasBot);
      if (!bot) throw new Error("房間已滿");
      faction = bot.faction;
      this.state.players.delete(bot.id);
    }
    const p = new Player();
    p.id = client.sessionId;
    p.name = cleanName(options?.name);
    p.faction = faction;
    this.state.players.set(p.id, p);
    if (!this.state.hostId || !this.state.players.has(this.state.hostId)) this.state.hostId = client.sessionId;
    this.syncMatchmaking();
  }

  // 非自願斷線（網路不穩、重新整理）：保留位置一段時間，期間由電腦代管
  async onDrop(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = false;
      if (this.state.phase === "playing") p.isBot = true;
    }
    this.allowReconnection(client, this.state.phase === "lobby" ? 15 : 60);
  }

  onReconnect(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = true;
      p.isBot = p.wasBot;
    }
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (this.state.phase === "lobby") {
      this.state.players.delete(p.id);
    } else {
      // 對局中離開：電腦接手到這局結束
      p.connected = false;
      p.isBot = true;
      p.wasBot = true;
      p.name = `${p.name}(電腦)`;
    }
    if (this.state.hostId === p.id) {
      const next = [...this.state.players.values()].find((x) => !x.wasBot && x.connected);
      this.state.hostId = next?.id ?? "";
    }
    this.syncMatchmaking();
  }

  // ---------------------------------------------------------------- 內部

  private tick(dt: number) {
    if (this.state.phase !== "playing") return;
    this.state.players.forEach((p) => {
      if (!p.isBot) return;
      let brain = this.bots.get(p.id);
      if (!brain) {
        brain = new BotBrain(p.id);
        this.bots.set(p.id, brain);
      }
      brain.update(this.battle, dt);
    });
    this.battle.step(dt);
  }

  private startBattle() {
    this.bots.clear();
    this.battle.start();
    this.lock();
  }

  private toLobby() {
    this.state.phase = "lobby";
    this.state.units.clear();
    this.state.structures.clear();
    this.state.aircraft.clear();
    this.state.nodes.clear();
    // 中途離開、由電腦接手的玩家，回大廳時移除
    const leftovers = [...this.state.players.values()].filter((p) => !p.wasBot && !this.clients.getById(p.id));
    for (const p of leftovers) this.state.players.delete(p.id);
    [...this.state.players.values()].filter((p) => p.name.endsWith("(電腦)")).forEach((p) => this.state.players.delete(p.id));
    this.state.players.forEach((p) => {
      p.hq = -1;
      p.alive = true;
      p.rank = 0;
    });
    this.unlock();
    this.syncMatchmaking();
  }

  private syncMatchmaking() {
    // 真人 + 電腦都算位置；滿 4 人就不讓別人用代碼加入（但會替換電腦，所以只在全是真人時上鎖）
    if (this.state.phase !== "lobby") return;
    const humans = [...this.state.players.values()].filter((p) => !p.wasBot).length;
    if (humans >= MAX_PLAYERS) this.lock();
    else this.unlock();
  }

  private isHost(client: Client) {
    return this.state.hostId === client.sessionId;
  }

  private factionFree(f: number) {
    for (const p of this.state.players.values()) if (p.faction === f) return false;
    return f >= 0 && f < FACTIONS.length;
  }

  private freeFaction() {
    for (let f = 0; f < FACTIONS.length; f++) if (this.factionFree(f)) return f;
    return -1;
  }

  private reply(client: Client, error: string | null) {
    if (error) this.notice(client, error);
  }

  private notice(client: Client, text: string) {
    client.send("notice", { text });
  }
}

function numList(v: unknown): number[] {
  return Array.isArray(v) ? v.slice(0, 12).map(num).filter((n) => Number.isInteger(n)) : [];
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.slice(0, 80).filter((x): x is string => typeof x === "string" && x.length < 24) : [];
}

function cleanDest(v: unknown): Dest | null {
  if (!v || typeof v !== "object") return null;
  const d = v as { node?: unknown; lane?: unknown; x?: unknown };
  if (d.node !== undefined) {
    const node = num(d.node);
    return Number.isInteger(node) ? { node } : null;
  }
  const lane = num(d.lane);
  const x = num(d.x);
  return Number.isInteger(lane) && Number.isFinite(x) ? { lane, x } : null;
}
