// 前端進入點：首頁 → 大廳 → 對局，三個畫面依照房間狀態切換。
import "./style.css";
import Phaser from "phaser";
import { WORLD_H, WORLD_W } from "@frontline/shared";
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

function ensureGame() {
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game-canvas",
    width: WORLD_W,
    height: WORLD_H,
    backgroundColor: "#7f9a4e",
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BattleScene],
    disableContextMenu: true,
    banner: false,
  });
  hud = new Hud();
  hud.onLeave = () => leaveRoom();
}

// ---------------------------------------------------------------- 房間

const SERVER_EVENTS = ["bomb", "paradrop", "airDown", "airIncoming", "eliminated", "hqAlert", "captured", "fortFallen", "ended", "notice"];

function attach(room: GameRoom) {
  session.room = room;
  rememberRoom(room);
  history.replaceState(null, "", `${location.pathname}?room=${room.roomId}`);
  for (const ev of SERVER_EVENTS) room.onMessage(ev, (m: unknown) => bus.emit(ev, m));
  room.onStateChange(() => onState());
  room.onLeave((code: number) => {
    session.room = null;
    forgetRoom();
    lastPhase = "";
    showScreen("home");
    if (code > 1000 && code !== 4000) homeError("跟伺服器的連線中斷了");
    if (code === 4000) homeError("房主請你離開房間");
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
  document.addEventListener("fullscreenchange", onResize);
  bindHome();
  bindLobbyActions();
  showScreen("home");
  // 每次觸控都確認音訊是開著的（iOS 接電話、切 App 回來後會被暫停）
  document.addEventListener("pointerdown", () => initAudio(), { passive: true });
  document.addEventListener("touchend", () => initAudio(), { passive: true });
  const room = await tryReconnect();
  if (room) attach(room);
  requestAnimationFrame(loop);
}

void boot();

// 讓瀏覽器測試腳本可以讀到狀態
(window as unknown as { __frontline: typeof session }).__frontline = session;
