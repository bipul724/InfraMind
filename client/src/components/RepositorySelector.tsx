import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Alert, AlertDescription } from './ui/alert';
import { apiFetch } from '@/lib/apiClient';
import { GITHUB_RECONNECT_CODES, UNREACHABLE_MESSAGE, describeApiError, readApiError } from '@/lib/apiError';
import { 
  Github, 
  Search, 
  ExternalLink, 
  Star, 
  GitBranch, 
  Lock, 
  Globe, 
  Calendar,
  User,
  Building
} from 'lucide-react';

interface Repository {
  id: number;
  name: string;
  fullName: string;
  description: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  language: string;
  stargazersCount: number;
  forksCount: number;
  updatedAt: string;
  defaultBranch: string;
  owner: {
    login: string;
    avatarUrl: string;
  };
}

interface Organization {
  id: number;
  login: string;
  description: string;
  avatarUrl: string;
  url: string;
}

// The `user` object of GET /api/github/repositories (server/server.js)
interface GitHubUser {
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

// Only GitHub's own repository pages are opened in a new tab
const isGitHubPage = (url: string | undefined): url is string =>
  typeof url === 'string' && url.startsWith('https://github.com/');

interface RepositorySelectorProps {
  onRepositorySelect: (repository: Repository) => void;
  // The repository picked so far, shown as pressed on its card
  selectedFullName?: string | null;
  isConnected: boolean;
  onConnect: () => void;
}

// Radix Select rejects an empty item value, so the default option uses a
// sentinel that maps back to the empty "no organization" state.
// GitHub logins cannot contain underscores, so it never collides with an org.
const PERSONAL_REPOS_VALUE = '__personal__';

export const RepositorySelector: React.FC<RepositorySelectorProps> = ({
  onRepositorySelect,
  selectedFullName = null,
  isConnected,
  onConnect
}) => {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  // The message shown, and the server's code (a GitHub sign-in problem offers Reconnect)
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Fetch user repositories
  // The server uses the signed-in user's stored GitHub connection
  const fetchRepositories = useCallback(async (page = 1, orgName = '') => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const endpoint = orgName 
        ? `/api/github/organizations/${encodeURIComponent(orgName)}/repositories?page=${page}&per_page=20`
        : `/api/github/repositories?page=${page}&per_page=20`;

      let response: Response;
      try {
        response = await apiFetch(endpoint);
      } catch {
        setError({ message: UNREACHABLE_MESSAGE, code: null });
        return;
      }

      if (!response.ok) {
        const failure = await readApiError(response, 'Your repositories could not be loaded. Please try again.');
        setError({ message: describeApiError(failure), code: failure.code });
        return;
      }

      const data = await response.json();

      if (page === 1) {
        setRepositories(data.repositories);
        if (!orgName) {
          setUser(data.user);
          setOrganizations(data.organizations);
        }
      } else {
        setRepositories(prev => [...prev, ...data.repositories]);
      }

      setHasMore(data.pagination.has_more);
      setCurrentPage(page);
    } catch (error) {
      // An unexpected body: never shown raw
      console.error('Error reading the repository list:', error);
      setError({ message: 'The server sent an unexpected answer. Please try again.', code: null });
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Load repositories when connected
  useEffect(() => {
    if (isConnected) {
      fetchRepositories(1, selectedOrg);
    }
  }, [isConnected, selectedOrg, fetchRepositories]);

  // Filter repositories based on search term
  const filteredRepositories = repositories.filter(repo =>
    repo.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    repo.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Load more repositories
  const loadMore = () => {
    if (!loading && hasMore) {
      fetchRepositories(currentPage + 1, selectedOrg);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (!isConnected) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-5 py-8 text-center sm:px-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-soft">
          <Github aria-hidden="true" className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold">
          Connect GitHub Account
        </h3>
        <div className="mx-auto mt-2 max-w-md space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Connect your GitHub account to browse and select your repositories for AI analysis.
          </p>
          <Button 
            onClick={onConnect} 
            className="w-full sm:w-auto"
            size="lg"
          >
            <Github aria-hidden="true" className="h-5 w-5" />
            Connect GitHub Account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* User Info */}
      {user && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 p-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user.avatarUrl} alt={user.name || user.login} />
            <AvatarFallback>{user.name?.[0] || user.login?.[0]}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{user.name || user.login}</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">@{user.login}</p>
          </div>
          <Badge variant="outline" className="gap-1 border-status-success/30 bg-status-success/[0.06] text-status-success">
            <Github aria-hidden="true" className="h-3 w-3" />
            Connected
          </Badge>
        </div>
      )}

      {/* Repository Browser */}
      <div className="space-y-4">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Select Repository</h3>
          <div className="flex flex-col gap-3 sm:flex-row">
            {/* Search */}
            <div className="flex-1">
              <Label htmlFor="search" className="sr-only">Search repositories</Label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search repositories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Organization filter */}
            {organizations.length > 0 && (
              <div className="w-full sm:w-56">
                <Select
                  value={selectedOrg || PERSONAL_REPOS_VALUE}
                  onValueChange={(value) => setSelectedOrg(value === PERSONAL_REPOS_VALUE ? '' : value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All repositories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PERSONAL_REPOS_VALUE}>
                      <div className="flex items-center gap-2">
                        <User aria-hidden="true" className="h-4 w-4" />
                        All repositories
                      </div>
                    </SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.login}>
                        <div className="flex items-center gap-2">
                          <Building aria-hidden="true" className="h-4 w-4" />
                          {org.login}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <div>
          {error && (
            <Alert className="mb-4" variant="destructive">
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error.message}</span>
                {error.code && GITHUB_RECONNECT_CODES.has(error.code) && (
                  <Button size="sm" variant="outline" onClick={onConnect} className="w-fit shrink-0">
                    <Github aria-hidden="true" className="h-4 w-4" />
                    Reconnect GitHub
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {loading && repositories.length === 0 ? (
            <div className="space-y-2" aria-busy="true">
              <div className="flex items-center gap-2 pb-1 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary"></div>
                <p>Loading repositories...</p>
              </div>
              {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse rounded-md border border-border p-4">
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="mt-3 h-3 w-3/4 rounded bg-muted" />
                  <div className="mt-3 h-3 w-1/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRepositories.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-12 text-center">
                  <Github aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm text-muted-foreground">
                    {searchTerm ? 'No repositories match your search.' : 'No repositories found.'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="scrollbar-slim max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {filteredRepositories.map((repo) => (
                    <div
                      key={repo.id}
                      className="relative rounded-md border border-border bg-card p-4 transition-colors duration-150 hover:border-primary/30 hover:bg-accent/40"
                    >
                      {/* The whole card selects the repository: one button stretched over it,
                          so it is reachable by keyboard and named; the card's content stays
                          outside the button */}
                      <button
                        type="button"
                        className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => onRepositorySelect(repo)}
                        aria-label={`Select ${repo.fullName}`}
                        aria-pressed={selectedFullName === repo.fullName}
                      />
                      <div className="pointer-events-none flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                            <h4 className="min-w-0 max-w-full truncate font-mono text-sm font-medium">{repo.name}</h4>
                            {repo.private ? (
                              <Badge variant="secondary" className="gap-1 border-status-warning/30 bg-status-warning/10 text-status-warning">
                                <Lock aria-hidden="true" className="h-3 w-3" />
                                Private
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <Globe aria-hidden="true" className="h-3 w-3" />
                                Public
                              </Badge>
                            )}
                            {repo.language && (
                              <Badge variant="secondary">{repo.language}</Badge>
                            )}
                          </div>
                          {repo.description && (
                            <p className="mb-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                              {repo.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Star aria-hidden="true" className="h-3 w-3" />
                              {repo.stargazersCount}
                            </span>
                            <span className="flex items-center gap-1">
                              <GitBranch aria-hidden="true" className="h-3 w-3" />
                              {repo.forksCount}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar aria-hidden="true" className="h-3 w-3" />
                              Updated {formatDate(repo.updatedAt)}
                            </span>
                          </div>
                        </div>
                        {isGitHubPage(repo.htmlUrl) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="pointer-events-auto relative h-10 w-10 shrink-0 p-0 text-muted-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              window.open(repo.htmlUrl, '_blank', 'noopener,noreferrer');
                            }}
                            aria-label={`Open ${repo.fullName} on GitHub`}
                            title="Open on GitHub"
                          >
                            <ExternalLink aria-hidden="true" className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  </div>

                  {hasMore && (
                    <div className="pt-2 text-center">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={loadMore} 
                        disabled={loading}
                      >
                        {loading ? 'Loading...' : 'Load More'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RepositorySelector;
