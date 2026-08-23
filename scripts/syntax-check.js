'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const commonJsRoots = [
  path.join(root, 'src', 'main'),
  path.join(root, 'src', 'preload.js'),
  path.join(root, 'scripts'),
  path.join(root, 'tests')
];
const rendererRoot = path.join(root, 'src', 'renderer');
let failed = false;

for (const file of collect(commonJsRoots)) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax error in ${path.relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || 'Unknown parser error\n');
  }
}

for (const file of collect([rendererRoot])) {
  const source = fs.readFileSync(file, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax error in ${path.relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || 'Unknown parser error\n');
  }
}

if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');

function collect(entries) {
  const files = [];
  for (const entry of entries) {
    const stat = fs.statSync(entry);
    if (stat.isFile()) {
      if (entry.endsWith('.js')) files.push(entry);
      continue;
    }
    walk(entry, files);
  }
  return files.sort();
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (full.endsWith('.js')) files.push(full);
  }
}
