import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedFilesAPI, type SaveFileRequest } from './api';

const file: SaveFileRequest = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Dockerfile', type: 'dockerfile', content: 'FROM node:22\n',
  repoUrl: 'https://github.com/octo/repo',
};
const row = (id: string) => ({
  id, user_id: file.userId, name: file.name, type: file.type,
  repo_url: file.repoUrl, content: file.content, created_at: '2026-11-06T00:00:00Z',
});
const requests = vi.fn<typeof fetch>();

beforeEach(() => {
  requests.mockReset();
  vi.stubGlobal('fetch', requests);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('SavedFilesAPI saves', () => {
  it.each([3, 1, 0])('returns %i inserted rows and counts the ignored copies', async (inserted) => {
    requests.mockResolvedValue(Response.json(Array.from({ length: inserted }, (_, index) => row(String(index)))));
    const result = await SavedFilesAPI.saveFiles([file, { ...file, name: 'ci.yml' }, { ...file, name: '.env.example' }]);
    expect(result.saved).toHaveLength(inserted);
    expect(result.alreadySaved).toBe(3 - inserted);
    expect(requests).toHaveBeenCalledTimes(1);
    const [input, init] = requests.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.searchParams.get('on_conflict')).toBe('user_id,name,repo_url,content_sha256');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Prefer')).toContain('resolution=ignore-duplicates');
    expect(JSON.parse(String(init?.body))[0]).toEqual({
      user_id: file.userId, name: file.name, type: file.type, content: file.content, repo_url: file.repoUrl,
    });
  });

  it.each([
    ['saved_files limit reached (500 per user)', 'Your saved files are full (500). Delete some in Saved Files to save more'],
    ['new row violates check constraint "saved_files_content_size_check"', 'This file is too large to save'],
    ['private database details that must stay hidden', 'These files could not be saved. Please try again.'],
  ])('normalizes a check failure: %s', async (message, expected) => {
    requests.mockResolvedValue(Response.json({ code: '23514', message, details: 'RAW_DATABASE_ROW' }, { status: 400 }));
    await expect(SavedFilesAPI.saveFiles([file])).rejects.toThrow(expected);
  });
});

describe('SavedFilesAPI pages', () => {
  it('requests an inclusive look-ahead range and stable ordering', async () => {
    requests.mockResolvedValue(Response.json([row('a'), row('b'), row('c')]));
    const result = await SavedFilesAPI.getSavedFiles({ offset: 3, limit: 2 });
    expect(result.files.map(item => item.id)).toEqual(['a', 'b']);
    expect(result.hasMore).toBe(true);
    const url = new URL(String(requests.mock.calls[0]![0]));
    expect(url.searchParams.get('offset')).toBe('3');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('order')).toBe('created_at.desc,id.desc');
  });

  it('defaults to 50 visible files and discovers file 51', async () => {
    requests.mockResolvedValue(Response.json(Array.from({ length: 51 }, (_, index) => row(String(index)))));
    const result = await SavedFilesAPI.getSavedFiles();
    expect(result.files).toHaveLength(50);
    expect(result.hasMore).toBe(true);
    const url = new URL(String(requests.mock.calls[0]![0]));
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('51');
  });

  it('marks the last page when no extra row was returned', async () => {
    requests.mockResolvedValue(Response.json([row('last')]));
    expect(await SavedFilesAPI.getSavedFiles({ offset: 50 })).toEqual({
      files: [{ id: 'last', userId: file.userId, name: file.name, type: file.type, repoUrl: file.repoUrl, content: file.content, createdAt: '2026-11-06T00:00:00Z' }],
      hasMore: false,
    });
  });
});
