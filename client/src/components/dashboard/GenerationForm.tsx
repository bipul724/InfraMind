import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RepositoryInput } from '@/components/RepositoryInput';
import { TechStackSelector } from '@/components/TechStackSelector';
import { 
  Loader2, 
  AlertCircle, 
  Plus,
  Rocket,
  Sparkles,
  Github,
  Code2
} from 'lucide-react';

interface GenerationFormProps {
  onGenerate: (repoUrl: string, techStack: string) => Promise<void>;
  isGenerating: boolean;
  error: string | null;
  className?: string;
}

export const GenerationForm: React.FC<GenerationFormProps> = ({
  onGenerate,
  isGenerating,
  error,
  className
}) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [techStack, setTechStack] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (repoUrl && techStack) {
      await onGenerate(repoUrl, techStack);
    }
  };

  const isValid = repoUrl && techStack && !isGenerating;

  return (
    <Card className={`border-border bg-card shadow-sm ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <div className="rounded-md bg-muted p-2">
            <Plus className="h-5 w-5 text-primary" />
          </div>
          <span>Generate New CI/CD Setup</span>
        </CardTitle>
        <CardDescription>
          Enter your repository details to generate production-ready DevOps configurations with AI
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Repository Input */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2 mb-3">
              <Github className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium text-foreground">
                Repository URL
              </label>
            </div>
                         <RepositoryInput 
               value={repoUrl} 
               onChange={setRepoUrl}
               placeholder="https://github.com/username/repository"
             />
          </div>
          
          {/* Tech Stack Selector */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2 mb-3">
              <Code2 className="h-4 w-4 text-muted-foreground" />
              <label className="text-sm font-medium text-foreground">
                Technology Stack
              </label>
            </div>
                         <TechStackSelector 
               value={techStack} 
               onChange={setTechStack}
             />
          </div>
          
          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          {/* Generate Button */}
          <div className="pt-4">
            <Button 
              type="submit"
              disabled={!isValid}
              className="h-11 w-full text-base font-medium shadow-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating CI/CD Setup...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Generate CI/CD Setup
                </>
              )}
            </Button>
          </div>
          
          {/* Helper Text */}
          <div className="rounded-md border border-border bg-muted/50 p-4">
            <div className="flex items-start space-x-3">
              <div className="rounded-full bg-secondary p-1">
                <Rocket className="h-4 w-4 text-primary" />
              </div>
              <div className="text-sm">
                <p className="mb-1 font-medium">What you'll get:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>• Production-ready Dockerfile with multi-stage builds</li>
                  <li>• Complete GitHub Actions CI/CD workflows</li>
                  <li>• Security scanning and vulnerability checks</li>
                  <li>• Deployment configurations for major cloud platforms</li>
                </ul>
              </div>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
