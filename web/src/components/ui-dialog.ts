"use client";

import { translateMockupText } from "@/lib/i18n";

/**
 * The site's own yes/no, text and notice dialogs, in place of the browser's confirm(), prompt() and
 * alert() (which show the browser's look and its address line). Each returns a promise, so callers
 * `await` them. Built with the DOM directly so it works from any handler without a provider.
 */

type Opts = { ok?: string; cancel?: string; danger?: boolean; input?: { value?: string; placeholder?: string }; notice?: boolean };

const STYLE_ID = "aw-ui-dialog-style";
const CSS = `
.aw-ui-dialog{margin:auto;inset:0;height:fit-content;max-height:calc(100vh - 32px);border:1px solid #292929;border-radius:16px;background:#111;color:#f2f2f2;width:min(440px,calc(100vw - 32px));padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.aw-ui-dialog::backdrop{background:rgba(0,0,0,.6);backdrop-filter:blur(2px)}
.aw-ui-dialog p{margin:0 0 16px;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.aw-ui-dialog input{width:100%;box-sizing:border-box;margin:0 0 16px;padding:10px 12px;border:1px solid #333;border-radius:10px;background:#000;color:#f2f2f2;font:inherit;font-size:14px}
.aw-ui-dialog input:focus{outline:2px solid #9b7cff;outline-offset:1px}
.aw-ui-dialog .aw-ui-row{display:flex;justify-content:flex-end;gap:8px}
.aw-ui-dialog button{height:36px;padding:0 16px;border-radius:9px;font:inherit;font-size:13px;font-weight:650;cursor:pointer;border:1px solid #333;background:#1a1a1a;color:#f2f2f2}
.aw-ui-dialog button:hover{background:#242424}
.aw-ui-dialog button.aw-ui-ok{background:#fff;border-color:#fff;color:#111}
.aw-ui-dialog button.aw-ui-ok:hover{background:#e8e8e8}
.aw-ui-dialog button.aw-ui-danger{background:#e5484d;border-color:#e5484d;color:#fff}
.aw-ui-dialog button.aw-ui-danger:hover{background:#d63c41}
`;

function lang(): "th" | "en" {
  return typeof document !== "undefined" && document.documentElement.lang === "th" ? "th" : "en";
}

function open(message: string, opts: Opts): Promise<string | boolean | null> {
  if (typeof document === "undefined") return Promise.resolve(opts.input ? null : false);
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  const l = lang();
  const tr = (t: string) => translateMockupText(t, l);
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "aw-ui-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const p = document.createElement("p");
    p.textContent = tr(message);
    form.appendChild(p);
    let input: HTMLInputElement | null = null;
    if (opts.input) {
      input = document.createElement("input");
      input.value = opts.input.value ?? "";
      input.placeholder = opts.input.placeholder ?? "";
      input.autocomplete = "off";
      form.appendChild(input);
    }
    const row = document.createElement("div");
    row.className = "aw-ui-row";
    let cancel: HTMLButtonElement | null = null;
    if (!opts.notice) {
      cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = tr(opts.cancel ?? "Cancel");
      row.appendChild(cancel);
    }
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = opts.danger ? "aw-ui-danger" : "aw-ui-ok";
    ok.textContent = tr(opts.ok ?? "OK");
    row.appendChild(ok);
    form.appendChild(row);
    dlg.appendChild(form);
    document.body.appendChild(dlg);

    let done = false;
    const finish = (v: string | boolean | null) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      finish(input ? input.value : true);
    });
    cancel?.addEventListener("click", () => finish(input ? null : false));
    dlg.addEventListener("close", () => finish(opts.notice ? true : input ? null : false));
    dlg.showModal();
    (input ?? ok).focus();
  });
}

/** Yes/no question. True when the user confirms. */
export function askConfirm(message: string, opts: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return open(message, opts) as Promise<boolean>;
}

/** Text question. The text, or null when cancelled. */
export function askText(message: string, value = "", placeholder = ""): Promise<string | null> {
  return open(message, { input: { value, placeholder } }) as Promise<string | null>;
}

/** A message with one OK button. */
export async function showNotice(message: string): Promise<void> {
  await open(message, { notice: true });
}
