import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModernDashboard } from './ModernDashboard';
import { clearResultCache } from '@/lib/resultCache';

const socket = vi.hoisted(() => ({ listeners: new Map<string, (payload: unknown) => void>() }));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, listener: (payload: unknown) => void) => socket.listeners.set(event, listener),
    emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'dashboard-user', name: 'Dashboard Tester' } }),
}));

vi.mock('@/contexts/GitHubContext', () => ({
  useGitHub: () => ({ isConnected: false, isLoading: false, connectGitHub: vi.fn() }),
}));

const SESSION_ID = '45678901-1234-4234-8234-123456789abc';
const EMPTY_MESSAGE = 'No files could be generated. Please try again.';

describe('ModernDashboard empty-run failures', () => {
  const requests = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearResultCache();
    socket.listeners.clear();
    requests.mockReset();
    requests.mockImplementation(async (input) => {
      const path = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
      if (path === '/api/clone-repo') return Response.json({ sessionId: SESSION_ID });
      if (path === '/api/analyze') return Response.json({ status: 'analyzing', sessionId: SESSION_ID }, { status: 202 });
      if (path === `/api/status/${SESSION_ID}`) return Response.json({ status: 'failed', sessionId: SESSION_ID, error: EMPTY_MESSAGE });
      throw new Error(`Unexpected dashboard request: ${path}`);
    });
    vi.stubGlobal('fetch', requests);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearResultCache();
  });

  function renderDashboard(route = '/dashboard') {
    render(<MemoryRouter initialEntries={[route]}><ModernDashboard /></MemoryRouter>);
  }

  it('shows a live empty-run failure and adds no Projects row', async () => {
    const events = userEvent.setup();
    renderDashboard();
    await events.click(screen.getByRole('button', { name: 'Use Manual URL' }));
    await events.type(screen.getByLabelText('GitHub Repository URL'), 'https://github.com/octo/empty-run');
    await events.click(screen.getByRole('button', { name: 'Start AI Analysis' }));
    await screen.findByText('Starting AI agent analysis...');

    const progress = socket.listeners.get('progress');
    expect(progress).toBeDefined();
    await act(async () => {
      progress?.({
        sessionId: SESSION_ID, status: 'failed', progress: 0, step: 'Analysis failed',
        error: EMPTY_MESSAGE, errors: ['Generator Agent Error: every file failed'],
      });
    });
    expect(screen.getByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.getByText('Generator Agent Error: every file failed')).toBeTruthy();

    await events.click(screen.getByRole('tab', { name: 'Projects' }));

    expect(await screen.findByRole('heading', { name: 'No Results Yet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^View the result for/ })).toBeNull();
  });

  it('shows the stored empty-run message when a failed session is opened again', async () => {
    renderDashboard(`/dashboard?session=${SESSION_ID}`);

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.getByText('This analysis failed')).toBeTruthy();
    expect(requests).toHaveBeenCalledTimes(1);
    const call = requests.mock.calls[0];
    if (!call) throw new Error('The failed session was not loaded');
    const input = call[0];
    expect(new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname).toBe(`/api/status/${SESSION_ID}`);
    expect(screen.queryByLabelText('Dockerfile contents')).toBeNull();
  });
});
