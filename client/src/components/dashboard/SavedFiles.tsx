import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SavedFilesAPI, SavedFile } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Trash2, RefreshCw, FilePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

export const SavedFiles: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSavedFiles = async () => {
    if (!user?.id) return;

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
  };

  useEffect(() => {
    if (user) {
      fetchSavedFiles();
    }
  }, [user]);

  const handleDownload = (file: SavedFile) => {
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        return 'bg-primary/10 text-primary border-primary/20';
      case 'github-actions':
        return 'bg-muted text-muted-foreground border-border';
      case 'env':
        return 'bg-status-success/10 text-status-success border-status-success/30';
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
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Saved Files</CardTitle>
          <CardDescription>Please sign in to view your saved files</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl">Saved Files</CardTitle>
          <CardDescription>Files you've saved to your account</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSavedFiles} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md border border-status-error/30 bg-status-error/10 p-3 text-status-error">
            {error}
          </div>
        )}
        
        {files.length === 0 && !loading ? (
          <div className="text-center py-8 space-y-4">
             <FilePlus className="mx-auto h-12 w-12 text-muted-foreground/50" />
             <p className="text-muted-foreground">No saved files found</p>
             <p className="text-sm text-muted-foreground">
              Save generated files from a completed generation to see them here
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {files.map((file) => (
              <div
                key={file.id}
                 className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{file.name}</h3>
                    <Badge className={getFileTypeColor(file.type)}>
                      {getFileTypeLabel(file.type)}
                    </Badge>
                  </div>
                   <p className="text-xs text-muted-foreground">
                    Created: {formatDate(file.createdAt)}
                  </p>
                  {file.repoUrl && (
                     <p className="max-w-md truncate text-xs text-muted-foreground">
                      Repo: {file.repoUrl}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownload(file)}
                  >
                    <Download className="h-4 w-4" />
                    <span className="sr-only">Download</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(file)}
                    disabled={deletingId === file.id}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
