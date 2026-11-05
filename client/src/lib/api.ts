import { supabase } from './supabase';

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

export class SavedFilesAPI {
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

// A row of public.saved_files as returned by Supabase
interface SavedFileRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  repo_url: string | null;
  content: string;
  created_at: string;
}

const toSavedFile = (row: SavedFileRow): SavedFile => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  type: row.type,
  repoUrl: row.repo_url,
  content: row.content,
  createdAt: row.created_at,
});
