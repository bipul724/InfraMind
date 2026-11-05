import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, Send, Bot, Github, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
}

export const Demo = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [repoUrl, setRepoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const simulateRepoAnalysis = async () => {
    if (!repoUrl) {
      toast({
        title: "Error",
        description: "Please enter a repository URL",
        variant: "destructive"
      });
      return;
    }

    setIsAnalyzing(true);
    // Simulate analysis with a delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsAnalyzing(false);
    setHasAnalyzed(true);

    // Add initial message after analysis
    const initialMessage: Message = {
      id: Date.now().toString(),
      type: 'assistant',
      content: `This is a scripted demo. Nothing was fetched from ${repoUrl}: every answer below is a fixed sample written for a made-up React project.

The real InfraMind app has no chat. It clones a repository, runs three agents and generates:

• a Dockerfile
• a GitHub Actions workflow
• a .env.example

Pick a sample question to see a scripted answer.`
    };
    setMessages([initialMessage]);
  };

  // Simulated typing effect
  const simulateTyping = async (response: string) => {
    setIsTyping(true);
    const tempId = Date.now().toString();
    
    setMessages(prev => [...prev, {
      id: tempId,
      type: 'assistant',
      content: '',
      isTyping: true
    }]);

    let currentText = '';
    const words = response.split(' ');
    
    for (const word of words) {
      currentText += (currentText ? ' ' : '') + word;
      setMessages(prev => 
        prev.map(msg => 
          msg.id === tempId 
            ? { ...msg, content: currentText }
            : msg
        )
      );
      // Random delay between 50-150ms per word
      await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    }

    setMessages(prev => 
      prev.map(msg => 
        msg.id === tempId 
          ? { ...msg, isTyping: false }
          : msg
      )
    );
    setIsTyping(false);
  };

  const handleSendMessage = async (message: string) => {
    if (!message.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: message
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // Generate AI response based on the question
    let response = '';
    
    // Simulate AI analyzing the question
    await new Promise(resolve => setTimeout(resolve, 500));

    // Example response generation logic
    const normalizedQuestion = message.toLowerCase();
    if (normalizedQuestion.includes('tech stack') || normalizedQuestion.includes('technologies')) {
      response = `Sample answer (scripted, not based on ${repoUrl}). A typical React project might use:

• Frontend: React with TypeScript
• State Management: Redux
• Styling: Tailwind CSS
• Testing: Jest and React Testing Library
• Build Tool: Vite

Would you like me to generate optimized configurations for any of these technologies?`;
    } else if (normalizedQuestion.includes('pipeline') || normalizedQuestion.includes('ci/cd')) {
      response = `Sample answer (scripted). A CI/CD pipeline for a React application could include:

1. GitHub Actions workflow with:
   • Node.js 18 setup
   • Dependency caching
   • ESLint checks
   • Unit tests with Jest
   • Build verification
   • Automated deployments

Would you like me to generate this configuration for you?`;
    } else if (normalizedQuestion.includes('security') || normalizedQuestion.includes('secure')) {
      response = `Sample answer (scripted, no security scan was run). Typical recommendations:

• Update dependencies with known vulnerabilities
• Implement environment variable validation
• Add security headers to your API responses
• Enable strict TypeScript checks
• Implement rate limiting
• Add CORS configuration

Would you like me to help you implement any of these security measures?`;
    } else if (normalizedQuestion.includes('docker') || normalizedQuestion.includes('containerize')) {
      response = `Sample answer (scripted). A typical Dockerfile setup:

• Multi-stage build for optimal image size
• Node 18 Alpine base image
• Proper caching of dependencies
• Security best practices
• Environment configuration
• Health check implementation

Would you like me to generate this Dockerfile for you?`;
    } else if (normalizedQuestion.includes('architecture') || normalizedQuestion.includes('structure')) {
      response = `Sample answer (scripted, not your repository's structure). A typical breakdown:

Project Structure:
• /src - Main source code
  • /components - React components
  • /hooks - Custom hooks
  • /services - API services
  • /utils - Helper functions
• /tests - Test suites
• /public - Static assets

Data Flow:
• Redux for state management
• API service layer for backend communication
• Custom hooks for business logic
• Component composition pattern

Would you like me to suggest any architectural improvements?`;
    } else if (normalizedQuestion.includes('performance') || normalizedQuestion.includes('optimize')) {
      response = `Sample answer (scripted). Typical optimizations:

Performance Improvements:
• Implement React.memo() for expensive components
• Add Suspense boundaries for code-splitting
• Optimize image loading with next/image
• Implement service worker for caching
• Add Redis caching for API responses

Example metrics (made up):
• First Load JS: ~2.8MB
• Lighthouse Score: 76
• Time to Interactive: 3.2s

Would you like me to help implement any of these optimizations?`;
    } else if (normalizedQuestion.includes('test') || normalizedQuestion.includes('testing')) {
      response = `Sample answer (scripted, no tests were run).

Example coverage (made up):
• Unit Tests: 65%
• Integration Tests: 40%
• E2E Tests: Minimal

Recommendations:
• Add Jest snapshot tests for UI components
• Implement React Testing Library for integration tests
• Add Cypress for E2E testing
• Setup test coverage reporting
• Add API mocking with MSW

Would you like me to help set up any of these testing improvements?`;
    } else if (normalizedQuestion.includes('dependencies') || normalizedQuestion.includes('packages')) {
      response = `Sample answer (scripted, no package.json was read).

Example findings (made up):
• Outdated packages: 5
• Security vulnerabilities: 2 moderate
• Duplicate dependencies: 3
• Unused dependencies: 2

Recommendations:
• Update React to 18.2.0
• Upgrade TypeScript to 5.0
• Remove unused moment.js
• Replace lodash with modern alternatives

Would you like me to help update these dependencies?`;
    } else if (normalizedQuestion.includes('deploy') || normalizedQuestion.includes('deployment')) {
      response = `Sample answer (scripted). Common deployment options:

Deployment Options:
1. Vercel (Recommended)
   • Zero-config deployment
   • Automatic HTTPS
   • Edge functions support
   • Built-in monitoring

2. AWS Amplify
   • Full-stack deployment
   • CI/CD built-in
   • Easy scalability

3. Docker + Kubernetes
   • Complete control
   • Advanced scaling
   • Custom configuration

Which deployment option would you like to explore?`;
    } else {
      response = `This scripted demo has no answer for "${message}". Its sample topics are:

• Tech stack analysis and optimization
• CI/CD pipeline setup
• Security implementation
• Docker containerization
• Cloud deployment
• Performance optimization
• Architecture review
• Testing strategy
• Dependency management

What specific aspect would you like to explore?`;
    }

    // Simulate AI typing response
    await simulateTyping(response);
  };

  const SuggestedQuestions = () => (
    <div className="mt-3 flex flex-wrap gap-2">
      {[
        "What's my tech stack?",
        "Help me set up CI/CD",
        "How can I improve security?",
        "Help me containerize the app",
        "Analyze the architecture",
        "How can I improve performance?",
        "Review my testing setup",
        "Check my dependencies",
        "What are my deployment options?"
      ].map((question) => (
        <Button
          key={question}
          variant="outline"
          size="sm"
          className="h-8 rounded-full px-3 text-xs font-normal text-foreground/80 hover:text-foreground"
          onClick={() => handleSendMessage(question)}
          disabled={isTyping}
        >
          {question}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="bg-background text-foreground">
      {/* Demo Mode Banner */}
      <div className="border-b border-status-warning/25 bg-status-warning/[0.07]">
        <div className="container mx-auto px-4 py-2.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-status-warning">
              <Terminal className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Scripted demo: sample answers, nothing is analyzed</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/auth')}
              className="h-8 shrink-0 border-status-warning/30 bg-card text-status-warning hover:border-status-warning/50 hover:bg-status-warning/10 hover:text-status-warning"
            >
              Sign In to the App
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-10 sm:px-6 lg:py-14">
        <div className="mx-auto max-w-3xl">
          {/* Repository Input Section */}
          {!hasAnalyzed && (
            <Card className="shadow-raised">
              <CardHeader>
                <CardTitle className="text-xl">Scripted Demo</CardTitle>
                <CardDescription>
                  Enter any GitHub URL to start. The demo does not fetch or analyze it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="https://github.com/username/repo"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      className="h-11 pl-10 font-mono text-[13px]"
                      disabled={isAnalyzing}
                      aria-label="Repository URL"
                    />
                  </div>
                  <Button
                    onClick={simulateRepoAnalysis}
                    disabled={isAnalyzing || !repoUrl}
                    size="lg"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      'Start Demo'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chat Interface */}
          {hasAnalyzed && (
            <Card className="overflow-hidden shadow-raised">
              <CardHeader className="border-b border-border bg-muted/40 py-4 sm:py-4">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Terminal className="h-4 w-4 text-primary" />
                  Sample conversation
                  <span className="font-mono text-xs font-normal text-muted-foreground">scripted, not your repository</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                {/* Messages Area */}
                <ScrollArea className="h-[min(500px,60vh)] px-4 sm:px-6" ref={chatContainerRef}>
                  <div className="space-y-5 py-5">
                    {/* Chat Messages */}
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex items-start gap-3 ${
                          message.type === 'user' ? 'justify-end' : ''
                        }`}
                      >
                        {message.type === 'assistant' && (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/[0.07] text-primary">
                            <Bot className="h-4 w-4" />
                          </div>
                        )}
                        <div className={`min-w-0 flex-1 ${message.type === 'user' ? 'flex justify-end' : ''}`}>
                          <div className={message.type === 'user' ? 'max-w-[85%]' : ''}>
                          <div
                            className={`rounded-lg px-4 py-3 text-sm leading-6 ${
                              message.type === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'border border-border bg-muted/50 text-foreground'
                            }`}
                          >
                            <p style={{ whiteSpace: 'pre-wrap' }}>{message.content}</p>
                            {message.isTyping && (
                              <div className="mt-2 flex gap-1" aria-hidden="true">
                                <span className="animate-bounce text-muted-foreground">▪</span>
                                <span className="animate-bounce text-muted-foreground delay-100">▪</span>
                                <span className="animate-bounce text-muted-foreground delay-200">▪</span>
                              </div>
                            )}
                          </div>
                          {message.type === 'assistant' && !message.isTyping && messages[messages.length - 1].id === message.id && (
                            <SuggestedQuestions />
                          )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="flex gap-2 border-t border-border bg-muted/30 p-4 sm:px-6">
                  <Input
                    placeholder="Type a question or pick a sample one..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !isTyping) {
                        handleSendMessage(inputValue);
                      }
                    }}
                    disabled={isTyping}
                    aria-label="Message"
                  />
                  <Button
                    onClick={() => handleSendMessage(inputValue)}
                    disabled={isTyping || !inputValue.trim()}
                    size="icon"
                    className="shrink-0"
                    aria-label="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
