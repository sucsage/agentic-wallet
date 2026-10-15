import { LoadingSkeleton } from "@/components/loading-skeleton";

/** Shown while a page's server part loads (route changes, first visit). */
export default function Loading() {
  return (
    <div className="aw-app aw-v08 min-h-screen">
      <LoadingSkeleton />
    </div>
  );
}
