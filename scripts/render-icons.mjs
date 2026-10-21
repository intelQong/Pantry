// Renders the app icons in public/ from the SVG sources in scripts/icons/.
//
//   node scripts/render-icons.mjs
//
// Three sources because the platforms want different things: iOS and
// Android's maskable icon take a full-bleed square and round it themselves,
// so baked-in corners would be rounded twice; the plain manifest icons and the
// favicon are shown unmasked, so they carry their own corners; and the
// maskable art is drawn smaller to sit inside Android's 80% safe zone.
//
// Uses playwright-core (a dev dependency) and its downloaded Chromium.
import { chromium } from "playwright-core";
import { readFileSync, copyFileSync } from "node:fs";

const OUT = [
  ["full-bleed.svg", "public/apple-touch-icon.png", 180],
  ["rounded.svg", "public/icon-192.png", 192],
  ["rounded.svg", "public/icon-512.png", 512],
  ["maskable.svg", "public/icon-maskable-512.png", 512],
];

const browser = await chromium.launch();
for (const [source, out, size] of OUT) {
  const svg = readFileSync(`scripts/icons/${source}`, "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: out, omitBackground: true });
  await page.close();
  console.log(out);
}
await browser.close();
copyFileSync("scripts/icons/rounded.svg", "public/icon.svg");
