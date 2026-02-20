'use client';

import { useEffect, useState } from 'react';
import { useAuth, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Settings, PanelRight } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoaded, userId, getToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [roleChecked, setRoleChecked] = useState(false);

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

  if (!isLoaded || !roleChecked) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f7fc] flex flex-col relative">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(196,181,253,0.15) 0%, transparent 60%)' }} />
        <div className="absolute bottom-0 -left-40 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,168,212,0.1) 0%, transparent 60%)' }} />
      </div>

      {/* Header */}
      <header className="h-12 border-b border-slate-200/50 bg-white/70 flex items-center justify-between px-5 flex-shrink-0 relative z-10">
        <Link href="/dashboard" className="flex items-center gap-2">
          <img src="/iconfigwork.png" alt="" className="h-6 w-6" />
          <span className="text-sm font-medium text-slate-800">figwork</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="text-slate-400 hover:text-slate-600">
            <Settings className="w-4 h-4" />
          </Link>
          <UserButton appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden relative z-10">
        {children}
      </main>
    </div>
  );
}
