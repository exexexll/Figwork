'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Shield,
  Zap,
  Clock,
  CheckCircle,
  DollarSign,
  BarChart3,
  Briefcase,
  Eye,
} from 'lucide-react';

export default function ForBusinessPage() {
  return (
    <div className="min-h-screen bg-[#faf8fc]">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 70% 0%, rgba(196,181,253,0.15) 0%, transparent 50%)',
      }} />

      {/* Nav */}
      <nav className="relative z-10 px-6 md:px-12 py-6 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/iconfigwork.png" alt="Figwork" className="h-9 w-9" />
          <span className="text-lg font-semibold text-[#1f1f2e]">figwork</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="text-sm text-[#6b6b80] hover:text-[#1f1f2e] font-medium">Sign in</Link>
          <Link
            href="/sign-up"
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ background: 'var(--gradient-fig)' }}
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-20 pb-28 max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1f1f2e] mb-6">
            <Briefcase className="w-4 h-4 text-[#c4b5fd]" />
            <span className="text-xs font-medium text-white/80">For Businesses</span>
          </div>

          <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[#1f1f2e] leading-[1.1] tracking-tight mb-6">
            Buy deliverables,
            <br />
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--gradient-fig)' }}>
              not headcount.
            </span>
          </h1>

          <p className="text-lg text-[#6b6b80] leading-relaxed max-w-xl mb-10">
            Post what you need. Vetted student contractors deliver. 
            Pay only for approved work — no recruiting, no overhead, no risk.
          </p>

          <Link
            href="/sign-up"
            className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-white font-semibold transition-all hover:shadow-glow hover:-translate-y-0.5"
            style={{ background: 'var(--gradient-fig)' }}
          >
            Post Your First Task
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </section>

      {/* Value Props */}
      <section className="relative z-10 px-6 md:px-12 pb-28 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Old way vs. Figwork */}
          <div className="p-8 rounded-2xl bg-red-50/50 border border-red-100/50">
            <h3 className="font-semibold text-[#1f1f2e] mb-4">The old way</h3>
            <ul className="space-y-3 text-sm text-[#6b6b80]">
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">✕</span>
                Post job → screen 500 resumes → phone screen 50 → hire 1
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">✕</span>
                3-6 week hiring cycle for a task that takes 4 hours
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">✕</span>
                Pay for onboarding, benefits, management overhead
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">✕</span>
                Risk of bad hire with no recourse
              </li>
            </ul>
          </div>

          <div className="p-8 rounded-2xl bg-[#f3f0f8] border border-[#e8e4f0]">
            <h3 className="font-semibold text-[#1f1f2e] mb-4">With Figwork</h3>
            <ul className="space-y-3 text-sm text-[#6b6b80]">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                Post task → auto-matched to best contractor → delivered
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                Average delivery in under 24 hours
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                Pay per deliverable — no overhead, no benefits
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                Escrow protection + full refund if work fails QA
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative z-10 px-6 md:px-12 pb-28 max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-[#1f1f2e] mb-3">Built for reliability</h2>
        <p className="text-[#6b6b80] mb-10 max-w-xl">
          Every layer of our system is designed to ensure you receive quality work on time.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: Shield,
              title: 'Escrow Protection',
              body: 'Funds are held securely until you review and approve the deliverable.',
            },
            {
              icon: Eye,
              title: 'Real-Time Oversight',
              body: 'Random proof-of-work photo check-ins and milestone tracking throughout.',
            },
            {
              icon: BarChart3,
              title: 'AI Quality Checks',
              body: 'Automated QA runs before submission reaches you, catching issues early.',
            },
            {
              icon: Zap,
              title: 'Smart Matching',
              body: 'Multi-factor algorithm considers skills, tier, history, and availability.',
            },
            {
              icon: Clock,
              title: 'Deadline Enforcement',
              body: 'Automatic warnings, escalation, and re-assignment if deadlines are at risk.',
            },
            {
              icon: DollarSign,
              title: 'Simple Pricing',
              body: 'You set the price. 15% platform fee included. No hidden costs.',
            },
          ].map((feature, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/70 border border-[#e8e4f0] hover:border-[#c4b5fd] transition-all">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'var(--gradient-fig-subtle)' }}>
                <feature.icon className="w-5 h-5 text-[#a78bfa]" />
              </div>
              <h3 className="font-semibold text-[#1f1f2e] mb-2">{feature.title}</h3>
              <p className="text-sm text-[#6b6b80] leading-relaxed">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Task Types */}
      <section className="relative z-10 px-6 md:px-12 pb-28 max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold text-[#1f1f2e] mb-8">What businesses are buying</h2>
        <div className="flex flex-wrap gap-3">
          {[
            'Content Writing', 'Data Entry', 'Research Reports', 'Social Media Posts',
            'Email Templates', 'Slide Decks', 'Market Analysis', 'Graphic Design',
            'Video Editing', 'Web Scraping', 'Translation', 'Survey Analysis',
            'Customer Outreach', 'Spreadsheet Cleanup', 'Lead Lists',
          ].map((task, i) => (
            <span key={i} className="px-4 py-2 rounded-lg bg-white border border-[#e8e4f0] text-sm text-[#6b6b80] font-medium">
              {task}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 px-6 md:px-12 pb-24 max-w-6xl mx-auto">
        <div className="p-12 rounded-3xl text-center relative overflow-hidden bg-[#1f1f2e]">
          <div className="absolute top-0 right-0 w-80 h-80 bg-[#a78bfa]/10 rounded-full translate-x-1/3 -translate-y-1/3" />
          <div className="relative">
            <h2 className="text-3xl font-bold text-white mb-3">
              Stop hiring. Start buying results.
            </h2>
            <p className="text-white/50 mb-8 max-w-md mx-auto">
              Post your first task for free. Only pay when you approve the deliverable.
            </p>
            <Link href="/sign-up" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl font-semibold text-[#1f1f2e] bg-white hover:shadow-lg hover:-translate-y-0.5 transition-all">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Link>
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
