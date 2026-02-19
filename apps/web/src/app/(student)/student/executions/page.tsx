'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Play,
  Pause,
  Upload,
  RotateCcw,
  X,
} from 'lucide-react';
import { getStudentExecutions, clockIn, clockOut, Execution } from '@/lib/marketplace-api';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending_screening: { label: 'Screening', color: 'bg-amber-100 text-amber-700', icon: Clock },
  pending_review: { label: 'Under Review', color: 'bg-purple-100 text-purple-700', icon: Clock },
  assigned: { label: 'Assigned', color: 'bg-slate-100 text-slate-700', icon: Clock },
  clocked_in: { label: 'Working', color: 'bg-green-100 text-green-700', icon: Play },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700', icon: Upload },
  in_review: { label: 'In Review', color: 'bg-purple-100 text-purple-700', icon: Clock },
  revision_needed: { label: 'Revision', color: 'bg-orange-100 text-orange-700', icon: RotateCcw },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: X },
  cancelled: { label: 'Cancelled', color: 'bg-slate-100 text-slate-500', icon: X },
};

export default function ExecutionsPage() {
  const { getToken } = useAuth();
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'completed' | 'all'>('active');

  useEffect(() => {
    loadExecutions();
  }, []);

  async function loadExecutions() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const data = await getStudentExecutions(token);
      setExecutions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load executions:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleClockIn(executionId: string) {
    try {
      setActionLoading(executionId);
      const token = await getToken();
      if (!token) return;
      await clockIn(executionId, token);
      await loadExecutions();
    } catch (err) {
      console.error('Clock in failed:', err);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleClockOut(executionId: string) {
    try {
      setActionLoading(executionId);
      const token = await getToken();
      if (!token) return;
      await clockOut(executionId, token);
      await loadExecutions();
    } catch (err) {
      console.error('Clock out failed:', err);
    } finally {
      setActionLoading(null);
    }
  }

  const activeStatuses = ['pending_screening', 'pending_review', 'assigned', 'clocked_in', 'submitted', 'in_review', 'revision_needed'];
  const completedStatuses = ['approved', 'failed', 'cancelled'];

  const filtered = executions.filter(e => {
    if (filter === 'active') return activeStatuses.includes(e.status);
    if (filter === 'completed') return completedStatuses.includes(e.status);
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">My Work</h1>
        <p className="text-slate-500 mt-1">Track and manage your active and past tasks</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6">
        {(['active', 'completed', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f} ({executions.filter(e => {
              if (f === 'active') return activeStatuses.includes(e.status);
              if (f === 'completed') return completedStatuses.includes(e.status);
              return true;
            }).length})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border p-6">
              <div className="h-5 bg-slate-200 rounded w-1/2 mb-3"></div>
              <div className="h-3 bg-slate-100 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">
            {filter === 'active' ? 'No active tasks' : 'No completed tasks'}
          </h3>
          <p className="text-slate-500">
            {filter === 'active' ? 'Accept a task to get started' : 'Complete tasks to see them here'}
          </p>
          {filter === 'active' && (
            <Link href="/student/tasks" className="inline-flex items-center gap-2 mt-4 text-blue-600 text-sm font-medium">
              Browse Tasks <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(execution => {
            const statusConfig = STATUS_CONFIG[execution.status] || STATUS_CONFIG.assigned;
            const StatusIcon = statusConfig.icon;
            const isDeadlineSoon = execution.deadlineAt && 
              new Date(execution.deadlineAt).getTime() - Date.now() < 6 * 60 * 60 * 1000;

            return (
              <div key={execution.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Link
                          href={`/student/executions/${execution.id}`}
                          className="font-semibold text-slate-900 hover:text-blue-600 truncate"
                        >
                          {execution.workUnit?.title || 'Task'}
                        </Link>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${statusConfig.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {statusConfig.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                        {execution.workUnit?.priceInCents && (
                          <span>${(execution.workUnit.priceInCents / 100).toFixed(0)}</span>
                        )}
                        {execution.deadlineAt && (
                          <span className={isDeadlineSoon ? 'text-red-600 font-medium' : ''}>
                            Due: {new Date(execution.deadlineAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {execution.qualityScore != null && (
                          <span className="text-green-600">Quality: {execution.qualityScore}%</span>
                        )}
                        {execution.expEarned > 0 && (
                          <span className="text-purple-600">+{execution.expEarned} EXP</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {execution.status === 'pending_screening' && (
                        <span className="text-xs text-amber-600 font-medium px-3 py-1.5">
                          Complete interview →
                        </span>
                      )}
                      {execution.status === 'pending_review' && (
                        <span className="text-xs text-purple-600 font-medium px-3 py-1.5">
                          Awaiting company decision
                        </span>
                      )}
                      {execution.status === 'assigned' && (
                        <button
                          onClick={() => handleClockIn(execution.id)}
                          disabled={actionLoading === execution.id}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {actionLoading === execution.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <>
                              <Play className="w-4 h-4" />
                              Clock In
                            </>
                          )}
                        </button>
                      )}
                      {execution.status === 'clocked_in' && (
                        <button
                          onClick={() => handleClockOut(execution.id)}
                          disabled={actionLoading === execution.id}
                          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors"
                        >
                          <Pause className="w-4 h-4" />
                          Clock Out
                        </button>
                      )}
                      <Link
                        href={`/student/executions/${execution.id}`}
                        className="flex items-center gap-1 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                      >
                        Details
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Milestones progress bar */}
                {execution.milestones && execution.milestones.length > 0 && (
                  <div className="px-6 pb-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-slate-500">
                        {execution.milestones.filter(m => m.completedAt).length}/{execution.milestones.length} milestones
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{
                          width: `${(execution.milestones.filter(m => m.completedAt).length / execution.milestones.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
