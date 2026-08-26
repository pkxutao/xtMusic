'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'dist', 'renderer');
const proofDir = path.join(root, 'ui-proof');
const indexPath = path.join(rendererDir, 'index.html');

function fail(message) {
  throw new Error(`[renderer verification] ${message}`);
}

if (!fs.existsSync(indexPath)) {
  fail('dist/renderer/index.html does not exist; run the renderer build first');
}

const html = fs.readFileSync(indexPath, 'utf8');
const references = [...html.matchAll(/(?:href|src)=["']\.\/([^"']+)["']/g)]
  .map((match) => match[1]);

if (references.length < 6) {
  fail(`expected at least 6 relative renderer assets, found ${references.length}`);
}

const assets = [];
for (const reference of references) {
  const assetPath = path.join(rendererDir, reference);
  if (!fs.existsSync(assetPath)) fail(`missing renderer asset: ${reference}`);
  const size = fs.statSync(assetPath).size;
  if (size < 32) fail(`renderer asset is unexpectedly small: ${reference} (${size} bytes)`);
  assets.push({ reference, size });
}

if (/\b(?:href|src)=["']\//.test(html)) {
  fail('absolute-root asset path detected; installed file:// builds require relative asset paths');
}

const requiredSelectors = {
  'styles.css': [
    ':root',
    '.app-shell',
    '.titlebar',
    '.sidebar',
    '.content-root',
    '.player-bar',
    '.login-screen',
    '.home-hero',
    '.track-table-row'
  ],
  'platform.css': [':root[data-platform="win32"]'],
  'lyrics-experience.css': ['.lyrics-experience']
};

for (const [file, selectors] of Object.entries(requiredSelectors)) {
  const filePath = path.join(rendererDir, file);
  const css = fs.readFileSync(filePath, 'utf8');
  for (const selector of selectors) {
    if (!css.includes(selector)) fail(`${file} is missing required selector: ${selector}`);
  }
}

fs.mkdirSync(proofDir, { recursive: true });
const report = {
  verifiedAt: new Date().toISOString(),
  rendererDir,
  assetCount: assets.length,
  assets,
  checks: {
    allReferencedAssetsExist: true,
    allAssetPathsAreRelative: true,
    requiredLayoutSelectorsPresent: true
  }
};
fs.writeFileSync(
  path.join(proofDir, 'renderer-assets.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
console.log(`Verified ${assets.length} renderer assets and required layout selectors.`);
