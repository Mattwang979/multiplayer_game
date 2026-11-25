// 裝置相關：手機判斷、全螢幕、橫向鎖定。
// Android（Chrome）可以直接全螢幕並鎖定橫向；iPhone 的 Safari 不支援網頁全螢幕，
// 要從「分享 → 加入主畫面」開啟，才會是沒有網址列的全螢幕。

export function isMobile() {
  return document.body.classList.contains("mobile");
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function canFullscreen() {
  return !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

export function isFullscreen() {
  return !!document.fullscreenElement || isStandalone();
}

/** 進入全螢幕並鎖定橫向；不支援時回傳說明文字 */
export async function enterFullscreen(): Promise<string | null> {
  if (isStandalone()) return null;
  if (canFullscreen()) {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.("landscape").catch(() => {});
      return null;
    } catch {
      /* 有些內建瀏覽器（LINE、FB）會擋 */
    }
  }
  if (isIOS()) return "iPhone 請用 Safari 開啟：點「分享」→「加入主畫面」，再從主畫面的「前線」圖示開，就是全螢幕。";
  return "這個瀏覽器不能全螢幕，請改用 Chrome 開啟（LINE、FB 內建的瀏覽器不支援）。";
}

export async function exitFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

/** 依照螢幕大小和觸控，切換 body 的 mobile / portrait class */
export function updateDeviceClass() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 560;
  document.body.classList.toggle("mobile", coarse || small);
  document.body.classList.toggle("portrait", window.innerHeight > window.innerWidth);
  document.body.classList.toggle("ios", isIOS());
}
