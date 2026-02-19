'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  DollarSign,
  Clock,
  TrendingUp,
  Shield,
  Zap,
  Star,
  CheckCircle,
  GraduationCap,
} from 'lucide-react';

const tiers = [
  {
    name: 'Novice',
    color: '#6b7280',
    tasks: '3 tasks/day',
    fee: '15% platform fee',
    perk: 'Weekly payouts',
    req: 'Pass screening interview',
  },
  {
    name: 'Pro',
    color: '#3b82f6',
    tasks: '8 tasks/day',
    fee: '12% platform fee',
    perk: 'Instant payouts',
    req: '50+ tasks, 85%+ quality',
  },
  {
    name: 'Elite',
    color: '#8b5cf6',
    tasks: '15 tasks/day',
    fee: '8% platform fee',
    perk: 'Priority matching',
    req: '200+ tasks, 92%+ quality',
  },
];

export default function BecomeContractorPage() {
  const router = useRouter();

  function handleSignUp() {
    localStorage.setItem('figwork_role', 'student');
    router.push('/sign-up');
  }

  return (
    <div className="min-h-screen bg-[#faf8fc]">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 30% 0%, rgba(196,181,253,0.2) 0%, transparent 50%)',
      }} />

      {/* Nav */}
      <nav className="relative z-10 px-6 md:px-12 py-6 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/iconfigwork.png" alt="Figwork" className="h-9 w-9" />
          <span className="text-lg font-semibold text-[#1f1f2e]">figwork</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="text-sm text-[#6b6b80] hover:text-[#1f1f2e] font-medium">
            Sign in
          </Link>
          <button
            onClick={handleSignUp}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ background: 'var(--gradient-fig)' }}
          >
            Apply Now
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-20 pb-28 max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 border border-[#e8e4f0] mb-6">
            <GraduationCap className="w-4 h-4 text-[#a78bfa]" />
            <span className="text-xs font-medium text-[#6b6b80]">For Student Contractors</span>
          </div>

          <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[#1f1f2e] leading-[1.1] tracking-tight mb-6">
            Get paid for real work.
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--gradient-fig)' }}>
              Build your career.
            </span>
          </h1>

          <p className="text-lg text-[#6b6b80] leading-relaxed max-w-xl mb-10">
            Complete paid tasks from real businesses. No unpaid internships, 
            no resume black holes — just work, deliver, get paid.
          </p>

          <button
            onClick={handleSignUp}
            className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-white font-semibold transition-all hover:shadow-glow hover:-translate-y-0.5"
            style={{ background: 'var(--gradient-fig)' }}
          >
            Start Earning Today
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 px-6 md:px-12 pb-28 max-w-6xl mx-auto">
        <p className="text-xs font-medium tracking-widest uppercase text-[#a0a0b0] mb-8">How it works</p>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { step: '01', title: 'Apply', body: 'Complete a 10-min voice interview. We verify your identity and skills.' },
            { step: '02', title: 'Get matched', body: 'Tasks appear in your dashboard based on your skills, tier, and history.' },
            { step: '03', title: 'Do the work', body: 'Clock in, submit deliverables, and complete POW check-ins.' },
            { step: '04', title: 'Get paid', body: 'Approved work triggers automatic payout to your bank account.' },
          ].map((item, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/70 border border-[#e8e4f0]">
              <span className="text-xs font-bold tracking-wider bg-clip-text text-transparent" style={{ backgroundImage: 'var(--gradient-fig)' }}>
                {item.step}
              </span>
              <h3 className="text-lg font-semibold text-[#1f1f2e] mt-2 mb-2">{item.title}</h3>
              <p className="text-sm text-[#6b6b80] leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tier System */}
      <section className="relative z-10 px-6 md:px-12 pb-28 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-[#1f1f2e] mb-3">Level up as you go</h2>
        <p className="text-[#6b6b80] mb-10 max-w-xl">
          Every completed task earns EXP. Higher tiers unlock more tasks, lower fees, and better matching.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((tier, i) => (
            <div
              key={tier.name}
              className="p-6 rounded-2xl bg-white border border-[#e8e4f0] hover:border-[#c4b5fd] transition-all"
            >
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5" style={{ color: tier.color }} />
                <h3 className="text-xl font-bold" style={{ color: tier.color }}>{tier.name}</h3>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2 text-[#1f1f2e]">
                  <Clock className="w-4 h-4 text-[#a0a0b0]" /> {tier.tasks}
                </li>
                <li className="flex items-center gap-2 text-[#1f1f2e]">
                  <DollarSign className="w-4 h-4 text-[#a0a0b0]" /> {tier.fee}
                </li>
                <li className="flex items-center gap-2 text-[#1f1f2e]">
                  <Zap className="w-4 h-4 text-[#a0a0b0]" /> {tier.perk}
                </li>
              </ul>
              <p className="text-xs text-[#a0a0b0] mt-4 pt-4 border-t border-[#e8e4f0]">
                {tier.req}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 md:px-12 pb-24 max-w-6xl mx-auto">
        <div className="p-12 rounded-3xl text-center relative overflow-hidden" style={{ background: 'var(--gradient-fig)' }}>
          <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
          <div className="relative">
            <h2 className="text-3xl font-bold text-white mb-3">Ready to start earning?</h2>
            <p className="text-white/70 mb-8 max-w-md mx-auto">Apply in 10 minutes. Get your first task within 24 hours.</p>
            <button onClick={handleSignUp} className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-[#1f1f2e] font-semibold hover:shadow-lg hover:-translate-y-0.5 transition-all">
              Apply Now <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      <footer className="relative z-10 px-6 md:px-12 py-10 border-t border-[#e8e4f0]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/iconfigwork.png" alt="Figwork" className="h-7 w-7 opacity-80" />
            <span className="font-semibold text-[#1f1f2e] text-sm">figwork</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#a0a0b0]">
            <Link href="/terms" className="hover:text-[#1f1f2e] transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-[#1f1f2e] transition-colors">Privacy</Link>
          </div>
          <p className="text-xs text-[#a0a0b0]">© {new Date().getFullYear()} Figwork</p>
        </div>
      </footer>
    </div>
  );
}
