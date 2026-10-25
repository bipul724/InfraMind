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
    <Card className={`shadow-lg border-slate-200/60 ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Plus className="h-5 w-5 text-slate-800" />
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
              <Github className="h-4 w-4 text-slate-600" />
              <label className="text-sm font-medium text-slate-700">
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
              <Code2 className="h-4 w-4 text-slate-600" />
              <label className="text-sm font-medium text-slate-700">
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
              className="w-full h-11 text-base font-medium bg-slate-900 hover:bg-slate-800 text-white transition-all duration-200 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-start space-x-3">
              <div className="p-1 bg-slate-200 rounded-full">
                <Rocket className="h-4 w-4 text-slate-700" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-slate-900 mb-1">What you'll get:</p>
                <ul className="text-slate-600 space-y-1">
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