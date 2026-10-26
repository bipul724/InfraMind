import { Github } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RepositoryInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const RepositoryInput = ({ value, onChange, placeholder }: RepositoryInputProps) => {
  const isValidUrl = value && (value.includes('github.com') || value.includes('gitlab.com') || value.includes('bitbucket.org'));

  return (
    <div className="space-y-3">
      <Label htmlFor="repo-url" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Github className="h-5 w-5" />
        Repository URL
      </Label>
      <div className="relative">
        <Input
          id="repo-url"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
           className={`h-12 border-2 pl-4 pr-12 text-base transition-all duration-200 ${
             value && !isValidUrl
               ? 'border-status-error/50 focus:border-status-error'
               : value && isValidUrl
               ? 'border-status-success/50 focus:border-status-success'
               : 'border-input focus:border-primary'
           }`}
        />
        {value && (
           <div className={`absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ${
             isValidUrl ? 'bg-status-success' : 'bg-status-error'
           }`} />
        )}
      </div>
      {value && !isValidUrl && (
        <p className="text-sm text-status-error">Please enter a valid GitHub, GitLab, or Bitbucket URL</p>
      )}
    </div>
  );
};
