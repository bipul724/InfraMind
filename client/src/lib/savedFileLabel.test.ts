// savedFileLabel: the Saved Files button names say which repository a file came from, so two
// saved Dockerfiles get different names. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedFileLabel } from './savedFileLabel.ts';

test('with a repository URL: the name ends with owner/repo', () => {
  assert.equal(savedFileLabel('Download', 'Dockerfile', 'https://github.com/owner-a/repo-a'), 'Download Dockerfile from owner-a/repo-a');
  assert.equal(savedFileLabel('Delete', '.github/workflows/ci.yml', 'https://github.com/owner-b/repo-b/'), 'Delete .github/workflows/ci.yml from owner-b/repo-b');
});

test('two Dockerfiles from different repositories get different names', () => {
  assert.notEqual(
    savedFileLabel('Download', 'Dockerfile', 'https://github.com/owner-a/repo-a'),
    savedFileLabel('Download', 'Dockerfile', 'https://github.com/owner-b/repo-b')
  );
});

test('without a repository URL: the action and the name only', () => {
  assert.equal(savedFileLabel('Download', 'Dockerfile', null), 'Download Dockerfile');
  assert.equal(savedFileLabel('Delete', 'Dockerfile', undefined), 'Delete Dockerfile');
  assert.equal(savedFileLabel('Delete', 'Dockerfile'), 'Delete Dockerfile');
  assert.equal(savedFileLabel('Download', 'Dockerfile', ''), 'Download Dockerfile');
});

test('a URL the parser rejects: the action and the name only', () => {
  assert.equal(savedFileLabel('Download', 'Dockerfile', 'https://gitlab.com/a/b'), 'Download Dockerfile');
  assert.equal(savedFileLabel('Delete', 'Dockerfile', 'not a url'), 'Delete Dockerfile');
});

test('a URL ending in .git: owner/repo without .git', () => {
  assert.equal(savedFileLabel('Download', 'Dockerfile', 'https://github.com/octocat/Hello-World.git'), 'Download Dockerfile from octocat/Hello-World');
});
