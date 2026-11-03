/**
 * GitHub API Service
 * 
 * This service handles GitHub repository operations AFTER user authentication.
 * It is NOT used for user authentication (that's handled by Supabase).
 * 
 * Purpose:
 * - Connect to user's GitHub account for repository access
 * - Fetch user's repositories and organizations
 * - Clone repositories for AI analysis
 * - Handle GitHub API interactions
 * 
 * Authentication Flow:
 * 1. User logs in via Supabase (email/password or OAuth)
 * 2. User connects GitHub account through this service for repo access
 * 3. GitHub token is used for repository operations only
 * 
 * Environment Variables Required:
 * - GITHUB_CLIENT_ID: GitHub OAuth app client ID
 * - GITHUB_CLIENT_SECRET: GitHub OAuth app client secret  
 * - GITHUB_REDIRECT_URI: OAuth callback URL
 * - JWT_SECRET: For signing GitHub session tokens
 */

import axios from 'axios';
import jwt from 'jsonwebtoken';

// Axios errors carry the request config (client secret, auth code, access token),
// so log only the message and HTTP status
const describeError = (error) =>
  `${error.message}${error.response ? ` (HTTP ${error.response.status})` : ''}`;

// Placeholder values shipped in docs and examples; never acceptable as a real secret
export const JWT_SECRET_PLACEHOLDERS = [
  'your-jwt-secret-change-in-production',
  'your-jwt-secret-for-github-sessions',
  'your_jwt_secret_here'
];
export const MIN_JWT_SECRET_LENGTH = 32;

// Returns a short description of what is wrong with the secret, or null if it is usable.
// Never includes the value itself.
export function describeJwtSecretProblem(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return 'is not set';
  if (JWT_SECRET_PLACEHOLDERS.includes(secret)) return 'is set to a known placeholder value';
  if (secret.length < MIN_JWT_SECRET_LENGTH) return `is shorter than ${MIN_JWT_SECRET_LENGTH} characters`;
  return null;
}

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

  get jwtSecret() {
    const secret = process.env.JWT_SECRET;
    const problem = describeJwtSecretProblem(secret);
    if (problem) {
      throw new Error(`JWT_SECRET ${problem}`);
    }
    return secret;
  }

  // Generate GitHub OAuth URL
  getAuthURL(state = '') {
    const params = new URLSearchParams({
      client_id: this.clientId || '',
      redirect_uri: this.redirectUri || '',
      scope: 'repo,user:email',
      state
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  // Exchange authorization code for access token
  async getAccessToken(code) {
    try {
      const response = await axios.post('https://github.com/login/oauth/access_token', {
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

      return response.data.access_token;
    } catch (error) {
      console.error('Error exchanging code for token:', describeError(error));
      throw new Error('Failed to authenticate with GitHub');
    }
  }

  // Get user information from GitHub
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get('https://api.github.com/user', {
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
      const response = await axios.get(`https://api.github.com/user/repos`, {
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
      console.error('Error fetching repositories:', describeError(error));
      throw new Error('Failed to fetch repositories');
    }
  }

  // Get organization repositories
  async getOrgRepositories(accessToken, org, page = 1, perPage = 50) {
    try {
      const response = await axios.get(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos`, {
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
      console.error('Error fetching org repositories:', describeError(error));
      throw new Error('Failed to fetch organization repositories');
    }
  }

  // Get user organizations
  async getUserOrganizations(accessToken) {
    try {
      const response = await axios.get('https://api.github.com/user/orgs', {
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
      console.error('Error fetching organizations:', describeError(error));
      throw new Error('Failed to fetch organizations');
    }
  }

  // Generate JWT token for user session
  generateJWT(userData) {
    return jwt.sign(userData, this.jwtSecret, { expiresIn: '7d' });
  }

  // Verify JWT token
  verifyJWT(token) {
    // Read outside the try so a missing secret is a configuration error, not "Invalid token"
    const secret = this.jwtSecret;
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Check if user has access to repository.
  // 403/404 resolve to { hasAccess: false }; a 401 (revoked or expired token)
  // throws an error with code GITHUB_UNAUTHORIZED.
  async checkRepoAccess(accessToken, owner, repo) {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
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
        const unauthorized = new Error('GitHub token is invalid or expired');
        unauthorized.code = 'GITHUB_UNAUTHORIZED';
        throw unauthorized;
      }
      console.error('Error checking repository access:', describeError(error));
      throw new Error('Failed to check repository access');
    }
  }
}

export default new GitHubService(); 