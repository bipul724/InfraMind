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
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo and Title */}
            <div className="flex items-center space-x-4">
              <Link to="/dashboard" className="flex items-center space-x-2 text-foreground transition-opacity hover:opacity-80">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Terminal className="h-4 w-4" />
                </div>
                <h1 className="text-lg font-semibold tracking-tight">InfraMind</h1>
              </Link>
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {title}
              </Badge>
            </div>
            
            {/* Navigation and User Menu */}
            <div className="flex items-center space-x-4">
              {/* Main Navigation */}
              <nav className="hidden md:flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/dashboard')}
                  className="flex items-center space-x-2"
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>Dashboard</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/select-repo')}
                  className="flex items-center space-x-2"
                >
                  <GitBranch className="h-4 w-4" />
                  <span>Repositories</span>
                </Button>
              </nav>

              {/* GitHub Username Display */}
              {user?.prefs?.githubUsername && (
                <div className="hidden items-center font-mono text-xs text-muted-foreground sm:flex">
                  <Github className="h-4 w-4 mr-1" />
                  {user.prefs.githubUsername}
                </div>
              )}
              
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={avatarUrl} alt={userName} />
                      <AvatarFallback>
                        {userName[0]?.toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{userName}</p>
                      <p className="w-[200px] truncate text-sm text-muted-foreground">
                        {userEmail}
                      </p>
                    </div>
                  </div>
                  <Separator />
                  <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/select-repo')}>
                    <GitBranch className="mr-2 h-4 w-4" />
                    Repositories
                  </DropdownMenuItem>
                  <Separator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="space-y-8">
          <GitHubConnect />
          <div className="mx-auto max-w-[1180px]">
            {subtitle && (
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
