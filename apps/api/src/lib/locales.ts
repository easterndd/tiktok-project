import { z } from 'zod';

export const publicLocales = [
  'en',
  'pt',
  'fr',
  'id',
  'ja',
  'es',
  'ko',
  'th'
] as const;

export const publicLocaleSchema = z.enum(publicLocales);
export const defaultLocale = 'en' as const;

export type PublicLocale = z.infer<typeof publicLocaleSchema>;
