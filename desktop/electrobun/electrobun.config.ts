import type { ElectrobunConfig } from "electrobun";

import pkg from "../package.json" with { type: "json" };

/**
 * Kravii in its own window. The main process is the same app (../src/main.ts): its local
 * server, device key, chain, MCP and the website bridge. The window shows that local page, so the
 * screen is the same HTML as the browser build.
 */
export default {
  app: {
    name: "Kravii",
    identifier: "app.milestonepay.desktop",
    version: pkg.version,
    description: "Kravii: milestone payments with your own deal chain (test mode demo).",
  },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    copy: { "../packaging/icons/icon.png": "views/icon.png" },
    mac: { icons: "../packaging/icons/Kravii.iconset" },
    win: { icon: "../packaging/icons/icon.ico" },
  },
  runtime: {
    // Closing the window keeps the app running in the tray (AI agents, sync); Quit is in the tray menu.
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
