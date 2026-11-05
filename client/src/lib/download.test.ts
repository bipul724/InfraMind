// downloadName: a browser does not accept a path in a download name, so a saved file is
// downloaded under its base name. Run with `npm test`. (downloadTextFile needs a DOM; the
// browser check covers it.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadName } from './download.ts';

test('downloadName gives the base name', () => {
  const cases: [string, string][] = [
    ['Dockerfile', 'Dockerfile'],
    ['.github/workflows/ci.yml', 'ci.yml'],
    ['.env.example', '.env.example'],
    ['a/b/', 'b'],
    ['/x', 'x'],
    ['', '']
  ];
  for (const [input, expected] of cases) assert.equal(downloadName(input), expected, input);
});
