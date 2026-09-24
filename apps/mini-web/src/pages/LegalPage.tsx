import { ArrowLeft, Mail, ScrollText, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { legalContactEmail, legalDocumentForApp, type LegalDocumentType } from './legal-docs';
import { appKey, appName } from '../lib/app-brand';
import styles from './LegalPage.module.css';

export function LegalPage({ type }: { type: LegalDocumentType }) {
  const legalDocument = legalDocumentForApp(type, appKey === 'taletv' ? 'taletv' : 'quickreels');
  const related = type === 'privacy' ? { path: '/terms', label: 'Terms of Service', icon: ScrollText } : { path: '/privacy', label: 'Privacy Policy', icon: ShieldCheck };
  const RelatedIcon = related.icon;

  useEffect(() => {
    window.scrollTo({ top: 0 });
    globalThis.document.title = `${legalDocument.title} | ${appName}`;
  }, [legalDocument.title]);

  return <article className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.heroTop}>
        <Link className={styles.backLink} to="/profile"><ArrowLeft size={17} aria-hidden="true" /> Back</Link>
        <span className={styles.brandMark}>{appKey === 'taletv' ? 'TV' : 'QR'}</span>
      </div>
      <p className="eyebrow">{legalDocument.eyebrow}</p>
      <h1>{legalDocument.title}</h1>
      <div className={styles.heroLayout}>
        <div className={styles.intro} dangerouslySetInnerHTML={{ __html: legalDocument.introHtml }} />
        <dl className={styles.metaPanel} dangerouslySetInnerHTML={{ __html: legalDocument.metaHtml }} />
      </div>
      <div className={styles.actions}>
        <Link className={styles.actionLink} to={related.path}><RelatedIcon size={16} aria-hidden="true" /> {related.label}</Link>
        <a className={styles.primaryAction} href={`mailto:${legalContactEmail}`}><Mail size={16} aria-hidden="true" /> Contact</a>
      </div>
      <div className={styles.markets} aria-label="Supported regional sections" dangerouslySetInnerHTML={{ __html: legalDocument.marketsHtml }} />
    </header>

    <div className={styles.readerShell}>
      <aside className={styles.toc} aria-label={`${legalDocument.title} contents`}>
        <div className={styles.tocTitle}>Contents</div>
        <nav dangerouslySetInnerHTML={{ __html: legalDocument.tocHtml }} />
      </aside>
      <section className={styles.document} dangerouslySetInnerHTML={{ __html: legalDocument.contentHtml }} />
    </div>
  </article>;
}
