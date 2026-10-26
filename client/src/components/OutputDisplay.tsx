import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Download, FileText, Settings, Play, Book, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DevPilotResponse } from '@/lib/api';
import { SavedFilesAPI, SaveFileRequest } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface OutputDisplayProps {
  techStack: string;
  apiResponse: DevPilotResponse;
  repoUrl?: string;
}

export const OutputDisplay = ({ techStack, apiResponse, repoUrl }: OutputDisplayProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('dockerfile');
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const copyToClipboard = (content: string, type: string) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copied to clipboard",
      description: `${type} has been copied to your clipboard.`,
    });
  };
  
  const saveFile = async (content: string, name: string, type: string) => {
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please sign in to save files.",
        variant: "destructive"
      });
      return;
    }
    
    try {
      setSaving(prev => ({ ...prev, [type]: true }));
      
      const request: SaveFileRequest = {
        userId: user.id,
        content,
        name,
        type,
        repoUrl
      };
      
      await SavedFilesAPI.saveFile(request);
      
      toast({
        title: "File saved",
        description: `${name} has been saved to your account.`,
      });
    } catch (error) {
      console.error('Failed to save file:', error);
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save file",
        variant: "destructive"
      });
    } finally {
      setSaving(prev => ({ ...prev, [type]: false }));
    }
  };

  const tabs = [
    {
      value: 'dockerfile',
      label: 'Dockerfile',
      icon: <Settings className="h-4 w-4" />,
      content: apiResponse.dockerfile,
      description: 'Production-ready Docker configuration',
      fileName: 'Dockerfile'
    },
    {
      value: 'github-actions',
      label: 'GitHub Actions',
      icon: <Play className="h-4 w-4" />,
      content: apiResponse.githubActions,
      description: 'Automated CI/CD workflow',
      fileName: '.github/workflows/ci.yml'
    },
    {
      value: 'env',
      label: '.env.example',
      icon: <FileText className="h-4 w-4" />,
      content: apiResponse.envExample,
      description: 'Environment variables template',
      fileName: '.env.example'
    },
    {
      value: 'docs',
      label: 'Documentation',
      icon: <Book className="h-4 w-4" />,
      content: apiResponse.docs,
      description: 'Deployment instructions and best practices',
      fileName: 'README.md'
    }
  ];

  return (
    <Card className="w-full border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Generated DevOps Configuration
        </CardTitle>
          <CardDescription className="text-muted-foreground">
          Production-ready files for your {techStack} project
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
           <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1">
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-6">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-semibold">{tab.label}</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(tab.content, tab.label)}
                      className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                    >
                      <Copy className="mr-1 h-4 w-4" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const blob = new Blob([tab.content], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = tab.fileName;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveFile(tab.content, tab.fileName, tab.value)}
                      disabled={saving[tab.value]}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      {saving[tab.value] ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
                
                <p className="text-sm text-muted-foreground">{tab.description}</p>
                
                <div className="overflow-hidden rounded-md border border-border terminal-surface">
                  <div className="flex items-center justify-between border-b border-background/15 px-3 py-2">
                    <span className="font-mono text-xs text-background/75">{tab.fileName}</span>
                    <span className="font-mono text-[11px] text-background/50">{tab.label}</span>
                  </div>
                  <pre className="scrollbar-slim max-h-[32rem] overflow-auto p-4 font-mono text-sm leading-6 text-background/90">
                    <code>{tab.content}</code>
                  </pre>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
};
