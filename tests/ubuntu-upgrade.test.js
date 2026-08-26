'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const indexSource = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8');
const preinstallSource = fs.readFileSync(
  path.join(root, 'build/linux-before-install.sh'),
  'utf8'
);

test('Ubuntu DEB runs the stale-process guard before replacing the app', () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.ok(
    packageJson.build.deb.fpm.includes('--before-install=build/linux-before-install.sh')
  );
  assert.match(preinstallSource, /\/opt\/XT Music\/xtmusic/);
  assert.match(preinstallSource, /XT-Music-.*\.AppImage/);
  assert.match(preinstallSource, /kill -TERM/);
  assert.match(preinstallSource, /kill -KILL/);
  assert.doesNotMatch(preinstallSource, /rm\s+-rf\s+\/home/);
});

test('new instances identify their version and can replace a stale tray process', () => {
  assert.match(indexSource, /requestSingleInstanceLock\(instanceData\)/);
  assert.match(indexSource, /additionalData\?\.version/);
  assert.match(indexSource, /incomingVersion !== app\.getVersion\(\)/);
  assert.match(indexSource, /app\.relaunch\(\{ execPath: incomingExecutable, args: \[\] \}\)/);
  assert.match(indexSource, /title: `XT Music \$\{app\.getVersion\(\)\}`/);
});
