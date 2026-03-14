'use client';

import { useEffect, useState } from 'react';
import { useAuth, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import {
  Settings,
  MessageSquare,
  Briefcase,
  CreditCard,
  FileText,
  Clock3,
  AlertTriangle,
  Menu,
  X,
} from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded, userId, getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [roleChecked, setRoleChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { href: '/dashboard', label: 'Chat', icon: MessageSquare },
    { href: '/dashboard/messages', label: 'Messages', icon: MessageSquare },
    { href: '/dashboard/workunits', label: 'Work Units', icon: Briefcase },
    { href: '/dashboard/workunits/workflow', label: 'Workflow', icon: Settings },
    { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
    { href: '/dashboard/sessions', label: 'Sessions', icon: Clock3 },
    { href: '/dashboard/review-queue', label: 'Review Queue', icon: FileText },
    { href: '/dashboard/disputes', label: 'Disputes', icon: AlertTriangle },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ];

  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (pathname.includes('/onboard') || pathname.includes('/settings')) {
      setRoleChecked(true);
      return;
    }

    async function checkRole() {
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'student') { router.replace('/student'); return; }
      if (savedRole === 'company') { setRoleChecked(true); return; }

      try {
        const token = await getToken();
        if (!token) { setRoleChecked(true); return; }
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const studentRes = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (studentRes?.ok) {
          localStorage.setItem('figwork_role', 'student');
          router.replace('/student');
          return;
        }
        localStorage.setItem('figwork_role', 'company');
        setRoleChecked(true);
      } catch { setRoleChecked(true); }
    }
    checkRole();
  }, [isLoaded, userId, pathname, getToken, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!isLoaded || !roleChecked) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7fc] flex flex-col relative">
      {/* Ambient color smudges */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 -right-10 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 50%)' }} />
        <div className="absolute bottom-20 -left-20 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(244,114,182,0.12) 0%, transparent 50%)' }} />
        <div className="absolute top-[40%] left-[20%] w-[300px] h-[300px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.1) 0%, transparent 50%)' }} />
        <div className="absolute bottom-[20%] right-[25%] w-[350px] h-[350px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.08) 0%, transparent 50%)' }} />
        <div className="absolute top-[15%] right-[40%] w-[200px] h-[200px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.07) 0%, transparent 50%)' }} />
        <div className="absolute bottom-[40%] left-[45%] w-[250px] h-[250px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 50%)' }} />
      </div>

      {/* Header */}
      <header className="h-12 border-b border-slate-200/50 bg-white/70 backdrop-blur-sm flex items-center justify-between px-3 md:px-5 flex-shrink-0 relative z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 rounded-lg hover:bg-white/60 transition-colors"
          >
            {sidebarOpen ? <X className="w-4 h-4 text-slate-500" /> : <Menu className="w-4 h-4 text-slate-500" />}
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <img src="/iconfigwork.png" alt="" className="h-6 w-6" />
            <span className="text-sm font-medium text-slate-800">figwork</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="text-slate-400 hover:text-slate-600">
            <Settings className="w-4 h-4" />
          </Link>
          <UserButton appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />
        </div>
      </header>

      <div className="relative flex flex-1 min-h-0 z-20">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/20 z-10 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={cn(
            'fixed md:sticky top-12 left-0 z-20 h-[calc(100vh-48px)] w-60 border-r border-slate-200/60 bg-white/88 backdrop-blur-md transition-transform duration-200 md:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="px-4 pt-4 pb-2">
            <span className="text-[11px] font-medium tracking-wide uppercase text-slate-400">Workspace</span>
          </div>
          <nav className="px-3 space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                    active
                      ? 'bg-violet-50 text-violet-700 font-medium border border-violet-100'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 min-h-0 overflow-hidden relative z-10 md:ml-0">
          {children}
        </main>
      </div>
    </div>
  );
}
