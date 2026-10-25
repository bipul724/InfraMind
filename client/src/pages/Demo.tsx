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
      content: `I've analyzed the repository at ${repoUrl}. I can help you with:

• Understanding the codebase structure
• Generating deployment configurations
• Setting up CI/CD pipelines
• Implementing security best practices
• Optimizing infrastructure

What would you like to know about your repository?`
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
    
    for (let word of words) {
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
      response = `Based on my analysis of ${repoUrl}, your project uses:

• Frontend: React with TypeScript
• State Management: Redux
• Styling: Tailwind CSS
• Testing: Jest and React Testing Library
• Build Tool: Vite

Would you like me to generate optimized configurations for any of these technologies?`;
    } else if (normalizedQuestion.includes('pipeline') || normalizedQuestion.includes('ci/cd')) {
      response = `I'll help you set up a CI/CD pipeline for your React application. Here's what I recommend:

1. GitHub Actions workflow with:
   • Node.js 18 setup
   • Dependency caching
   • ESLint checks
   • Unit tests with Jest
   • Build verification
   • Automated deployments

Would you like me to generate this configuration for you?`;
    } else if (normalizedQuestion.includes('security') || normalizedQuestion.includes('secure')) {
      response = `I've analyzed your repository's security profile. Here are my recommendations:

• Update dependencies with known vulnerabilities
• Implement environment variable validation
• Add security headers to your API responses
• Enable strict TypeScript checks
• Implement rate limiting
• Add CORS configuration

Would you like me to help you implement any of these security measures?`;
    } else if (normalizedQuestion.includes('docker') || normalizedQuestion.includes('containerize')) {
      response = `I'll help you containerize your application. Based on your tech stack, here's the recommended Dockerfile setup:

• Multi-stage build for optimal image size
• Node 18 Alpine base image
• Proper caching of dependencies
• Security best practices
• Environment configuration
• Health check implementation

Would you like me to generate this Dockerfile for you?`;
    } else if (normalizedQuestion.includes('architecture') || normalizedQuestion.includes('structure')) {
      response = `I've analyzed the architecture of your repository. Here's the breakdown:

📁 Project Structure:
• /src - Main source code
  • /components - React components
  • /hooks - Custom hooks
  • /services - API services
  • /utils - Helper functions
• /tests - Test suites
• /public - Static assets

🔄 Data Flow:
• Redux for state management
• API service layer for backend communication
• Custom hooks for business logic
• Component composition pattern

Would you like me to suggest any architectural improvements?`;
    } else if (normalizedQuestion.includes('performance') || normalizedQuestion.includes('optimize')) {
      response = `I've identified several opportunities to optimize your application:

🚀 Performance Improvements:
• Implement React.memo() for expensive components
• Add Suspense boundaries for code-splitting
• Optimize image loading with next/image
• Implement service worker for caching
• Add Redis caching for API responses

📊 Current Metrics:
• First Load JS: ~2.8MB
• Lighthouse Score: 76
• Time to Interactive: 3.2s

Would you like me to help implement any of these optimizations?`;
    } else if (normalizedQuestion.includes('test') || normalizedQuestion.includes('testing')) {
      response = `I've analyzed your testing setup. Here's what I found and recommend:

🧪 Current Test Coverage:
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
      response = `I've analyzed your package.json and found some opportunities:

📦 Dependencies Analysis:
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
      response = `Based on your repository structure, here are my deployment recommendations:

🚀 Deployment Options:
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
      response = `I understand you're asking about ${message}. Based on your repository at ${repoUrl}, I can help you with:

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
    <div className="flex flex-wrap gap-2 mt-4">
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
          onClick={() => handleSendMessage(question)}
          disabled={isTyping}
        >
          {question}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Demo Mode Banner */}
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 py-2">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-yellow-700">
              <Terminal className="h-4 w-4" />
              <span className="text-sm font-medium">⚡ Running in Demo Mode</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/auth')}
              className="text-yellow-700 border-yellow-500/30 hover:bg-yellow-500/10"
            >
              Switch to Full Version
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Repository Input Section */}
          {!hasAnalyzed && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Analyze Repository</CardTitle>
                <CardDescription>
                  Enter your GitHub repository URL to start the analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex space-x-2">
                  <div className="relative flex-1">
                    <Github className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-4 w-4" />
                    <Input
                      placeholder="https://github.com/username/repo"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      className="pl-10"
                      disabled={isAnalyzing}
                    />
                  </div>
                  <Button
                    onClick={simulateRepoAnalysis}
                    disabled={isAnalyzing || !repoUrl}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      'Analyze'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chat Interface */}
          {hasAnalyzed && (
            <Card className="border-2">
              <CardContent className="p-6">
                {/* Messages Area */}
                <ScrollArea className="h-[500px] pr-4" ref={chatContainerRef}>
                  <div className="space-y-4">
                    {/* Chat Messages */}
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex items-start space-x-3 ${
                          message.type === 'user' ? 'justify-end' : ''
                        }`}
                      >
                        {message.type === 'assistant' && (
                          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0">
                            <Bot className="h-5 w-5 text-white" />
                          </div>
                        )}
                        <div className={`flex-1 ${message.type === 'user' ? 'text-right' : ''}`}>
                          <div
                            className={`rounded-lg p-4 shadow-sm ${
                              message.type === 'user'
                                ? 'bg-slate-900 text-white ml-12'
                                : 'bg-white text-slate-700'
                            }`}
                          >
                            <p style={{ whiteSpace: 'pre-wrap' }}>{message.content}</p>
                            {message.isTyping && (
                              <div className="mt-2">
                                <span className="animate-pulse">▪</span>
                                <span className="animate-pulse delay-100">▪</span>
                                <span className="animate-pulse delay-200">▪</span>
                              </div>
                            )}
                          </div>
                          {message.type === 'assistant' && !message.isTyping && messages[messages.length - 1].id === message.id && (
                            <SuggestedQuestions />
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="mt-4 flex space-x-2">
                  <Input
                    placeholder="Ask me anything about your repository..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !isTyping) {
                        handleSendMessage(inputValue);
                      }
                    }}
                    disabled={isTyping}
                  />
                  <Button
                    onClick={() => handleSendMessage(inputValue)}
                    disabled={isTyping || !inputValue.trim()}
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