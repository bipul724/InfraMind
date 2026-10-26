import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, 
  AlertCircle, 
  ArrowLeft, 
  Github, 
  Mail,
  Terminal,
  Eye,
  EyeOff,
  Lock,
  Shield
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface SignInFormData {
  email: string;
  password: string;
}

interface SignUpFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, register } = useAuth();
  
  // Determine initial tab from URL params
  const initialTab = searchParams.get('sign-up') === 'true' ? 'signup' : 'signin';
  const [activeTab, setActiveTab] = useState(initialTab);
  
  // Form states
  const [signInForm, setSignInForm] = useState<SignInFormData>({
    email: '',
    password: ''
  });
  
  const [signUpForm, setSignUpForm] = useState<SignUpFormData>({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  
  // UI states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Handle sign in
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!signInForm.email || !signInForm.password) {
        throw new Error('Please fill in all fields');
      }

      await login.withEmail(signInForm.email, signInForm.password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  // Handle sign up
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!signUpForm.name || !signUpForm.email || !signUpForm.password) {
        throw new Error('Please fill in all fields');
      }

      if (signUpForm.password !== signUpForm.confirmPassword) {
        throw new Error('Passwords do not match');
      }

      if (signUpForm.password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      await register(signUpForm.email, signUpForm.password, signUpForm.name);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  // Handle OAuth login
  const handleOAuthLogin = async (provider: 'google' | 'github') => {
    setLoading(true);
    setError('');

    try {
      if (provider === 'google') {
        await login.withGoogle();
      } else {
        await login.withGitHub();
      }
      // OAuth will redirect, so no need to navigate manually
    } catch (err: any) {
      setError(err.message || `Failed to sign in with ${provider}`);
      setLoading(false);
    }
  };

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setError('');
    
    // Update URL without causing navigation
    const newSearchParams = new URLSearchParams(searchParams);
    if (value === 'signup') {
      newSearchParams.set('sign-up', 'true');
    } else {
      newSearchParams.delete('sign-up');
    }
    
    const newUrl = `${window.location.pathname}?${newSearchParams.toString()}`;
    window.history.replaceState({}, '', newUrl);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between p-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Home</span>
        </Button>
        
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-semibold tracking-tight">
              InfraMind
            </span>
            <span className="text-xs font-medium text-muted-foreground">Powered by Supabase</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[450px] relative">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="text-center pb-4 space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight">
                {activeTab === 'signin' ? 'Welcome back!' : 'Create your account'}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {activeTab === 'signin' 
                  ? 'Sign in to access your multi-agent AI dashboard powered by cutting-edge technology'
                  : 'Join thousands of developers automating DevOps with AI agents'
                }
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger 
                    value="signin"
                    className="data-[state=active]:bg-background data-[state=active]:text-foreground"
                  >
                    Sign In
                  </TabsTrigger>
                  <TabsTrigger 
                    value="signup"
                    className="data-[state=active]:bg-background data-[state=active]:text-foreground"
                  >
                    Create Account
                  </TabsTrigger>
                </TabsList>

                {/* Error Alert */}
                {error && (
                  <Alert variant="destructive" className="mt-4 animate-slideDown">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Sign In Form */}
                <TabsContent value="signin" className="space-y-4 mt-4">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-email"
                          type="email"
                          value={signInForm.email}
                          onChange={(e) => setSignInForm({ ...signInForm, email: e.target.value })}
                          className="pl-10"
                          placeholder="Enter your email"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="signin-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signin-password"
                          type={showPassword ? "text" : "password"}
                          value={signInForm.password}
                          onChange={(e) => setSignInForm({ ...signInForm, password: e.target.value })}
                          className="pl-10 pr-10"
                          placeholder="Enter your password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        'Sign In'
                      )}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button 
                        type="button"
                        variant="outline"
                        onClick={() => handleOAuthLogin('github')}
                        disabled={loading}
                      >
                        <Github className="mr-2 h-4 w-4" />
                        GitHub
                      </Button>
                      <Button 
                        type="button"
                        variant="outline"
                        onClick={() => handleOAuthLogin('google')}
                        disabled={loading}
                      >
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        Google
                      </Button>
                    </div>
                  </form>
                </TabsContent>

                {/* Sign Up Form */}
                <TabsContent value="signup" className="space-y-4 mt-4">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-name">Full Name</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-name"
                          type="text"
                          value={signUpForm.name}
                          onChange={(e) => setSignUpForm({ ...signUpForm, name: e.target.value })}
                          className="pl-10"
                          placeholder="Enter your full name"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-email">Email</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-email"
                          type="email"
                          value={signUpForm.email}
                          onChange={(e) => setSignUpForm({ ...signUpForm, email: e.target.value })}
                          className="pl-10"
                          placeholder="Enter your email"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password">Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-password"
                          type={showPassword ? "text" : "password"}
                          value={signUpForm.password}
                          onChange={(e) => setSignUpForm({ ...signUpForm, password: e.target.value })}
                          className="pl-10 pr-10"
                          placeholder="Create a password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="signup-confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          value={signUpForm.confirmPassword}
                          onChange={(e) => setSignUpForm({ ...signUpForm, confirmPassword: e.target.value })}
                          className="pl-10 pr-10"
                          placeholder="Confirm your password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        'Create Account'
                      )}
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button 
                        type="button"
                        variant="outline"
                        onClick={() => handleOAuthLogin('github')}
                        disabled={loading}
                      >
                        <Github className="mr-2 h-4 w-4" />
                        GitHub
                      </Button>
                      <Button 
                        type="button"
                        variant="outline"
                        onClick={() => handleOAuthLogin('google')}
                        disabled={loading}
                      >
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        Google
                      </Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>

            <CardFooter className="flex flex-col items-center justify-center pt-0 pb-6">
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                <span>Secured by</span>
                <a 
                  href="https://supabase.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  Supabase
                </a>
              </div>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
};
