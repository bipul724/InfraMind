import { supabase } from './supabase';

export interface DevPilotRequest {
  repoUrl: string;
  techStack: string;
  userId: string;
}

export interface DevPilotResponse {
  dockerfile: string;
  githubActions: string;
  envExample: string;
  docs: string;
}

export interface AuthRequest {
  email: string;
  password: string;
}

export interface ProjectData {
  id?: string;
  name: string;
  repoUrl: string;
  techStack: string;
  status: 'active' | 'archived' | 'pending';
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalyticsData {
  deployments: number;
  successRate: number;
  buildTime: number;
  lastDeployment: string;
}

// API Base URL
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000';

// Define interfaces for saving generated files to Supabase
export interface SaveFileRequest {
  userId: string;
  content: string;
  name: string;
  type: string;
  repoUrl?: string;
}

export interface SavedFile {
  id: string;
  userId: string;
  name: string;
  type: string;
  repoUrl: string | null;
  content: string;
  createdAt: string;
}

export class DevPilotAPI {
  private static async makeRequest(data: DevPilotRequest): Promise<DevPilotResponse> {
    try {
      // useAgents: false selects the single-shot generator (server/index.js),
      // which returns the DevPilotResponse shape including docs
      const response = await fetch(`${API_BASE_URL}/api/devpilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...data, useAgents: false }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to generate CI/CD setup');
    }
  }

  static async generateCICD(repoUrl: string, techStack: string, userId: string = 'anonymous'): Promise<DevPilotResponse> {
    // Validate inputs
    if (!repoUrl || !techStack) {
      throw new Error('Repository URL and tech stack are required');
    }

    // Validate repo URL format
    const githubUrlPattern = /^https:\/\/github\.com\/[\w\-\.]+\/[\w\-\.]+$/;
    if (!githubUrlPattern.test(repoUrl)) {
      throw new Error('Please enter a valid GitHub repository URL');
    }

    return this.makeRequest({ repoUrl, techStack, userId });
  }
}

export class ProjectsAPI {
  static async getProjects(): Promise<ProjectData[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/projects`, {
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      throw error;
    }
  }

  static async createProject(data: Omit<ProjectData, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectData> {
    try {
      const response = await fetch(`${API_BASE_URL}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error;
    }
  }

  static async updateProject(id: string, data: Partial<ProjectData>): Promise<ProjectData> {
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to update project:', error);
      throw error;
    }
  }

  static async deleteProject(id: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/projects/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
      console.error('Failed to delete project:', error);
      throw error;
    }
  }
}

export class AnalyticsAPI {
  static async getProjectAnalytics(projectId: string): Promise<AnalyticsData> {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/projects/${projectId}`, {
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to fetch project analytics:', error);
      throw error;
    }
  }

  static async getOverallAnalytics(): Promise<{ projects: AnalyticsData[] }> {
    try {
      const response = await fetch(`${API_BASE_URL}/analytics/overall`, {
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to fetch overall analytics:', error);
      throw error;
    }
  }
}

export class GitHubAPI {
  static async connectGitHubAccount(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/github/connect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
      console.error('Failed to connect GitHub account:', error);
      throw error;
    }
  }

  static async disconnectGitHubAccount(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE_URL}/github/disconnect`, {
        method: 'POST',
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
      console.error('Failed to disconnect GitHub account:', error);
      throw error;
    }
  }

  static async getGitHubRepositories(): Promise<Array<{id: string, name: string, url: string}>> {
    try {
      const response = await fetch(`${API_BASE_URL}/github/repositories`, {
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to fetch GitHub repositories:', error);
      throw error;
    }
  }

  static async getGitHubAccountStatus(): Promise<{connected: boolean, username?: string}> {
    try {
      const response = await fetch(`${API_BASE_URL}/github/status`, {
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.json();
    } catch (error) {
      console.error('Failed to get GitHub account status:', error);
      throw error;
    }
  }
}

export class SavedFilesAPI {
  static async saveFile(data: SaveFileRequest): Promise<SavedFile> {
    const { data: row, error } = await supabase
      .from('saved_files')
      .insert({
        user_id: data.userId,
        content: data.content,
        name: data.name,
        type: data.type,
        repo_url: data.repoUrl || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to save file:', error);
      throw new Error(error.message);
    }
    return toSavedFile(row);
  }

  // Inserts all files in one request, so either every file is saved or none is
  static async saveFiles(files: SaveFileRequest[]): Promise<SavedFile[]> {
    const { data: rows, error } = await supabase
      .from('saved_files')
      .insert(files.map(file => ({
        user_id: file.userId,
        content: file.content,
        name: file.name,
        type: file.type,
        repo_url: file.repoUrl || null,
      })))
      .select();

    if (error) {
      console.error('Failed to save files:', error);
      throw new Error(error.message);
    }
    return rows.map(toSavedFile);
  }

  static async deleteFile(id: string): Promise<void> {
    // Row-level security hides other users' rows, so a foreign id deletes nothing
    const { data, error } = await supabase
      .from('saved_files')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) {
      console.error('Failed to delete file:', error);
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      throw new Error('File not found');
    }
  }

  static async getSavedFiles(limit = 50): Promise<SavedFile[]> {
    // Row-level security limits results to the signed-in user's files
    const { data, error } = await supabase
      .from('saved_files')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch saved files:', error);
      throw new Error(error.message);
    }
    return data.map(toSavedFile);
  }
}

const toSavedFile = (row: any): SavedFile => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  type: row.type,
  repoUrl: row.repo_url,
  content: row.content,
  createdAt: row.created_at,
});
