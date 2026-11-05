// The one GitHub repository URL parser in the client. Its rules are exactly the
// server's parseGitHubRepoUrl (server/utils/repository.js), so a URL the form accepts is
// one /api/clone-repo accepts: https://github.com/{owner}/{repo}, with an optional
// ".git" and/or one trailing "/". githubUrl.test.ts checks both parsers side by side.
// No imports, so `node --test` can load this file directly.

export interface GitHubRepo {
  owner: string;
  repo: string;
}

// The server's OWNER_PATTERN and REPO_PATTERN
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
// Whitespace, "\", "%", "?", "#" and control characters are never part of an accepted URL
// (checked before parsing, so URL normalisation never decides)
// eslint-disable-next-line no-control-regex
const FORBIDDEN_URL_CHARS = /[\s\\%?#\u0000-\u001f\u007f]/;
// "." or ".." path segments, which new URL() would silently resolve
const DOT_SEGMENT = /\/\.{1,2}(?=\/|$)/;

const isValidOwner = (owner: string) => OWNER_PATTERN.test(owner);
const isValidRepo = (repo: string) => REPO_PATTERN.test(repo) && repo !== '.' && repo !== '..';

export function parseGitHubRepoUrl(input: unknown): GitHubRepo | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  if (FORBIDDEN_URL_CHARS.test(value) || DOT_SEGMENT.test(value)) return null;
  if (!/^https:\/\/github\.com\//i.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;

  let pathname = url.pathname;
  if (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const segments = pathname.split('/');
  if (segments.length !== 3 || segments[0] !== '') return null;

  const owner = segments[1];
  let repo = segments[2];
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);

  if (!isValidOwner(owner) || !isValidRepo(repo)) return null;
  return { owner, repo };
}

// The form the server stores and shows (buildDisplayUrl): no ".git", no trailing "/"
export const canonicalRepoUrl = ({ owner, repo }: GitHubRepo): string => `https://github.com/${owner}/${repo}`;

// "owner/repo" for a repository URL; the input itself when it does not parse
export const repoLabel = (url: string): string => {
  const parsed = parseGitHubRepoUrl(url);
  return parsed ? `${parsed.owner}/${parsed.repo}` : url;
};

// The one message for a URL the parser rejects, in every form that takes a URL
export const INVALID_REPO_URL_MESSAGE =
  'Enter a repository URL of the form https://github.com/owner/repository. Private repositories need Browse Repositories.';
