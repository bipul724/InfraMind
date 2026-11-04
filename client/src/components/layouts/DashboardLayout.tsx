import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { 
  LogOut, 
  User, 
  Terminal,
  Bell,
  HelpCircle,
  Github,
  LayoutDashboard,
  GitBranch
} from 'lucide-react';
import { GitHubConnect } from '@/components/GitHubConnect';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, Link } from 'react-router-dom';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ 
  children, 
  title = "Dashboard",
  subtitle 
}) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/auth');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Get user avatar - filled from Google/GitHub profiles, empty for email sign-ups
  const avatarUrl = user?.prefs?.avatarUrl || undefined;
  const userName = user?.name || 'User';
  const userEmail = user?.email || '';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="container mx-auto px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo and Title */}
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/dashboard"
                className="flex items-center gap-2.5 rounded-md text-foreground transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
                  <Terminal className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold tracking-tight">InfraMind</h1>
              </Link>
              <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {title}
              </Badge>
            </div>
            
            {/* Navigation and User Menu */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Main Navigation */}
              <nav className="hidden items-center gap-1 md:flex">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/dashboard')}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Dashboard</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/select-repo')}
                >
                  <GitBranch className="h-4 w-4" />
                  <span>Repositories</span>
                </Button>
              </nav>

              {/* GitHub Username Display */}
              {user?.prefs?.githubUsername && (
                <div className="hidden items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground sm:flex">
                  <Github className="h-3.5 w-3.5" />
                  {user.prefs.githubUsername}
                </div>
              )}
              
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={avatarUrl} alt={userName} />
                      <AvatarFallback>
                        {userName[0]?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-60" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 px-2.5 py-2">
                    <div className="flex min-w-0 flex-col space-y-1 leading-none">
                      <p className="truncate text-sm font-medium">{userName}</p>
                      <p className="w-[200px] truncate text-xs text-muted-foreground">
                        {userEmail}
                      </p>
                    </div>
                  </div>
                  <Separator className="my-1" />
                  <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                    <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/select-repo')}>
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    Repositories
                  </DropdownMenuItem>
                  <Separator className="my-1" />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="h-4 w-4 text-muted-foreground" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 sm:px-6 lg:py-10">
        <div className="mx-auto max-w-5xl space-y-10">
          <div>
            {subtitle && (
              <div className="mb-8">
                <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-2 text-muted-foreground">{subtitle}</p>
              </div>
            )}
            {children}
          </div>
          <GitHubConnect />
        </div>
      </main>
    </div>
  );
};
