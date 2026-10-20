/** Paid campaigns must opt in through their Mini landing URL. */
export function isPaidStoryLandEntry(search: string, pathname: string) {
  if (pathname !== '/') return false;
  const values = new URLSearchParams(search).getAll('ad_entry');
  return values.length === 1 && values[0] === '1';
}
