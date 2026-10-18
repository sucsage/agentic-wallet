"use client";

import { useEffect, useState } from "react";

type Item = { key: string; label: string; url: string; size: string };

/** The big button: the installer for the visitor's computer (guessed from the browser), or a list. */
export function PickForThisComputer({ items, version }: { items: Item[]; version: string }) {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = (data?.platform ?? navigator.platform ?? "").toLowerCase();
    let k: string | null = null;
    if (/win/.test(platform) || /Windows/.test(ua)) k = "windows-x64";
    else if (/mac/.test(platform) || /Mac OS X/.test(ua)) {
      // Browsers report Intel even on Apple silicon; WebGL's renderer tells them apart.
      let arm = true;
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        const renderer = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
        if (/Intel|AMD|Radeon/i.test(renderer)) arm = false;
      } catch {
        // keep Apple silicon, the common case now
      }
      k = arm ? "macos-arm64" : "macos-x64";
    } else if (/linux/.test(platform) || /Linux/.test(ua)) k = /aarch64|arm64/i.test(platform + ua) ? "linux-arm64" : "linux-x64";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(k);
  }, []);
  const mine = items.find((i) => i.key === key);
  return (
    <div className="dl-pick">
      {mine ? (
        <a className="dl-btn dl-big" href={mine.url}>
          Download for {mine.label} · {mine.size}
        </a>
      ) : (
        <a className="dl-btn dl-big" href="#downloads-list" onClick={(e) => (e.preventDefault(), document.querySelector(".dl-grid")?.scrollIntoView({ behavior: "smooth" }))}>
          Download MilestonePay {version}
        </a>
      )}
      {mine && <a href={`#${items.find((i) => i.key !== mine.key)?.key ?? ""}`} onClick={(e) => (e.preventDefault(), document.querySelector(".dl-grid")?.scrollIntoView({ behavior: "smooth" }))}>Other computers</a>}
    </div>
  );
}
