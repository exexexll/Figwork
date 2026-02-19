'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Global error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background-secondary flex items-center justify-center p-4">
      {/* Ambient background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.15) 0%, transparent 40%)',
        }}
      />

      <div className="relative z-10 max-w-md text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
          style={{ background: 'rgba(239, 68, 68, 0.1)' }}
        >
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>

        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Something went wrong
        </h1>
        <p className="text-text-secondary mb-6">
          An unexpected error occurred. Please try again or contact support if the
          problem persists.
        </p>

        <div className="flex gap-4 justify-center">
          <Button onClick={() => reset()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.href = '/dashboard'}>
            Go to Dashboard
          </Button>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 p-4 bg-red-50 rounded-lg text-left">
            <p className="text-xs font-mono text-red-800 break-all">
              {error.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
