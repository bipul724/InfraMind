import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentGenerationForm } from './AgentGenerationForm';
import { POLL_INTERVAL_MS } from '@/hooks/use-session-poller';
import { clearResultCache } from '@/lib/resultCache';
import type { ProgressPayload, SessionFilesResponse } from '@/lib/session';

const socket = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  disconnect: vi.fn(),
  connect: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: (event: string, listener: (payload: unknown) => void) => socket.listeners.set(event, listener),
    disconnect: socket.disconnect,
    connect: socket.connect,
    emit: socket.emit,
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'component-user' } }),
}));

const SESSION_ID = '12345678-1234-4234-8234-123456789abc';
const REPO_URL = 'https://github.com/octo/public-repo';
const messages = ['analyzer', 'generator', 'verifier'].map((agent) => ({
  agent, message: `${agent} finished`, timestamp: '2026-10-20T00:00:00.000Z',
}));
const files: SessionFilesResponse = {
  files: { dockerfile: 'FROM node:22\n# component fixture\n' },
  techStack: { primary: 'node' },
  messages,
  errors: [],
};

function requestPath(input: string | URL | Request): string {
  return new URL(typeof input === 'string' || input instanceof URL ? input : input.url).pathname;
}

function progress(payload: Omit<ProgressPayload, 'sessionId'>): void {
  const listener = socket.listeners.get('progress');
  expect(listener).toBeDefined();
  listener?.({ sessionId: SESSION_ID, ...payload });
}

describe('AgentGenerationForm with AgentProgress', () => {
  const requests = vi.fn<typeof fetch>();
  let polledStatus: 'analyzing' | 'completed' | 'failed';

  beforeEach(() => {
    vi.useFakeTimers();
    clearResultCache();
    socket.listeners.clear();
    requests.mockReset();
    polledStatus = 'analyzing';
    requests.mockImplementation(async (input) => {
      const path = requestPath(input);
      if (path === '/api/clone-repo') return Response.json({ sessionId: SESSION_ID });
      if (path === '/api/analyze') return Response.json({ sessionId: SESSION_ID, status: 'analyzing' }, { status: 202 });
      if (path === `/api/status/${SESSION_ID}`) return Response.json({ sessionId: SESSION_ID, status: polledStatus, error: 'Generator fixture failed' });
      if (path === `/api/files/${SESSION_ID}`) return Response.json(files);
      throw new Error(`Unexpected component request: ${path}`);
    });
    vi.stubGlobal('fetch', requests);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearResultCache();
  });

  async function start(onComplete = vi.fn()) {
    render(<AgentGenerationForm onComplete={onComplete} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('GitHub Repository URL'), { target: { value: REPO_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Analysis' }));
    });
    expect(screen.getByText('Starting AI agent analysis...')).toBeTruthy();
    return onComplete;
  }

  it('submits the manual public URL to clone before starting analysis', async () => {
    await start();
    const calls = requests.mock.calls;
    expect(calls.map(([input]) => requestPath(input))).toEqual(['/api/clone-repo', '/api/analyze']);
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ repoUrl: REPO_URL });
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({ sessionId: SESSION_ID });
  });

  it('reports completion once when the poller completes before a late socket completion', async () => {
    const onComplete = await start();
    await act(async () => {
      progress({ status: 'analyzing', progress: 60, step: 'Generator running', messages: messages.slice(0, 1) });
    });
    expect(screen.getByText('Generator running')).toBeTruthy();
    polledStatus = 'completed';
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID }));
    await act(async () => {
      progress({ status: 'completed', progress: 100, step: 'Socket completed', messages, techStack: { primary: 'node' }, generatedFiles: ['dockerfile'] });
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Done')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Dockerfile' })).toBeTruthy();
    expect(requests.mock.calls.filter(([input]) => requestPath(input) === `/api/files/${SESSION_ID}`)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('loads files once when a socket completion wins an in-flight completed status response', async () => {
    const onComplete = await start();
    let resolveStatus: ((response: Response) => void) | undefined;
    const ordinaryRequest = requests.getMockImplementation();
    requests.mockImplementation((input, init) => {
      if (requestPath(input) === `/api/status/${SESSION_ID}`) {
        return new Promise<Response>((resolve) => { resolveStatus = resolve; });
      }
      if (!ordinaryRequest) throw new Error('Missing request fixture');
      return ordinaryRequest(input, init);
    });
    await act(async () => {
      progress({ status: 'analyzing', progress: 90, messages: messages.slice(0, 2) });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(resolveStatus).toBeDefined();
    await act(async () => {
      progress({ status: 'completed', progress: 100, messages, techStack: { primary: 'node' }, generatedFiles: ['dockerfile'] });
    });
    await act(async () => { resolveStatus?.(Response.json({ status: 'completed', sessionId: SESSION_ID })); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID }));
    expect(requests.mock.calls.filter(([input]) => requestPath(input) === `/api/files/${SESSION_ID}`)).toHaveLength(1);
  });

  it('shows a failed run without reporting completion', async () => {
    const onComplete = await start();
    polledStatus = 'failed';
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS); });
    expect(screen.getByText('Generator fixture failed')).toBeTruthy();
    expect(screen.getByText('Analysis failed')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(requests.mock.calls.filter(([input]) => requestPath(input) === `/api/files/${SESSION_ID}`)).toHaveLength(0);
  });
});
