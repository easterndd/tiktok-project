import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');
const repoRoot = resolve(packageRoot, '..', '..');
const app = process.argv[2] ?? 'quickreels';
const appNames = { quickreels: 'QuicK ReeLS', taletv: 'TaleTV', cinereels: 'CineReels', talereels: 'TaleReels', storyland: 'StoryLand', dramacloud: 'DramaCloud', dailyreel: 'DailyReel', dramaone: 'DramaOne', dramaup: 'DramaUp', dramavault: 'DramaVault', talehub: 'TaleHub', talebox: 'TaleBox', storyworld: 'StoryWorld', storyhub: 'StoryHub', dramaroom: 'DramaRoom', dramazone: 'DramaZone', taleflick: 'TaleFlick', dramashort: 'DramaShort', storyshort: 'StoryShort', storyflicks: 'StoryFlicks', dramaflicks: 'DramaFlicks', crownrush: 'CrownRush', sugarreel: 'SugarReel', crimsonshorts: 'CrimsonShorts', sweetreel: 'SweetReel', dramablaze: 'DramaBlaze', heartreel: 'HeartReel', dramahit: 'DramaHit', crownreel: 'CrownReel', luxereel: 'LuxeReel', elitedrama: 'EliteDrama' };
if (!(app in appNames)) throw new Error(`Expected one of: ${Object.keys(appNames).join(', ')}.`);
const appName = appNames[app];
const publicPath = app;
const sourcePath = join(packageRoot, 'src', 'pages', 'legal-docs.ts');
const outputRoot = join(repoRoot, 'deploy', 'website', publicPath);
const breezeApp = ['crownrush', 'sugarreel', 'crimsonshorts', 'sweetreel', 'dramablaze', 'heartreel', 'dramahit', 'crownreel', 'luxereel', 'elitedrama'].includes(app);
const publicBaseUrl = breezeApp ? 'https://xuyins.com/static' : app === 'quickreels' ? `https://evergreenprosper.com/${publicPath}` : 'https://www.yya.ai/capy';
const legalOperator = breezeApp ? 'Breeze and Azure Sky Culture Limited' : app === 'quickreels' ? 'evergreenprosper' : 'SAGATHIYA TECHSOLUTIONS PRIVATE LIMITED';
const legalOperatorUrl = breezeApp ? 'https://xuyins.com/' : app === 'quickreels' ? 'https://evergreenprosper.com/' : 'https://www.yya.ai/';

function loadLegalDocuments(source) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: (id) => {
      throw new Error(`Unexpected dependency while exporting legal pages: ${id}`);
    }
  };
  vm.runInNewContext(transpiled, sandbox, { filename: sourcePath });
  return module.exports;
}

function renderPage(type, legalDocument, legalContactEmail) {
  const otherType = type === 'privacy' ? 'terms' : 'privacy';
  const otherLabel = type === 'privacy' ? 'Terms of Service' : 'Privacy Policy';
  const canonicalUrl = breezeApp
    ? `${publicBaseUrl}/${type === 'privacy' ? 'privacy-policy' : 'terms-of-service'}.html`
    : app !== 'quickreels'
    ? `${publicBaseUrl}/${type === 'privacy' ? 'privacypolicy.html' : 'termsofservice.html'}`
    : `${publicBaseUrl}/${type}`;
  const relatedUrl = breezeApp
    ? `${publicBaseUrl}/${otherType === 'privacy' ? 'privacy-policy' : 'terms-of-service'}.html`
    : app !== 'quickreels'
    ? `${publicBaseUrl}/${otherType === 'privacy' ? 'privacypolicy.html' : 'termsofservice.html'}`
    : `/${publicPath}/${otherType}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${legalDocument.title}${breezeApp ? '' : ` | ${appName}`}</title>
  <meta name="description" content="${legalDocument.title} for ${breezeApp ? 'TikTok Minis short-drama services' : appName}, operated by ${legalOperator}.">
  <link rel="canonical" href="${canonicalUrl}">
  <style>
    :root {
      color-scheme: light;
      --text: #111827;
      --muted: #4b5563;
      --faint: #6b7280;
      --line: #d9dee8;
      --surface: #ffffff;
      --soft: #f6f8fb;
      --accent: #c9184a;
      --accent-soft: #fff1f5;
      --link: #075985;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--text);
      background: #f3f5f8;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
    }
    a { color: var(--link); }
    .page { max-width: 1160px; margin: 0 auto; padding: 32px 20px 48px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
      padding: 32px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface);
    }
    .brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .brand a { min-width: 0; overflow-wrap: anywhere; }
    .brand a, .actions a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--text);
      background: var(--surface);
      font-size: 13px;
      font-weight: 750;
      text-decoration: none;
    }
    .mark {
      display: grid;
      flex: 0 0 40px;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 8px;
      color: #ffffff;
      background: var(--accent);
      font-size: 12px;
      font-weight: 850;
    }
    .eyebrow {
      margin: 0;
      color: var(--accent);
      font-size: 12px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 { max-width: 860px; margin: 0; font-size: clamp(34px, 6vw, 64px); line-height: 1.04; letter-spacing: 0; }
    .hero-layout { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 24px; align-items: start; }
    .intro { min-width: 0; max-width: 760px; color: var(--muted); font-size: 16px; }
    .intro, .document, .meta-panel, .detail-list { overflow-wrap: anywhere; }
    .intro p { margin: 0 0 14px; }
    .meta-panel, .detail-list {
      display: grid;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--soft);
    }
    .meta-panel div, .detail-list div {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 12px;
      padding: 13px 14px;
      border-bottom: 1px solid var(--line);
    }
    .meta-panel div:last-child, .detail-list div:last-child { border-bottom: 0; }
    dt { color: var(--faint); font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
    dd { min-width: 0; margin: 0; word-break: break-word; }
    .actions, .markets { display: flex; flex-wrap: wrap; gap: 10px; }
    .actions .primary { color: #ffffff; border-color: var(--accent); background: var(--accent); }
    .market-chip {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 0 12px;
      border: 1px solid #fbcfe8;
      border-radius: 999px;
      color: #9f1239;
      background: var(--accent-soft);
      font-size: 12px;
      font-weight: 750;
    }
    .reader { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 24px; align-items: start; margin-top: 26px; }
    .toc {
      position: sticky;
      top: 24px;
      max-height: calc(100dvh - 48px);
      overflow: auto;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--surface);
    }
    .toc-title { margin-bottom: 10px; color: var(--faint); font-size: 11px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
    .toc nav { display: grid; gap: 2px; }
    .toc a { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 8px; padding: 8px; color: var(--muted); border-radius: 8px; font-size: 13px; line-height: 1.35; text-decoration: none; }
    .toc a:hover { color: var(--text); background: var(--soft); }
    .toc span { color: var(--accent); font-weight: 850; }
    .document { min-width: 0; padding: 30px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); font-size: 15.5px; }
    .policy-section { scroll-margin-top: 24px; padding: 4px 0 30px; border-bottom: 1px solid var(--line); }
    .policy-section:last-child { border-bottom: 0; }
    .policy-subsection { scroll-margin-top: 24px; margin-top: 18px; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--soft); }
    h2, h3 { margin: 0 0 12px; color: var(--text); letter-spacing: 0; }
    h2 { display: flex; gap: 10px; align-items: baseline; font-size: 24px; line-height: 1.25; }
    h3 { display: flex; gap: 9px; align-items: baseline; font-size: 18px; line-height: 1.35; }
    h2 span, h3 span { flex: 0 0 auto; color: var(--accent); font-size: .72em; font-weight: 850; }
    p { margin: 0 0 13px; }
    .policy-list { margin: 8px 0 16px; padding-left: 22px; }
    .policy-list li { margin: 6px 0; padding-left: 4px; }
    @media (max-width: 900px) {
      .hero-layout, .reader { grid-template-columns: minmax(0, 1fr); }
      .toc { position: static; max-height: none; }
    }
    @media (max-width: 560px) {
      .page { padding: 18px 14px 34px; }
      .hero, .document { padding: 20px; }
      h1 { font-size: 34px; }
      .meta-panel div, .detail-list div { grid-template-columns: 1fr; gap: 4px; }
      .toc { display: none; }
      .document { font-size: 14px; }
      h2 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="hero">
      <div class="brand">
        <a href="${legalOperatorUrl}">${legalOperator}</a>
        <span class="mark">${breezeApp ? 'BA' : app === 'quickreels' ? 'QR' : app === 'taletv' ? 'TV' : appName.replace(/[^A-Z]/g, '').slice(0, 3) || appName.slice(0, 2).toUpperCase()}</span>
      </div>
      <p class="eyebrow">${legalDocument.eyebrow}</p>
      <h1>${legalDocument.title}</h1>
      <div class="hero-layout">
        <div class="intro">${legalDocument.introHtml}</div>
        <dl class="meta-panel">${legalDocument.metaHtml}</dl>
      </div>
      <div class="actions">
        <a href="${relatedUrl}">${otherLabel}</a>
        <a class="primary" href="mailto:${legalContactEmail}">Contact</a>
      </div>
      <div class="markets" aria-label="Supported regional sections">${legalDocument.marketsHtml}</div>
    </header>
    <div class="reader">
      <aside class="toc" aria-label="${legalDocument.title} contents">
        <div class="toc-title">Contents</div>
        <nav>${legalDocument.tocHtml}</nav>
      </aside>
      <section class="document">${legalDocument.contentHtml}</section>
    </div>
  </main>
</body>
</html>
`;
}

const source = await readFile(sourcePath, 'utf8');
const { legalDocumentForApp, legalContactForApp } = loadLegalDocuments(source);
const contactEmail = legalContactForApp(app);

for (const type of ['privacy', 'terms']) {
  const directory = join(outputRoot, type);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), renderPage(type, legalDocumentForApp(type, app), contactEmail), 'utf8');
  if (breezeApp) {
    const staticDirectory = join(repoRoot, 'deploy', 'website', 'static');
    await mkdir(staticDirectory, { recursive: true });
    const page = renderPage(type, legalDocumentForApp(type, app), contactEmail);
    const suffix = type === 'privacy' ? 'privacy-policy' : 'terms-of-service';
    await writeFile(join(staticDirectory, `${suffix}.html`), page, 'utf8');
    if (['crownrush', 'sugarreel', 'crimsonshorts'].includes(app)) {
      await writeFile(join(staticDirectory, `${app}-${suffix}.html`), page, 'utf8');
    }
  }
}

console.log(`Exported ${appName} legal pages to ${outputRoot}`);
