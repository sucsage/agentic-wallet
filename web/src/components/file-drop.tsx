"use client";

import { type DragEvent, useRef, useState } from "react";

import { translateMockupText, useLang } from "@/lib/i18n";

/**
 * Drag a file from the desktop onto a chat to attach it. Spread `bind` on the area that takes the
 * drop and show `dragging` (e.g. <DropHint />) while a file is over it. Only file drags count:
 * dragging text or a link inside the page does nothing.
 */
export function useFileDrop(onFile: (file: File) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => enabled && [...e.dataTransfer.types].includes("Files");
  const bind = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    },
  };
  return { dragging, bind };
}

export function DropHint({ text = "Drop the file to attach it" }: { text?: string }) {
  const lang = useLang();
  return (
    <div className="aw-drop-hint" aria-hidden>
      <span>⇣</span>
      <b>{translateMockupText(text, lang)}</b>
      <small>{translateMockupText("Images, PDFs and text files (TXT, CSV, MD, JSON)", lang)}</small>
    </div>
  );
}
