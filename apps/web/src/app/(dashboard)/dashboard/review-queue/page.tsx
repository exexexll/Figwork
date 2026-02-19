'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronRight,
  User,
  Calendar,
  DollarSign,
  Star,
  RotateCcw,
} from 'lucide-react';

interface ReviewItem {
  id: string;
  workUnit: {
    id: string;
    title: string;
    priceInCents: number;
    category: string;
  };
  student: {
    id: string;
    name: string;
    tier: string;
    avgQualityScore: number;
    tasksCompleted: number;
  };
  status: string;
  submittedAt: string;
  deadlineAt: string;
  revisionCount: number;
  deliverableUrls: string[];
  priorityScore: number; // Calculated priority
}

export default function ReviewQueuePage() {
  const { getToken } = useAuth();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'priority' | 'deadline' | 'submitted'>('priority');
  const [filterStatus, setFilterStatus] = useState<string>('submitted');

  useEffect(() => {
    fetchReviewQueue();
  }, [filterStatus]);

  async function fetchReviewQueue() {
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/executions/review-queue?status=${filterStatus}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        // Calculate priority scores
        const withPriority = (data.executions || []).map((exec: any) => ({
          ...exec,
          priorityScore: calculatePriority(exec),
        }));
        setReviews(withPriority);
      }
    } catch (error) {
      console.error('Failed to fetch review queue:', error);
    } finally {
      setLoading(false);
    }
  }

  function calculatePriority(exec: any): number {
    let score = 50; // Base score

    // Deadline urgency (higher score for closer deadlines)
    const hoursRemaining = (new Date(exec.deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursRemaining < 0) score += 30; // Overdue
    else if (hoursRemaining < 2) score += 25;
    else if (hoursRemaining < 6) score += 15;
    else if (hoursRemaining < 12) score += 10;

    // Revision count (lower priority for many revisions)
    if (exec.revisionCount >= 2) score -= 10;

    // Task value (higher value = higher priority)
    if (exec.workUnit.priceInCents > 5000) score += 10;
    else if (exec.workUnit.priceInCents > 2000) score += 5;

    // Student tier (elite students get slightly higher priority)
    if (exec.student.tier === 'elite') score += 5;
    else if (exec.student.tier === 'pro') score += 3;

    // Quality score factor
    if (exec.student.avgQualityScore > 0.9) score += 5;
    else if (exec.student.avgQualityScore < 0.6) score -= 5;

    return Math.min(100, Math.max(0, score));
  }

  function sortReviews(items: ReviewItem[]): ReviewItem[] {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          return b.priorityScore - a.priorityScore;
        case 'deadline':
          return new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime();
        case 'submitted':
          return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
        default:
          return 0;
      }
    });
  }

  function getPriorityColor(score: number) {
    if (score >= 75) return 'bg-red-100 text-red-700 border-red-200';
    if (score >= 50) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-green-100 text-green-700 border-green-200';
  }

  function getPriorityLabel(score: number) {
    if (score >= 75) return 'High';
    if (score >= 50) return 'Medium';
    return 'Low';
  }

  function getTierBadgeColor(tier: string) {
    switch (tier) {
      case 'elite':
        return 'bg-violet-100 text-violet-700';
      case 'pro':
        return 'bg-blue-100 text-blue-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  function getTimeRemaining(deadline: string) {
    const hours = (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hours < 0) return { text: 'Overdue', urgent: true };
    if (hours < 2) return { text: `${Math.round(hours * 60)}m left`, urgent: true };
    if (hours < 24) return { text: `${Math.round(hours)}h left`, urgent: hours < 6 };
    return { text: `${Math.round(hours / 24)}d left`, urgent: false };
  }

  const sortedReviews = sortReviews(reviews);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Review Queue</h1>
        <p className="text-text-secondary mt-1">
          Submitted work awaiting your review, prioritized by urgency
        </p>
      </div>

      {/* Filters & Sorting */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="input text-sm"
          >
            <option value="submitted">Awaiting Review</option>
            <option value="revision_needed">Revisions Pending</option>
            <option value="approved">Recently Approved</option>
          </select>

          <span className="text-text-secondary text-sm">
            {reviews.length} item{reviews.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Sort by:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="input text-sm"
          >
            <option value="priority">Priority</option>
            <option value="deadline">Deadline</option>
            <option value="submitted">Submitted</option>
          </select>
        </div>
      </div>

      {/* Review Items */}
      {sortedReviews.length === 0 ? (
        <div className="card">
          <div className="p-12 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <CheckCircle className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-2">Queue Empty</h3>
            <p className="text-text-secondary max-w-sm mx-auto">
              {filterStatus === 'submitted'
                ? 'No submissions waiting for review. Great job staying on top of things!'
                : 'No items match the current filter.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedReviews.map(review => {
            const timeRemaining = getTimeRemaining(review.deadlineAt);

            return (
              <Link
                key={review.id}
                href={`/dashboard/workunits/${review.workUnit.id}/executions/${review.id}`}
                className="card block hover:shadow-soft-lg transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    {/* Left: Task & Student Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        {/* Priority Badge */}
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getPriorityColor(
                            review.priorityScore
                          )}`}
                        >
                          {getPriorityLabel(review.priorityScore)} Priority
                        </span>

                        {/* Revision Badge */}
                        {review.revisionCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700">
                            <RotateCcw className="w-3 h-3" />
                            Revision {review.revisionCount}
                          </span>
                        )}

                        {/* Deadline */}
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${
                            timeRemaining.urgent ? 'text-red-600 font-medium' : 'text-text-secondary'
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {timeRemaining.text}
                        </span>
                      </div>

                      <h3 className="font-semibold text-text-primary mb-1 truncate">
                        {review.workUnit.title}
                      </h3>

                      <div className="flex items-center gap-4 text-sm text-text-secondary">
                        {/* Student */}
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4" />
                          <span>{review.student.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getTierBadgeColor(
                              review.student.tier
                            )}`}
                          >
                            {review.student.tier}
                          </span>
                        </div>

                        {/* Quality Score */}
                        <div className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-amber-500" />
                          <span>{Math.round(review.student.avgQualityScore * 100)}%</span>
                        </div>

                        {/* Price */}
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-4 h-4" />
                          <span>${(review.workUnit.priceInCents / 100).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Action Arrow */}
                    <div className="flex items-center gap-4">
                      {review.deliverableUrls.length > 0 && (
                        <span className="text-xs text-text-secondary">
                          {review.deliverableUrls.length} deliverable
                          {review.deliverableUrls.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <ChevronRight className="w-5 h-5 text-text-secondary" />
                    </div>
                  </div>

                  {/* Submitted Date */}
                  <div className="mt-4 pt-4 border-t border-border-light flex items-center justify-between text-sm">
                    <span className="text-text-secondary">
                      Submitted {new Date(review.submittedAt).toLocaleDateString()} at{' '}
                      {new Date(review.submittedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span className="text-primary font-medium">Review →</span>
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
