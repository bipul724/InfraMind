import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";

export const NotFound = () => {
  const location = useLocation();

  // Development only (like the error boundary): an unknown path is not an app error, so
  // production builds log nothing
  useEffect(() => {
    if (import.meta.env.DEV) console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-12 text-center shadow-raised sm:px-10">
        <h1 className="mb-3 font-mono text-6xl font-semibold tracking-tight text-primary">404</h1>
        <p className="mb-8 text-lg text-muted-foreground">Oops! Page not found</p>
        <a href="/" className={buttonVariants()}>
          Return to Home
        </a>
      </div>
    </div>
  );
};
