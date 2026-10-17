"use client";

import { useEffect, useState } from "react";

/**
 * Discourages copying the app: no right-click menu, the developer-tools and view-source shortcuts
 * are swallowed, the Print Screen key blanks the page and empties the clipboard, and protected
 * content (.aw-protect: delivery previews, website mockups) is blurred whenever the window loses
 * focus (a snipping tool, a screen recorder's picker) or the developer tools look open, and is
 * hidden when printing. A browser cannot truly stop screenshots or inspection (an OS shortcut or a
 * phone camera still works): the real protection is server-side (watermarked previews, encrypted
 * files released only after approval).
 */
export function CaptureGuard() {
  const [shield, setShield] = useState<"" | "blur" | "blank">("");
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const onMenu = (e: MouseEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const devtools = k === "f12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k)) || (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(k));
      const source = mod && !e.shiftKey && (k === "u" || k === "s");
      if (devtools || source) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    let blankTimer: ReturnType<typeof setTimeout> | undefined;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        setShield("blank");
        void navigator.clipboard?.writeText("").catch(() => {});
        clearTimeout(blankTimer);
        blankTimer = setTimeout(() => setShield(""), 1500);
      }
    };
    const onBlur = () => setShield((s) => (s === "blank" ? s : "blur"));
    const onFocus = () => setShield((s) => (s === "blur" ? "" : s));
    const onVisibility = () => (document.hidden ? onBlur() : onFocus());
    const onDrag = (e: DragEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest(".aw-protect")) e.preventDefault();
    };
    // Docked developer tools shrink the page inside the window by a lot.
    const devtoolsOpen = () => window.outerWidth - window.innerWidth > 240 || window.outerHeight - window.innerHeight > 320;
    const tick = setInterval(() => document.documentElement.classList.toggle("aw-devtools", devtoolsOpen()), 1500);
    document.addEventListener("contextmenu", onMenu);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("dragstart", onDrag);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(tick);
      clearTimeout(blankTimer);
      document.removeEventListener("contextmenu", onMenu);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("dragstart", onDrag);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("aw-shield-blur", shield === "blur");
  }, [shield]);
  return shield === "blank" ? (
    <div className="aw-capture-blank" role="alert">
      Screenshots are not allowed here.
    </div>
  ) : null;
}
