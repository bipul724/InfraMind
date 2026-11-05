import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthSuccess from './AuthSuccess';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { apiFetch } from '@/lib/apiClient';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/GitHubContext', () => ({ useGitHub: vi.fn() }));
vi.mock('@/lib/apiClient', () => ({ apiFetch: vi.fn(), getApiErrorCode: vi.fn() }));

const completion = 'a'.repeat(64);
const user = { id: 'user-a', name: 'Octo', email: 'octo@example.test', emailVerification: true, prefs: {} };
const refresh = vi.fn<() => Promise<void>>();
const authState: ReturnType<typeof useAuth> = {
  user, loading: false, isAuthenticated: true,
  login: { withGoogle: vi.fn(), withGitHub: vi.fn(), withEmail: vi.fn() },
  register: vi.fn(), logout: vi.fn()
};

function Location() {
  const location = useLocation();
  return <output aria-label="Current URL">{location.pathname}{location.search}</output>;
}

function renderSuccess(query: string) {
  return render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/auth/success?${query}`]}>
        <AuthSuccess />
        <Location />
      </MemoryRouter>
    </React.StrictMode>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(authState);
  vi.mocked(useGitHub).mockReturnValue({
    isConnected: false, isLoading: false, user: null,
    connectGitHub: vi.fn(), disconnect: vi.fn(), refresh
  });
  refresh.mockResolvedValue(undefined);
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthSuccess', () => {
  it('claims a completion exactly once in StrictMode and removes it from the URL', async () => {
    renderSuccess(`complete=${completion}`);

    await screen.findByText(/Your GitHub account has been connected/);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith('/api/github/connect/complete', {
      method: 'POST', body: JSON.stringify({ completion })
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current URL').textContent).toBe('/auth/success');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards a completion exactly once when signed out without claiming it', async () => {
    vi.mocked(useAuth).mockReturnValue({ ...authState, user: null, isAuthenticated: false });
    renderSuccess(`complete=${completion}`);

    await screen.findByText(/Sign in, then connect GitHub again/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/github\/discard$/), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completion })
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Current URL').textContent).toBe('/auth/success');
  });

  it('shows the error parameter without making a claim or discard request', async () => {
    renderSuccess('error=access_denied');

    await waitFor(() => expect(screen.getByText('GitHub access was not granted.')).toBeTruthy());
    expect(apiFetch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
