// 前端進入點：首頁 → 大廳 → 對局，三個畫面依照房間狀態切換。
import "./style.css";
import Phaser from "phaser";
import { KICK_CODE, WORLD_H, WORLD_W } from "@frontline/shared";
import { canFullscreen, enterFullscreen, isMobile, updateDeviceClass } from "./device";
import { BattleScene } from "./game/BattleScene";
import { initAudio, play, startMusic, stopMusic } from "./game/sound";
import { createRoom, errorText, forgetRoom, joinRoom, rememberRoom, tryReconnect, type GameRoom } from "./net";
import { bus, session } from "./session";
import { Hud } from "./ui/hud";
import { bindLobbyActions, homeError, renderLobby, showScreen } from "./ui/screens";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let game: Phaser.Game | null = null;
let hud: Hud | null = null;
let lastPhase = "";

// ---------------------------------------------------------------- 戰場畫布（含黑屏自救）
// 手機切到背景、記憶體不夠時，瀏覽器會把 WebGL 畫布收回去（context lost），
// 有時候不會還回來，畫面就一直黑的。這裡偵測到就把整個 Phaser 畫面重建一次；
// 重建兩次還不行就改用相容性比較好的 Canvas 模式。
let rebuilds = 0;
let lostAt = 0;
let visibleSince = performance.now();
let lastWatch = 0;

function useCanvasRenderer() {
  try {
    return localStorage.getItem("frontline.renderer") === "canvas";
  } catch {
    return false;
  }
}

function createGame() {
  game = new Phaser.Game({
    type: useCanvasRenderer() ? Phaser.CANVAS : Phaser.AUTO,
    parent: "game-canvas",
    width: WORLD_W,
    height: WORLD_H,
    backgroundColor: "#7f9a4e",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BattleScene],
    disableContextMenu: true,
    banner: false,
  });
  const g = game;
  g.events.once("ready", () => {
    g.canvas?.addEventListener("webglcontextlost", () => {
      lostAt = performance.now();
      showRecover("畫面重新載入中…");
    });
    g.canvas?.addEventListener("webglcontextrestored", () => {
      lostAt = 0;
      showRecover("");
    });
  });
  refreshCanvasSoon();
}

function ensureGame() {
  if (!game) createGame();
  if (!hud) {
    hud = new Hud();
    hud.onLeave = () => leaveRoom();
  }
}

/** 把整個 Phaser 畫面丟掉重建（狀態都在伺服器，重建後會自己畫回來） */
function rebuildGame(reason: string) {
  console.warn("重建戰場畫面：", reason);
  rebuilds += 1;
  if (rebuilds >= 2) {
    try {
      localStorage.setItem("frontline.renderer", "canvas");
    } catch {
      /* ignore */
    }
  }
  const old = game;
  game = null;
  lostAt = 0;
  try {
    old?.destroy(true);
  } catch (e) {
    console.error(e);
  }
  document.querySelectorAll("#game-canvas canvas").forEach((c) => c.remove());
  createGame();
  showRecover("");
}

function refreshCanvasSoon() {
  for (const ms of [0, 150, 600, 1500]) setTimeout(() => game?.scale.refresh(), ms);
}

function showRecover(text: string) {
  const el = $("canvas-recover");
  el.classList.toggle("hidden", !text);
  if (text) el.querySelector("p")!.textContent = text;
}

/** 每秒檢查一次：畫布大小是 0、WebGL 被收回沒還、畫面停住不動 → 修 */
function watchdog() {
  if (!game || document.hidden || $("screen-game").classList.contains("hidden")) return;
  const now = performance.now();
  const parent = $("game-canvas").getBoundingClientRect();
  const rect = game.canvas?.getBoundingClientRect();
  if (parent.width > 20 && parent.height > 20 && rect && (rect.width < 10 || rect.height < 10)) game.scale.refresh();
  const gl = (game.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
  if (gl && typeof gl.isContextLost === "function" && gl.isContextLost()) {
    if (!lostAt) {
      lostAt = now;
      showRecover("畫面重新載入中…");
    }
    if (now - lostAt > 2500) rebuildGame("WebGL context lost");
    return;
  }
  if (lostAt && now - lostAt > 2500) {
    lostAt = 0;
    showRecover("");
  }
  // 場景沒有在更新（例如手機回到前景後卡住）
  const scene = game.scene.getScene("battle") as BattleScene | null;
  const stalled = !!scene && game.isBooted && now - visibleSince > 5000 && now - scene.lastFrame > 4000;
  if (stalled) rebuildGame("畫面停住");
}

// ---------------------------------------------------------------- 房間

const CONSENTED = 4000; // Colyseus：正常、自願離開
const SERVER_EVENTS = ["bomb", "paradrop", "airDown", "airIncoming", "eliminated", "hqAlert", "captured", "fortFallen", "leader", "built", "converted", "event", "eventEnd", "crateTaken", "barrageMark", "history", "ended", "notice"];

function attach(room: GameRoom) {
  session.room = room;
  rememberRoom(room);
  history.replaceState(null, "", `${location.pathname}?room=${room.roomId}`);
  for (const ev of SERVER_EVENTS) room.onMessage(ev, (m: unknown) => bus.emit(ev, m));
  room.onStateChange(() => onState());
  room.onLeave((code: number) => {
    // 自己按離開或已經換到別的房間：舊房間的離開事件不要影響現在的畫面
    if (session.room !== room) return;
    session.room = null;
    forgetRoom();
    lastPhase = "";
    showScreen("home");
    if (code === KICK_CODE) homeError("房主請你離開房間");
    else if (code !== 1000 && code !== CONSENTED) homeError("跟伺服器的連線中斷了");
  });
  room.onDrop(() => bus.emit("toast", "連線不穩，重新連線中…"));
  room.onReconnect(() => bus.emit("toast", "已重新連線"));
  onState();
}

function onState() {
  const s = session.state;
  if (!s) return;
  if (s.phase !== lastPhase) {
    const prev = lastPhase;
    lastPhase = s.phase;
    if (s.phase === "lobby") {
      stopMusic();
      showScreen("lobby");
    } else {
      ensureGame();
      showScreen("game");
      refreshCanvasSoon();
      if (prev === "lobby" || prev === "") {
        if (s.phase === "playing") {
          bus.emit("newBattle");
          hud?.resetForBattle();
          setTimeout(() => bus.emit("banner", { kind: "gold", text: "開戰！", sub: "推進前線，消滅所有對手" }), 300);
          play("start", 0.9);
          setTimeout(() => startMusic(), 1400);
        }
      }
      // 視窗大小可能在大廳時改變過
      game?.scale.refresh();
    }
  }
  if (s.phase === "lobby") renderLobby();
}

async function leaveRoom() {
  const room = session.room;
  stopMusic(0.5);
  forgetRoom();
  session.room = null;
  lastPhase = "";
  history.replaceState(null, "", location.pathname);
  showScreen("home");
  try {
    await room?.leave(true);
  } catch {
    /* 已經斷線 */
  }
}

// ---------------------------------------------------------------- 首頁

function playerName() {
  const n = $<HTMLInputElement>("name-input").value.trim() || "新兵";
  localStorage.setItem("frontline-name", n);
  return n;
}

async function withBusy(btn: HTMLButtonElement, fn: () => Promise<void>) {
  initAudio();
  // 手機上按下開始時順便進全螢幕（Android 可以；iPhone 要從主畫面開）
  if (isMobile() && canFullscreen()) void enterFullscreen();
  play("click");
  homeError("");
  document.querySelectorAll<HTMLButtonElement>("#screen-home button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    homeError(errorText(e));
  } finally {
    document.querySelectorAll<HTMLButtonElement>("#screen-home button").forEach((b) => (b.disabled = false));
    void btn;
  }
}

function bindHome() {
  const name = $<HTMLInputElement>("name-input");
  name.value = localStorage.getItem("frontline-name") ?? "";
  const params = new URLSearchParams(location.search);
  const code = params.get("room");
  if (code) $<HTMLInputElement>("code-input").value = code.toUpperCase();

  $("btn-create").addEventListener("click", (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, async () => attach(await createRoom(playerName()))),
  );
  $("btn-practice").addEventListener("click", (e) =>
    withBusy(e.currentTarget as HTMLButtonElement, async () => {
      const room = await createRoom(playerName());
      attach(room);
      room.send("addBot", {});
      room.send("addBot", {});
      room.send("start", {});
    }),
  );
  const join = (btn: HTMLButtonElement) =>
    withBusy(btn, async () => {
      const c = $<HTMLInputElement>("code-input").value.trim();
      if (c.length < 4) throw new Error("請輸入 4 碼房間代碼");
      attach(await joinRoom(c, playerName()));
    });
  $("btn-join").addEventListener("click", (e) => join(e.currentTarget as HTMLButtonElement));
  $("code-input").addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") join($("btn-join") as HTMLButtonElement);
  });
  $("btn-leave").addEventListener("click", () => leaveRoom());
  $("btn-fullscreen").addEventListener("click", async () => {
    initAudio();
    const tip = await enterFullscreen();
    homeError(tip ?? "");
  });
}

function onResize() {
  updateDeviceClass();
  // 版面（左右欄）變了，Phaser 要重新量一次畫布大小
  requestAnimationFrame(() => game?.scale.refresh());
}

// ---------------------------------------------------------------- 啟動

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastWatch > 1000) {
    lastWatch = now;
    try {
      watchdog();
    } catch (e) {
      console.error(e);
    }
  }
  try {
    if (session.state && session.state.phase !== "lobby") hud?.update();
  } catch (e) {
    console.error(e);
  }
}

async function boot() {
  updateDeviceClass();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    visibleSince = performance.now();
    refreshCanvasSoon();
  });
  $("btn-recover").addEventListener("click", () => rebuildGame("玩家按了重新載入"));
  $("btn-rules").addEventListener("click", () => $("rules").classList.add("open"));
  $("btn-rules-close").addEventListener("click", () => $("rules").classList.remove("open"));
  document.addEventListener("fullscreenchange", onResize);
  bindHome();
  bindLobbyActions();
  showScreen("home");
  // 每次觸控都確認音訊是開著的（iOS 接電話、切 App 回來後會被暫停）
  // iOS Safari：雙指縮放要給戰場用，不要縮放整個網頁
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());
  document.addEventListener("pointerdown", () => initAudio(), { passive: true });
  document.addEventListener("touchend", () => initAudio(), { passive: true });
  const room = await tryReconnect();
  if (room) attach(room);
  requestAnimationFrame(loop);
}

void boot();

// 讓瀏覽器測試腳本可以讀到狀態
(window as unknown as { __frontline: typeof session }).__frontline = session;
Object.defineProperty(window, "__game", { get: () => game });
