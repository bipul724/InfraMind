// B2.1: a stand-in `git` executable, so spawned servers can reach the "cloned" state
// offline in either session store. Put `binDir` first on the server's PATH: utils/git.js
// runs `git` through PATH with execFile, so nothing in the server changes. A `clone`
// writes a small Node project to the destination (the last argument) instead of
// contacting github.com; every invocation is appended to `logFile` as one JSON line.
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir } from './helpers.js';

export const FAKE_REPO_FILES = Object.freeze({
  'package.json': JSON.stringify({ name: 'fixture', main: 'index.js', scripts: { start: 'node index.js', test: 'node --test' }, dependencies: { express: '^4.21.0' } }, null, 2),
  'index.js': "const express = require('express');\nexpress().listen(process.env.PORT || 3000);\n",
  'README.md': '# fixture\n'
});

const SCRIPT = (logFile) => `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args }) + '\\n');
if (args.includes('clone')) {
  const destination = args[args.length - 1];
  const files = ${JSON.stringify(FAKE_REPO_FILES)};
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(destination, name), content);
}
process.exit(0);
`;

export async function createFakeGit() {
  const dir = await makeTempDir('inframind-fake-git-');
  const binDir = path.join(dir, 'bin');
  const logFile = path.join(dir, 'git.log');
  await fs.mkdir(binDir);
  await fs.writeFile(logFile, '');
  await fs.writeFile(path.join(binDir, 'git'), SCRIPT(logFile), { mode: 0o755 });
  return {
    binDir,
    // PATH for a spawned server: the fake first, then the real one (node, etc.)
    pathEnv: `${binDir}${path.delimiter}${process.env.PATH}`,
    async invocations() {
      const text = await fs.readFile(logFile, 'utf8');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
    async clones() {
      return (await this.invocations()).filter((entry) => entry.args.includes('clone'));
    }
  };
}
