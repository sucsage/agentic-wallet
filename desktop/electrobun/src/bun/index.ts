/**
 * MilestonePay in its own window (Electrobun). The app itself is ../../../src/main.ts: started here
 * without a browser tab, its local page is shown in a native window. A tray icon reopens the window
 * and quits the app; links the page opens in a new window go to the system browser (Stripe, GitHub,
 * printable documents). `--mcp` still runs the MCP server for other AI apps, without a window.
 *
 * macOS: no native title bar; the page draws a black bar under macOS's own close/minimize/zoom
 * buttons. Windows: the native title bar, made dark (black on Windows 11), with the app's icon, its
 * taskbar identity and per-monitor DPI awareness (sharp text at 125%/150%). Size and position fit
 * the screen and are remembered.
 */
process.env.AW_SHELL = "electrobun";
// This file in the built app: other AI apps run it with --mcp (the MCP server, no window).
process.env.AW_ENTRY = import.meta.path;

if (process.argv.includes("--mcp")) {
  const { runMcp } = await import("../../../src/main");
  await runMcp();
} else {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const win32 = process.platform === "win32" ? await import("./win32") : null;
  // Before any window exists: sharp at any Windows scaling, and our own taskbar entry and icon.
  win32?.beforeWindows();
  const { startApp, setWindowControl } = await import("../../../src/main");
  const { dataDir } = await import("../../../src/paths");
  const { default: Electrobun, ApplicationMenu, BrowserWindow, Screen, Tray, Utils } = await import("electrobun/bun");
  const { url } = await startApp({ browser: false });

  // macOS: the native buttons sit over the page's black bar. Windows and Linux keep the system's title bar.
  const chrome = process.platform === "darwin" ? "mac" : "";
  const pageUrl = chrome ? url.replace("/#", `/?chrome=${chrome}#`) : url;

  type Frame = { x: number; y: number; width: number; height: number };
  const savedPath = join(dataDir(), "window.json");
  /** The last size and position if it still fits a screen, else a size that fits this screen. */
  function startFrame(): Frame {
    const area = Screen.getPrimaryDisplay().workArea;
    const W = area.width || 1440, H = area.height || 900;
    try {
      const f = JSON.parse(readFileSync(savedPath, "utf8")) as Frame;
      const fits = Screen.getAllDisplays().some((d) => f.x >= d.workArea.x - 40 && f.y >= d.workArea.y - 40 && f.x + 200 <= d.workArea.x + d.workArea.width && f.y + 100 <= d.workArea.y + d.workArea.height);
      if (fits && f.width >= 720 && f.height >= 480) return { ...f, width: Math.min(f.width, W), height: Math.min(f.height, H) };
    } catch {
      // first start
    }
    const width = Math.min(W, Math.max(960, Math.min(1480, Math.round(W * 0.86))));
    const height = Math.min(H, Math.max(640, Math.min(960, Math.round(H * 0.88))));
    return { x: area.x + Math.round((W - width) / 2), y: area.y + Math.round((H - height) / 2), width, height };
  }

  let win: InstanceType<typeof BrowserWindow> | null = null;
  let lastSaved = "";
  const saveFrame = () => {
    if (!win) return;
    try {
      const f = JSON.stringify(win.getFrame());
      if (f !== lastSaved) writeFileSync(savedPath, (lastSaved = f));
    } catch {
      // the window is closing
    }
  };
  setInterval(saveFrame, 4000);

  const openWindow = () => {
    if (win) {
      win.show();
      return;
    }
    win = new BrowserWindow({
      title: "MilestonePay",
      url: pageUrl,
      frame: startFrame(),
      titleBarStyle: chrome ? "hiddenInset" : "default",
      trafficLightOffset: { x: 14, y: 12 },
      activate: true,
    });
    win32?.styleWindow(win.ptr);
    console.log(`[window] opened ${win.id}`);
  };

  // What the page's own title bar asks for (Windows buttons, double-click to zoom on macOS).
  setWindowControl((op) => {
    if (!win) return;
    if (op === "minimize") win.minimize();
    else if (op === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (op === "close") {
      saveFrame();
      win.close();
    }
  });

  // The window was closed: the tray (or the dock) opens a new one.
  Electrobun.events.on("close", (e: { data: { id: number } }) => {
    if (win && e.data.id === win.id) win = null;
  });

  // Anything the page opens in a new window (window.open, target=_blank) goes to the system browser.
  Electrobun.events.on("new-window-open", (e: { data: { detail: string | { url: string } } }) => {
    const target = typeof e.data.detail === "string" ? e.data.detail : e.data.detail.url;
    if (/^https?:\/\//.test(target)) Utils.openExternal(target);
  });

  // macOS only: one menu (the app's), no Edit or Window menus; copy, paste and undo stay in it so
  // their shortcuts keep working. Windows and Linux get no menu bar in the window.
  if (process.platform === "darwin") ApplicationMenu.setApplicationMenu([
    {
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "undo" },
        { role: "redo" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "divider" },
        { role: "minimize" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "divider" },
        { label: "Quit MilestonePay", action: "quit", accelerator: "q" },
      ],
    },
  ]);
  const quit = () => {
    saveFrame();
    process.exit(0);
  };
  ApplicationMenu.on("application-menu-clicked", (e: unknown) => {
    const action = (e as { data?: { action?: string } }).data?.action;
    if (action === "quit") quit();
    if (action === "show") openWindow();
  });

  const tray = new Tray({ title: "MilestonePay", image: "views://icon.png", template: false, width: 18, height: 18 });
  tray.setMenu([
    { type: "normal", label: "Open MilestonePay", action: "show" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);
  tray.on("tray-clicked", (e: unknown) => {
    const action = (e as { data?: { action?: string } }).data?.action;
    if (action === "quit") quit();
    else openWindow();
  });

  try {
    openWindow();
  } catch (e) {
    console.error("[window] could not open", e);
  }
}
