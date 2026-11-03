/**
 * GitHub API Service
 * 
 * This service handles GitHub repository operations AFTER user authentication.
 * It is NOT used for user authentication (that's handled by Supabase).
 * 
 * Purpose:
 * - Connect to user's GitHub account for repository access
 * - Fetch user's repositories and organizations
 * - Check repository access before cloning
 * - Revoke the OAuth grant when a user disconnects
 * 
 * Authentication Flow:
 * 1. User logs in via Supabase (email/password or OAuth)
 * 2. User connects GitHub account through this service for repo access
 * 3. The GitHub token is stored encrypted on the server (utils/githubConnections.js)
 *    and is used for repository operations only
 * 
 * Environment Variables:
 * - GITHUB_CLIENT_ID: GitHub OAuth app client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth app client secret  
 * - GITHUB_REDIRECT_URI: OAuth callback URL
 * - GITHUB_OAUTH_BASE_URL (optional): default https://github.com
 * - GITHUB_API_BASE_URL (optional): default https://api.github.com
 *   Both exist so the OAuth flow can be tested against local fakes. They never
 *   influence the git clone URL, which is always https://github.com/{owner}/{repo}.git
 */

import axios from 'axios';
import { describeServiceUrlProblem } from './utils/auth.js';

// Axios errors carry the request config (client secret, auth code, access token),
// so log only the message and HTTP status
const describeError = (error) =>
  `${error.message}${error.response ? ` (HTTP ${error.response.status})` : ''}`;

export const DEFAULT_GITHUB_OAUTH_BASE_URL = 'https://github.com';
export const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';
const REVOKE_TIMEOUT_MS = 5000;

const warnedInvalidBaseUrls = new Set();

// Reads an optional base URL override. An invalid value falls back to the default
// with a warning that names the variable but never prints the value.
function resolveBaseUrl(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const problem = describeServiceUrlProblem(value);
  if (problem) {
    if (!warnedInvalidBaseUrls.has(name)) {
      warnedInvalidBaseUrls.add(name);
      console.warn(`⚠️ ${name} ${problem}; using the default`);
    }
    return fallback;
  }
  return value.replace(/\/+$/, '');
}

// GitHub answers 401 for a revoked or expired token
function unauthorizedError() {
  const unauthorized = new Error('GitHub token is invalid or expired');
  unauthorized.code = 'GITHUB_UNAUTHORIZED';
  return unauthorized;
}

const isUnauthorized = (error) => error?.response?.status === 401;

class GitHubService {
  // Configuration is read lazily so it always reflects the loaded environment,
  // regardless of module evaluation order
  get clientId() {
    return process.env.GITHUB_CLIENT_ID;
  }

  get clientSecret() {
    return process.env.GITHUB_CLIENT_SECRET;
  }

  get redirectUri() {
    return process.env.GITHUB_REDIRECT_URI;
  }

  get oauthBaseUrl() {
    return resolveBaseUrl('GITHUB_OAUTH_BASE_URL', DEFAULT_GITHUB_OAUTH_BASE_URL);
  }

  get apiBaseUrl() {
    return resolveBaseUrl('GITHUB_API_BASE_URL', DEFAULT_GITHUB_API_BASE_URL);
  }

  // Generate GitHub OAuth URL
  getAuthURL(state = '') {
    const params = new URLSearchParams({
      client_id: this.clientId || '',
      redirect_uri: this.redirectUri || '',
      scope: 'repo,user:email',
      state
    });
    return `${this.oauthBaseUrl}/login/oauth/authorize?${params.toString()}`;
  }

  // Exchange authorization code for an access token.
  // Returns { accessToken, scope }; scope is the granted scope list, or null.
  async getAccessToken(code) {
    try {
      const response = await axios.post(`${this.oauthBaseUrl}/login/oauth/access_token`, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: code,
        redirect_uri: this.redirectUri
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      // GitHub answers an invalid or expired code with HTTP 200 and an error field
      if (!response.data.access_token) {
        throw new Error(`GitHub rejected the authorization code: ${response.data.error || 'no access token returned'}`);
      }

      return {
        accessToken: response.data.access_token,
        scope: typeof response.data.scope === 'string' ? response.data.scope : null
      };
    } catch (error) {
      console.error('Error exchanging code for token:', describeError(error));
      throw new Error('Failed to authenticate with GitHub');
    }
  }

  // Get user information from GitHub
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/user`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching user info:', describeError(error));
      throw new Error('Failed to fetch user information');
    }
  }

  // Get user repositories
  async getUserRepositories(accessToken, page = 1, perPage = 50) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/user/repos`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          page: page,
          per_page: perPage,
          sort: 'updated',
          type: 'all'
        }
      });

      return response.data.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        language: repo.language,
        stargazersCount: repo.stargazers_count,
        forksCount: repo.forks_count,
        updatedAt: repo.updated_at,
        defaultBranch: repo.default_branch,
        owner: {
          login: repo.owner.login,
          avatarUrl: repo.owner.avatar_url
        }
      }));
    } catch (error) {
      if (isUnauthorized(error)) throw unauthorizedError();
      console.error('Error fetching repositories:', describeError(error));
      throw new Error('Failed to fetch repositories');
    }
  }

  // Get organization repositories
  async getOrgRepositories(accessToken, org, page = 1, perPage = 50) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/orgs/${encodeURIComponent(org)}/repos`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          page: page,
          per_page: perPage,
          sort: 'updated',
          type: 'all'
        }
      });

      return response.data.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        private: repo.private,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        language: repo.language,
        stargazersCount: repo.stargazers_count,
        forksCount: repo.forks_count,
        updatedAt: repo.updated_at,
        defaultBranch: repo.default_branch,
        owner: {
          login: repo.owner.login,
          avatarUrl: repo.owner.avatar_url
        }
      }));
    } catch (error) {
      if (isUnauthorized(error)) throw unauthorizedError();
      console.error('Error fetching org repositories:', describeError(error));
      throw new Error('Failed to fetch organization repositories');
    }
  }

  // Get user organizations
  async getUserOrganizations(accessToken) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/user/orgs`, {
        headers: {
          'Authorization': `token ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      return response.data.map(org => ({
        id: org.id,
        login: org.login,
        description: org.description,
        avatarUrl: org.avatar_url,
        url: org.url
      }));
    } catch (error) {
      if (isUnauthorized(error)) throw unauthorizedError();
      console.error('Error fetching organizations:', describeError(error));
      throw new Error('Failed to fetch organizations');
    }
  }

  // Check if user has access to repository.
  // 403/404 resolve to { hasAccess: false }; a 401 (revoked or expired token)
  // throws an error with code GITHUB_UNAUTHORIZED.
  async checkRepoAccess(accessToken, owner, repo) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          headers: {
            'Authorization': `token ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      return {
        hasAccess: true,
        repo: {
          id: response.data.id,
          name: response.data.name,
          fullName: response.data.full_name,
          private: response.data.private,
          size: response.data.size, // KB
          cloneUrl: response.data.clone_url,
          sshUrl: response.data.ssh_url,
          defaultBranch: response.data.default_branch
        }
      };
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 403) {
        return { hasAccess: false, error: 'Repository not found or no access' };
      }
      if (status === 401) {
        throw unauthorizedError();
      }
      console.error('Error checking repository access:', describeError(error));
      throw new Error('Failed to check repository access');
    }
  }

  // Revoke the OAuth grant (all tokens of this app for the GitHub user).
  // Best effort: returns { ok, status } and never throws. Logs no request details.
  async revokeGrant(accessToken) {
    const clientId = this.clientId || '';
    const credentials = Buffer.from(`${clientId}:${this.clientSecret || ''}`).toString('base64');
    try {
      const response = await fetch(`${this.apiBaseUrl}/applications/${encodeURIComponent(clientId)}/grant`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS)
      });
      await response.text().catch(() => {});
      return { ok: response.status === 204, status: response.status };
    } catch (error) {
      return { ok: false, status: error?.name === 'TimeoutError' ? 'timeout' : 'network error' };
    }
  }
}

export default new GitHubService(); 