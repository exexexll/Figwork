'use client';

import { useUser, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Paperclip, ArrowUp } from 'lucide-react';

const PRESETS = [
  'manage your UGC creator campaigns',
  'run your data annotation pipeline',
  'handle your content marketing',
  'operate your QA testing team',
  'coordinate your research operations',
];

const TYPING_PROMPTS = [
  'I need 20 UGC creators to post twice a month on Instagram...',
  'Build me a data annotation team for medical imaging labels...',
  'Find 5 street marketers for a 2-hour shift in downtown LA...',
  'Hire a founding engineer contractor for an 8-week MVP sprint...',
  'Set up a content writing pipeline: 40 blog posts per month...',
  'I need someone to design a logo for my tech startup...',
];

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { getToken } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState('');
  const [presetIdx] = useState(() => Math.floor(Math.random() * PRESETS.length));
  const [typingText, setTypingText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptIdx = useRef(0);
  const charIdx = useRef(0);
  const deleting = useRef(false);
  const paused = useRef(false);

  // Redirect signed-in users
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    async function detectRoleAndRedirect() {
      const savedRole = localStorage.getItem('figwork_role');
      if (savedRole === 'student') { router.push('/student'); return; }
      if (savedRole === 'company') { router.push('/dashboard'); return; }

      try {
        const token = await getToken();
        if (!token) { router.push('/dashboard'); return; }
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const studentRes = await fetch(`${API_URL}/api/students/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (studentRes?.ok) { localStorage.setItem('figwork_role', 'student'); router.push('/student'); return; }
        localStorage.setItem('figwork_role', 'company');
        router.push('/dashboard');
      } catch { router.push('/dashboard'); }
    }
    detectRoleAndRedirect();
  }, [isLoaded, isSignedIn, router, getToken]);


  // Typewriter animation for input placeholder
  useEffect(() => {
    if (input) { setIsTyping(false); return; }
    setIsTyping(true);

    const tick = () => {
      if (paused.current) return;
      const currentPrompt = TYPING_PROMPTS[promptIdx.current % TYPING_PROMPTS.length];

      if (!deleting.current) {
        if (charIdx.current <= currentPrompt.length) {
          setTypingText(currentPrompt.slice(0, charIdx.current));
          charIdx.current++;
        } else {
          paused.current = true;
          setTimeout(() => { paused.current = false; deleting.current = true; }, 2000);
        }
      } else {
        if (charIdx.current > 0) {
          charIdx.current -= 2;
          if (charIdx.current < 0) charIdx.current = 0;
          setTypingText(currentPrompt.slice(0, charIdx.current));
        } else {
          deleting.current = false;
          promptIdx.current++;
        }
      }
    };

    const interval = setInterval(tick, deleting.current ? 20 : 40);
    return () => clearInterval(interval);
  }, [input]);

  function handleSubmit() {
    if (!input.trim()) return;
    // Store the prompt so the dashboard can use it
    localStorage.setItem('figwork_initial_prompt', input.trim());
    router.push('/sign-up');
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0f0a1a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-300/30 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (isSignedIn) return null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background image */}
      <div className="fixed inset-0 pointer-events-none">
        <img src="/landing-bg.png" alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-12 py-4 md:py-5">
          <div className="flex items-center gap-1.5">
            <img src="/iconfigwork.png" alt="Figwork" className="h-6 w-6 md:h-8 md:w-8" />
            <span className="text-sm md:text-base font-semibold text-white/90 hidden sm:block">figwork</span>
          </div>
          <div className="flex items-center gap-3 md:gap-4 relative z-50">
            <a href="/become-contractor" className="text-[11px] md:text-sm text-white/40 hover:text-white/70 transition-colors">
              Find jobs?
            </a>
            <a href="/for-business"
              className="text-[11px] md:text-sm font-medium text-white bg-white/10 hover:bg-white/15 border border-white/20 px-2.5 py-1 md:px-4 md:py-1.5 rounded-md md:rounded-lg transition-all">
              Business
            </a>
          </div>
        </header>

        {/* Main content — centered column */}
        <main className="flex-1 flex flex-col items-center justify-center px-6 -mt-16">
          {/* Title */}
          <h1 className="text-center text-[clamp(2.5rem,5.5vw,4.5rem)] font-bold text-white leading-[1.1] tracking-tight mb-5">
            Make things{' '}
            <span className="relative inline-block">
              <span className="text-white/35">that&apos;re</span>
              <span className="absolute left-[-4%] right-[-4%] top-[52%] h-[3px] bg-white/50 rounded-full" style={{ transform: 'rotate(-2deg)' }} />
            </span>
            {' '}possible
          </h1>

          {/* Subtitle */}
          <p className="text-center text-lg md:text-xl text-white/50 mb-10">
            <span className="text-white font-medium">We manage human intelligence</span>{' '}
            to {PRESETS[presetIdx]}
          </p>

          {/* Input box */}
          <div className="w-full max-w-2xl">
            <div className="relative rounded-2xl bg-[#1a1528]/80 backdrop-blur-xl border border-white/10 shadow-2xl shadow-violet-500/5">
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder=""
                  rows={3}
                  className="w-full bg-transparent text-white text-sm placeholder:text-transparent resize-none border-0 focus:ring-0 px-5 pt-4 pb-2 outline-none"
                />
                {/* Animated placeholder overlay */}
                {!input && isTyping && (
                  <div className="absolute top-4 left-5 right-14 pointer-events-none text-sm text-white/25">
                    {typingText}<span className="inline-block w-0.5 h-4 bg-white/30 ml-0.5 animate-pulse align-middle" />
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between px-4 pb-3">
                <div className="flex items-center gap-2">
                  <button className="p-1.5 text-white/20 hover:text-white/50 transition-colors rounded-lg hover:bg-white/5">
                    <Paperclip className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  className="p-2 rounded-full bg-white/10 text-white/40 hover:bg-violet-600 hover:text-white disabled:opacity-30 disabled:hover:bg-white/10 transition-all"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="flex items-center justify-center gap-6 px-6 py-6 text-[11px] text-white/15 relative z-50">
          <a href="/terms" className="hover:text-white/40 transition-colors">Terms</a>
          <a href="/privacy" className="hover:text-white/40 transition-colors">Privacy</a>
          <span>© {new Date().getFullYear()} Figwork</span>
        </footer>
      </div>

    </div>
  );
}
