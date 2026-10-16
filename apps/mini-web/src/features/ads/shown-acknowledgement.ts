// Start while the ad is visible. Keep failures recoverable until close, so an
// HTTP failure cannot be mistaken for an SDK failure and replay a watched ad.
export function createShownAcknowledgement(record: () => Promise<unknown>) {
  let confirmed = false;
  let pending: Promise<void> | undefined;
  const attempt = () => {
    pending ??= Promise.resolve().then(record).then(() => {
      confirmed = true;
    }).finally(() => { pending = undefined; });
    return pending;
  };
  void attempt().catch(() => undefined);
  return async () => {
    if (!confirmed) await attempt();
  };
}
