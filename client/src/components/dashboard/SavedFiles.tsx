import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SavedFilesAPI, SavedFile } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Trash2, RefreshCw, FilePlus, FileCode, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { downloadTextFile } from '@/lib/download';

export const SavedFiles: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Loaded once per signed-in user, and again from the Refresh button
  const userId = user?.id;
  const fetchSavedFiles = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const savedFiles = await SavedFilesAPI.getSavedFiles();
      setFiles(savedFiles);
    } catch (err) {
      console.error('Error fetching saved files:', err);
      setError('Failed to fetch your saved files');
      toast({
        title: 'Error',
        description: 'Failed to fetch your saved files',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    void fetchSavedFiles();
  }, [fetchSavedFiles]);

  // Saved under its base name: the workflow is stored as .github/workflows/ci.yml and
  // downloads as ci.yml
  const handleDownload = (file: SavedFile) => downloadTextFile(file.name, file.content);

  const handleDelete = async (file: SavedFile) => {
    if (!window.confirm(`Delete ${file.name}? This cannot be undone.`)) return;

    setDeletingId(file.id);
    try {
      await SavedFilesAPI.deleteFile(file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
      toast({
        title: 'File deleted',
        description: `${file.name} has been removed from your account.`,
      });
    } catch (err) {
      console.error('Error deleting file:', err);
      toast({
        title: 'Delete Failed',
        description: 'Failed to delete the file',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const getFileTypeColor = (type: string) => {
    switch (type) {
      case 'dockerfile':
        return 'bg-primary/[0.07] text-primary border-primary/20';
      case 'github-actions':
        return 'bg-muted text-foreground/80 border-border';
      case 'env':
        return 'bg-status-success/[0.07] text-status-success border-status-success/25';
      case 'docs':
        return 'bg-status-warning/10 text-status-warning border-status-warning/30';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getFileTypeLabel = (type: string) => {
    switch (type) {
      case 'dockerfile':
        return 'Dockerfile';
      case 'github-actions':
        return 'GitHub Actions';
      case 'env':
        return 'Env File';
      case 'docs':
        return 'Documentation';
      default:
        return type;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Saved Files</CardTitle>
          <CardDescription>Please sign in to view your saved files</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div className="min-w-0 space-y-1">
          <CardTitle>Saved Files</CardTitle>
          <CardDescription>Files you've saved to your account</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSavedFiles} disabled={loading} className="shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-start gap-2.5 rounded-md border border-status-error/30 bg-status-error/[0.05] px-4 py-3 text-sm text-status-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        
        {files.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
             <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
               <FilePlus className="h-6 w-6 text-muted-foreground" />
             </div>
             <p className="font-medium text-foreground">No saved files found</p>
             <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">
              Save generated files from a completed generation to see them here
            </p>
          </div>
        ) : files.length === 0 && loading ? (
          <div className="divide-y divide-border overflow-hidden rounded-md border border-border" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex animate-pulse items-center gap-3 p-4">
                <div className="h-10 w-10 shrink-0 rounded-md bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 max-w-full rounded bg-muted" />
                  <div className="h-3 w-32 max-w-full rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {files.map((file) => (
              <li
                key={file.id}
                 className="flex flex-col gap-3 bg-card p-4 transition-colors duration-150 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60">
                    <FileCode className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="min-w-0 max-w-full truncate font-mono text-sm font-medium">{file.name}</h3>
                      <Badge variant="outline" className={getFileTypeColor(file.type)}>
                        {getFileTypeLabel(file.type)}
                      </Badge>
                    </div>
                     <p className="text-xs text-muted-foreground">
                      Created: {formatDate(file.createdAt)}
                    </p>
                    {file.repoUrl && (
                       <p className="max-w-md truncate font-mono text-[11px] text-muted-foreground">
                        Repo: {file.repoUrl}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 pl-[3.25rem] sm:pl-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => handleDownload(file)}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                    <span className="sr-only">Download</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 hover:border-destructive/30 hover:bg-destructive/[0.06] hover:text-destructive"
                    onClick={() => handleDelete(file)}
                    disabled={deletingId === file.id}
                    title="Delete"
                  >
                    {deletingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
