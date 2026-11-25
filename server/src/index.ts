// 伺服器進入點：Colyseus（多人連線）+ Express（放前端網頁）。
// 開發時：npm run dev（前端由 Vite 提供，這裡只負責連線）
// 上線時：先 npm run build，這裡會順便提供 client/dist 的網頁，只要開一個埠。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { defineRoom, defineServer } from "colyseus";
import { ROOM_NAME } from "@frontline/shared";
import { BattleRoom } from "./rooms/BattleRoom";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
const port = Number(process.env.PORT || 2567);

const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(BattleRoom),
  },
  express: (app) => {
    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
    }
  },
});

await server.listen(port);
console.log(`⚔️  前線伺服器啟動：http://localhost:${port}`);
if (!fs.existsSync(clientDist)) {
  console.log("（還沒有 client/dist，請另外用 npm run dev 開前端，或先 npm run build）");
}
