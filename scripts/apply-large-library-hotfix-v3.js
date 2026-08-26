'use strict';

const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.resolve(
  __dirname,
  '..',
  '.github',
  'workflows',
  'windows-playback-regression.yml'
);
const originalWorkflow = fs.readFileSync(workflowPath, 'utf8');

try {
  require('./apply-large-library-hotfix-v2');
} finally {
  fs.writeFileSync(workflowPath, originalWorkflow, 'utf8');
}

console.log('Restored the permanent regression workflow after applying the source-only hotfix.');
