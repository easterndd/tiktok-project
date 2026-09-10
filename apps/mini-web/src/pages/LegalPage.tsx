export function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  const privacy = type === 'privacy';
  return <article className="legal"><p className="eyebrow">BREEZEREELS</p><h1>{privacy ? 'Privacy Policy' : 'Terms of Service'}</h1><p>This development placeholder must be replaced with counsel-approved legal text and a public HTTPS URL before TikTok submission.</p></article>;
}
