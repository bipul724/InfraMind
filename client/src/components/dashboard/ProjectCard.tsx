import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Download, 
  Share, 
  Trash2, 
  Github, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Clock,
  Play,
  Settings,
  ExternalLink
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  repoUrl: string;
  techStack: string;
  status: 'generating' | 'completed' | 'failed';
  createdAt: string;
  lastGenerated?: string;
  deploymentCount?: number;
}

interface ProjectCardProps {
  project: Project;
  onDownload?: (projectId: string) => void;
  onShare?: (projectId: string) => void;
  onDelete?: (projectId: string) => void;
  onRedeploy?: (projectId: string) => void;
  onConfigure?: (projectId: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  onDownload,
  onShare,
  onDelete,
  onRedeploy,
  onConfigure
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-status-success/10 text-status-success border-status-success/30';
      case 'generating': return 'bg-status-warning/10 text-status-warning border-status-warning/30';
      case 'failed': return 'bg-status-error/10 text-status-error border-status-error/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="h-4 w-4" />;
      case 'generating': return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'failed': return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <Card className="group border-border bg-card transition-shadow duration-200 hover:shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-lg truncate">{project.name}</CardTitle>
            <CardDescription className="text-sm">{project.techStack}</CardDescription>
          </div>
          <Badge className={`${getStatusColor(project.status)} border ml-2 flex-shrink-0`}>
            <div className="flex items-center space-x-1">
              {getStatusIcon(project.status)}
              <span className="capitalize">{project.status}</span>
            </div>
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Repository URL */}
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <Github className="h-4 w-4 flex-shrink-0" />
          <span className="truncate flex-1">{project.repoUrl.replace('https://github.com/', '')}</span>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => window.open(project.repoUrl, '_blank')}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
        
        {/* Project Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
              <span className="text-muted-foreground">Created:</span>
              <p className="font-medium">{formatDate(project.createdAt)}</p>
          </div>
          {project.deploymentCount && (
            <div>
                <span className="text-muted-foreground">Deployments:</span>
                <p className="font-medium">{project.deploymentCount}</p>
            </div>
          )}
        </div>
        
        {project.lastGenerated && (
          <div className="text-sm">
            <span className="text-muted-foreground">Last updated:</span>
            <p className="font-medium">{formatDate(project.lastGenerated)}</p>
          </div>
        )}
        
        <Separator />
        
        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {project.status === 'completed' && (
              <>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => onDownload?.(project.id)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => onRedeploy?.(project.id)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Deploy
                </Button>
              </>
            )}
            
            {project.status === 'failed' && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onRedeploy?.(project.id)}
              >
                <Play className="h-4 w-4 mr-2" />
                Retry
              </Button>
            )}
            
            {project.status === 'generating' && (
              <Button variant="outline" size="sm" disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </Button>
            )}
          </div>
          
          <div className="flex items-center space-x-1">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onConfigure?.(project.id)}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onShare?.(project.id)}
            >
              <Share className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
               className="text-status-error hover:bg-status-error/10 hover:text-status-error"
              onClick={() => onDelete?.(project.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
