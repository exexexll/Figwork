'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin section error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div
          className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center"
          style={{ background: 'rgba(239, 68, 68, 0.08)' }}
        >
          <AlertCircle className="w-7 h-7 text-red-500" />
        </div>

        <h2 className="text-xl font-semibold text-[#1f1f2e] mb-2">Admin Error</h2>
        <p className="text-[#6b6b80] text-sm mb-6">
          An error occurred in the admin panel. Please try again or go back to the overview.
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--gradient-fig)' }}
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-[#6b6b80] bg-white border border-[#e8e4f0] hover:border-[#c4b5fd] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Admin Home
          </Link>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <div className="mt-6 p-3 bg-red-50 rounded-lg text-left">
            <p className="text-xs font-mono text-red-700 break-all">{error.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
