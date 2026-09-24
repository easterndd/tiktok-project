export type LegalDocumentType = 'privacy' | 'terms';

export type LegalDocument = {
  eyebrow: string;
  title: string;
  introHtml: string;
  marketsHtml: string;
  metaHtml: string;
  tocHtml: string;
  contentHtml: string;
};

export const legalContactEmail = 'caixuwen@xuyins.com';

const companyDetails = `<dl class="detail-list">
<div><dt>Operator</dt><dd>evergreenprosper</dd></div>
<div><dt>Business address</dt><dd>3901 Branham Park Unit A, Lexington, KY 40515, United States</dd></div>
<div><dt>Privacy contact</dt><dd><a href="mailto:${legalContactEmail}">${legalContactEmail}</a></dd></div>
</dl>`;

const privacyContent = `<section id="section-1" class="policy-section" data-title="Who We Are">
<h2><span>1</span> Who We Are</h2>
<p class="policy-copy">evergreenprosper operates QuicK ReeLS and is responsible for personal information that it controls in connection with the Service.</p>
${companyDetails}
</section>
<section id="section-2" class="policy-section" data-title="Information We Collect">
<h2><span>2</span> Information We Collect</h2>
<section class="policy-subsection"><h3><span>2.1</span> Anonymous device identifier</h3><p class="policy-copy">QuicK ReeLS does not require you to sign in to a QuicK ReeLS account or authorize TikTok login. When you first use the Service, the Mini stores a randomly generated identifier on your device and sends only a protected, one-way-derived identifier to our service. We use it to recognize the same device and maintain its viewing progress, preferences, advertising sessions, and unlocked-content status. We do not use it to identify you across other apps or websites.</p></section>
<section class="policy-subsection"><h3><span>2.2</span> Service activity</h3><p class="policy-copy">We store information needed to operate the Service, including viewing progress, completed episodes, content unlock records, favorites, likes, locale and playback preferences, and service interactions. This data is associated with the anonymous device identifier rather than a named service account.</p></section>
<section class="policy-subsection"><h3><span>2.3</span> Advertising and diagnostics</h3><p class="policy-copy">When advertising features are available, we may process entry-ad and rewarded-ad request, display, completion, early-close, and error events to provide advertising-supported access and diagnose the Service. We may also receive technical information such as IP address, request headers, device or runtime information, language, error reports, and security logs.</p></section>
<section class="policy-subsection"><h3><span>2.4</span> Information you send us</h3><p class="policy-copy">If you contact us, we process the contact details and message content that you provide so that we can respond.</p></section>
</section>
<section id="section-3" class="policy-section" data-title="How We Use Information">
<h2><span>3</span> How We Use Information</h2>
<ul class="policy-list"><li>provide, secure, and improve QuicK ReeLS;</li><li>maintain anonymous device state for the current installation;</li><li>save viewing progress, favorites, preferences, and unlocked-content status;</li><li>operate advertising-supported access where enabled;</li><li>detect, investigate, and prevent fraud, abuse, and technical failures;</li><li>comply with legal obligations and respond to valid requests; and</li><li>respond to privacy, support, and other user inquiries.</li></ul>
</section>
<section id="section-4" class="policy-section" data-title="How We Share Information">
<h2><span>4</span> How We Share Information</h2>
<p class="policy-copy">We do not sell personal information. We share information only as needed to operate the Service, comply with law, protect rights and safety, or complete a corporate transaction.</p>
<section class="policy-subsection"><h3><span>4.1</span> TikTok and BytePlus</h3><p class="policy-copy">QuicK ReeLS runs in TikTok Minis. TikTok may independently process information under its own notices. Where enabled, TikTok and BytePlus services provide platform, advertising, video, and playback capabilities.</p></section>
<section class="policy-subsection"><h3><span>4.2</span> Tencent Cloud</h3><p class="policy-copy">We use Tencent Cloud infrastructure in the United States, Silicon Valley region, to host the Service, including application and database services. Tencent Cloud processes information on our behalf to provide hosting, networking, storage, and related infrastructure.</p></section>
<section class="policy-subsection"><h3><span>4.3</span> Service providers and authorized personnel</h3><p class="policy-copy">Authorized personnel and service providers may access information only when reasonably necessary to operate, secure, support, or improve the Service and subject to appropriate confidentiality and access controls.</p></section>
</section>
<section id="section-5" class="policy-section" data-title="Storage and International Transfers">
<h2><span>5</span> Storage and International Transfers</h2>
<p class="policy-copy">Our primary application and database hosting is in the United States, Silicon Valley region. If you access the Service from another country, your information may be transferred to, stored in, or processed in the United States and in locations where TikTok, BytePlus, or our service providers operate. Those locations may have privacy laws that differ from those in your country.</p>
</section>
<section id="section-6" class="policy-section" data-title="Retention and Deletion">
<h2><span>6</span> Retention and Deletion</h2>
<p class="policy-copy">We retain information only for as long as reasonably necessary for the purposes described in this Policy, including service operation, security, fraud prevention, dispute resolution, and legal compliance. Clearing Mini storage or uninstalling the Mini removes the local anonymous identifier and prevents the prior device history from being restored by the Service. To request deletion of Service data associated with your device, contact us using the address below. We may retain limited information where required or permitted by law.</p>
</section>
<section id="section-7" class="policy-section" data-title="Security">
<h2><span>7</span> Security</h2>
<p class="policy-copy">We use reasonable technical and organizational measures designed to protect information. No internet service or storage system can be guaranteed completely secure.</p>
</section>
<section id="section-8" class="policy-section" data-title="Your Choices and Rights">
<h2><span>8</span> Your Choices and Rights</h2>
<p class="policy-copy">Depending on where you live, you may have rights to request access, correction, deletion, restriction, objection, or portability of personal information. You may also have a right to complain to a privacy authority. To make a request, contact us using the details below and, where available, provide the anonymous identifier from the affected Mini installation. We may need to verify your request before responding.</p>
</section>
<section id="section-9" class="policy-section" data-title="Children">
<h2><span>9</span> Children</h2>
<p class="policy-copy">QuicK ReeLS is not directed to children below the minimum age permitted by TikTok Minis or applicable law. We do not knowingly collect personal information from children in violation of applicable law. Contact us if you believe a child has provided information to us improperly.</p>
</section>
<section id="section-10" class="policy-section" data-title="Third-Party Platforms">
<h2><span>10</span> Third-Party Platforms</h2>
<p class="policy-copy">TikTok, advertising providers, and other third parties may have their own terms and privacy notices. We are not responsible for their independent privacy practices.</p>
</section>
<section id="section-11" class="policy-section" data-title="Changes to This Policy">
<h2><span>11</span> Changes to This Policy</h2>
<p class="policy-copy">We may update this Policy when our Service, legal obligations, or practices change. The latest version will be made available through the Service and will show its effective date.</p>
</section>
<section id="section-12" class="policy-section" data-title="Contact Us">
<h2><span>12</span> Contact Us</h2>
<p class="policy-copy">For privacy questions or requests, contact:</p>
${companyDetails}
</section>`;

const termsContent = `<section id="section-1" class="policy-section" data-title="The Service">
<h2><span>1</span> The Service</h2>
<p class="policy-copy">QuicK ReeLS is a short-drama service made available through TikTok Minis. We may change, add, remove, or restrict features, content, and availability as permitted by law.</p>
</section>
<section id="section-2" class="policy-section" data-title="Eligibility and TikTok Account">
<h2><span>2</span> Eligibility and TikTok</h2>
<p class="policy-copy">You must meet the minimum age and account requirements that TikTok and applicable law require to use TikTok Minis. QuicK ReeLS does not require a separate QuicK ReeLS account or TikTok login authorization to watch content, save local viewing progress, or use advertising-supported access. Your use of TikTok Minis remains subject to TikTok's own terms and notices.</p>
</section>
<section id="section-3" class="policy-section" data-title="Advertising-Supported Access">
<h2><span>3</span> Advertising-Supported Access</h2>
<p class="policy-copy">The Service currently does not offer direct purchases, subscriptions, or virtual-currency purchases. When enabled, an entry advertisement may be shown before content becomes available, and certain episodes may be unlocked after you complete a rewarded advertisement. Advertisement availability, duration, completion conditions, and rewards are controlled by the applicable advertising and platform systems. We do not guarantee that an advertisement will always be available.</p>
</section>
<section id="section-4" class="policy-section" data-title="Content and Intellectual Property">
<h2><span>4</span> Content and Intellectual Property</h2>
<p class="policy-copy">The Service and its videos, artwork, text, software, branding, and other materials are owned by evergreenprosper or used under license. Subject to these Terms, we grant you a limited, personal, revocable, non-transferable right to access the Service for personal, non-commercial entertainment.</p>
</section>
<section id="section-5" class="policy-section" data-title="Acceptable Use">
<h2><span>5</span> Acceptable Use</h2>
<p class="policy-copy">You must not misuse the Service. In particular, you must not attempt to bypass content locks or advertisement rewards, automate impressions or completion events, interfere with the Service or its security, infringe rights, use the Service unlawfully, or reverse engineer the Service except where applicable law expressly permits it.</p>
</section>
<section id="section-6" class="policy-section" data-title="Availability and Changes">
<h2><span>6</span> Availability and Changes</h2>
<p class="policy-copy">Content availability may change because of licensing, regional restrictions, platform requirements, legal obligations, technical reasons, or business decisions. We do not promise that any title, episode, feature, or advertisement will remain available.</p>
</section>
<section id="section-7" class="policy-section" data-title="Third-Party Services">
<h2><span>7</span> Third-Party Services</h2>
<p class="policy-copy">The Service depends on TikTok Minis and may use TikTok, BytePlus, Tencent Cloud, and other service providers. Those services are governed by their own applicable terms and notices. Changes to their services may affect QuicK ReeLS.</p>
</section>
<section id="section-8" class="policy-section" data-title="Disclaimers and Liability">
<h2><span>8</span> Disclaimers and Liability</h2>
<p class="policy-copy">To the maximum extent permitted by law, the Service is provided on an &quot;as available&quot; basis. We do not guarantee uninterrupted, secure, or error-free operation. Nothing in these Terms excludes rights or remedies that applicable law does not permit us to exclude.</p>
</section>
<section id="section-9" class="policy-section" data-title="Suspension and Termination">
<h2><span>9</span> Suspension and Termination</h2>
<p class="policy-copy">We may suspend or restrict access when reasonably necessary to protect users, comply with law or platform rules, prevent fraud or abuse, protect intellectual property, or maintain Service security and reliability.</p>
</section>
<section id="section-10" class="policy-section" data-title="Privacy">
<h2><span>10</span> Privacy</h2>
<p class="policy-copy">Our collection and use of personal information are described in the QuicK ReeLS Privacy Policy.</p>
</section>
<section id="section-11" class="policy-section" data-title="Governing Law">
<h2><span>11</span> Governing Law</h2>
<p class="policy-copy">These Terms are governed by the laws of the Commonwealth of Kentucky, United States, without regard to conflict-of-law rules, except where mandatory law in your place of residence provides otherwise.</p>
</section>
<section id="section-12" class="policy-section" data-title="Contact Us">
<h2><span>12</span> Contact Us</h2>
<p class="policy-copy">For questions about these Terms or the Service, contact:</p>
${companyDetails}
</section>`;

export const legalDocuments: Record<LegalDocumentType, LegalDocument> = {
  privacy: {
    eyebrow: 'Privacy Policy',
    title: 'QuicK ReeLS Privacy Policy',
    introHtml: `<p>This Privacy Policy explains how evergreenprosper (&quot;evergreenprosper,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, stores, and shares information when you use QuicK ReeLS through TikTok Minis (the &quot;Service&quot;).</p><p>QuicK ReeLS is a short-drama service. This Policy applies to the Service and does not replace TikTok's own terms or privacy notices.</p>`,
    marketsHtml: '<span class="market-chip">TikTok Minis</span>\n<span class="market-chip">United States controller</span>\n<span class="market-chip">Tencent Cloud US</span>',
    metaHtml: '<div><dt>Last Updated</dt><dd>September 15, 2026</dd></div><div><dt>Effective Date</dt><dd>September 15, 2026</dd></div><div><dt>Controller</dt><dd>evergreenprosper, United States</dd></div><div><dt>Primary Hosting</dt><dd>Tencent Cloud, United States (Silicon Valley)</dd></div>',
    tocHtml: '<a href="#section-1"><span>1</span> Who We Are</a><a href="#section-2"><span>2</span> Information We Collect</a><a href="#section-3"><span>3</span> How We Use Information</a><a href="#section-4"><span>4</span> How We Share Information</a><a href="#section-5"><span>5</span> Storage and International Transfers</a><a href="#section-6"><span>6</span> Retention and Deletion</a><a href="#section-7"><span>7</span> Security</a><a href="#section-8"><span>8</span> Your Choices and Rights</a><a href="#section-9"><span>9</span> Children</a><a href="#section-10"><span>10</span> Third-Party Platforms</a><a href="#section-11"><span>11</span> Changes to This Policy</a><a href="#section-12"><span>12</span> Contact Us</a>',
    contentHtml: privacyContent
  },
  terms: {
    eyebrow: 'Terms of Service',
    title: 'QuicK ReeLS Terms of Service',
    introHtml: '<p>These Terms of Service govern your use of QuicK ReeLS through TikTok Minis. By using the Service, you agree to these Terms and to the QuicK ReeLS Privacy Policy.</p><p>QuicK ReeLS is operated by evergreenprosper from the United States. If you do not agree to these Terms, do not use the Service.</p>',
    marketsHtml: '<span class="market-chip">TikTok Minis</span>\n<span class="market-chip">Ad-supported service</span>\n<span class="market-chip">No direct purchases</span>',
    metaHtml: '<div><dt>Last Updated</dt><dd>September 15, 2026</dd></div><div><dt>Effective Date</dt><dd>September 15, 2026</dd></div><div><dt>Operator</dt><dd>evergreenprosper</dd></div><div><dt>Governing Law</dt><dd>Kentucky, United States</dd></div>',
    tocHtml: '<a href="#section-1"><span>1</span> The Service</a><a href="#section-2"><span>2</span> Eligibility and TikTok Account</a><a href="#section-3"><span>3</span> Advertising-Supported Access</a><a href="#section-4"><span>4</span> Content and Intellectual Property</a><a href="#section-5"><span>5</span> Acceptable Use</a><a href="#section-6"><span>6</span> Availability and Changes</a><a href="#section-7"><span>7</span> Third-Party Services</a><a href="#section-8"><span>8</span> Disclaimers and Liability</a><a href="#section-9"><span>9</span> Suspension and Termination</a><a href="#section-10"><span>10</span> Privacy</a><a href="#section-11"><span>11</span> Governing Law</a><a href="#section-12"><span>12</span> Contact Us</a>',
    contentHtml: termsContent
  }
};

export function legalDocumentForApp(type: LegalDocumentType, app: 'quickreels' | 'taletv'): LegalDocument {
  const source = legalDocuments[type];
  if (app === 'quickreels') return source;
  return {
    ...source,
    title: source.title.replaceAll('QuicK ReeLS', 'TaleTV'),
    introHtml: source.introHtml.replaceAll('QuicK ReeLS', 'TaleTV'),
    contentHtml: source.contentHtml.replaceAll('QuicK ReeLS', 'TaleTV')
  };
}
