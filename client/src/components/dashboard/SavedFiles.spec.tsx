import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedFiles } from './SavedFiles';
import * as download from '@/lib/download';
import { Toaster } from '@/components/ui/toaster';

const auth = vi.hoisted(() => ({ userId: 'saved-files-user' }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: auth.userId } }),
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

function requestUrl(input: string | URL | Request): URL {
  return new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
}

function pagedRows() {
  return Array.from({ length: 56 }, (_, index) => ({
    ...rows[0],
    id: `paged-${index}`,
    repo_url: `https://github.com/owner/repo-${index}`,
    content: `FROM node:22\n# paged ${index}\n`,
  }));
}

function deferredResponse() {
  let settle: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => { settle = resolve; });
  return {
    promise,
    resolve(response: Response) {
      if (!settle) throw new Error('The response fixture was not initialized');
      settle(response);
    },
  };
}

describe('SavedFiles', () => {
  const requests = vi.fn<typeof fetch>();

  beforeEach(() => {
    auth.userId = 'saved-files-user';
    requests.mockReset();
    requests.mockImplementation(async (input) => {
      const path = requestUrl(input).pathname;
      if (path !== '/rest/v1/saved_files') throw new Error(`Unexpected saved-files request: ${path}`);
      return Response.json(rows);
    });
    vi.stubGlobal('fetch', requests);
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

  it('appends the next page without repeating an overlapping file id', async () => {
    const available = pagedRows();
    requests.mockImplementation(async (input) => {
      const url = requestUrl(input);
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      return Response.json(offset === 0 ? available.slice(0, limit) : available.slice(offset - 1, offset + limit - 1));
    });
    render(<SavedFiles />);
    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    expect(screen.getAllByRole('button', { name: /^Download Dockerfile from/ })).toHaveLength(50);

    fireEvent.click(loadMore);

    expect(await screen.findByRole('button', { name: 'Download Dockerfile from owner/repo-55' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Download Dockerfile from/ })).toHaveLength(56);
    expect(screen.getAllByRole('button', { name: 'Download Dockerfile from owner/repo-49' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(requests.mock.calls.map(([input]) => requestUrl(input).searchParams.get('offset'))).toEqual(['0', '50']);
    expect(requests.mock.calls.map(([input]) => requestUrl(input).searchParams.get('limit'))).toEqual(['51', '51']);
  });

  it('uses the remaining displayed row count after a delete so Load more skips nothing', async () => {
    const available = pagedRows();
    const deletion = deferredResponse();
    const nextPage = deferredResponse();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    requests.mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (init?.method === 'DELETE') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const index = available.findIndex(file => file.id === id);
        if (index >= 0) available.splice(index, 1);
        return deletion.promise;
      }
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      return offset === 0 ? Response.json(available.slice(offset, offset + limit)) : nextPage.promise;
    });
    render(<SavedFiles />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dockerfile from owner/repo-0' }));
    expect(screen.getAllByRole('button', { name: /^Delete Dockerfile from/ }).every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Load more' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    await act(async () => { deletion.resolve(Response.json([{ id: 'paged-0' }])); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download Dockerfile from owner/repo-0' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(screen.getAllByRole('button', { name: /^Delete Dockerfile from/ }).every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Load more' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(3));
    await act(async () => { nextPage.resolve(Response.json(available.slice(49, 100))); });

    expect(await screen.findByRole('button', { name: 'Download Dockerfile from owner/repo-50' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download Dockerfile from owner/repo-55' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Download Dockerfile from/ })).toHaveLength(55);
    const gets = requests.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET');
    expect(gets.map(([input]) => requestUrl(input).searchParams.get('offset'))).toEqual(['0', '49']);
  });

  it('Refresh replaces appended pages with the current first page', async () => {
    const available = pagedRows();
    requests.mockImplementation(async (input) => {
      const url = requestUrl(input);
      const offset = Number(url.searchParams.get('offset'));
      return Response.json(available.slice(offset, offset + Number(url.searchParams.get('limit'))));
    });
    render(<SavedFiles />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Download Dockerfile from owner/repo-55' });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download Dockerfile from owner/repo-55' })).toBeNull());
    expect(screen.getAllByRole('button', { name: /^Download Dockerfile from/ })).toHaveLength(50);
    expect(requestUrl(requests.mock.calls[2]![0]).searchParams.get('offset')).toBe('0');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('ignores an older StrictMode request error and keeps loading until the current request settles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = deferredResponse();
    const current = deferredResponse();
    requests.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => current.promise);
    render(<StrictMode><SavedFiles /></StrictMode>);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));

    await act(async () => { first.resolve(Response.json({ message: 'stale fixture failure' }, { status: 500 })); });

    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Failed to fetch your saved files')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull();
    await act(async () => { current.resolve(Response.json(pagedRows().slice(0, 51))); });
    expect(await screen.findByRole('button', { name: 'Load more' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps appended pages and a deletion when an old StrictMode first page arrives last', async () => {
    const available = pagedRows();
    const stalePage = available.slice(0, 51);
    const stale = deferredResponse();
    const current = deferredResponse();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    requests.mockImplementation(async (input, init) => {
      const url = requestUrl(input);
      if (init?.method === 'DELETE') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        const index = available.findIndex(file => file.id === id);
        return Response.json(index < 0 ? [] : available.splice(index, 1).map(file => ({ id: file.id })));
      }
      const offset = Number(url.searchParams.get('offset'));
      return Response.json(available.slice(offset, offset + Number(url.searchParams.get('limit'))));
    });
    requests.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => current.promise);
    render(<StrictMode><SavedFiles /></StrictMode>);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    await act(async () => { current.resolve(Response.json(stalePage)); });
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Download Dockerfile from owner/repo-55' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dockerfile from owner/repo-0' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Download Dockerfile from owner/repo-0' })).toBeNull());

    await act(async () => { stale.resolve(Response.json(stalePage)); });

    expect(screen.getByRole('button', { name: 'Download Dockerfile from owner/repo-55' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download Dockerfile from owner/repo-0' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Download Dockerfile from/ })).toHaveLength(55);
  });

  it('invalidates the previous user request when the signed-in user changes', async () => {
    const oldUser = deferredResponse();
    requests.mockImplementationOnce(() => oldUser.promise).mockResolvedValue(Response.json([rows[1]]));
    const view = render(<SavedFiles />);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));

    auth.userId = 'next-saved-files-user';
    view.rerender(<SavedFiles />);
    await screen.findByRole('button', { name: 'Download Dockerfile from owner-b/repo-b' });
    await act(async () => { oldUser.resolve(Response.json([rows[0]])); });

    expect(screen.queryByRole('button', { name: 'Download Dockerfile from owner-a/repo-a' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download Dockerfile from owner-b/repo-b' })).toBeTruthy();
  });

  it('does not show a late fetch-failure toast after the view unmounts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pending = deferredResponse();
    requests.mockImplementation(() => pending.promise);
    const view = render(<SavedFiles />);
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    view.unmount();
    render(<Toaster />);

    await act(async () => { pending.resolve(Response.json({ message: 'late fixture failure' }, { status: 500 })); });

    expect(screen.queryByText('Failed to fetch your saved files')).toBeNull();
  });
});
