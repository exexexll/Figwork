'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import {
  ArrowLeft,
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  MapPin,
  Shield,
  Target,
  FileText,
  Mic,
  Users,
  Zap,
  ChevronRight,
  Loader2,
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { getTaskDetail, acceptTask, TaskDetail } from '@/lib/marketplace-api';
import { track, EVENTS } from '@/lib/analytics';

const TIER_BADGE: Record<string, { label: string; className: string }> = {
  novice: { label: 'Novice+', className: 'bg-slate-100 text-slate-600' },
  pro: { label: 'Pro+', className: 'bg-purple-100 text-purple-700' },
  elite: { label: 'Elite', className: 'bg-amber-100 text-amber-700' },
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskId = params.id as string;

  useEffect(() => {
    loadTask();
  }, [taskId]);

  async function loadTask() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const data = await getTaskDetail(taskId, token);
      setTask(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    try {
      setAccepting(true);
      setError(null);
      const token = await getToken();
      if (!token) return;
      const result = await acceptTask(taskId, token);
      track(EVENTS.TASK_ACCEPTED, { workUnitId: taskId, requiresScreening: result.requiresScreening });

      // Redirect to execution detail (which will show interview banner if needed)
      router.push(`/student/executions/${result.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept task';
      setError(message);
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-slate-200 rounded w-32"></div>
          <div className="h-10 bg-slate-200 rounded w-2/3"></div>
          <div className="h-48 bg-slate-200 rounded-2xl"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-slate-200 rounded-xl"></div>
            <div className="h-24 bg-slate-200 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-700 mb-1">Task not found</h2>
        <p className="text-slate-500 mb-4">{error || 'This task may have been removed or is no longer available.'}</p>
        <Link href="/student/tasks" className="text-blue-600 hover:text-blue-700 text-sm font-medium">
          ← Back to Available Tasks
        </Link>
      </div>
    );
  }

  const tierBadge = TIER_BADGE[task.minTier] || TIER_BADGE.novice;
  const criteria = task.acceptanceCriteria || [];
  const formats = task.deliverableFormat || [];
  const milestones = task.milestoneTemplates || [];
  const elig = task.eligibility;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <Link
        href="/student/tasks"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Available Tasks
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{task.title}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierBadge.className}`}>
                {tierBadge.label}
              </span>
              {task.requiresScreening && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                  <Mic className="w-3 h-3" />
                  Screening Required
                </span>
              )}
              {task.assignmentMode === 'manual' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  <Users className="w-3 h-3" />
                  Manual Review
                </span>
              )}
            </div>
            {task.company && (
              <p className="text-sm text-slate-500 flex items-center gap-1 mb-3">
                <MapPin className="w-3.5 h-3.5" />
                {task.company.companyName}
              </p>
            )}
          </div>

          {/* Price + Payout */}
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">${(task.priceInCents / 100).toFixed(0)}</div>
            {task.estimatedPayout != null && (
              <div className="text-sm text-green-600 font-medium">
                ~${(task.estimatedPayout / 100).toFixed(0)} your payout
              </div>
            )}
          </div>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-t border-slate-100">
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />Deadline</div>
            <div className="font-semibold text-slate-900">{task.deadlineHours}h</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Complexity</div>
            <div className="font-semibold text-slate-900">
              {task.complexityScore}/5 — {['Simple', 'Easy', 'Medium', 'Hard', 'Expert'][task.complexityScore - 1]}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Revisions</div>
            <div className="font-semibold text-slate-900">Up to {task.revisionLimit ?? 2}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Match Score</div>
            <div className="font-semibold text-blue-600">{task.matchScore != null ? `${Math.round(task.matchScore * 100)}%` : '—'}</div>
          </div>
        </div>

        {/* Eligibility */}
        {elig && !elig.eligible && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-medium text-red-800 mb-1">You can't accept this task:</p>
            <ul className="text-xs text-red-700 space-y-0.5">
              {!elig.meetsComplexity && <li>• Task complexity exceeds your tier limit</li>}
              {!elig.meetsTier && <li>• Requires a higher tier than your current level</li>}
              {elig.alreadyAccepted && <li>• You already have an active execution for this task</li>}
            </ul>
          </div>
        )}

        {/* Accept button */}
        {elig && elig.eligible && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {task.requiresScreening && (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1">
                <Mic className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>After accepting, you'll complete a screening interview before starting work.</span>
              </div>
            )}
            {task.assignmentMode === 'manual' && !task.requiresScreening && (
              <div className="flex items-start gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 flex-1">
                <Users className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>This task uses manual review — the company will review your profile before assignment.</span>
              </div>
            )}
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="btn-primary !px-8 !py-3 text-sm font-semibold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {accepting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {task.assignmentMode === 'manual' ? 'Apply for Task' : 'Accept Task'}
            </button>
          </div>
        )}
      </div>

      {/* Specification */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500" />
          Task Specification
        </h2>
        <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{task.spec}</div>
      </div>

      {/* Skills */}
      {task.requiredSkills.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3">Required Skills</h2>
          <div className="flex flex-wrap gap-2">
            {task.requiredSkills.map(skill => {
              const isMatch = elig?.skillMatch?.includes(skill);
              return (
                <span
                  key={skill}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
                    isMatch
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  )}
                >
                  {isMatch ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {skill}
                </span>
              );
            })}
          </div>
          {elig && elig.missingSkills.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              You're missing {elig.missingSkills.length} skill{elig.missingSkills.length > 1 ? 's' : ''} — you can still accept but may score lower.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Acceptance Criteria */}
        {criteria.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-slate-500" />
              Acceptance Criteria
            </h2>
            <div className="space-y-2">
              {criteria.map((ac, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    ac.required ? 'bg-red-100' : 'bg-slate-100'
                  )}>
                    <span className="text-[10px] font-bold text-slate-600">{i + 1}</span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-700">{ac.criterion}</p>
                    {ac.required && (
                      <span className="text-[10px] font-medium text-red-600 uppercase">Required</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deliverable Format */}
        {formats.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              Deliverable Format
            </h2>
            <ul className="space-y-2">
              {formats.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-700">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Milestones */}
      {milestones.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3">Milestones ({milestones.length})</h2>
          <div className="space-y-3">
            {milestones.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-slate-600">{i + 1}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-700">{m.description}</p>
                  <p className="text-xs text-slate-400">
                    Expected at {Math.round(m.expectedCompletion * 100)}% completion
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Screening Info */}
      {task.requiresScreening && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
          <h2 className="font-semibold text-amber-900 mb-2 flex items-center gap-2">
            <Mic className="w-4 h-4" />
            Screening Interview Required
          </h2>
          <p className="text-sm text-amber-800 mb-3">
            This task requires you to complete an AI-powered screening interview before you can start working.
            The interview assesses your fit for this specific task.
          </p>
          <div className="text-xs text-amber-700 space-y-1">
            <p>• You'll be asked questions relevant to the task requirements</p>
            <p>• The interview typically takes 5-15 minutes</p>
            <p>• Your responses are reviewed {task.assignmentMode === 'manual' ? 'by the company' : 'automatically'} before you can clock in</p>
          </div>
        </div>
      )}
    </div>
  );
}
