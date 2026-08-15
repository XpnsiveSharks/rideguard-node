#!/usr/bin/env node
/**
 * Usage:
 *   yarn run gen:module module_name
 */
const { spawnSync } = require('node:child_process');

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0) {
  console.error('❌ Missing name. Example: yarn run gen:module my_module');
  process.exit(1);
}

const name = rawArgs[0];

// optional: allow overriding path via --path modules
let basePath = 'modules';
const pathIndex = rawArgs.indexOf('--path');
if (pathIndex !== -1 && rawArgs[pathIndex + 1]) {
  basePath = rawArgs[pathIndex + 1];
}

const target = name.includes('/') ? name : `${basePath}/${name}`;

// Use local nest cli (node_modules/.bin) via npx to be safe
run('npx', ['nest', 'g', 'module', target, '--no-spec']);
run('npx', ['nest', 'g', 'controller', target, '--no-spec']);
run('npx', ['nest', 'g', 'service', target, '--no-spec']);
