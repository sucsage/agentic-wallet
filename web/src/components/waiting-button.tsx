"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Button } from "./mockup-ui";

// Bounded UI demo work; cancel on unmount and ignore repeated clicks.
export function useDemoWait() {
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const wait = (complete: () => void) => {
    if (timer.current) return;
    setPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      try { complete(); } finally { setPending(false); }
    }, 1000);
  };
  return { pending, wait };
}
export function WaitingButton({ pendingLabel, onComplete, children, disabled, ...props }: Omit<ComponentProps<typeof Button>, "onClick"> & { pendingLabel: string; onComplete: () => void }) {
  const { pending, wait } = useDemoWait();
  return <Button {...props} disabled={disabled || pending} aria-busy={pending} onClick={() => wait(onComplete)}>{pending ? <><i className="aw-button-spinner" aria-hidden="true"/>{pendingLabel}</> : children}</Button>;
}
