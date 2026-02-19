'use client';

import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Briefcase, GraduationCap, Shield, Zap, Clock, CheckCircle } from 'lucide-react';

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ticking = false;
    function handleScroll() {
      setScrolled(window.scrollY > 80);

      // Parallax: background scrolls slower than content (moves up at 30% of scroll speed)
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          if (bgRef.current) {
            const y = window.scrollY;
            bgRef.current.style.transform = `translate3d(0, ${y * -0.3}px, 0)`;
          }
          ticking = false;
        });
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    async function detectRoleAndRedirect() {
      // Check localStorage for saved role intent
      const savedRole = localStorage.getItem('figwork_role');
      
      // If user already chose student → go to student panel (layout handles onboarding)
      if (savedRole === 'student') {
        router.push('/student');
        return;
      }
      if (savedRole === 'company') {
        router.push('/dashboard');
        return;
      }

      // No saved role — check backend for existing profiles
      try {
        const token = await getToken();
        if (!token) { router.push('/dashboard'); return; }

        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

        // Check for student profile
        const studentRes = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (studentRes?.ok) {
          localStorage.setItem('figwork_role', 'student');
          router.push('/student');
          return;
        }

        // Check for company profile
        const companyRes = await fetch(`${API_URL}/api/companies/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);

        if (companyRes?.ok) {
          localStorage.setItem('figwork_role', 'company');
          router.push('/dashboard');
          return;
        }

        // No profile at all — default to company dashboard (includes onboarding prompt)
        router.push('/dashboard');
      } catch {
        router.push('/dashboard');
      }
    }

    detectRoleAndRedirect();
  }, [isLoaded, isSignedIn, router, getToken]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-light border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isSignedIn) return null;

  return (
    <div className="min-h-screen bg-[#0a0a12] overflow-x-hidden">
      {/* Parallax Background — moves slower than content for a POV depth effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          ref={bgRef}
          className="absolute left-0 right-0 top-0 will-change-transform"
          style={{
            height: '200vh',
            backgroundImage: 'url(/hero-bg.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            opacity: 0.3,
            transform: 'translate3d(0, 0, 0)',
          }}
        />
      </div>
      <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-[#0a0a12]/60 via-[#0a0a12]/40 to-[#0a0a12]/90" />

      {/* Nav — transforms to centered glassmorphism pill on scroll */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ease-out ${
          scrolled ? 'py-3' : 'py-6'
        }`}
      >
        <div
          className={`mx-auto flex items-center justify-between transition-all duration-200 ease-out ${
            scrolled
              ? 'max-w-2xl px-4 py-2.5 rounded-full backdrop-blur-xl border border-white/[0.12]'
              : 'max-w-6xl px-6 md:px-12 border border-transparent'
          }`}
          style={scrolled ? { background: 'rgba(255,255,255,0.07)' } : {}}
        >
          <div className="flex items-center gap-2">
            <img src="/iconfigwork.png" alt="Figwork" className={`transition-all duration-200 ease-out ${scrolled ? 'h-7 w-7' : 'h-9 w-9'}`} />
            {!scrolled && <span className="text-lg font-semibold text-white/90 tracking-tight">figwork</span>}
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/marketplace"
              className={`text-sm font-medium transition-colors hidden md:block ${
                scrolled ? 'text-white/60 hover:text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              Browse Tasks
            </Link>
            <Link
              href="/sign-in"
              className={`text-sm font-medium transition-colors ${
                scrolled ? 'text-white/60 hover:text-white' : 'text-white/50 hover:text-white'
              }`}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className={`text-sm font-medium transition-all duration-300 hover:-translate-y-px ${
                scrolled
                  ? 'px-4 py-1.5 rounded-full bg-white text-[#0a0a12] hover:shadow-lg'
                  : 'px-4 py-2 rounded-lg text-white hover:shadow-glow'
              }`}
              style={!scrolled ? { background: 'var(--gradient-fig)' } : {}}
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-28 pb-36 max-w-6xl mx-auto">
        <div className="max-w-3xl">
          {/* Headline */}
          <h1 className="text-[clamp(3rem,6vw,5rem)] font-bold text-white leading-[1.08] tracking-tight mb-6">
            The future of{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--gradient-fig)' }}
            >
              human
            </span>
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'var(--gradient-fig)' }}
            >
              talent
            </span>{' '}
            marketplace.
          </h1>

          {/* Sub */}
          <p className="text-lg text-white/50 leading-relaxed max-w-xl mb-10">
            Figwork runs your contract work end-to-end—matching vetted talent, 
            managing execution, and paying only for approved results.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-4">
            <Link
              href="/sign-up"
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-white font-semibold transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5"
              style={{ background: 'var(--gradient-fig)' }}
            >
              Post Work
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button
              onClick={() => { localStorage.setItem('figwork_role', 'student'); router.push('/sign-up'); }}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white bg-white/10 border border-white/20 hover:bg-white/15 hover:border-white/30 transition-all duration-300 backdrop-blur-sm"
            >
              Become a Contractor
            </button>
          </div>
        </div>

      </section>

      {/* How It Works — horizontal steps */}
      <section className="relative z-10 px-6 md:px-12 pb-32 max-w-6xl mx-auto">
        <p className="text-sm font-medium tracking-widest uppercase text-white/30 mb-10">
          How it works
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              step: '01',
              title: 'Post a task',
              body: 'Describe the deliverable, deadline, and budget. Our AI checks clarity before publishing.',
            },
            {
              step: '02',
              title: 'We match & manage',
              body: 'Vetted students are matched by skill, tier, and history. POW check-ins ensure real progress.',
            },
            {
              step: '03',
              title: 'Receive the work',
              body: 'QA-checked deliverables land in your dashboard. Pay only for approved work.',
            },
          ].map((item, i) => (
            <div
              key={i}
              className="group p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-[#c4b5fd]/40 transition-all duration-300"
            >
              <span
                className="text-xs font-bold tracking-wider bg-clip-text text-transparent"
                style={{ backgroundImage: 'var(--gradient-fig)' }}
              >
                {item.step}
              </span>
              <h3 className="text-xl font-semibold text-white mt-3 mb-3">{item.title}</h3>
              <p className="text-white/50 text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Two audiences */}
      <section className="relative z-10 px-6 md:px-12 pb-32 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-6">
          {/* For Business */}
          <Link
            href="/sign-up"
            onMouseEnter={() => setHoveredCard('biz')}
            onMouseLeave={() => setHoveredCard(null)}
            className="group relative p-10 rounded-3xl overflow-hidden transition-all duration-500"
            style={{
              background: hoveredCard === 'biz'
                ? 'linear-gradient(135deg, rgba(196,181,253,0.15) 0%, rgba(249,168,212,0.08) 100%)'
                : 'rgba(255,255,255,0.08)',
            }}
          >
            <Briefcase className="w-8 h-8 text-[#c4b5fd] mb-6" />
            <h3 className="text-2xl font-bold text-white mb-3">For Businesses</h3>
            <p className="text-white/60 leading-relaxed mb-8">
              Stop hiring. Start buying deliverables. Post what you need and 
              receive QA-checked work from vetted student contractors.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                'Escrow-protected payments',
                'AI quality checks before delivery',
                'No recruitment overhead',
                'Dedicated review dashboard',
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-white/50">
                  <CheckCircle className="w-4 h-4 text-[#c4b5fd] flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#c4b5fd] group-hover:gap-2.5 transition-all">
              Post your first task
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </Link>

          {/* For Contractors */}
          <Link
            href="/sign-up"
            onMouseEnter={() => setHoveredCard('stu')}
            onMouseLeave={() => setHoveredCard(null)}
            className="group relative p-10 rounded-3xl border border-white/10 hover:border-[#c4b5fd]/40 overflow-hidden transition-all duration-500 bg-white/5 backdrop-blur-sm"
          >
            <GraduationCap className="w-8 h-8 text-[#a78bfa] mb-6" />
            <h3 className="text-2xl font-bold text-white mb-3">For Contractors</h3>
            <p className="text-white/50 leading-relaxed mb-8">
              Get paid for real work, not unpaid internships. Build your track record 
              and level up from Novice to Elite.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                'Daily paid tasks matched to your skills',
                'Tier-based progression (Novice → Pro → Elite)',
                'Direct deposit to your bank',
                'AI coaching to improve your craft',
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-white/40">
                  <CheckCircle className="w-4 h-4 text-[#a78bfa] flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#a78bfa] group-hover:gap-2.5 transition-all">
              Start earning
              <ArrowUpRight className="w-4 h-4" />
            </span>
          </Link>
        </div>
      </section>

      {/* Trust bar */}
      <section className="relative z-10 px-6 md:px-12 pb-32 max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { icon: Shield, label: 'Escrow-protected', sub: 'Every task funded upfront' },
            { icon: Zap, label: 'AI-screened', sub: 'Voice + skill verification' },
            { icon: Clock, label: 'POW verified', sub: 'Random photo check-ins' },
            { icon: CheckCircle, label: 'QA before delivery', sub: 'Auto + human review' },
          ].map((item, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center bg-white/5">
                <item.icon className="w-5 h-5 text-[#a78bfa]" />
              </div>
              <p className="font-semibold text-white text-sm">{item.label}</p>
              <p className="text-xs text-white/40 mt-0.5">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-6 md:px-12 pb-24 max-w-6xl mx-auto">
        <div
          className="p-12 md:p-16 rounded-3xl text-center relative overflow-hidden"
          style={{ background: 'var(--gradient-fig)' }}
        >
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-white/10 rounded-full translate-x-1/3 translate-y-1/3" />

          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Work delivered, not applicants screened.
            </h2>
            <p className="text-white/70 text-lg max-w-xl mx-auto mb-8">
              Join the marketplace that replaces hiring friction 
              with finished deliverables.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-[#1f1f2e] font-semibold transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 md:px-12 py-10 border-t border-white/10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <img src="/iconfigwork.png" alt="Figwork" className="h-7 w-7 opacity-60" />
            <span className="font-semibold text-white/60 text-sm">figwork</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-white/30">
            <Link href="/for-business" className="hover:text-white transition-colors">For Business</Link>
            <Link href="/become-contractor" className="hover:text-white transition-colors">Become a Contractor</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/sign-in" className="hover:text-white transition-colors">Sign In</Link>
          </div>
          <p className="text-xs text-white/20">
            © {new Date().getFullYear()} Figwork
          </p>
        </div>
      </footer>
    </div>
  );
}
