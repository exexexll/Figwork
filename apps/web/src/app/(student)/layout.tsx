'use client';

import { useEffect, useState } from 'react';
import { useAuth, UserButton, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { 
  LayoutDashboard, 
  Briefcase, 
  Clock, 
  DollarSign, 
  User, 
  AlertCircle,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { NotificationBell } from '@/components/marketplace/NotificationBell';
import { ToastProvider } from '@/components/ui/toast';
import { RealtimeToasts } from '@/components/marketplace/RealtimeToasts';

const navItems = [
  { href: '/student', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/student/tasks', label: 'Available Tasks', icon: Briefcase },
  { href: '/student/executions', label: 'My Work', icon: Clock },
  { href: '/student/earnings', label: 'Earnings', icon: DollarSign },
  { href: '/student/disputes', label: 'Disputes', icon: AlertTriangle },
  { href: '/student/profile', label: 'Profile & Files', icon: User },
];

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, userId, getToken } = useAuth();
  const [profileChecked, setProfileChecked] = useState(false);
  const [onboardingIncomplete, setOnboardingIncomplete] = useState(false);

  // Role guard: verify this user is a student, not a company
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (pathname.includes('/onboard')) {
      // On onboard page — check if they're a company trying to access student area
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'company') {
        router.replace('/dashboard');
        return;
      }
      setProfileChecked(true);
      return;
    }

    async function checkProfile() {
      // Fast check
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'company') {
        router.replace('/dashboard');
        return;
      }

      try {
        const token = await getToken();
        if (!token) return;
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        // Check student profile
        const res = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          localStorage.setItem('figwork_role', 'student');
          
          // Use onboarding status API for dynamic check (includes legal agreements)
          try {
            const statusRes = await fetch(`${API_URL}/api/onboarding-config/my-status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (statusRes.ok) {
              const status = await statusRes.json();
              // Show banner if any required onboarding steps are incomplete
              setOnboardingIncomplete(!status.canAccept);
            } else {
              // Fallback: check basic profile fields
              const profile = await res.json();
              const needsOnboarding = !profile.kycStatus || profile.kycStatus === 'pending' ||
                !profile.stripeConnectStatus || profile.stripeConnectStatus === 'pending';
              setOnboardingIncomplete(needsOnboarding);
            }
          } catch {
            // If status API fails, fall back to basic check
            const profile = await res.clone().json().catch(() => ({}));
            const needsOnboarding = !profile.kycStatus || profile.kycStatus === 'pending' ||
              !profile.stripeConnectStatus || profile.stripeConnectStatus === 'pending';
            setOnboardingIncomplete(needsOnboarding);
          }
          setProfileChecked(true);
          return;
        }

        // No student profile — check if they're a company
        const companyRes = await fetch(`${API_URL}/api/companies/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (companyRes?.ok) {
          // They're a company, not a student — redirect
          localStorage.setItem('figwork_role', 'company');
          router.replace('/dashboard');
          return;
        }

        // Neither profile — redirect to student onboarding
        // (they came from "Become a Contractor" flow)
        router.replace('/student/onboard');
      } catch {
        setProfileChecked(true);
      }
    }
    checkProfile();
  }, [isLoaded, userId, pathname, getToken, router]);

  // Connect to marketplace WebSocket for real-time notifications
  useEffect(() => {
    if (isLoaded && userId && profileChecked) {
      import('@/lib/marketplace-socket').then(({ marketplaceSocket }) => {
        marketplaceSocket.connect({
          userType: 'student',
          userId,
        });
      });

      return () => {
        import('@/lib/marketplace-socket').then(({ marketplaceSocket }) => {
          marketplaceSocket.disconnect();
        });
      };
    }
  }, [isLoaded, userId, profileChecked]);

  if (!isLoaded || (!profileChecked && !pathname.includes('/onboard'))) {
    return (
      <div className="min-h-screen bg-background-secondary flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <>
      <SignedIn>
        <ToastProvider>
        <div className="min-h-screen bg-background-secondary">
          {/* Ambient gradient background */}
          <div
            className="fixed inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at top left, rgba(196,181,253,0.15) 0%, transparent 40%)',
            }}
          />

          {/* Onboarding Reminder — soft nudge, not blocking */}
          {onboardingIncomplete && !pathname.includes('/onboard') && (
            <div className="relative z-20 bg-[#f3f0f8] border-b border-[#e8e4f0] px-6 py-2">
              <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#6b6b80] text-xs">
                  <AlertCircle className="w-3.5 h-3.5 text-[#a78bfa]" />
                  <span>Complete your profile for faster payouts and higher tier access</span>
                </div>
                <Link
                  href="/student/onboard"
                  className="flex items-center gap-1 text-[#a78bfa] text-xs font-medium hover:text-[#8b5cf6]"
                >
                  Finish Setup <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Header */}
          <header className="relative z-10 border-b border-border-light bg-white/60 backdrop-blur-sm sticky top-0">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
              <div className="flex items-center gap-8">
                {/* Logo */}
                <Link href="/student" className="flex items-center gap-2">
                  <img src="/iconfigwork.png" alt="Figwork" className="h-8 w-8" />
                  <span className="text-xl font-semibold text-text-primary">figwork</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary-light/20 text-primary-dark">
                    Student
                  </span>
                </Link>
                
                {/* Desktop Navigation */}
                <nav className="hidden md:flex items-center gap-1">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href || 
                      (item.href !== '/student' && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                          isActive
                            ? 'bg-primary-light/20 text-primary-dark'
                            : 'text-text-secondary hover:text-text-primary hover:bg-white/60'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>
              
              <div className="flex items-center gap-4">
                <NotificationBell />
                <Link
                  href="/student/pow"
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                    pathname.startsWith('/student/pow')
                      ? 'bg-primary-light/20 text-primary-dark'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/60'
                  )}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">POW</span>
                </Link>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox: 'h-9 w-9',
                    },
                  }}
                />
              </div>
            </div>
          </header>

          {/* Mobile Navigation */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border-light bg-white/80 backdrop-blur-sm">
            <div className="flex items-center justify-around py-2 px-1">
              {navItems.slice(0, 4).map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== '/student' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors',
                      isActive ? 'text-primary-dark' : 'text-text-muted'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          {/* Main Content */}
          <main className="relative pb-20 md:pb-0">
            {children}
          </main>

          <RealtimeToasts />
        </div>
        </ToastProvider>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
