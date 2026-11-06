export function episodeDisplayTitle(title: string | null | undefined, episodeNo: number) {
  const value = title?.trim() ?? '';
  if (!value || /^(?:第\s*\d+\s*[集话回]|episode\s*\d+)$/i.test(value)) return `Episode ${episodeNo}`;
  return value;
}
