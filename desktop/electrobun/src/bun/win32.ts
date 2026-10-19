/**
 * Windows details the window library leaves out, through the system's own DLLs (bun:ffi):
 * - per-monitor DPI awareness before any window exists, so Windows does not stretch a 100% bitmap
 *   (blurry text at 125%/150%; the executables also carry it in their manifest);
 * - the app's taskbar identity (the Start menu shortcut has the same one), so the taskbar shows
 *   Kravii and its icon, not Bun's;
 * - a dark title bar (black on Windows 11) and the app's icon on the window.
 * Every call is best effort: an older Windows without one of them keeps its default.
 */
import { FFIType, dlopen, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const APP_ID = "app.milestonepay.desktop";
const wide = (s: string) => Uint16Array.from(`${s}\0`, (c) => c.charCodeAt(0));

function tryRun(what: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.warn(`[win32] ${what}: ${(e as Error).message}`);
  }
}

export function beforeWindows() {
  tryRun("DPI awareness", () => {
    const user32 = dlopen("user32.dll", { SetProcessDpiAwarenessContext: { args: [FFIType.i64], returns: FFIType.i32 } });
    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = (HANDLE)-4. Fails harmlessly when the manifest already set it.
    user32.symbols.SetProcessDpiAwarenessContext(-4n);
  });
  tryRun("taskbar identity", () => {
    const shell32 = dlopen("shell32.dll", { SetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 } });
    shell32.symbols.SetCurrentProcessExplicitAppUserModelID(ptr(wide(APP_ID)));
  });
}

export function styleWindow(hwnd: unknown) {
  if (!hwnd) return;
  tryRun("dark title bar", () => {
    const dwm = dlopen("dwmapi.dll", { DwmSetWindowAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 } });
    const set = (attr: number, value: number) => dwm.symbols.DwmSetWindowAttribute(hwnd as never, attr, ptr(new Uint32Array([value])), 4);
    set(20, 1); // DWMWA_USE_IMMERSIVE_DARK_MODE (Windows 10 2004+ and 11)
    set(35, 0x000000); // DWMWA_CAPTION_COLOR: black (Windows 11)
    set(36, 0xe0e0e0); // DWMWA_TEXT_COLOR: light grey
    set(34, 0x161616); // DWMWA_BORDER_COLOR
  });
  tryRun("window icon", () => {
    const ico = join(dirname(process.execPath), "..", "Resources", "app.ico");
    if (!existsSync(ico)) return;
    const user32 = dlopen("user32.dll", {
      LoadImageW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
      SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
      GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
    });
    const u = user32.symbols;
    const path = ptr(wide(ico));
    // IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10; sizes for the title bar (SM_CXSMICON 49) and the taskbar / Alt+Tab (SM_CXICON 11).
    const small = u.LoadImageW(null, path, 1, u.GetSystemMetrics(49), u.GetSystemMetrics(49), 0x10);
    const big = u.LoadImageW(null, path, 1, u.GetSystemMetrics(11), u.GetSystemMetrics(11), 0x10);
    // WM_SETICON = 0x80: ICON_SMALL 0, ICON_BIG 1.
    if (small) u.SendMessageW(hwnd as never, 0x80, 0n, small);
    if (big) u.SendMessageW(hwnd as never, 0x80, 1n, big);
  });
}

/**
 * Screen recording and screenshots: off makes Windows show the window blank (or leave it out) in
 * captures, screen sharing and Snipping Tool (WDA_EXCLUDEFROMCAPTURE, Windows 10 2004+; older
 * Windows: WDA_MONITOR, shown black).
 */
export function setCaptureAllowed(hwnd: unknown, allowed: boolean) {
  if (!hwnd) return;
  tryRun("screen capture", () => {
    const user32 = dlopen("user32.dll", { SetWindowDisplayAffinity: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 } });
    const set = user32.symbols.SetWindowDisplayAffinity;
    if (allowed) set(hwnd as never, 0);
    else if (!set(hwnd as never, 0x11)) set(hwnd as never, 0x1);
  });
}
