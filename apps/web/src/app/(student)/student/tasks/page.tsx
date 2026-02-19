'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import {
  Search,
  Clock,
  DollarSign,
  ChevronRight,
  MapPin,
  AlertCircle,
  Mic,
  Users,
} from 'lucide-react';
import {
  getAvailableTasks,
  WorkUnit,
} from '@/lib/marketplace-api';

const TIER_BADGE: Record<string, { label: string; className: string }> = {
  novice: { label: 'Novice+', className: 'bg-border-light text-text-secondary' },
  pro: { label: 'Pro+', className: 'bg-primary-light/20 text-primary-dark' },
  elite: { label: 'Elite', className: 'bg-accent-light text-amber-700' },
};

export default function AvailableTasksPage() {
  const { getToken } = useAuth();
  const [tasks, setTasks] = useState<WorkUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const data = await getAvailableTasks(token);
      setTasks(data?.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }

  const categories = ['all', ...Array.from(new Set(tasks.map(t => t.category)))];

  const filtered = tasks.filter(t => {
    const matchesSearch = !search || 
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.spec.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Available Tasks</h1>
        <p className="text-text-secondary mt-1">Find tasks that match your skills and tier</p>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200',
                categoryFilter === cat
                  ? 'bg-primary-light/20 text-primary-dark'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/60'
              )}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="p-4 mb-6 !border-red-200 !bg-red-50/50">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
            <p className="text-sm text-red-600 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-slate-200 p-6">
              <div className="h-5 bg-slate-200 rounded w-2/3 mb-3"></div>
              <div className="h-3 bg-slate-100 rounded w-full mb-2"></div>
              <div className="h-3 bg-slate-100 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Search className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No tasks found</h3>
          <p className="text-slate-500">Try adjusting your filters or check back later</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(task => {
            const tierBadge = TIER_BADGE[task.minTier] || TIER_BADGE.novice;
            const hasScreening = !!task.infoCollectionTemplateId;
            const isManual = task.assignmentMode === 'manual';
            return (
              <Link
                key={task.id}
                href={`/student/tasks/${task.id}`}
                className="card p-6 hover:shadow-soft-lg transition-all duration-300 block"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h3 className="font-semibold text-text-primary truncate">{task.title}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierBadge.className}`}>
                        {tierBadge.label}
                      </span>
                      {hasScreening && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                          <Mic className="w-3 h-3" />
                          Interview
                        </span>
                      )}
                      {isManual && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                          <Users className="w-3 h-3" />
                          Manual
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary line-clamp-2 mb-3">{task.spec}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5" />
                        ${(task.priceInCents / 100).toFixed(0)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {task.deadlineHours}h deadline
                      </span>
                      <span className="px-2 py-0.5 bg-border-light rounded text-xs">{task.category}</span>
                      {task.company && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {task.company.companyName}
                        </span>
                      )}
                    </div>
                    {task.requiredSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {task.requiredSkills.map(skill => (
                          <span key={skill} className="px-2 py-0.5 bg-primary-light/20 text-primary-dark rounded text-xs">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="text-lg font-bold text-text-primary">${(task.priceInCents / 100).toFixed(0)}</div>
                    {task.estimatedPayout != null && (
                      <div className="text-xs text-green-600 font-medium">~${(task.estimatedPayout / 100).toFixed(0)} payout</div>
                    )}
                    <div className="flex items-center gap-1 text-sm text-primary font-medium mt-1">
                      View Details
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
