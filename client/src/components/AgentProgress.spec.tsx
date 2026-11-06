import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProgress } from './AgentProgress';
import { Toaster } from './ui/toaster';
import { clearResultCache } from '@/lib/resultCache';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'progress-user' } }),
}));

const content = {
  dockerfile: 'FROM node:22\n',
  githubActions: 'name: CI\n',
  envExample: 'PORT=3000\n',
};
const rows = [
  { name: 'Dockerfile', type: 'dockerfile', content: content.dockerfile },
  { name: '.github/workflows/ci.yml', type: 'github-actions', content: content.githubActions },
  { name: '.env.example', type: 'env', content: content.envExample },
].map((file, index) => ({
  ...file, id: `saved-${index}`, user_id: 'progress-user',
  repo_url: 'https://github.com/octo/save-result', created_at: '2026-11-06T00:00:00.000Z',
}));

describe('AgentProgress saves', () => {
  const requests = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearResultCache();
    requests.mockReset();
    requests.mockResolvedValue(Response.json(rows));
    vi.stubGlobal('fetch', requests);
  });

  afterEach(() => {
    clearResultCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderResult() {
    render(<>
      <AgentProgress
        sessionId="34567890-1234-4234-8234-123456789abc"
        repoUrl="https://github.com/octo/save-result"
        currentStep="Analysis complete!"
        progress={100}
        status="completed"
        generatedFiles={Object.keys(content)}
        loadedResult={{ files: content }}
      />
      <Toaster />
    </>);
  }

  function expectDeduplicatingRequest() {
    expect(requests).toHaveBeenCalledTimes(1);
    const call = requests.mock.calls[0];
    if (!call) throw new Error('No save request was sent');
    const [input, init] = call;
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    expect(url.pathname).toBe('/rest/v1/saved_files');
    expect(url.searchParams.get('on_conflict')).toBe('user_id,name,repo_url,content_sha256');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Prefer')).toContain('resolution=ignore-duplicates');
    expect(JSON.parse(String(init?.body))).toEqual(rows.map(({ name, type, content: text, user_id, repo_url }) => ({ name, type, content: text, user_id, repo_url })));
  }

  it('keeps the existing Saved state and toast when every file is new', async () => {
    renderResult();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Account' }));
    expect(await screen.findByText('3 files saved to your account. They are listed under Saved Files.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
    expectDeduplicatingRequest();
  });

  it('reports the inserted and existing counts when some files were already saved', async () => {
    requests.mockResolvedValue(Response.json(rows.slice(0, 1)));
    renderResult();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Account' }));
    expect(await screen.findByText('Saved 1 files; 2 were already in your account')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
    expectDeduplicatingRequest();
  });

  it('marks the result Saved when every file was already in the account', async () => {
    requests.mockResolvedValue(Response.json([]));
    renderResult();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Account' }));
    expect(await screen.findByText('These files are already in your account')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
    expectDeduplicatingRequest();
  });

  it.each([
    ['saved_files limit reached (500 per user)', 'Your saved files are full (500). Delete some in Saved Files to save more'],
    ['new row violates check constraint "saved_files_content_size_check"', 'This file is too large to save'],
  ])('shows a safe message for %s without exposing database details', async (message, publicMessage) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    requests.mockResolvedValue(Response.json({ code: '23514', message: `${message}; RAW DATABASE DETAILS`, details: 'secret row details' }, { status: 400 }));
    renderResult();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Account' }));
    expect(await screen.findByText(publicMessage)).toBeTruthy();
    expect(screen.queryByText(/RAW DATABASE DETAILS|secret row details/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save to Account' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
  });
});
