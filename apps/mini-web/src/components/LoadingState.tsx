export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return <p role="status" className="loading-state">{label}</p>;
}
