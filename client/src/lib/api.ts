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

export interface SaveFilesResult {
  saved: SavedFile[];
  alreadySaved: number;
}

export interface SavedFilesPage {
  files: SavedFile[];
  hasMore: boolean;
}

export class SavedFilesAPI {
  // Ignore exact copies in one atomic request so a reload cannot save the same run twice.
  static async saveFiles(files: SaveFileRequest[]): Promise<SaveFilesResult> {
    const values = files.map(file => ({
      user_id: file.userId,
      content: file.content,
      name: file.name,
      type: file.type,
      repo_url: file.repoUrl || null,
    }));
    const { data: rows, error } = await supabase
      .from('saved_files')
      .upsert(values, { onConflict: 'user_id,name,repo_url,content_sha256', ignoreDuplicates: true })
      .select();

    if (error) {
      if (error.code === '23514' && error.message.includes('saved_files limit reached')) {
        throw new Error('Your saved files are full (500). Delete some in Saved Files to save more');
      }
      if (error.code === '23514' && error.message.includes('saved_files_content_size_check')) {
        throw new Error('This file is too large to save');
      }
      throw new Error('These files could not be saved. Please try again.');
    }
    const saved = (rows ?? []).map(toSavedFile);
    return { saved, alreadySaved: files.length - saved.length };
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

  static async getSavedFiles({ offset = 0, limit = 50 }: { offset?: number; limit?: number } = {}): Promise<SavedFilesPage> {
    // Fetch one extra row with a stable tie-breaker so the next page is discoverable.
    const { data, error } = await supabase
      .from('saved_files')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit);

    if (error) {
      console.error('Failed to fetch saved files:', error);
      throw new Error(error.message);
    }
    return { files: (data ?? []).slice(0, limit).map(toSavedFile), hasMore: (data?.length ?? 0) > limit };
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
