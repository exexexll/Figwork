'use client';

import { useEffect, useState, useRef } from 'react';
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
  FolderOpen,
  Menu,
  Sparkles,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { NotificationBell } from '@/components/marketplace/NotificationBell';
import { ToastProvider } from '@/components/ui/toast';
import { RealtimeToasts } from '@/components/marketplace/RealtimeToasts';

/* ── Accent color ── */
const ACCENT = '#a2a3fc';

const navItems = [
  { href: '/student', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/student/messages', label: 'Messages', icon: MessageSquare },
  { href: '/student/tasks', label: 'Available Tasks', icon: Briefcase },
  { href: '/student/quiz', label: 'Quiz', icon: BookOpen },
  { href: '/student/executions', label: 'My Work', icon: Clock },
  { href: '/student/earnings', label: 'Earnings', icon: DollarSign },
  { href: '/student/disputes', label: 'Disputes', icon: AlertTriangle },
  { href: '/student/profile', label: 'Profile', icon: User },
  { href: '/student/library', label: 'Library', icon: FolderOpen },
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

  /* ── Sidebar state ── */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Click-outside to close sidebar
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sidebarOpen]);

  // Role guard: verify this user is a student, not a company
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (pathname.includes('/onboard')) {
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'company') {
        router.replace('/dashboard');
        return;
      }
      setProfileChecked(true);
      return;
    }

    async function checkProfile() {
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'company') {
        router.replace('/dashboard');
        return;
      }

      try {
        const token = await getToken();
        if (!token) return;
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        const res = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          localStorage.setItem('figwork_role', 'student');
          
          try {
            const statusRes = await fetch(`${API_URL}/api/onboarding-config/my-status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (statusRes.ok) {
              const status = await statusRes.json();
              setOnboardingIncomplete(!status.canAccept);
            } else {
              const profile = await res.json();
              const needsOnboarding =
                !profile.kycStatus ||
                profile.kycStatus === 'pending' ||
                !profile.stripeConnectStatus ||
                profile.stripeConnectStatus === 'pending';
              setOnboardingIncomplete(needsOnboarding);
            }
          } catch {
            const profile = await res.clone().json().catch(() => ({}));
            const needsOnboarding =
              !profile.kycStatus ||
              profile.kycStatus === 'pending' ||
              !profile.stripeConnectStatus ||
              profile.stripeConnectStatus === 'pending';
            setOnboardingIncomplete(needsOnboarding);
          }
          setProfileChecked(true);
          return;
        }

        const companyRes = await fetch(`${API_URL}/api/companies/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (companyRes?.ok) {
          localStorage.setItem('figwork_role', 'company');
          router.replace('/dashboard');
          return;
        }

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
        marketplaceSocket.connect({ userType: 'student', userId });
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: ACCENT }} />
      </div>
    );
  }

  return (
    <>
      <SignedIn>
        <ToastProvider>
          <div className="min-h-screen flex">
            {/* ── Desktop Sidebar ── */}
            <aside
              ref={sidebarRef}
              className={cn(
                'hidden md:flex flex-col fixed top-0 left-0 h-screen z-30 bg-white border-r border-[#f0f0f5] transition-all duration-200 ease-in-out',
                sidebarOpen ? 'w-[220px]' : 'w-[56px]'
              )}
            >
              {/* Logo / toggle */}
              <div className="h-14 flex items-center px-3 border-b border-[#f0f0f5]">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[#f5f5ff] transition-colors"
                >
                  <Menu className="w-[18px] h-[18px] text-[#6b6b80]" />
                </button>
                {sidebarOpen && (
                  <Link href="/student" className="ml-2 flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                    <span className="text-base font-semibold text-[#1f1f2e]">figwork</span>
                </Link>
                )}
              </div>

              {/* Nav items */}
              <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
                  {navItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                      (item.href !== '/student' && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                      title={!sidebarOpen ? item.label : undefined}
                        className={cn(
                        'flex items-center gap-2.5 rounded-lg transition-all duration-150',
                        sidebarOpen ? 'px-3 py-2' : 'px-0 py-2 justify-center',
                          isActive
                          ? 'text-white'
                          : 'text-[#6b6b80] hover:text-[#1f1f2e] hover:bg-[#f5f5ff]'
                        )}
                      style={isActive ? { background: ACCENT } : undefined}
                      >
                      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                      {sidebarOpen && (
                        <span className="text-sm font-medium whitespace-nowrap overflow-hidden">
                        {item.label}
                        </span>
                      )}
                      </Link>
                    );
                  })}
                </nav>
            </aside>

            {/* ── Main wrapper ── */}
            <div
              className={cn(
                'flex-1 flex flex-col min-h-screen transition-all duration-200',
                'md:ml-[56px]',
                sidebarOpen && 'md:ml-[220px]'
              )}
            >
              {/* Onboarding Reminder */}
              {onboardingIncomplete && !pathname.includes('/onboard') && (
                <div className="relative z-20 bg-white border-b border-[#f0f0f5] px-6 py-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#6b6b80] text-xs">
                      <AlertCircle className="w-3.5 h-3.5" style={{ color: ACCENT }} />
                      <span>Complete your profile for faster payouts and higher tier access</span>
                    </div>
                    <Link
                      href="/student/onboard"
                      className="flex items-center gap-1 text-xs font-medium hover:opacity-80"
                      style={{ color: ACCENT }}
                    >
                      Finish Setup <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              )}

              {/* Top bar (minimal) — transparent, icons have bg pills for visibility */}
              <header className="z-10 h-14 flex items-center justify-between px-6">
                {/* Mobile hamburger + logo */}
                <div className="flex items-center gap-3 md:hidden">
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="w-8 h-8 flex items-center justify-center rounded-md bg-white/80 backdrop-blur-sm shadow-sm"
                  >
                    <Menu className="w-[18px] h-[18px] text-[#6b6b80]" />
                  </button>
                  <Link href="/student" className="flex items-center gap-1.5">
                    <img src="/iconfigwork.png" alt="Figwork" className="h-7 w-7" />
                    <span className="text-base font-semibold text-[#1f1f2e] drop-shadow-sm">figwork</span>
                  </Link>
              </div>
              
                {/* Desktop: empty left side — page content provides its own title */}
                <div className="hidden md:block" />

                {/* Right: POW + Notification + Avatar — white pill cover */}
                <div className="flex items-center gap-2 bg-white rounded-full px-3 py-1.5 shadow-sm border border-[#f0f0f5]">
                  <NotificationBell />
                <Link
                  href="/student/pow"
                  className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-sm font-medium transition-colors',
                    pathname.startsWith('/student/pow')
                        ? 'text-white'
                        : 'text-[#6b6b80] hover:text-[#1f1f2e] hover:bg-[#f5f5ff]'
                  )}
                    style={pathname.startsWith('/student/pow') ? { background: ACCENT } : undefined}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">POW</span>
                </Link>
                <UserButton
                  appearance={{
                      elements: { avatarBox: 'h-8 w-8' },
                  }}
                />
              </div>
              </header>

              {/* Main Content */}
              <main className="relative flex-1 pb-20 md:pb-0">
                {children}
              </main>

              <RealtimeToasts />
            </div>

            {/* ── Mobile Sidebar Overlay ── */}
            {sidebarOpen && (
              <div
                className="md:hidden fixed inset-0 z-40 bg-black/30"
                onClick={() => setSidebarOpen(false)}
              >
                <aside
                  className="w-[220px] h-full bg-white/40 backdrop-blur-xl border-r border-white/10 flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="h-14 flex items-center px-4 border-b border-white/10">
                    <Link href="/student" className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
                      <img src="/iconfigwork.png" alt="Figwork" className="h-7 w-7" />
                      <span className="text-base font-semibold text-[#1f1f2e]">figwork</span>
                    </Link>
                  </div>
                  <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
                    {navItems.map((item) => {
                      const isActive =
                        pathname === item.href ||
                        (item.href !== '/student' && pathname.startsWith(item.href));
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setSidebarOpen(false)}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 text-sm font-medium',
                            isActive
                              ? 'text-white'
                              : 'text-[#6b6b80] hover:text-[#1f1f2e] hover:bg-[#f5f5ff]'
                          )}
                          style={isActive ? { background: ACCENT } : undefined}
                        >
                          <Icon className="w-[18px] h-[18px]" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </aside>
              </div>
            )}

            {/* ── Mobile Bottom Tab Bar ── */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-white/40 backdrop-blur-xl">
            <div className="flex items-center justify-around py-2 px-1">
              {navItems.slice(0, 4).map((item) => {
                  const isActive =
                    pathname === item.href ||
                  (item.href !== '/student' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors',
                        isActive ? 'font-semibold' : 'text-[#a0a0b0]'
                    )}
                      style={isActive ? { color: ACCENT } : undefined}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium">{item.label.split(' ')[0]}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
        </ToastProvider>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
