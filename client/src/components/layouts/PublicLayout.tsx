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
        <header className="border-b border-border bg-card">
          <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-soft">
                <Terminal className="h-4 w-4" aria-hidden="true" />
              </div>
              <span className="text-base font-semibold tracking-tight text-foreground">{headerTitle}</span>
            </div>

            {showBackButton ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Back to Home</span>
              </Button>
            ) : (
              <div />
            )}
          </div>
        </header>
      )}
      
      <main>
        {children}
      </main>
    </div>
  );
};
