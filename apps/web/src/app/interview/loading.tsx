import { Loader2 } from 'lucide-react';

export default function InterviewLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Ambient gradient background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.2) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.2) 0%, transparent 50%)',
        }}
      />

      <div className="relative z-10 text-center">
        <div className="mb-6">
          <img
            src="/iconfigwork.png"
            alt="Figwork"
            className="w-16 h-16 mx-auto animate-pulse"
          />
        </div>

        <Loader2 className="w-8 h-8 mx-auto text-primary animate-spin" />

        <p className="text-text-secondary mt-4">Loading interview...</p>
      </div>
    </div>
  );
}
