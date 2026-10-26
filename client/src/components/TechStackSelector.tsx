import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Code, Server } from 'lucide-react';

interface TechStack {
  value: string;
  label: string;
  icon: React.ElementType;
  description: string;
}

const techStacks: TechStack[] = [
  { value: 'react', label: 'React', icon: Code, description: 'Frontend React application' },
  { value: 'nodejs', label: 'Node.js', icon: Server, description: 'Backend Node.js application' },
];

interface TechStackSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export const TechStackSelector: React.FC<TechStackSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="space-y-2">
      <Label>Tech Stack</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a tech stack" />
        </SelectTrigger>
        <SelectContent>
          {techStacks.map((stack) => {
            const Icon = stack.icon;
            return (
              <SelectItem key={stack.value} value={stack.value}>
                <div className="flex items-center space-x-2">
                  <Icon className="h-4 w-4" />
                  <div>
                    <div className="font-medium">{stack.label}</div>
                    <div className="text-xs text-slate-500">{stack.description}</div>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};