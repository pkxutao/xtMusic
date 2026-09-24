'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const platform = process.platform;
const output = path.join(root, 'release-out');
fs.mkdirSync(output, { recursive: true });
const names = platform === 'win32'
  ? [`XT-Music-${version}-x64.exe`, `XT-Music-Portable-${version}-x64.exe`]
  : [`XT-Music-${version}-ubuntu-amd64.deb`, `XT-Music-${version}-ubuntu-x86_64.AppImage`];
for (const name of names) {
  const file = path.join(root, 'release', name);
  if (fs.statSync(file).size < 50000000) throw Error(`Package unexpectedly small: ${name}`);
  fs.copyFileSync(file, path.join(output, name));
}
const proof = JSON.parse(fs.readFileSync(path.join(root, 'ui-proof', `full-library-${platform}.json`), 'utf8'));
if (!proof.passed || proof.sandboxDisabled) throw Error('Packaged full-library verification did not pass with the sandbox enabled');
for (const name of fs.readdirSync(path.join(root, 'ui-proof'))) {
  if (/\.(json|png)$/.test(name) && /^(full-library-|windows-|ubuntu-)/.test(name)) {
    fs.copyFileSync(path.join(root, 'ui-proof', name), path.join(output, `${platform}-${name}`));
  }
}
const tests = fs.readFileSync(path.join(root, 'verification', 'application-tests.log'), 'utf8');
const pass = Number(/# pass (\d+)/.exec(tests)?.[1]);
const fail = Number(/# fail (\d+)/.exec(tests)?.[1]);
if (!pass || fail !== 0) throw Error('Missing passing unit test results');
const info = { version, platform, arch: process.arch, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  unitTests: { pass, fail }, node: process.version, electron: require(path.join(root, 'package.json')).devDependencies.electron,
  workflowRun: process.env.GITHUB_RUN_ID || null, builtAt: new Date().toISOString(),
  verification: proof, limits: 'Loopback mock NAS; no real FNOS credentials, physical audio, Bluetooth, Wayland or mounted FUSE validation. Windows binaries are not production Authenticode signed.' };
fs.writeFileSync(path.join(output, `BUILD-INFO-${platform}.json`), JSON.stringify(info, null, 2));
fs.writeFileSync(path.join(output, `VERIFICATION-${platform}.txt`), `${pass} unit tests passed.\n${proof.checks.join('\n')}\n${info.limits}\n`);
const sums = fs.readdirSync(output).filter((name) => !name.startsWith('SHA256')).sort()
  .map((name) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(output, `SHA256SUMS-${platform}.txt`), sums.join('\n') + '\n');
console.log(JSON.stringify(info, null, 2));
