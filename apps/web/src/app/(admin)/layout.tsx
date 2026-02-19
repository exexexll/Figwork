'use client';

import { useAuth, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  BarChart3,
  Settings,
  Shield,
  FileText,
  Menu,
  X,
} from 'lucide-react';

// Admin user IDs - should match backend
const ADMIN_USER_IDS = ['user_admin_1', 'user_admin_2'];

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/disputes', label: 'Disputes', icon: AlertTriangle },
  { href: '/admin/students', label: 'Students', icon: Users },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/legal-onboarding', label: 'Legal Onboarding', icon: FileText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, isLoaded } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (isLoaded) {
      // In production, check against backend or Clerk metadata
      // For now, allow any authenticated user (for development)
      setIsAdmin(true);
      // For production:
      // setIsAdmin(ADMIN_USER_IDS.includes(userId || ''));
    }
  }, [isLoaded, userId]);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!isLoaded || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-secondary">
        <div className="card p-8 text-center max-w-md">
          <Shield className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <h1 className="text-xl font-semibold text-text-primary mb-2">Access Denied</h1>
          <p className="text-text-secondary mb-4">
            You don&apos;t have permission to access the admin dashboard.
          </p>
          <Link href="/" className="btn-primary px-6 py-2">
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
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
            <Link href="/admin" className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary" />
              <span className="text-xl font-semibold text-text-primary hidden sm:inline">Admin</span>
              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded">
                ADMIN
              </span>
            </Link>
          </div>

          {/* User menu */}
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'h-9 w-9',
              },
            }}
          />
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
                (item.href !== '/admin' && pathname.startsWith(item.href));
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
    </div>
  );
}
