// 介面用的線條圖示（兵種、空軍、陣營徽章），跟設計稿同一套
import type { UnitType } from "@frontline/shared";

const UNIT_PATHS: Record<UnitType | "bomber" | "transport", string> = {
  rifle: '<path d="M6 19a10 10 0 0 1 20 0z"/><path d="M3 19h26"/><path d="M11 24l14-9"/>',
  mg: '<path d="M4 14h20"/><path d="M24 12v4M26 14h3"/><rect x="9" y="11" width="8" height="6" rx="1"/><path d="M13 17l-5 10M13 17l5 10"/>',
  sniper: '<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="2"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6"/>',
  flame: '<path d="M16 29c-6 0-9-4-9-9 0-6 6-8 5-15 5 3 6 7 6 10 2-1 3-3 3-5 3 3 4 7 4 10 0 5-3 9-9 9z"/>',
  car: '<path d="M3 21v-5l4-5h13l4 5h5v5z"/><path d="M16 11l-2-4h-4"/><circle cx="9" cy="23" r="3"/><circle cx="23" cy="23" r="3"/>',
  tank: '<path d="M3 20h26l-3 7H6z"/><path d="M9 20v-5h12v5"/><path d="M21 16h9"/>',
  at: '<circle cx="12" cy="23" r="4"/><path d="M12 19L29 10"/><path d="M12 23L3 28"/><path d="M8 14l7-3v7"/>',
  flak: '<rect x="3" y="18" width="22" height="6" rx="1"/><circle cx="8" cy="26" r="2.5"/><circle cx="20" cy="26" r="2.5"/><path d="M12 18L22 5M16 18L26 6"/>',
  artillery: '<circle cx="11" cy="22" r="5"/><path d="M12 17L28 7" stroke-width="3.2"/><path d="M11 22L3 29"/>',
  engineer: '<path d="M20 4a6 6 0 0 0-5 8L5 22a3 3 0 0 0 4 4l10-10a6 6 0 0 0 8-5l-4 2-3-3 2-4z"/>',
  medic: '<circle cx="16" cy="16" r="12"/><path d="M16 9v14M9 16h14" stroke-width="3.4"/>',
  para: '<path d="M4 14a12 10 0 0 1 24 0z"/><path d="M4 14l12 12 12-12M16 14v12"/><circle cx="16" cy="28" r="2"/>',
  bomber: '<path d="M16 3v24"/><path d="M3 15l13-3 13 3"/><path d="M10 27h12"/><path d="M8 13v4M24 13v4"/>',
  transport: '<path d="M4 14a12 10 0 0 1 24 0z"/><path d="M4 14l12 12 12-12M16 14v12"/><circle cx="16" cy="28" r="2"/>',
};

/** 兵種／空軍圖示（顏色跟著文字） */
export function unitIcon(kind: keyof typeof UNIT_PATHS, size = 26) {
  return `<svg class="ico" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${UNIT_PATHS[kind]}</svg>`;
}

/** 陣營徽章：底色方塊＋符號 */
export function emblem(kind: string, color: string, mark: string, size = 16) {
  const shape =
    kind === "cross" ? `<path d="M-4,-11h8v7h7v8h-7v7h-8v-7h-7v-8h7z" fill="${mark}"/>` :
    kind === "triangle" ? `<path d="M0,-11 L11,8 L-11,8z" fill="${mark}"/>` :
    kind === "star" ? `<polygon points="0,-12 3.5,-4 12,-4 5,2 7.5,11 0,6 -7.5,11 -5,2 -12,-4 -3.5,-4" fill="${mark}"/>` :
    `<circle r="7" fill="none" stroke="${mark}" stroke-width="4"/>`;
  return `<svg class="emb" viewBox="-14 -14 28 28" width="${size}" height="${size}" aria-hidden="true" style="background:${color}">${shape}</svg>`;
}
