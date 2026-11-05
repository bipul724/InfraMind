import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentProgress } from '@/components/AgentProgress';
import { clearResultCache } from './resultCache';

vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'result-cache-user' } }),
}));

const SESSION_ID = '23456789-1234-4234-8234-123456789abc';
const CONTENT = 'FROM node:22\n# joined pending result\n';

beforeEach(() => {
  clearResultCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearResultCache();
});

describe('resultCache through AgentProgress', () => {
  it('joins one pending files request across StrictMode effects and a completed-view remount', async () => {
    let releaseRequest: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { releaseRequest = resolve; });
    const requests = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.pathname).toBe(`/api/files/${SESSION_ID}`);
      expect(init?.method ?? 'GET').toBe('GET');
      await pending;
      return Response.json({ files: { dockerfile: CONTENT } });
    });
    vi.stubGlobal('fetch', requests);

    const completedView = (
      <StrictMode>
        <AgentProgress
          sessionId={SESSION_ID}
          repoUrl="https://github.com/octo/result-cache"
          currentStep="Analysis complete!"
          progress={100}
          status="completed"
          generatedFiles={['dockerfile']}
        />
      </StrictMode>
    );

    try {
      const first = render(completedView);
      await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
      expect(screen.queryByLabelText('Dockerfile contents')).toBeNull();
      first.unmount();
      render(completedView);
      await act(async () => { await Promise.resolve(); });
      expect(requests).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText('Dockerfile contents')).toBeNull();
    } finally {
      await act(async () => { releaseRequest?.(); });
    }

    expect((await screen.findByLabelText('Dockerfile contents')).textContent).toBe(CONTENT);
    expect(requests).toHaveBeenCalledTimes(1);
  });
});
