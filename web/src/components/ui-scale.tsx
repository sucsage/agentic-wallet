"use client";

import { useEffect, useState } from "react";

import { Card } from "./mockup-ui";

/**
 * Display size. "Auto" scales the app with the screen (CSS steps in globals.css: bigger on 2K / 4K
 * screens); a fixed size overrides it for this browser only.
 */
const KEY = "aw:ui-scale";
const SIZES = [
  ["auto", "Auto"],
  ["0.9", "90%"],
  ["1", "100%"],
  ["1.1", "110%"],
  ["1.25", "125%"],
  ["1.5", "150%"],
] as const;

export function applySavedScale() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && v !== "auto") document.documentElement.style.setProperty("--aw-zoom", v);
    else document.documentElement.style.removeProperty("--aw-zoom");
  } catch {
    /* storage blocked: Auto */
  }
}

/** Applies the saved size on every page (mounted once by the app). */
export function UiScale() {
  useEffect(() => {
    applySavedScale();
  }, []);
  return null;
}

export function DisplaySizeCard() {
  const [v, setV] = useState("auto");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setV(localStorage.getItem(KEY) ?? "auto");
    } catch {
      /* Auto */
    }
  }, []);
  return (
    <Card className="aw-scale-card">
      <h2>Display size</h2>
      <small>Auto grows the app on large, high-resolution screens. Saved in this browser.</small>
      <div className="aw-profile-segment" role="radiogroup" aria-label="Display size">
        {SIZES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={v === value}
            className={v === value ? "selected" : ""}
            onClick={() => {
              setV(value);
              try {
                localStorage.setItem(KEY, value);
              } catch {
                /* this page only */
              }
              if (value === "auto") document.documentElement.style.removeProperty("--aw-zoom");
              else document.documentElement.style.setProperty("--aw-zoom", value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}
