// SDK failures and failures to acknowledge a displayed ad have different meanings.
export async function runAdShow(
  show: () => Promise<unknown>,
  confirmShown: () => Promise<unknown>,
  onSdkError: (error: unknown) => void,
  onReportError: (error: unknown) => void
) {
  try { await show(); }
  catch (error) { onSdkError(error); return; }
  try { await confirmShown(); }
  catch (error) { onReportError(error); }
}
