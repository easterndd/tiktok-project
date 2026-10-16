const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const out = path.resolve(__dirname, '../../output/skyreels-icons');
fs.mkdirSync(out, { recursive: true });

const icons = [
  ['01-video', '#071A3A', '#28D7E8', '#FFFFFF', `<rect x="220" y="250" width="584" height="524" rx="112" fill="none" stroke="${'#28D7E8'}" stroke-width="58"/><path d="M445 382 Q445 350 476 369 L655 482 Q684 500 655 519 L476 632 Q445 651 445 619Z" fill="#FFFFFF"/><circle cx="300" cy="330" r="20" fill="#FF745F"/>`],
  ['02-analytics', '#10283B', '#46D6B4', '#F7FFFF', `<path d="M250 734V560h112v174zm184 0V436h112v298zm184 0V305h112v429z" fill="${'#46D6B4'}"/><path d="m276 482 172-112 120 40 170-152" fill="none" stroke="#FFFFFF" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/><path d="m700 258 80-8-20 80" fill="none" stroke="#FF745F" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`],
  ['03-calendar', '#33214D', '#FFB84D', '#FFFFFF', `<rect x="230" y="278" width="564" height="492" rx="78" fill="none" stroke="#FFFFFF" stroke-width="48"/><path d="M230 420h564" stroke="#FFB84D" stroke-width="48"/><path d="M360 220v120m304-120v120" stroke="#FFB84D" stroke-width="48" stroke-linecap="round"/><path d="m355 585 82 78 205-202" fill="none" stroke="#54DCC1" stroke-width="55" stroke-linecap="round" stroke-linejoin="round"/>`],
  ['04-account', '#183F4A', '#54DCC1', '#FFFFFF', `<circle cx="512" cy="394" r="148" fill="#54DCC1"/><path d="M220 802c20-174 124-258 292-258s272 84 292 258" fill="#FFFFFF"/><circle cx="512" cy="394" r="78" fill="#183F4A"/><path d="M310 790c28-92 98-142 202-142s174 50 202 142" fill="#183F4A"/>`],
  ['05-campaign', '#4A1E30', '#FF745F', '#FFFFFF', `<path d="M242 460h164l305-164v432L406 564H242z" fill="#FF745F"/><path d="M406 564 460 784h126l-82-236" fill="#FFFFFF"/><path d="M744 398q112 60 0 124m45-226q202 164 0 328" fill="none" stroke="#FFD36F" stroke-width="42" stroke-linecap="round"/>`],
  ['06-messages', '#17364A', '#54DCC1', '#FFFFFF', `<path d="M222 278h580v392H480L322 790v-120h-100z" fill="#FFFFFF"/><path d="M332 408h360M332 510h276" stroke="#54DCC1" stroke-width="48" stroke-linecap="round"/><circle cx="695" cy="686" r="112" fill="#FF745F"/><path d="M650 686h90m-45-45v90" stroke="#FFFFFF" stroke-width="30" stroke-linecap="round"/>`],
  ['07-settings', '#283448', '#80A7FF', '#FFFFFF', `<path d="m512 220 52 18 20 74 64 36 74-14 48 48-14 74 36 64 74 20 18 52-18 52-74 20-36 64 14 74-48 48-74-14-64 36-20 74-52 18-52-18-20-74-64-36-74 14-48-48 14-74-36-64-74-20-18-52 18-52 74-20 36-64-14-74 48-48 74 14 64-36 20-74z" fill="#80A7FF" transform="translate(0 0) scale(.78) translate(144 144)"/><circle cx="512" cy="512" r="126" fill="#283448" stroke="#FFFFFF" stroke-width="42"/><circle cx="512" cy="512" r="45" fill="#FFFFFF"/>`],
  ['08-billing', '#49321D', '#FFD36F', '#FFFFFF', `<rect x="290" y="210" width="444" height="604" rx="70" fill="#FFFFFF"/><path d="M390 350h244m-244 90h244" stroke="#C5D6E8" stroke-width="34" stroke-linecap="round"/><circle cx="512" cy="620" r="112" fill="#FFD36F"/><path d="M550 570c-18-26-72-24-78 8-8 44 92 29 85 81-5 37-58 47-91 19m48-136v160" fill="none" stroke="#49321D" stroke-width="28" stroke-linecap="round"/>`],
  ['09-store', '#263A31', '#B6E36B', '#FFFFFF', `<path d="M250 388h524v390H250z" fill="#FFFFFF"/><path d="M210 388 282 238h460l72 150" fill="#B6E36B"/><path d="M210 388q0 105 100 105t100-105q0 105 102 105t102-105q0 105 100 105t100-105" fill="#FF745F"/><path d="M420 778V586h184v192" fill="none" stroke="#263A31" stroke-width="38"/><path d="M318 566v168m364-168v168" stroke="#D9E8D7" stroke-width="22"/>`],
];

for (const [name, bg, accent, fg, artwork] of icons) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#101827"/></linearGradient><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#000" flood-opacity=".22"/></filter></defs><rect width="1024" height="1024" rx="220" fill="url(#bg)"/><g filter="url(#shadow)">${artwork}</g></svg>`;
  fs.writeFileSync(path.join(out, `${name}.svg`), svg);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
  fs.writeFileSync(path.join(out, `${name}.png`), png);
}
const tiles = icons.map(([name], i) => {
  const x = 52 + (i % 3) * 360;
  const y = 52 + Math.floor(i / 3) * 360;
  const data = fs.readFileSync(path.join(out, `${name}.png`)).toString('base64');
  return `<image x="${x}" y="${y}" width="300" height="300" href="data:image/png;base64,${data}"/>`;
}).join('');
const contactSheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1132" height="1132" viewBox="0 0 1132 1132"><rect width="1132" height="1132" fill="#F3F6F8"/>${tiles}</svg>`;
fs.writeFileSync(path.join(out, 'preview-grid.png'), new Resvg(contactSheet).render().asPng());
console.log(`Rendered ${icons.length} icons to ${out}`);
