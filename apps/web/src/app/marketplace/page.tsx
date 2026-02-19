'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  Clock,
  DollarSign,
  Star,
  ChevronDown,
  Briefcase,
  ArrowRight,
  Filter,
  X,
  Building2,
  CheckCircle,
  Shield,
  Zap,
} from 'lucide-react';
import { track, EVENTS } from '@/lib/analytics';

interface Task {
  id: string;
  title: string;
  spec: string;
  category: string;
  priceInCents: number;
  deadlineHours: number;
  requiredSkills: string[];
  minTier: string;
  complexityScore: number;
  companyName: string;
  publishedAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function MarketplacePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);

  // Filters
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchTasks();
  }, []);

  async function fetchCategories() {
    try {
      const res = await fetch(`${API_URL}/api/marketplace/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (err) { console.error(err); }
  }

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      if (sort === 'price_asc') params.set('sort', 'price_asc');
      else if (sort === 'price_desc') params.set('sort', 'price_desc');
      else if (sort === 'deadline') params.set('sort', 'deadline');

      const res = await fetch(`${API_URL}/api/marketplace/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
        setTotal(data.total || 0);
        track(EVENTS.MARKETPLACE_SEARCH, { query: query.trim(), category, sort, results: data.total || 0 });
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [query, category, sort]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchTasks();
  }

  function getTierColor(tier: string) {
    switch (tier) {
      case 'elite': return 'bg-violet-100 text-violet-700';
      case 'pro': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  return (
    <div className="min-h-screen bg-[#faf8fc]">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at top, rgba(196,181,253,0.1) 0%, transparent 50%)',
      }} />

      {/* Nav */}
      <nav className="relative z-10 px-6 md:px-12 py-6 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/iconfigwork.png" alt="Figwork" className="h-9 w-9" />
          <span className="text-lg font-semibold text-[#1f1f2e]">figwork</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="text-sm text-[#6b6b80] hover:text-[#1f1f2e] font-medium">Sign in</Link>
          <Link href="/sign-up" className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ background: 'var(--gradient-fig)' }}>
            Get Started
          </Link>
        </div>
      </nav>

      <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Marketplace</h1>
          <p className="text-[#6b6b80]">
            Browse available tasks · {total} active
          </p>
        </div>

        {/* Search + Filters */}
        <form onSubmit={handleSearch} className="flex gap-3 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0a0b0]" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd]"
              placeholder="Search tasks..."
            />
          </div>
          <button
            type="submit"
            className="px-6 py-3 rounded-xl text-white font-medium"
            style={{ background: 'var(--gradient-fig)' }}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white hover:border-[#c4b5fd] transition-colors"
          >
            <Filter className="w-4 h-4 text-[#6b6b80]" />
          </button>
        </form>

        {/* Filter Row */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-white/80 rounded-xl border border-[#e8e4f0]">
            <select
              value={category}
              onChange={e => { setCategory(e.target.value); setTimeout(fetchTasks, 0); }}
              className="px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            >
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={sort}
              onChange={e => { setSort(e.target.value); setTimeout(fetchTasks, 0); }}
              className="px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            >
              <option value="recent">Most Recent</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
              <option value="deadline">Shortest Deadline</option>
            </select>

            {(category || query) && (
              <button
                onClick={() => { setCategory(''); setQuery(''); setTimeout(fetchTasks, 0); }}
                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs text-[#a78bfa] hover:bg-[#f3f0f8]"
              >
                <X className="w-3 h-3" /> Clear filters
              </button>
            )}
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-56 rounded-2xl bg-white/50 border border-[#e8e4f0] animate-pulse" />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-16">
            <Briefcase className="w-12 h-12 text-[#e8e4f0] mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#1f1f2e] mb-2">No tasks found</h3>
            <p className="text-[#6b6b80] mb-6">
              {query ? `No results for "${query}"` : 'No active tasks at the moment'}
            </p>
            {query && (
              <button onClick={() => { setQuery(''); fetchTasks(); }} className="text-sm text-[#a78bfa] font-medium">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tasks.map(task => (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="group p-6 rounded-2xl bg-white/80 border border-[#e8e4f0] hover:border-[#c4b5fd] hover:shadow-soft transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs font-medium text-[#a0a0b0] capitalize">{task.category}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${getTierColor(task.minTier)}`}>
                    {task.minTier}+
                  </span>
                </div>

                <h3 className="font-semibold text-[#1f1f2e] mb-2 line-clamp-2 group-hover:text-[#8b5cf6] transition-colors">
                  {task.title}
                </h3>

                <p className="text-sm text-[#6b6b80] line-clamp-2 mb-4">
                  {task.spec.substring(0, 120)}{task.spec.length > 120 ? '...' : ''}
                </p>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3 text-[#6b6b80]">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" />
                      ${(task.priceInCents / 100).toFixed(0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {task.deadlineHours}h
                    </span>
                  </div>
                  <span className="text-xs text-[#a0a0b0]">{task.companyName}</span>
                </div>

                {task.requiredSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {task.requiredSkills.slice(0, 3).map(s => (
                      <span key={s} className="text-[10px] px-2 py-0.5 rounded bg-[#f3f0f8] text-[#6b6b80]">{s}</span>
                    ))}
                    {task.requiredSkills.length > 3 && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#f3f0f8] text-[#a0a0b0]">
                        +{task.requiredSkills.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Apply CTA */}
        {tasks.length > 0 && (
          <div className="mt-12 text-center">
            <p className="text-[#6b6b80] mb-4">Want to work on these tasks?</p>
            <Link
              href="/become-contractor"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-medium"
              style={{ background: 'var(--gradient-fig)' }}
            >
              Become a Contractor <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedTask(null)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Modal */}
          <div
            className="relative bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Gradient header */}
            <div
              className="h-2 rounded-t-2xl"
              style={{ background: 'var(--gradient-fig)' }}
            />

            {/* Close */}
            <button
              onClick={() => setSelectedTask(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-[#f3f0f8] hover:bg-[#e8e4f0] transition-colors"
            >
              <X className="w-4 h-4 text-[#6b6b80]" />
            </button>

            <div className="p-8">
              {/* Category + Tier */}
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-medium text-[#a0a0b0] capitalize">{selectedTask.category}</span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full capitalize ${getTierColor(selectedTask.minTier)}`}>
                  {selectedTask.minTier}+ required
                </span>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-bold text-[#1f1f2e] mb-2">{selectedTask.title}</h2>

              {/* Company */}
              <div className="flex items-center gap-2 text-sm text-[#6b6b80] mb-6">
                <Building2 className="w-4 h-4" />
                <span>{selectedTask.companyName}</span>
              </div>

              {/* Key Info Cards */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="p-4 rounded-xl bg-[#faf8fc] text-center">
                  <DollarSign className="w-5 h-5 text-[#a78bfa] mx-auto mb-1" />
                  <p className="text-xl font-bold text-[#1f1f2e]">${(selectedTask.priceInCents / 100).toFixed(0)}</p>
                  <p className="text-[10px] text-[#a0a0b0]">Payment</p>
                </div>
                <div className="p-4 rounded-xl bg-[#faf8fc] text-center">
                  <Clock className="w-5 h-5 text-[#a78bfa] mx-auto mb-1" />
                  <p className="text-xl font-bold text-[#1f1f2e]">{selectedTask.deadlineHours}h</p>
                  <p className="text-[10px] text-[#a0a0b0]">Deadline</p>
                </div>
                <div className="p-4 rounded-xl bg-[#faf8fc] text-center">
                  <Zap className="w-5 h-5 text-[#a78bfa] mx-auto mb-1" />
                  <p className="text-xl font-bold text-[#1f1f2e]">{selectedTask.complexityScore}/5</p>
                  <p className="text-[10px] text-[#a0a0b0]">Complexity</p>
                </div>
              </div>

              {/* Description */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-[#1f1f2e] mb-2">Task Description</h3>
                <p className="text-sm text-[#6b6b80] leading-relaxed whitespace-pre-wrap">
                  {selectedTask.spec}
                </p>
              </div>

              {/* Required Skills */}
              {selectedTask.requiredSkills.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-[#1f1f2e] mb-2">Required Skills</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedTask.requiredSkills.map(skill => (
                      <span key={skill} className="px-3 py-1 rounded-lg bg-[#f3f0f8] text-sm text-[#6b6b80]">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Trust Indicators */}
              <div className="flex items-center gap-4 mb-8 text-xs text-[#a0a0b0]">
                <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-[#a78bfa]" /> Escrow protected</span>
                <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-[#a78bfa]" /> QA verified</span>
                {selectedTask.publishedAt && (
                  <span>Posted {new Date(selectedTask.publishedAt).toLocaleDateString()}</span>
                )}
              </div>

              {/* CTA */}
              <div className="flex items-center gap-3">
                <Link
                  href="/sign-up"
                  onClick={() => localStorage.setItem('figwork_role', 'student')}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold transition-all hover:shadow-glow hover:-translate-y-0.5"
                  style={{ background: 'var(--gradient-fig)' }}
                >
                  Apply as Contractor
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="px-6 py-3 rounded-xl text-[#6b6b80] font-medium border border-[#e8e4f0] hover:border-[#c4b5fd] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
