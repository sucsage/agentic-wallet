/**
 * MilestonePay in its own window (Electrobun). The app itself is ../../../src/main.ts: started here
 * without a browser tab, its local page is shown in a native window. A tray icon reopens the window
 * and quits the app; links the page opens in a new window go to the system browser (Stripe, GitHub,
 * printable documents). `--mcp` still runs the MCP server for other AI apps, without a window.
 */
process.env.AW_SHELL = "electrobun";
// This file in the built app: other AI apps run it with --mcp (the MCP server, no window).
process.env.AW_ENTRY = import.meta.path;

if (process.argv.includes("--mcp")) {
  const { runMcp } = await import("../../../src/main");
  await runMcp();
} else {
  const { startApp } = await import("../../../src/main");
  const { default: Electrobun, ApplicationMenu, BrowserWindow, Tray, Utils } = await import("electrobun/bun");
  const { url } = await startApp({ browser: false });

  let win: InstanceType<typeof BrowserWindow> | null = null;
  const openWindow = () => {
    if (win) {
      win.show();
      return;
    }
    win = new BrowserWindow({ title: "MilestonePay", url, frame: { x: 80, y: 60, width: 1280, height: 780 }, activate: true });
    console.log(`[window] opened ${win.id}`);
  };

  // The window was closed: the tray (or the dock) opens a new one.
  Electrobun.events.on("close", (e: { data: { id: number } }) => {
    if (win && e.data.id === win.id) win = null;
  });

  // Anything the page opens in a new window (window.open, target=_blank) goes to the system browser.
  Electrobun.events.on("new-window-open", (e: { data: { detail: string | { url: string } } }) => {
    const target = typeof e.data.detail === "string" ? e.data.detail : e.data.detail.url;
    if (/^https?:\/\//.test(target)) Utils.openExternal(target);
  });

  ApplicationMenu.setApplicationMenu([
    { submenu: [{ role: "about" }, { type: "divider" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "divider" }, { label: "Quit MilestonePay", action: "quit", accelerator: "q" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "divider" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "Window", submenu: [{ label: "Show MilestonePay", action: "show" }, { role: "minimize" }, { role: "zoom" }, { role: "close" }] },
  ]);
  ApplicationMenu.on("application-menu-clicked", (e: unknown) => {
    const action = (e as { data?: { action?: string } }).data?.action;
    if (action === "quit") process.exit(0);
    if (action === "show") openWindow();
  });

  const tray = new Tray({ title: "MilestonePay", image: "views://icon.png", template: false, width: 18, height: 18 });
  tray.setMenu([
    { type: "normal", label: "Open MilestonePay", action: "show" },
    { type: "normal", label: "Open in the browser", action: "browser" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);
  tray.on("tray-clicked", (e: unknown) => {
    const action = (e as { data?: { action?: string } }).data?.action;
    if (action === "quit") process.exit(0);
    else if (action === "browser") Utils.openExternal(url);
    else openWindow();
  });

  try {
    openWindow();
  } catch (e) {
    console.error("[window] could not open", e);
  }
}
