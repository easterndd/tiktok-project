export function formatDuration(durationMs: number | null): string {
  if (!durationMs) return '--:--';
  const totalSeconds = Math.floor(durationMs / 1_000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
