'use client';

import { useEffect, useState } from 'react';
import { useAuth, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Home, Briefcase, CreditCard, ClipboardCheck, AlertTriangle, Settings, Menu, X } from 'lucide-react';
import { NotificationBell } from '@/components/marketplace/NotificationBell';
import { ToastProvider } from '@/components/ui/toast';
import { RealtimeToasts } from '@/components/marketplace/RealtimeToasts';

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/dashboard/workunits', label: 'Work Units', icon: Briefcase },
  { href: '/dashboard/review-queue', label: 'Review Queue', icon: ClipboardCheck },
  { href: '/dashboard/disputes', label: 'Disputes', icon: AlertTriangle },
  { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, userId, getToken } = useAuth();
  const [roleChecked, setRoleChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Role guard: if user is a student, redirect to /student
  useEffect(() => {
    if (!isLoaded || !userId) return;

    // Skip check on onboard page (new users need access)
    if (pathname.includes('/onboard')) {
      setRoleChecked(true);
      return;
    }

    async function checkRole() {
      // Fast check: localStorage
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'student') {
        router.replace('/student');
        return;
      }
      if (savedRole === 'company') {
        setRoleChecked(true);
        return;
      }

      // No saved role — check backend
      try {
        const token = await getToken();
        if (!token) { setRoleChecked(true); return; }

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        // Check if they're a student
        const studentRes = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (studentRes?.ok) {
          // They're a student — redirect out
          localStorage.setItem('figwork_role', 'student');
          router.replace('/student');
          return;
        }

        // Not a student — they belong here (company or new user)
        localStorage.setItem('figwork_role', 'company');
        setRoleChecked(true);
      } catch {
        setRoleChecked(true);
      }
    }

    checkRole();
  }, [isLoaded, userId, pathname, getToken, router]);

  // Connect to marketplace WebSocket
  useEffect(() => {
    if (isLoaded && userId && roleChecked) {
      import('@/lib/marketplace-socket').then(({ marketplaceSocket }) => {
        marketplaceSocket.connect({
          userType: 'company',
          userId,
        });
      });

      return () => {
        import('@/lib/marketplace-socket').then(({ marketplaceSocket }) => {
          marketplaceSocket.disconnect();
        });
      };
    }
  }, [isLoaded, userId, roleChecked]);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Show loading until role is verified
  if (!isLoaded || !roleChecked) {
    return (
      <div className="min-h-screen bg-background-secondary flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
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

      {/* Header */}
      <header className="relative z-30 border-b border-border-light bg-white/60 backdrop-blur-sm sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile menu toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-white/60 transition-colors"
            >
              {sidebarOpen ? (
                <X className="w-5 h-5 text-text-secondary" />
              ) : (
                <Menu className="w-5 h-5 text-text-secondary" />
              )}
            </button>

            {/* Logo */}
            <Link href="/dashboard" className="flex items-center gap-2">
              <img src="/iconfigwork.png" alt="Figwork" className="h-8 w-8" />
              <span className="text-xl font-semibold text-text-primary hidden sm:inline">figwork</span>
            </Link>
          </div>

          {/* Notifications + User menu */}
          <div className="flex items-center gap-3">
            <NotificationBell />
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

      <div className="relative flex">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — fixed on mobile, static on desktop */}
        <aside
          className={cn(
            'fixed md:sticky top-16 left-0 z-20 h-[calc(100vh-64px)] w-56 border-r border-border-light bg-white/95 md:bg-white/40 backdrop-blur-sm transition-transform duration-200 md:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
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
        </aside>

        {/* Main content */}
        <main className="flex-1 min-h-[calc(100vh-64px)] w-full md:w-auto">
          {children}
        </main>
      </div>

      <RealtimeToasts />
    </div>
    </ToastProvider>
  );
}
