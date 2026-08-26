'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'renderer');
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'renderer', 'app.js')],
  outfile: path.join(outDir, 'app.js'),
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction,
  platform: 'browser',
  format: 'iife',
  target: ['chrome136'],
  legalComments: 'eof',
  define: {
    __APP_VERSION__: JSON.stringify(require(path.join(root, 'package.json')).version)
  }
});

for (const name of [
  'index.html',
  'styles.css',
  'platform.css',
  'platform.js',
  'diagnostics.js',
  'lyrics-experience.css',
  'lyrics-experience.js'
]) {
  fs.copyFileSync(
    path.join(root, 'src', 'renderer', name),
    path.join(outDir, name)
  );
}

console.log(`Renderer built at ${outDir}`);
