"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import copy from "./operation-copy.json";
import { V08BalanceBar } from "./balance-bar";
import "./operation-loading.css";

export type OperationId = keyof typeof copy;
type Options = { description?: string; steps?: string[]; destination?: string };
type Job = { id: OperationId; from: string; complete: () => void; options?: Options };
const OperationContext = createContext<{ job: Job | null; step: number; error: boolean; run: (id: OperationId, complete: () => void, options?: Options) => void; cancel: () => void; retry: () => void } | null>(null);
export function OperationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [job, setJob] = useState<Job | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(false);
  const current = useRef<Job | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Discard an abandoned operation permanently, including browser Back/Forward.
  if (job && job.from !== pathname) setJob(null);
  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; current.current = null; };
  const cancel = () => { stop(); setJob(null); setError(false); };
  const run = (id: OperationId, complete: () => void, options?: Options) => {
    if (current.current) return;
    const next = { id, complete, options, from: pathname };
    current.current = next; setJob(next); setStep(0); setError(false);
    // Bounded mock flow: no banking, upload or AI request is made here.
    timers.current = [setTimeout(() => setStep(1), 600), setTimeout(() => setStep(2), 1200), setTimeout(() => {
      if (current.current !== next) return;
      try { next.complete(); stop(); setJob(null); }
      catch { stop(); setError(true); }
    }, 1900)];
  };
  useEffect(() => {
    if (current.current && current.current.from !== pathname) {
      timers.current.forEach(clearTimeout); timers.current = []; current.current = null;
    }
    return () => { timers.current.forEach(clearTimeout); timers.current = []; current.current = null; };
  }, [pathname]);
  const visible = job?.from === pathname ? job : null;
  return <OperationContext.Provider value={{job: visible, step, error, run, cancel, retry: () => { if (job) { stop(); run(job.id, job.complete, job.options); } }}}>{children}</OperationContext.Provider>;
}
export function useOperationActive() { return !!useContext(OperationContext)?.job; }
export function useOperation() {
  const context = useContext(OperationContext);
  if (!context) throw new Error("OperationProvider is required");
  return context.run;
}
export function OperationCard({ id, step = 1, options, error = false, onCancel, onRetry }: { id: OperationId; step?: number; options?: Options; error?: boolean; onCancel?: () => void; onRetry?: () => void }) {
  const item = { ...copy[id], ...options };
  return <section className="aw-operation-stage" data-operation={id} aria-busy={!error}>
    <div className="aw-operation-card" role={error ? "alert" : "status"} aria-live="polite">
      <i className={error ? "aw-operation-error-icon" : "aw-operation-spinner"} aria-hidden="true">{error ? "!" : ""}</i>
      <h1>{error ? "This step could not be completed" : item.title}</h1>
      <p>{error ? "No real transaction was made. Retry this demo step or return to the page." : item.description}</p>
      <ol>{item.steps.map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "current" : "waiting"}><i aria-hidden="true">{index < step ? "✓" : ""}</i><span>{label}</span></li>)}</ol>
      <div className="aw-operation-destination">Going to <b>{item.destination}</b></div>
      <small>Demo only · no real money, file transfer or AI request</small>
      <div className="aw-operation-actions">{error && <button type="button" onClick={onRetry}>Retry</button>}{onCancel && <button type="button" onClick={onCancel}>{error ? "Back" : "Cancel"}</button>}</div>
    </div>
  </section>;
}
export function OperationOutlet({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const state = useContext(OperationContext);
  const job = state?.job;
  return <><div className="aw-operation-content" hidden={!!job}>{children}</div>{job && <>{!publicPage && <V08BalanceBar/>}<OperationCard id={job.id} step={state.step} options={job.options} error={state.error} onCancel={state.cancel} onRetry={state.retry}/></>}</>;
}
export { copy as operationCopy };
