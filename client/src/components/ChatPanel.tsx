import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, User, Send, Sparkles, Terminal } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export const ChatPanel = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Initialize with welcome message
  useEffect(() => {
    const welcomeMessage: Message = {
      id: '1',
      type: 'assistant',
      content: "Hi! I've successfully generated your CI/CD configuration. Here are some key points about your setup:\n\n• Your Dockerfile uses multi-stage builds for optimization\n• GitHub Actions will run tests on every PR\n• Automatic deployment to production on main branch\n• Environment variables are properly configured\n\nDo you have any questions about the generated files?",
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }, []);

  const mockResponses = [
    "Great question! The Dockerfile uses multi-stage builds to keep the final image size small while ensuring all dependencies are properly installed.",
    "The GitHub Actions workflow includes automated testing, linting, and deployment. It will only deploy to production when tests pass.",
    "Make sure to add your Docker Hub credentials to GitHub Secrets before pushing to the main branch.",
    "The .env.example file contains all the environment variables you'll need. Copy it to .env and fill in your actual values.",
    "For production deployment, I recommend using a cloud provider like AWS, Google Cloud, or Azure for better scalability.",
    "You can customize the workflow by modifying the .github/workflows/ci-cd.yml file according to your specific needs.",
  ];

  const sendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: randomResponse,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Card className="flex h-[600px] flex-col border-border bg-card shadow-sm">
      <CardHeader className="border-b border-border p-0">
        <div className="flex items-center justify-between border-b border-background/15 terminal-surface px-4 py-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-background/70" />
            <span className="font-mono text-xs text-background/75">assistant-session.log</span>
          </div>
          <span className="font-mono text-[11px] text-background/50">interactive</span>
        </div>
        <CardTitle className="flex items-center gap-2 px-4 py-4 text-lg">
          <Bot className="h-5 w-5 text-primary" />
          AI Assistant
          <Sparkles className="h-4 w-4 text-status-warning" />
        </CardTitle>
      </CardHeader>
      
      <CardContent className="flex flex-1 flex-col p-0">
        <ScrollArea className="scrollbar-slim terminal-surface flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.type === 'assistant' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/10">
                    <Bot className="h-4 w-4 text-background/80" />
                  </div>
                )}
                
                <div
                  className={`max-w-[80%] p-3 rounded-lg ${
                    message.type === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background/10 text-background/90'
                  }`}
                >
                  <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed">{message.content}</p>
                  <span className={`mt-1 block font-mono text-xs ${
                    message.type === 'user' ? 'text-primary-foreground/70' : 'text-background/55'
                  }`}>
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                
                {message.type === 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/10">
                    <User className="h-4 w-4 text-background/70" />
                  </div>
                )}
              </div>
            ))}
            
            {isTyping && (
              <div className="flex gap-3 justify-start">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background/10">
                  <Bot className="h-4 w-4 text-background/80" />
                </div>
                <div className="rounded-lg bg-background/10 p-3">
                  <div className="flex space-x-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-background/50"></div>
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-background/50"
                      style={{ animationDelay: '0.1s' }}
                    ></div>
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-background/50"
                      style={{ animationDelay: '0.2s' }}
                    ></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        
        <div className="border-t border-border bg-card p-4">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask about your CI/CD setup..."
              className="flex-1"
              disabled={isTyping}
            />
            <Button 
              onClick={sendMessage} 
              disabled={!inputValue.trim() || isTyping}
              size="icon"
              className=""
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
