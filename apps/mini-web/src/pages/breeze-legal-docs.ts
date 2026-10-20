import type { LegalDocument, LegalDocumentType } from './legal-docs';

const breezeLegalContactEmail = 'caijiarong@xuyins.com';

const breezeCompanyDetails = `<dl class="detail-list">
<div><dt>Operator</dt><dd>Breeze and Azure Sky Culture Limited</dd></div>
<div><dt>Chinese legal name</dt><dd>長風碧雲文化傳媒有限公司</dd></div>
<div><dt>Registered address</dt><dd>Unit 903, 9/F., Cameron Commercial Centre, 458-468 Hennessy Road, Causeway Bay, Hong Kong</dd></div>
<div><dt>Contact email</dt><dd><a href="mailto:${breezeLegalContactEmail}">${breezeLegalContactEmail}</a></dd></div>
</dl>`;

const breezeLegalDocuments: Record<LegalDocumentType, LegalDocument> = {
  privacy: {
    eyebrow: 'Privacy Policy',
    title: 'Privacy Policy',
    introHtml: '<p>This Privacy Policy explains how Breeze and Azure Sky Culture Limited ("we", "us" or "our") processes information when you use our short-drama services through TikTok Minis (the "Service"). It applies across our Minis operated by the same company, without requiring a separate policy for each Mini.</p><p>Please also review TikTok\'s own privacy notice. Applicable local law may provide additional rights.</p>',
    marketsHtml: '<span class="market-chip">TikTok Minis</span><span class="market-chip">Short-drama service</span>',
    metaHtml: '<div><dt>Last Updated</dt><dd>October 8, 2026</dd></div><div><dt>Effective Date</dt><dd>October 8, 2026</dd></div><div><dt>Controller</dt><dd>Breeze and Azure Sky Culture Limited, Hong Kong</dd></div>',
    tocHtml: '<a href="#section-1"><span>1</span> Who We Are</a><a href="#section-2"><span>2</span> Information We Process</a><a href="#section-3"><span>3</span> How We Use Information</a><a href="#section-4"><span>4</span> Sharing and Transfers</a><a href="#section-5"><span>5</span> Retention and Security</a><a href="#section-6"><span>6</span> Your Rights</a><a href="#section-7"><span>7</span> Children and TikTok</a><a href="#section-8"><span>8</span> Changes and Contact</a>',
    contentHtml: `<section id="section-1" class="policy-section"><h2><span>1</span> Who We Are</h2><p class="policy-copy">The Service is operated by Breeze and Azure Sky Culture Limited. We are responsible for the personal information we determine how and why to process.</p>${breezeCompanyDetails}</section>
<section id="section-2" class="policy-section"><h2><span>2</span> Information We Process</h2><p class="policy-copy">Depending on the Mini and features you use, we process a TikTok-provided identifier and authentication information, such as an OpenID and temporary authorization code; a locally generated anonymous identifier where you use the Service without TikTok sign-in; viewing history, progress, favorites and unlocked episodes; ad completion and anti-fraud signals; and technical records such as device, network, error and request information. If you contact us, we process the information in your message.</p><p class="policy-copy">We do not require a separate Service password or ask for contacts, precise location or payment-card information to watch short dramas. TikTok and advertising providers may independently process information under their own notices.</p></section>
<section id="section-3" class="policy-section"><h2><span>3</span> How We Use Information</h2><p class="policy-copy">We use this information to provide and personalize playback, remember progress and unlock status, verify rewarded-ad completion, maintain security and prevent abuse, diagnose failures, answer requests and comply with applicable law. The legal grounds and choices available to you depend on your jurisdiction and the processing involved.</p></section>
<section id="section-4" class="policy-section"><h2><span>4</span> Sharing and Transfers</h2><p class="policy-copy">We may share information with providers that help us host, deliver video, operate advertisements, secure and maintain the Service, and with TikTok to support Mini functionality. We may disclose information where required by law or to protect rights and safety. Service providers may process information outside your country; where required, we use appropriate safeguards for transfers.</p></section>
<section id="section-5" class="policy-section"><h2><span>5</span> Retention and Security</h2><p class="policy-copy">We keep information only as long as reasonably necessary for the purposes above, subject to legal, security and dispute-resolution needs. We use reasonable technical and organizational safeguards, but no online service can guarantee absolute security.</p></section>
<section id="section-6" class="policy-section"><h2><span>6</span> Your Rights</h2><p class="policy-copy">Depending on applicable law, you may request access, correction, deletion, restriction, portability or an objection to certain processing. Contact us using the email below. We may need information to verify your request. Clearing Mini storage may remove local identifiers and viewing state, but does not by itself guarantee deletion of all server records.</p></section>
<section id="section-7" class="policy-section"><h2><span>7</span> Children and TikTok</h2><p class="policy-copy">The Service is provided within TikTok Minis and is subject to TikTok's platform rules and age requirements. If you believe a child has provided information contrary to applicable law, contact us so we can review the request.</p></section>
<section id="section-8" class="policy-section"><h2><span>8</span> Changes and Contact</h2><p class="policy-copy">We may update this Policy as the Service or legal requirements change. The current version and its effective date will be published here. For privacy questions or requests, contact:</p>${breezeCompanyDetails}</section>`
  },
  terms: {
    eyebrow: 'Terms of Service',
    title: 'Terms of Service',
    introHtml: '<p>These Terms of Service govern your use of short-drama TikTok Minis operated by Breeze and Azure Sky Culture Limited (the "Service"). By using the Service, you agree to these Terms and our Privacy Policy. If you do not agree, do not use the Service.</p>',
    marketsHtml: '<span class="market-chip">TikTok Minis</span><span class="market-chip">Ad-supported access</span>',
    metaHtml: '<div><dt>Last Updated</dt><dd>October 8, 2026</dd></div><div><dt>Effective Date</dt><dd>October 8, 2026</dd></div><div><dt>Operator</dt><dd>Breeze and Azure Sky Culture Limited</dd></div><div><dt>Governing Law</dt><dd>Hong Kong, subject to mandatory local law</dd></div>',
    tocHtml: '<a href="#section-1"><span>1</span> The Service</a><a href="#section-2"><span>2</span> Eligibility</a><a href="#section-3"><span>3</span> Advertising and Access</a><a href="#section-4"><span>4</span> Content and Conduct</a><a href="#section-5"><span>5</span> Availability</a><a href="#section-6"><span>6</span> Third Parties</a><a href="#section-7"><span>7</span> Liability</a><a href="#section-8"><span>8</span> Privacy and Changes</a><a href="#section-9"><span>9</span> Law and Contact</a>',
    contentHtml: `<section id="section-1" class="policy-section"><h2><span>1</span> The Service</h2><p class="policy-copy">We offer short-drama discovery and playback through TikTok Minis. Available titles and features can vary by region, platform and licensing arrangements. These Terms apply to each Mini operated by Breeze and Azure Sky Culture Limited.</p></section>
<section id="section-2" class="policy-section"><h2><span>2</span> Eligibility</h2><p class="policy-copy">You must comply with TikTok's applicable terms, age requirements and local law. Do not use the Service where your use is prohibited.</p></section>
<section id="section-3" class="policy-section"><h2><span>3</span> Advertising and Access</h2><p class="policy-copy">Some episodes may require completion of a rewarded advertisement to unlock access. Ad availability and eligibility may vary. Watching an ad does not transfer ownership of any content and does not guarantee permanent access if content is withdrawn or rights change.</p></section>
<section id="section-4" class="policy-section"><h2><span>4</span> Content and Conduct</h2><p class="policy-copy">Content and the Service are protected by applicable intellectual-property rights. You receive a limited, personal, non-commercial right to use the Service as intended. Do not copy, redistribute, reverse engineer, interfere with security or ad verification, automate abuse, or infringe others' rights.</p></section>
<section id="section-5" class="policy-section"><h2><span>5</span> Availability</h2><p class="policy-copy">We may change, restrict or discontinue content or functionality for licensing, operational, security, legal or platform reasons. We may restrict access where reasonably necessary to address misuse or comply with law. Where required by law, we will provide appropriate notice.</p></section>
<section id="section-6" class="policy-section"><h2><span>6</span> Third Parties</h2><p class="policy-copy">The Service depends on TikTok and other third-party infrastructure, video and advertising services. Their separate terms may apply. We are not responsible for changes to third-party services outside our reasonable control.</p></section>
<section id="section-7" class="policy-section"><h2><span>7</span> Liability</h2><p class="policy-copy">We use reasonable care to operate the Service, but cannot guarantee uninterrupted availability or that every advertisement or title will be available. Nothing in these Terms excludes or limits any consumer right, remedy or liability that cannot lawfully be excluded or limited.</p></section>
<section id="section-8" class="policy-section"><h2><span>8</span> Privacy and Changes</h2><p class="policy-copy">Our Privacy Policy explains our processing of personal information. We may update these Terms and will publish the current version and effective date here. Material changes will be handled as required by applicable law.</p></section>
<section id="section-9" class="policy-section"><h2><span>9</span> Law and Contact</h2><p class="policy-copy">These Terms are governed by the laws of Hong Kong, subject to mandatory consumer and other protections in your place of residence. Before starting a dispute, please contact us so we can try to resolve it. Nothing here removes a right to bring a claim in a competent local forum where applicable law grants that right.</p>${breezeCompanyDetails}</section>`
  }
};

export function legalContactForApp(_app: string) {
  return breezeLegalContactEmail;
}

export function legalDocumentForApp(type: LegalDocumentType, _app: string): LegalDocument {
  return breezeLegalDocuments[type];
}
