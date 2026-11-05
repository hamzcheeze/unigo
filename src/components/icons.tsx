export function BusIcon({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="3" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4 11h16M8 19v2m8-2v2M8 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><circle cx="8" cy="15" r="1.2" fill="currentColor"/><circle cx="16" cy="15" r="1.2" fill="currentColor"/></svg>;
}
export function PinIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8"/></svg>;
}
export function TargetIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}
