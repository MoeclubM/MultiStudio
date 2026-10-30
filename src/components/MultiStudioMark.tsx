export function MultiStudioMark({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M7 24V8l9 11L25 8v16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="7" cy="8" r="2" fill="currentColor" />
    <circle cx="16" cy="19" r="2" fill="currentColor" />
    <circle cx="25" cy="8" r="2" fill="currentColor" />
  </svg>;
}
