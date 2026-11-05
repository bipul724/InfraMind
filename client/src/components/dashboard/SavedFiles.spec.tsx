import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedFiles } from './SavedFiles';
import * as download from '@/lib/download';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'saved-files-user' } }),
}));

const rows = ['a', 'b'].map((owner) => ({
  id: `file-${owner}`,
  user_id: 'saved-files-user',
  name: 'Dockerfile',
  type: 'dockerfile',
  repo_url: `https://github.com/owner-${owner}/repo-${owner}`,
  content: `FROM node:22\n# repository ${owner}\n`,
  created_at: '2026-10-20T00:00:00.000Z',
}));

describe('SavedFiles', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
      if (path !== '/rest/v1/saved_files') throw new Error(`Unexpected saved-files request: ${path}`);
      return Response.json(rows);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('distinguishes Dockerfile download buttons by repository', async () => {
    render(<SavedFiles />);
    expect(await screen.findByRole('button', { name: 'Download Dockerfile from owner-a/repo-a' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Dockerfile from owner-b/repo-b' })).toBeTruthy();
  });

  it('downloads the selected repository content with the Dockerfile name', async () => {
    const downloadTextFile = vi.spyOn(download, 'downloadTextFile').mockImplementation(() => undefined);
    render(<SavedFiles />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download Dockerfile from owner-b/repo-b' }));
    expect(downloadTextFile).toHaveBeenCalledExactlyOnceWith('Dockerfile', rows[1]?.content);
  });
});
