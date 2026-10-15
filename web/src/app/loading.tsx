/** Shown while a page's server part loads (route changes, first visit). */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[60vh] items-center justify-center gap-3 px-4 text-sm text-[#9fc2ff]">
      <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-[#2e3f5e] border-t-[#559bff]" />
      Loading…
    </div>
  );
}
