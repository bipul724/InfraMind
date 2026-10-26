import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Terminal } from 'lucide-react';

interface PublicLayoutProps {
  children: React.ReactNode;
  showBackButton?: boolean;
  showHeader?: boolean;
  headerTitle?: string;
}

export const PublicLayout: React.FC<PublicLayoutProps> = ({ 
  children, 
  showBackButton = true,
  showHeader = true,
  headerTitle = "InfraMind"
}) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {showHeader && (
        <div className="border-b border-border/80 bg-background">
          <div className="container mx-auto flex items-center px-4 py-5">
            <div className="flex w-full items-center justify-between">
            {showBackButton && (
              <Button
                variant="ghost"
                onClick={() => navigate('/')}
                className="flex items-center space-x-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Home</span>
              </Button>
            )}
            
            <div className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Terminal className="h-4 w-4" />
              </div>
              <span className="text-lg font-semibold tracking-tight text-foreground">{headerTitle}</span>
            </div>
            
            {!showBackButton && <div />} {/* Spacer for center alignment */}
            </div>
          </div>
        </div>
      )}
      
      <main>
        {children}
      </main>
    </div>
  );
};
