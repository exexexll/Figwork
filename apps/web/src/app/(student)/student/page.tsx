'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import {
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Clock,
  LayoutGrid,
  Rows3,
  FolderOpen,
  ImageIcon,
  X,
} from 'lucide-react';
import {
  getStudentProfile,
  getStudentExecutions,
  getAvailableTasks,
  getPendingPOW,
  getStudentBalance,
  StudentProfile,
  Execution,
  WorkUnit,
  POWLog,
} from '@/lib/marketplace-api';

const ACCENT = '#a2a3fc';
const BG_STORAGE_KEY = 'figwork-dash-bg';

/* ── Placeholder tasks so the carousel is always visible during dev ── */
const PLACEHOLDER_TASKS: WorkUnit[] = [
  { id: 'ph-1', title: 'Social Media Content — Write 10 Instagram Captions', spec: 'Create engaging captions for a fitness brand targeting millennials. Each caption 50-100 words with relevant hashtags.', category: 'writing', priceInCents: 2500, deadlineHours: 48, requiredSkills: ['copywriting'], complexityScore: 2, minTier: 'novice', status: 'open' },
  { id: 'ph-2', title: 'Data Entry — Organize 500 Product Listings', spec: 'Transfer product info from PDF catalog into structured spreadsheet with name, SKU, price, dimensions, and weight.', category: 'data-entry', priceInCents: 4500, deadlineHours: 72, requiredSkills: ['data-entry'], complexityScore: 1, minTier: 'novice', status: 'open' },
  { id: 'ph-3', title: 'Logo Redesign — Modern Minimalist Style', spec: 'Redesign an outdated restaurant logo. Deliver SVG + PNG in 3 color variants. Must include icon and wordmark versions.', category: 'design', priceInCents: 8000, deadlineHours: 96, requiredSkills: ['graphic-design'], complexityScore: 4, minTier: 'pro', status: 'open' },
  { id: 'ph-4', title: 'Research Report — AI in Healthcare 2026', spec: 'Write a 2000-word report with cited sources on current AI applications in diagnostics, drug discovery, and patient care.', category: 'research', priceInCents: 6000, deadlineHours: 120, requiredSkills: ['research', 'writing'], complexityScore: 5, minTier: 'pro', status: 'open' },
  { id: 'ph-5', title: 'Video Editing — 3-Minute YouTube Intro', spec: 'Edit raw footage into a polished intro video with transitions, lower-thirds, background music, and color grading.', category: 'video', priceInCents: 5000, deadlineHours: 48, requiredSkills: ['video-editing'], complexityScore: 3, minTier: 'novice', status: 'open' },
];

/* ── Animated count-up hook ── */
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

/* ── Detect mobile (SSR-safe) ── */
function useIsMobile(breakpoint = 640) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return mobile;
}

/* ── Live clock hook ── */
function useLiveClock() {
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Format time in user's local timezone
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  // Get short timezone abbreviation
  const tzStr = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || '';

  return { timeStr, tzStr };
}

/* ── Background image hook (persisted in localStorage) ── */
function useBgImage() {
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(BG_STORAGE_KEY);
    if (saved) setBgUrl(saved);
  }, []);

  function setBackground(file: File | null) {
    if (!file) {
      localStorage.removeItem(BG_STORAGE_KEY);
      setBgUrl(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      try {
        localStorage.setItem(BG_STORAGE_KEY, dataUrl);
        setBgUrl(dataUrl);
      } catch {
        // localStorage full — try URL.createObjectURL fallback
        const objectUrl = URL.createObjectURL(file);
        setBgUrl(objectUrl);
      }
    };
    reader.readAsDataURL(file);
  }

  return { bgUrl, setBackground };
}

export default function StudentDashboard() {
  const { getToken } = useAuth();
  const isMobile = useIsMobile();
  const { timeStr, tzStr } = useLiveClock();
  const { bgUrl, setBackground } = useBgImage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [availableTasks, setAvailableTasks] = useState<WorkUnit[]>([]);
  const [pendingPOW, setPendingPOW] = useState<POWLog[]>([]);
  const [balance, setBalance] = useState<{
    pendingInCents: number;
    totalEarnedInCents: number;
    monthlyEarnedInCents: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Carousel state ── */
  const [focusIndex, setFocusIndex] = useState(0);
  const [taskView, setTaskView] = useState<'carousel' | 'list'>('carousel');

  /* ── Touch / swipe state for carousel ── */
  const touchStartX = useRef(0);
  const touchDelta = useRef(0);

  useEffect(() => {
    async function loadData() {
      try {
        const token = await getToken();
        if (!token) return;

        const [profileData, executionsData, tasksData, powData, balanceData] =
          await Promise.all([
          getStudentProfile(token),
          getStudentExecutions(token),
            getAvailableTasks(token).catch(() => ({ tasks: [], matchScores: {} })),
          getPendingPOW(token),
          getStudentBalance(token),
        ]);

        setProfile(profileData);
        setExecutions(Array.isArray(executionsData) ? executionsData : []);
        const realTasks: WorkUnit[] = tasksData?.tasks || [];
        const combined = [
          ...realTasks,
          ...PLACEHOLDER_TASKS.filter((ph) => !realTasks.some((rt) => rt.id === ph.id)),
        ];
        setAvailableTasks(combined);
        setPendingPOW(Array.isArray(powData) ? powData : []);
        setBalance(balanceData);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [getToken]);

  /* ── Carousel navigation ── */
  const shiftFocus = useCallback(
    (dir: -1 | 1) => {
      setFocusIndex((prev) => {
        const next = prev + dir;
        if (next < 0) return availableTasks.length - 1;
        if (next >= availableTasks.length) return 0;
        return next;
      });
    },
    [availableTasks.length]
  );

  /* ── Earnings math (before early returns so hooks stay stable) ── */
  const activeExecutions = executions.filter(
    (e) => !['approved', 'failed', 'cancelled'].includes(e.status)
  );
  const activeValueCents = activeExecutions.reduce(
    (sum, ex) => sum + (ex.workUnit?.priceInCents || 0),
    0
  );
  const potentialCents = (balance?.pendingInCents || 0) + activeValueCents;
  const monthlyCents = balance?.monthlyEarnedInCents || 0;

  const animatedPotential = useCountUp(potentialCents / 100);
  const animatedMonthly = useCountUp(monthlyCents / 100);

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-5xl">
        <div className="animate-pulse space-y-6">
          <div className="h-20 sm:h-24 bg-[#f5f5ff] rounded-xl" />
          <div className="h-48 sm:h-64 bg-[#f5f5ff] rounded-xl" />
          <div className="h-36 sm:h-48 bg-[#f5f5ff] rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-5xl">
        <div className="bg-white rounded-xl border border-[#f0f0f5] p-6 sm:p-8 text-center">
          <AlertCircle className="w-10 h-10 text-[#a2a3fc] mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-[#1f1f2e] mb-1">
            Error Loading Dashboard
          </h2>
          <p className="text-[#6b6b80] text-sm">{error}</p>
          {error.includes('profile') && (
            <Link
              href="/student/onboard"
              className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
              style={{ background: ACCENT }}
            >
              Complete Onboarding
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (!profile) return null;

  /* ── Color helpers for bg/no-bg mode ── */
  const hasBg = !!bgUrl;
  const clrHeading = hasBg ? 'text-white' : 'text-[#1f1f2e]';
  const clrBody = hasBg ? 'text-white/70' : 'text-[#6b6b80]';
  const clrMuted = hasBg ? 'text-white/50' : 'text-[#a0a0b0]';

  /* ── Glassmorphism helpers ── */
  const glass = hasBg
    ? 'bg-white/10 backdrop-blur-xl border-white/20'
    : 'bg-white border-[#f0f0f5]';
  const glassMuted = hasBg
    ? 'bg-white/5 backdrop-blur-xl border-white/10'
    : 'bg-[#fafaff] border-[#f0f0f5]';
  const glassHover = hasBg
    ? 'hover:bg-white/15'
    : 'hover:bg-[#fafafe]';
  const glassDivide = hasBg
    ? 'divide-white/10'
    : 'divide-[#f0f0f5]';

  /* ── Carousel card dimensions (responsive) ── */
  const CARD_W = isMobile ? 240 : 300;
  const CARD_GAP = isMobile ? 200 : 320;
  const VISIBLE_RANGE = isMobile ? 1 : 2;

  /* ── Touch handlers for swipe ── */
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDelta.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    touchDelta.current = e.touches[0].clientX - touchStartX.current;
  }
  function onTouchEnd() {
    if (touchDelta.current > 50) shiftFocus(-1);
    else if (touchDelta.current < -50) shiftFocus(1);
  }

  return (
    <div className="relative min-h-full">
      {/* ── Background image layer ── */}
      {bgUrl && (
        <div className="fixed inset-0 z-0 overflow-hidden">
          <img
            src={bgUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'brightness(0.55) saturate(0.8)' }}
          />
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setBackground(file);
          e.target.value = '';
        }}
      />

      <div className={cn('relative z-10 p-4 sm:p-6 md:p-8 max-w-5xl', bgUrl && 'text-white')}>
        {/* ══════════════════════════════════════
            TOP ROW — Clock (right) + BG controls
           ══════════════════════════════════════ */}
        {/* ══════════════════════════════════════
            1. EARNINGS HERO + Clock row
           ══════════════════════════════════════ */}
        <section className="mb-6 sm:mb-10">
          <div className="flex items-start justify-between mb-1">
            <p className={cn('text-[10px] sm:text-xs font-medium tracking-wide uppercase', clrMuted)}>
              Potential Earnings
            </p>
            {/* Clock + BG controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={cn('p-1.5 rounded-md transition-colors', hasBg ? 'text-white/40 hover:text-white/70 hover:bg-white/10' : 'text-[#c8c8d0] hover:text-[#a2a3fc] hover:bg-white/50')}
                  title="Change background"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                </button>
                {bgUrl && (
                  <button
                    onClick={() => setBackground(null)}
                    className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
                    title="Remove background"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-right">
                <p className={cn('text-2xl sm:text-3xl font-extralight leading-none tracking-tight tabular-nums select-none', hasBg ? 'text-white/40' : 'text-[#b0b0bc]')}>
                  {timeStr}
                </p>
                <p className={cn('text-[9px] mt-0.5 tracking-wide font-medium text-right', hasBg ? 'text-white/30' : 'text-[#a0a0b0]')}>
                  {tzStr}
            </p>
          </div>
            </div>
          </div>
          <h2 className={cn('text-4xl sm:text-5xl md:text-6xl font-bold leading-none tracking-tight tabular-nums', clrHeading)}>
            ${animatedPotential.toFixed(2)}
          </h2>
          <p className={cn('mt-1.5 sm:mt-2 text-xs sm:text-sm tabular-nums', clrMuted)}>
            ${animatedMonthly.toFixed(2)} earned this month
          </p>
        </section>

        {/* ── POW Alert ── */}
      {pendingPOW.length > 0 && (
        <Link
          href="/student/pow"
            className={cn('flex items-center justify-between border rounded-xl p-3 sm:p-4 mb-6 sm:mb-8 transition-colors group', hasBg ? 'bg-white/10 backdrop-blur-xl border-white/20 hover:bg-white/15' : 'bg-[#f0f0ff] border-[#e0e0f0] hover:bg-[#e8e8ff]')}
          >
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className={cn('w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center', hasBg ? 'bg-white/15' : 'bg-[#a2a3fc]/15')}>
                <AlertCircle className={cn('w-4 h-4 sm:w-5 sm:h-5', hasBg ? 'text-white/80' : 'text-[#a2a3fc]')} />
            </div>
            <div>
                <div className={cn('font-semibold text-xs sm:text-sm', clrHeading)}>
                {pendingPOW.length} POW Check{pendingPOW.length > 1 ? 's' : ''} Pending
                </div>
                <div className={cn('text-[10px] sm:text-xs', clrBody)}>
                  Submit your proof of work to continue
                </div>
              </div>
            </div>
            <ChevronRight className={cn('w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform flex-shrink-0', clrMuted)} />
        </Link>
      )}

        {/* ══════════════════════════════════════
            2. DAILY TASKS — DUAL VIEW
           ══════════════════════════════════════ */}
        <section className="mb-6 sm:mb-10">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className={cn('text-base sm:text-lg font-semibold', clrHeading)}>Available Tasks</h2>
            <div className={cn('flex items-center gap-1 rounded-lg p-0.5', hasBg ? 'bg-white/10' : 'bg-[#f5f5ff]')}>
              <button
                onClick={() => setTaskView('carousel')}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  taskView === 'carousel'
                    ? hasBg ? 'bg-white/20 text-white shadow-sm' : 'bg-white text-[#1f1f2e] shadow-sm'
                    : hasBg ? 'text-white/40 hover:text-white/70' : 'text-[#a0a0b0] hover:text-[#6b6b80]'
                )}
                title="Exhibition view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTaskView('list')}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  taskView === 'list'
                    ? hasBg ? 'bg-white/20 text-white shadow-sm' : 'bg-white text-[#1f1f2e] shadow-sm'
                    : hasBg ? 'text-white/40 hover:text-white/70' : 'text-[#a0a0b0] hover:text-[#6b6b80]'
                )}
                title="List view"
              >
                <Rows3 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {availableTasks.length === 0 ? (
            <div className={cn('rounded-xl border p-8 sm:p-10 text-center', glass)}>
              <Clock className={cn('w-10 h-10 mx-auto mb-3', hasBg ? 'text-white/25' : 'text-[#e0e0e8]')} />
              <p className={cn('text-sm', clrBody)}>No tasks available right now</p>
              <p className={cn('text-xs mt-1', clrMuted)}>Check back soon</p>
            </div>
          ) : taskView === 'carousel' ? (
            /* ── Exhibition / Carousel View ── */
            <div
              className={cn('relative overflow-hidden rounded-xl border py-8 sm:py-10 px-2 sm:px-4 select-none', glassMuted)}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <div className="relative h-[170px] sm:h-[180px] w-full">
                {availableTasks.map((task, i) => {
                  const offset = i - focusIndex;
                  const absOff = Math.abs(offset);
                  if (absOff > VISIBLE_RANGE) return null;

                  const scale = absOff === 0 ? 1 : absOff === 1 ? 0.78 : 0.6;
                  const opacity = absOff === 0 ? 1 : absOff === 1 ? 0.7 : 0.4;
                  const zIndex = 10 - absOff;
                  const tx = offset * CARD_GAP;
                  const ty = absOff * 8;

                  return (
                    <div
                      key={task.id}
                      className="absolute top-1/2 left-1/2 transition-all duration-300 ease-out cursor-pointer"
                      style={{
                        transform: `translate(-50%, -50%) translateX(${tx}px) translateY(${ty}px) scale(${scale})`,
                        opacity,
                        zIndex,
                        width: CARD_W,
                      }}
                      onClick={() => setFocusIndex(i)}
                    >
                      <Link
                        href={`/student/tasks/${task.id}`}
                        onClick={(e) => {
                          if (i !== focusIndex) e.preventDefault();
                        }}
                        className={cn(
                          'block rounded-xl border p-4 sm:p-5 transition-shadow',
                          hasBg
                            ? i === focusIndex
                              ? 'bg-white/15 backdrop-blur-xl border-white/30 shadow-lg'
                              : 'bg-white/10 backdrop-blur-xl border-white/15 shadow-sm'
                            : i === focusIndex
                              ? 'border-[#a2a3fc] shadow-lg bg-white'
                              : 'border-[#f0f0f5] shadow-sm bg-white'
                        )}
                      >
                        <h3 className={cn('font-semibold text-xs sm:text-sm mb-1.5 sm:mb-2 line-clamp-2', clrHeading)}>
                          {task.title}
                        </h3>
                        <p className={cn('text-[10px] sm:text-xs line-clamp-2 mb-2 sm:mb-3', clrBody)}>
                          {task.spec}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className={cn('text-[10px] sm:text-xs font-medium', clrMuted)}>
                            {task.deadlineHours ? `${task.deadlineHours}h` : 'Flexible'}
                          </span>
                          <span className="text-xs sm:text-sm font-bold" style={{ color: hasBg ? '#fff' : ACCENT }}>
                            ${((task.priceInCents || 0) / 100).toFixed(0)}
                          </span>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>

              {/* Nav arrows — hidden on mobile (swipe instead) */}
              {availableTasks.length > 1 && (
                <>
                  <button
                    onClick={() => shiftFocus(-1)}
                    className={cn('hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border items-center justify-center shadow-sm hover:shadow-md transition-shadow', hasBg ? 'bg-white/10 backdrop-blur-xl border-white/20' : 'bg-white border-[#f0f0f5]')}
                  >
                    <ChevronLeft className={cn('w-4 h-4', hasBg ? 'text-white/70' : 'text-[#6b6b80]')} />
                  </button>
                  <button
                    onClick={() => shiftFocus(1)}
                    className={cn('hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full border items-center justify-center shadow-sm hover:shadow-md transition-shadow', hasBg ? 'bg-white/10 backdrop-blur-xl border-white/20' : 'bg-white border-[#f0f0f5]')}
                  >
                    <ChevronRight className={cn('w-4 h-4', hasBg ? 'text-white/70' : 'text-[#6b6b80]')} />
                  </button>
                </>
              )}

              {/* Dots */}
              {availableTasks.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-4 sm:mt-6">
                  {availableTasks.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setFocusIndex(i)}
                      className={cn(
                        'h-1.5 rounded-full transition-all',
                        i === focusIndex ? 'w-5' : hasBg ? 'w-1.5 bg-white/25' : 'w-1.5 bg-[#e0e0e8]'
                      )}
                      style={i === focusIndex ? { background: hasBg ? 'rgba(255,255,255,0.6)' : ACCENT } : undefined}
                    />
                  ))}
              </div>
              )}
            </div>
          ) : (
            /* ── List View ── */
            <div className={cn('rounded-xl border', glass, glassDivide, 'divide-y')}>
              {availableTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/student/tasks/${task.id}`}
                  className={cn('flex items-center justify-between p-3 sm:p-4 transition-colors gap-3', glassHover)}
                >
                  <div className="flex-1 min-w-0">
                    <h3 className={cn('text-xs sm:text-sm font-medium truncate', clrHeading)}>
                      {task.title}
                    </h3>
                    <p className={cn('text-[10px] sm:text-xs mt-0.5 truncate', clrMuted)}>
                      {task.spec}
                    </p>
              </div>
                  <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                    <span className={cn('text-[10px] sm:text-xs hidden xs:inline', clrMuted)}>
                      {task.deadlineHours ? `${task.deadlineHours}h` : 'Flex'}
                    </span>
                    <span className="text-xs sm:text-sm font-bold" style={{ color: hasBg ? '#fff' : ACCENT }}>
                      ${((task.priceInCents || 0) / 100).toFixed(0)}
                    </span>
                    <ChevronRight className={cn('w-4 h-4', hasBg ? 'text-white/20' : 'text-[#e0e0e8]')} />
              </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════
            3. ACTIVE WORK
           ══════════════════════════════════════ */}
        <section className="mb-6 sm:mb-10">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className={cn('text-base sm:text-lg font-semibold', clrHeading)}>Active Work</h2>
            <Link
              href="/student/executions"
              className="text-xs font-medium hover:opacity-80 transition-opacity"
              style={{ color: hasBg ? 'rgba(255,255,255,0.6)' : ACCENT }}
            >
              View All
            </Link>
          </div>
          
          {activeExecutions.length === 0 ? (
            <div className={cn('rounded-xl border p-8 sm:p-10 text-center', glass)}>
              <Clock className={cn('w-10 h-10 mx-auto mb-3', hasBg ? 'text-white/25' : 'text-[#e0e0e8]')} />
              <p className={cn('text-sm mb-2', clrBody)}>No active tasks</p>
              <Link
                href="/student/tasks"
                className="inline-flex items-center gap-1 text-sm font-medium hover:opacity-80"
                style={{ color: hasBg ? '#fff' : ACCENT }}
              >
                Browse available tasks
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className={cn('rounded-xl border divide-y', glass, glassDivide)}>
              {activeExecutions.slice(0, 6).map((execution) => (
                <Link
                  key={execution.id}
                  href={`/student/executions/${execution.id}`}
                  className={cn('flex items-center justify-between p-3 sm:p-4 transition-colors gap-2', glassHover)}
                >
                  <div className="flex-1 min-w-0">
                    <div className={cn('text-xs sm:text-sm font-medium truncate', clrHeading)}>
                      {execution.workUnit?.title || 'Task'}
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 mt-1 flex-wrap">
                      <span
                        className={cn(
                          'px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-medium',
                          hasBg
                            ? 'bg-white/10 text-white/70'
                            : execution.status === 'clocked_in'
                              ? 'bg-[#f0f0ff] text-[#a2a3fc]'
                          : execution.status === 'submitted'
                                ? 'bg-[#f0f0ff] text-[#6b6bcc]'
                                : 'bg-[#f5f5f5] text-[#6b6b80]'
                        )}
                      >
                        {execution.status.replace(/_/g, ' ')}
                      </span>
                      {execution.deadlineAt && (
                        <span className={cn('text-[10px] sm:text-xs', clrMuted)}>
                          Due: {new Date(execution.deadlineAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className={cn('w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0', hasBg ? 'text-white/20' : 'text-[#e0e0e8]')} />
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════
            4. LIBRARY LINK
           ══════════════════════════════════════ */}
        <section className="pb-4">
          <Link
            href="/student/library"
            className={cn('flex items-center gap-3 sm:gap-4 rounded-xl border p-4 sm:p-5 transition-all group', glass, hasBg ? 'hover:bg-white/15' : 'hover:border-[#a2a3fc] hover:shadow-sm')}
          >
            <div
              className={cn('w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0', hasBg ? 'bg-white/15' : 'bg-[#f0f0ff]')}
            >
              <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: hasBg ? '#fff' : ACCENT }} />
                </div>
            <div className="flex-1 min-w-0">
              <h3 className={cn('text-xs sm:text-sm font-semibold', clrHeading)}>Library</h3>
              <p className={cn('text-[10px] sm:text-xs', clrMuted)}>
                Manage your files to help AI understand you better
              </p>
            </div>
            <ChevronRight className={cn('w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform flex-shrink-0', hasBg ? 'text-white/20' : 'text-[#e0e0e8]')} />
              </Link>
        </section>
      </div>
    </div>
  );
}
