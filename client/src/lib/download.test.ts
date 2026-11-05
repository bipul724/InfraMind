// downloadName: a browser does not accept a path in a download name, so a saved file is
// downloaded under its base name. downloadTextFile: run against a stub document and stub
// object URLs (no DOM in node), with mocked timers for the delayed revoke. Run with `npm test`.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { REVOKE_OBJECT_URL_AFTER_MS, downloadName, downloadTextFile } from './download.ts';

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

interface StubLink { tag: string; href: string; download: string; clicks: number; click(): void }

// Replaces document and URL.createObjectURL/revokeObjectURL for one test. URL's methods are
// restored by t.mock when the test ends; document is restored by the returned function.
function stubBrowser(t: TestContext) {
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const links: StubLink[] = [];
  const appended: StubLink[] = [];
  const removed: StubLink[] = [];
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => { blobs.push(blob); return `blob:stub/${blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const stubDocument = {
    createElement: (tag: string): StubLink => {
      const link: StubLink = { tag, href: '', download: '', clicks: 0, click() { this.clicks++; } };
      links.push(link);
      return link;
    },
    body: { appendChild: (el: StubLink) => { appended.push(el); }, removeChild: (el: StubLink) => { removed.push(el); } }
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: stubDocument, configurable: true, writable: true });
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  };
  return { blobs, revoked, links, appended, removed, restore };
}

test('downloadTextFile: application/octet-stream by default, the base name, a delayed revoke', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stub = stubBrowser(t);
  try {
    downloadTextFile('.github/workflows/ci.yml', 'name: ci\n');
    assert.equal(stub.blobs.length, 1);
    assert.equal(stub.blobs[0].type, 'application/octet-stream');
    assert.equal(await stub.blobs[0].text(), 'name: ci\n');
    assert.equal(stub.links.length, 1);
    const [link] = stub.links;
    assert.equal(link.tag, 'a');
    assert.equal(link.href, 'blob:stub/1');
    assert.equal(link.download, 'ci.yml');
    assert.equal(link.clicks, 1);
    assert.deepEqual(stub.appended, [link]);
    assert.deepEqual(stub.removed, [link]);
    // Revoked after the delay, not at once (an immediate revoke can cancel the download)
    assert.deepEqual(stub.revoked, []);
    t.mock.timers.tick(REVOKE_OBJECT_URL_AFTER_MS - 1);
    assert.deepEqual(stub.revoked, []);
    t.mock.timers.tick(1);
    assert.deepEqual(stub.revoked, ['blob:stub/1']);
  } finally {
    stub.restore();
  }
  assert.equal(Object.getOwnPropertyDescriptor(globalThis, 'document'), undefined, 'document restored');
});

test('downloadTextFile: a given type is used as is', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stub = stubBrowser(t);
  try {
    downloadTextFile('Dockerfile', 'FROM node:22\n', 'text/plain');
    assert.equal(stub.blobs[0].type, 'text/plain');
    assert.equal(stub.links[0].download, 'Dockerfile');
  } finally {
    stub.restore();
  }
});
