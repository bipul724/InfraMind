import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { LogOut, Terminal, Github, LayoutDashboard, GitBranch, Unplug } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGitHub } from '@/contexts/GitHubContext';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, Link } from 'react-router-dom';

interface DashboardLayoutProps {
  children: React.ReactNode;
  // Shown as a badge in the header, and as a heading with `subtitle`, only when passed
  title?: string;
  subtitle?: string;
}

// How the user signed in to InfraMind (Supabase), for the account menu only. This is not
// the repository connection, which is the GitHub status below.
const SIGN_IN_LINES: Readonly<Record<string, string>> = {
  github: 'Signed in with GitHub',
  google: 'Signed in with Google',
  email: 'Signed in with email'
};

// The signed-in pages' one header. Its GitHub status is the repository connection
// (GitHubContext: GET /api/github/status), never the sign-in provider.
export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, title, subtitle }) => {
  const { user, logout } = useAuth();
  const { isConnected, isLoading, user: githubUser, connectGitHub, disconnect } = useGitHub();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/auth');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleDisconnect = async () => {
    const disconnected = await disconnect();
    toast(disconnected
      ? { title: 'GitHub disconnected', description: 'Connect GitHub again to list or clone your private repositories.' }
      : { title: 'GitHub was not disconnected', description: 'Please try again.', variant: 'destructive' });
  };

  // Avatar from the Google/GitHub sign-in profile; empty for email sign-ups
  const avatarUrl = user?.prefs?.avatarUrl || undefined;
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';
  const signInLine = SIGN_IN_LINES[user?.prefs?.loginProvider as string] ?? SIGN_IN_LINES.email;
  const githubLogin = isConnected && githubUser?.login ? githubUser.login : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/dashboard"
                className="flex items-center gap-2.5 rounded-md text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
                  <Terminal className="h-4 w-4" aria-hidden="true" />
                </div>
                <h1 className="text-base font-semibold tracking-tight">InfraMind</h1>
              </Link>
              {title && (
                <>
                  <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
                  <Badge variant="secondary" className="hidden sm:inline-flex">{title}</Badge>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
                <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  <span>Dashboard</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/select-repo')}>
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  <span>Repositories</span>
                </Button>
              </nav>

              {/* The repository connection. Below sm it is shown in the account menu instead. */}
              <div className="hidden sm:flex">
                {isLoading ? (
                  <span className="h-7 w-24 animate-pulse rounded-full bg-muted" aria-hidden="true" />
                ) : githubLogin ? (
                  <span
                    data-github-status="connected"
                    role="status"
                    aria-label={`GitHub connected as @${githubLogin}`}
                    className="flex items-center gap-1.5 rounded-full border border-status-success/30 bg-status-success/[0.06] px-2.5 py-1 font-mono text-xs text-status-success"
                  >
                    <Github className="h-3.5 w-3.5" aria-hidden="true" />
                    @{githubLogin}
                  </span>
                ) : (
                  <Button data-github-status="not-connected" variant="outline" size="sm" onClick={() => void connectGitHub()}>
                    <Github className="h-4 w-4" aria-hidden="true" />
                    Connect GitHub
                  </Button>
                )}
              </div>

              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0" aria-label="Account menu">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={avatarUrl} alt="" />
                      <AvatarFallback aria-hidden="true">{userName[0]?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="end">
                  <div className="space-y-1 px-2.5 py-2">
                    <p className="truncate text-sm font-medium">{userName}</p>
                    <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                    <p className="text-xs text-muted-foreground">{signInLine}</p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Signing in does not give InfraMind access to your repositories; that is the GitHub connection below.
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">GitHub (repository access)</DropdownMenuLabel>
                  {githubLogin ? (
                    <>
                      <p className="flex items-center gap-1.5 px-2.5 pb-1 font-mono text-xs text-status-success">
                        <Github className="h-3.5 w-3.5" aria-hidden="true" />
                        @{githubLogin}
                      </p>
                      <DropdownMenuItem onSelect={() => setConfirmDisconnect(true)}>
                        <Unplug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        Disconnect GitHub
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onSelect={() => void connectGitHub()} disabled={isLoading}>
                      <Github className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      Connect GitHub
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => navigate('/dashboard')}>
                    <LayoutDashboard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('/select-repo')}>
                    <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Repositories
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleLogout()}>
                    <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Disconnect: the server asks GitHub to revoke the token (best effort) and deletes it */}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              InfraMind will no longer list or clone your private repositories. It asks GitHub to revoke its
              access token and deletes the token from its server. You stay signed in, and public repositories
              still work by URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDisconnect()}>Disconnect GitHub</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="container mx-auto px-4 py-8 sm:px-6 lg:py-10">
        <div className="mx-auto max-w-5xl space-y-10">
          <div>
            {subtitle && title && (
              <div className="mb-8">
                <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-2 text-muted-foreground">{subtitle}</p>
              </div>
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};
