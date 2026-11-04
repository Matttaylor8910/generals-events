'use strict';
// Deploy-runtime configuration regression: the functions runtime must match
// the Firebase CLI-supported Node major in engines, the lockfile must agree,
// and the deploy workflow must install function deps on that same runtime.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function namedSteps(workflow) {
  const matches = [...workflow.matchAll(/^ {6}- name: ([^\r\n]+)\r?$/gm)];
  return matches.map((match, i) => ({
    name: match[1],
    offset: match.index,
    body: workflow.slice(match.index, matches[i + 1]?.index ?? workflow.length),
  }));
}

// Validate one config object so the same assertions can be exercised against
// the real files and deliberate misconfigurations.
function validate({ fnsPkg, lockRoot, nvmrc, workflow }) {
  assert.strictEqual(fnsPkg.engines.node, '22',
    'functions/package.json engines must pin the Node 22 runtime');
  assert.strictEqual(lockRoot.engines.node, '22',
    'functions/package-lock.json root engines must match');

  assert.strictEqual(nvmrc.trim(), 'v16.20.2',
    '.nvmrc must keep the Angular app on Node 16');

  const steps = namedSteps(workflow);
  const step = name => {
    const found = steps.find(candidate => candidate.name === name);
    assert.ok(found, `missing workflow step: ${name}`);
    return found;
  };
  const app = step('Set up Node.js 16 for the app build');
  const deploy = step('Set up Node.js 22 for the functions deploy');
  for (const setup of [app, deploy]) {
    assert.match(setup.body, /^ {8}uses: actions\/setup-node@v\d+\r?$/m);
  }
  assert.match(app.body, /^ {10}node-version: 16\.20\.2\r?$/m,
    'app setup-node must pin node-version 16.20.2');
  assert.match(deploy.body, /^ {10}node-version: 22\r?$/m,
    'deploy setup-node must pin node-version 22');
  assert.match(step('Install functions dependencies').body,
    /^ {8}run: npm --prefix functions ci --force\r?$/m);
  assert.match(step('Check deployment runtime configuration').body,
    /^ {8}run: npm run test:deployment\r?$/m,
    'deployment check must run the offline config test');
  assert.match(step('Deploy to Firebase').body,
    /^ {8}run: firebase deploy --project generals-tournaments --non-interactive --force\r?$/m);

  const order = [
    app.name, 'Install app dependencies', 'Build prod app', deploy.name,
    'Install functions dependencies', 'Check deployment runtime configuration',
    'Install Firebase CLI', 'Deploy to Firebase',
  ].map(name => step(name).offset);
  assert.deepStrictEqual(order, [...order].sort((a, b) => a - b),
    'app build must precede Node 22 setup, functions install, checks and deploy');
}

const good = {
  fnsPkg: JSON.parse(read('functions/package.json')),
  lockRoot: JSON.parse(read('functions/package-lock.json')).packages[''],
  nvmrc: read('.nvmrc'),
  workflow: read('.github/workflows/deploy.yml'),
};
validate(good);

// Mutate the valid configuration and require the intended diagnostic, so a
// broken fixture cannot make every negative case pass for an unrelated reason.
const bad = (overrides, diagnostic) =>
  assert.throws(() => validate({ ...good, ...overrides }), diagnostic);
bad({ fnsPkg: { engines: { node: '20' } } }, /functions\/package.json engines/);
bad({ lockRoot: { engines: { node: '20' } } }, /lock.json root engines/);
bad({ workflow: good.workflow.replace('node-version: 22', 'node-version: 20') },
  /deploy setup-node must pin/);
bad({ workflow: good.workflow.replace('node-version: 16.20.2', 'node-version: 22') },
  /app setup-node must pin/);
bad({ workflow: good.workflow.replace('run: npm run test:deployment', 'run: echo skipped') },
  /deployment check must run/);
const install = namedSteps(good.workflow)
  .find(step => step.name === 'Install functions dependencies').body;
const earlyInstall = good.workflow.replace(install, '').replace(
  '      - name: Set up Node.js 22', install + '      - name: Set up Node.js 22');
bad({ workflow: earlyInstall }, /app build must precede/);

console.log('deployment-runtime: engine/lock/workflow checks passed');
