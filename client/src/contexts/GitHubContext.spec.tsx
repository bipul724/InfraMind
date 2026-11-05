import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubProvider, useGitHub } from './GitHubContext';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'context-user' }, loading: false }),
}));

function ContextActions() {
  const { connectGitHub, disconnect, isLoading } = useGitHub();
  const { toasts } = useToast();
  const [outcome, setOutcome] = useState('not attempted');
  return (
    <>
      <button disabled={isLoading} onClick={() => { void connectGitHub(); }}>Connect fixture</button>
      <button disabled={isLoading} onClick={() => { void disconnect().then((result) => setOutcome(String(result))); }}>Disconnect fixture</button>
      <output aria-label="Disconnect outcome">{outcome}</output>
      <output aria-label="Toast ids">{toasts.map((item) => item.id).join(',')}</output>
      <Toaster />
    </>
  );
}

describe('GitHubContext failures', () => {
  const requests = vi.fn<typeof fetch>();

  beforeEach(() => {
    requests.mockReset();
    requests.mockImplementation(async (input) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
      if (path === '/api/github/status') return Response.json({ connected: false });
      if (path === '/api/github/connect' || path === '/api/github/connection') return Response.json({ error: 'fixture failure' }, { status: 500 });
      throw new Error(`Unexpected context request: ${path}`);
    });
    vi.stubGlobal('fetch', requests);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function requestFor(path: string) {
    return requests.mock.calls.filter(([input]) => new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname === path);
  }

  it('shows the connect-failure toast after a 500 without navigating', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalUrl = window.location.href;
    render(<GitHubProvider><ContextActions /></GitHubProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect fixture' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Connect fixture' }));
    expect(await screen.findByText('GitHub could not be connected')).toBeTruthy();
    expect(requestFor('/api/github/connect')).toHaveLength(1);
    expect(requestFor('/api/github/connect')[0]?.[1]?.method).toBe('POST');
    expect(window.location.href).toBe(originalUrl);
    expect(errors).toHaveBeenCalledExactlyOnceWith('GitHub connection could not be started');
  });

  it('resolves false after a disconnect 500 and emits no context toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<GitHubProvider><ContextActions /></GitHubProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect fixture' }).hasAttribute('disabled')).toBe(false));
    const originalToastIds = screen.getByLabelText('Toast ids').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect fixture' }));
    await waitFor(() => expect(screen.getByLabelText('Disconnect outcome').textContent).toBe('false'));
    expect(requestFor('/api/github/connection')).toHaveLength(1);
    expect(requestFor('/api/github/connection')[0]?.[1]?.method).toBe('DELETE');
    expect(requestFor('/api/github/status')).toHaveLength(2);
    expect(screen.getByLabelText('Toast ids').textContent).toBe(originalToastIds);
  });
});
