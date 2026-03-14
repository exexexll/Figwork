'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import {
  Sparkles,
  Clock,
  DollarSign,
  ChevronRight,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import {
  getDailyTasks,
  consumeDailyTask,
  DailyTask,
} from '@/lib/marketplace-api';

const ACCENT = '#a2a3fc';

export default function DailyTasksPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) return;
      const data = await getDailyTasks(token);
      setTasks(data?.tasks || []);
      setRefreshedAt(data?.refreshedAt || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load daily tasks');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadTasks();
    setRefreshing(false);
  }

  async function handleConsumeTask(taskId: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await consumeDailyTask(taskId, token);
      // Navigate to task detail page
      router.push(`/student/tasks/${taskId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start task');
    }
  }

  const getMatchScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-600 bg-green-50';
    if (score >= 70) return 'text-blue-600 bg-blue-50';
    if (score >= 50) return 'text-yellow-600 bg-yellow-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getMatchScoreLabel = (score: number) => {
    if (score >= 85) return 'Strong Match';
    if (score >= 70) return 'Good Match';
    if (score >= 50) return 'Fair Match';
    return 'Basic Match';
  };

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#f0f0ff] flex items-center justify-center">
              <Sparkles className="w-5 h-5" style={{ color: ACCENT }} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[#1f1f2e]">Daily Recommended Tasks</h1>
              <p className="text-sm text-[#6b6b80] mt-0.5">
                Personalized tasks matched to your skills and experience
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              'bg-white border border-[#f0f0f5] text-[#1f1f2e] hover:border-[#a2a3fc] hover:bg-[#f0f0ff]',
              (refreshing || loading) && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
        {refreshedAt && (
          <p className="text-xs text-[#a0a0b0] ml-14">
            Last updated: {new Date(refreshedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* Info Card */}
      <Card className="p-4 mb-6 !border-[#e0e0f0] !bg-[#f0f0ff]">
        <div className="flex items-start gap-3">
          <BookOpen className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
          <div className="flex-1">
            <p className="text-sm text-[#6b6b80]">
              <strong className="text-[#1f1f2e]">Tip:</strong> Complete quizzes to unlock more daily tasks and improve your match scores.
            </p>
            <Link
              href="/student/quiz"
              className="inline-flex items-center gap-1 text-sm font-medium mt-2"
              style={{ color: ACCENT }}
            >
              Take a Quiz
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card className="p-4 mb-6 !border-[#e0e0f0] !bg-[#f0f0ff]">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: ACCENT }} />
            <div className="flex-1">
              <p className="text-sm text-[#6b6b80]">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs mt-2 text-[#a2a3fc] hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse bg-white rounded-xl border border-[#f0f0f5] p-6">
              <div className="h-5 bg-[#f5f5ff] rounded w-2/3 mb-3"></div>
              <div className="h-3 bg-[#f5f5f5] rounded w-full mb-2"></div>
              <div className="h-3 bg-[#f5f5f5] rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#f0f0f5] p-12 text-center">
          <Sparkles className="w-12 h-12 text-[#e0e0e8] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#1f1f2e] mb-1">No recommended tasks yet</h3>
          <p className="text-[#6b6b80] mb-4">
            Complete quizzes or check back later for personalized recommendations
          </p>
          <Link
            href="/student/quiz"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ backgroundColor: ACCENT }}
          >
            <BookOpen className="w-4 h-4" />
            Take a Quiz
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map(task => {
            const matchScoreColor = getMatchScoreColor(task.matchScore);
            const matchScoreLabel = getMatchScoreLabel(task.matchScore);
            return (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-[#f0f0f5] p-6 hover:border-[#a2a3fc] hover:shadow-sm transition-all duration-200"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Match Score Badge */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <span className={cn('px-2.5 py-1 rounded-lg text-xs font-semibold', matchScoreColor)}>
                        {matchScoreLabel} • {Math.round(task.matchScore)}%
                      </span>
                      <TrendingUp className="w-4 h-4 text-[#a2a3fc]" />
                    </div>

                    {/* Title */}
                    <h3 className="font-semibold text-[#1f1f2e] mb-2">{task.title}</h3>
                    <p className="text-sm text-[#6b6b80] line-clamp-2 mb-3">{task.spec}</p>

                    {/* Match Reasons */}
                    {task.dailyReasons && task.dailyReasons.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-medium text-[#6b6b80] mb-1.5">Why this matches:</p>
                        <ul className="space-y-1">
                          {task.dailyReasons.map((reason, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-xs text-[#6b6b80]">
                              <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-green-500" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#a0a0b0]">
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5" />
                        ${(task.priceInCents / 100).toFixed(0)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {task.deadlineHours}h deadline
                      </span>
                      <span className="px-2 py-0.5 bg-[#f5f5f5] rounded text-xs">{task.category}</span>
                      {task.company && (
                        <span>{task.company.companyName}</span>
                      )}
                    </div>

                    {/* Skills */}
                    {task.requiredSkills && task.requiredSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {task.requiredSkills.map(skill => (
                          <span key={skill} className="px-2 py-0.5 bg-[#f0f0ff] text-[#a2a3fc] rounded text-xs">
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-bold text-[#1f1f2e]">
                        ${(task.priceInCents / 100).toFixed(0)}
                      </div>
                      {task.estimatedPayout != null && (
                        <div className="text-xs text-[#a2a3fc] font-medium">
                          ~${(task.estimatedPayout / 100).toFixed(0)} payout
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleConsumeTask(task.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
                      style={{ backgroundColor: ACCENT }}
                    >
                      Start Task
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
