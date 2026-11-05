import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardLayout } from './DashboardLayout';
import { Toaster } from '@/components/ui/toaster';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/contexts/GitHubContext', () => ({ useGitHub: vi.fn() }));

const connectGitHub = vi.fn<() => Promise<void>>();
const disconnect = vi.fn<() => Promise<boolean>>();
const user = {
  id: 'user-a', name: 'Octo', email: 'octo@example.test', emailVerification: true,
  prefs: { loginProvider: 'email' }
};
const authState: ReturnType<typeof useAuth> = {
  user, loading: false, isAuthenticated: true,
  login: { withGoogle: vi.fn(), withGitHub: vi.fn(), withEmail: vi.fn() },
  register: vi.fn(), logout: vi.fn()
};
const githubState: ReturnType<typeof useGitHub> = {
  isConnected: false, isLoading: false, user: null,
  connectGitHub, disconnect, refresh: vi.fn()
};

function renderLayout() {
  return render(<MemoryRouter><DashboardLayout><p>Dashboard content</p></DashboardLayout><Toaster /></MemoryRouter>);
}

function connected() {
  vi.mocked(useGitHub).mockReturnValue({
    ...githubState, isConnected: true,
    user: { login: 'octo', name: 'Octo', avatarUrl: null }
  });
}

async function openDisconnect() {
  const events = userEvent.setup();
  await events.click(screen.getByRole('button', { name: 'Account menu' }));
  await events.click(await screen.findByRole('menuitem', { name: 'Disconnect GitHub' }));
  expect(disconnect).not.toHaveBeenCalled();
  return { events, dialog: await screen.findByRole('alertdialog', { name: 'Disconnect GitHub?' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(authState);
  vi.mocked(useGitHub).mockReturnValue(githubState);
  connectGitHub.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(true);
});

describe('DashboardLayout', () => {
  it('shows the loading placeholder without claiming a GitHub connection state', () => {
    vi.mocked(useGitHub).mockReturnValue({ ...githubState, isLoading: true });
    const view = renderLayout();
    const header = within(view.container.querySelector('header')!);

    expect(header.queryByRole('button', { name: 'Connect GitHub' })).toBeNull();
    expect(header.queryByRole('status')).toBeNull();
    expect(view.container.querySelector('header .animate-pulse[aria-hidden="true"]')).toBeTruthy();
    expect(header.queryByText(/connected|not connected/i)).toBeNull();
  });

  it('names the connected GitHub status accessibly', () => {
    connected();
    renderLayout();
    expect(screen.getByRole('status', { name: 'GitHub connected as @octo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull();
  });

  it('offers Connect GitHub when disconnected and starts it once', async () => {
    const events = userEvent.setup();
    renderLayout();

    await events.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    expect(connectGitHub).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['github', 'Signed in with GitHub'],
    ['google', 'Signed in with Google'],
    ['email', 'Signed in with email'],
    [undefined, 'Signed in with email']
  ])('shows the account sign-in line for provider %s', async (loginProvider, line) => {
    vi.mocked(useAuth).mockReturnValue({ ...authState, user: { ...user, prefs: { loginProvider } } });
    const events = userEvent.setup();
    renderLayout();

    await events.click(screen.getByRole('button', { name: 'Account menu' }));

    expect(await screen.findByText(line)).toBeTruthy();
  });

  it('opens the disconnect dialog and Cancel makes no disconnect request', async () => {
    connected();
    renderLayout();
    const { events, dialog } = await openDisconnect();
    expect(disconnect).not.toHaveBeenCalled();

    await events.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(disconnect).not.toHaveBeenCalled();
  });

  it.each([
    [true, 'GitHub disconnected'],
    [false, 'GitHub was not disconnected']
  ])('confirms disconnect once and shows the resolved %s outcome', async (result, title) => {
    connected();
    disconnect.mockResolvedValue(result);
    renderLayout();
    const { events, dialog } = await openDisconnect();
    expect(disconnect).not.toHaveBeenCalled();

    await events.click(within(dialog).getByRole('button', { name: 'Disconnect GitHub' }));

    await screen.findByText(title);
    expect(disconnect).toHaveBeenCalledTimes(1);
    if (result) {
      expect(screen.getByText('Connect GitHub again to list or clone your private repositories.')).toBeTruthy();
    } else {
      expect(screen.getByText('Please try again.')).toBeTruthy();
    }
  });
});
