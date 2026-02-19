'use client';

import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-background-secondary flex items-center justify-center p-4">
      {/* Ambient background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.2) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(254,243,199,0.2) 0%, transparent 50%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src="/iconfigwork.png" alt="Figwork" className="h-12 w-12" />
          <span className="ml-3 text-2xl font-semibold text-text-primary">figwork</span>
        </div>

        {/* Clerk Sign In */}
        <SignIn
          appearance={{
            elements: {
              formButtonPrimary: 'bg-gradient-fig hover:shadow-glow',
              card: 'bg-white/80 backdrop-blur-sm border border-border-light shadow-soft-lg rounded-lg',
              headerTitle: 'text-text-primary',
              headerSubtitle: 'text-text-secondary',
              formFieldLabel: 'text-text-primary',
              formFieldInput: 'border-border focus:border-primary-light rounded-md',
              footerActionLink: 'text-primary hover:text-primary-dark',
            },
          }}
        />
      </div>
    </div>
  );
}
