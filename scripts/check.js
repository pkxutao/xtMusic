'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'src/main/index.js',
  'src/main/ipc.js',
  'src/main/platform.js',
  'src/main/protocol/feiniu-client.js',
  'src/main/protocol/fn-discovery.js',
  'src/preload.js',
  'src/renderer/app.js',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'src/renderer/platform.css',
  'src/renderer/platform.js'
];

let failed = false;
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    console.error(`Missing required file: ${file}`);
    failed = true;
  }
}

const forbidden = [
  /nodeIntegration\s*:\s*true/,
  /contextIsolation\s*:\s*false/,
  /setCertificateVerifyProc\([^)]*callback\(0\)/,
  /feiniu_password/,
  /localStorage\.setItem\([^,]*password/i
];

for (const dir of ['src/main', 'src/renderer', 'src/preload.js']) {
  const target = path.join(root, dir);
  const entries = fs.statSync(target).isDirectory()
    ? walk(target)
    : [target];
  for (const file of entries) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        console.error(`Forbidden security pattern ${pattern} in ${path.relative(root, file)}`);
        failed = true;
      }
    }
  }
}

if (failed) process.exit(1);
console.log('Static security checks passed.');

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}
