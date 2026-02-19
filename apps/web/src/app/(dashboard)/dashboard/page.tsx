'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Plus,
  Briefcase,
  ClipboardCheck,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  getWorkUnits,
  getCompanyBalance,
  getReviewQueue,
  getCompanyDisputes,
  WorkUnit,
} from '@/lib/marketplace-api';

export default function DashboardPage() {
  const { getToken } = useAuth();
  const [workUnits, setWorkUnits] = useState<WorkUnit[]>([]);
  const [balance, setBalance] = useState<any>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [disputeCount, setDisputeCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = await getToken();
        if (!token) return;

        const [wuRes, balRes, reviewRes, disputeRes] = await Promise.all([
          getWorkUnits(token).catch(() => []),
          getCompanyBalance(token).catch(() => null),
          getReviewQueue(token).catch(() => ({ executions: [] })),
          getCompanyDisputes(token).catch(() => ({ disputes: [] })),
        ]);

        setWorkUnits(Array.isArray(wuRes) ? wuRes : []);
        setBalance(balRes);
        setReviewCount((reviewRes as any)?.executions?.length || 0);
        setDisputeCount(
          ((disputeRes as any)?.disputes || []).filter(
            (d: any) => d.status === 'filed' || d.status === 'under_review'
          ).length
        );
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [getToken]);

  const activeUnits = workUnits.filter(w => w.status === 'active' || w.status === 'in_progress').length;
  const completedUnits = workUnits.filter(w => w.status === 'completed').length;

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="grid grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">
          Manage your tasks and track deliverables.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <Briefcase className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">{activeUnits}</p>
                <p className="text-sm text-text-secondary">Active Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-amber-50">
                <ClipboardCheck className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">{reviewCount}</p>
                <p className="text-sm text-text-secondary">Awaiting Review</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-green-50">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">{completedUnits}</p>
                <p className="text-sm text-text-secondary">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-emerald-50">
                <DollarSign className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  ${balance ? ((balance.monthlySpendInCents || 0) / 100).toLocaleString() : '0'}
                </p>
                <p className="text-sm text-text-secondary">This Month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Alerts */}
      {(reviewCount > 0 || disputeCount > 0) && (
        <div className="flex flex-wrap gap-4 mb-10">
          {reviewCount > 0 && (
            <Link
              href="/dashboard/review-queue"
              className="flex items-center gap-3 px-5 py-3 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <ClipboardCheck className="w-5 h-5 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                {reviewCount} submission{reviewCount > 1 ? 's' : ''} awaiting review
              </span>
              <ArrowRight className="w-4 h-4 text-amber-600" />
            </Link>
          )}
          {disputeCount > 0 && (
            <Link
              href="/dashboard/disputes"
              className="flex items-center gap-3 px-5 py-3 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
            >
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="text-sm font-medium text-red-800">
                {disputeCount} open dispute{disputeCount > 1 ? 's' : ''}
              </span>
              <ArrowRight className="w-4 h-4 text-red-600" />
            </Link>
          )}
        </div>
      )}

      {/* Work Units */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Your Work Units</h2>
          <Link
            href="/dashboard/workunits"
            className="text-sm text-primary hover:text-primary-dark"
          >
            View all
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workUnits.slice(0, 5).map(wu => (
            <Link key={wu.id} href={`/dashboard/workunits/${wu.id}`}>
              <Card className="hover:shadow-soft-lg cursor-pointer group">
                <div
                  className="h-1.5 opacity-60 group-hover:opacity-100 transition-opacity rounded-t-lg"
                  style={{ background: 'var(--gradient-fig)' }}
                />
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-text-secondary capitalize">
                      {wu.category}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        wu.status === 'active'
                          ? 'bg-green-50 text-green-700'
                          : wu.status === 'in_progress'
                          ? 'bg-blue-50 text-blue-700'
                          : wu.status === 'draft'
                          ? 'bg-gray-50 text-gray-600'
                          : 'bg-violet-50 text-violet-700'
                      }`}
                    >
                      {wu.status}
                    </span>
                  </div>
                  <h3 className="font-semibold text-text-primary mb-3 group-hover:text-primary-dark transition-colors line-clamp-1">
                    {wu.title}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-text-secondary">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" />
                      ${(wu.priceInCents / 100).toFixed(0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {wu.deadlineHours}h
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {/* New Work Unit */}
          <Link href="/dashboard/workunits/new">
            <Card className="h-full min-h-[140px] border-2 border-dashed hover:border-primary-light cursor-pointer flex items-center justify-center group">
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <span className="text-text-secondary font-medium group-hover:text-text-primary transition-colors">
                  Post New Task
                </span>
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/dashboard/workunits/new"
          className="p-4 rounded-xl border border-border-light hover:border-primary-light hover:bg-white/60 transition-all flex items-center gap-3"
        >
          <Briefcase className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium text-text-primary text-sm">Post a Task</p>
            <p className="text-xs text-text-secondary">Describe work and set a budget</p>
          </div>
        </Link>
        <Link
          href="/dashboard/review-queue"
          className="p-4 rounded-xl border border-border-light hover:border-primary-light hover:bg-white/60 transition-all flex items-center gap-3"
        >
          <ClipboardCheck className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium text-text-primary text-sm">Review Submissions</p>
            <p className="text-xs text-text-secondary">Approve or request revisions</p>
          </div>
        </Link>
        <Link
          href="/dashboard/billing"
          className="p-4 rounded-xl border border-border-light hover:border-primary-light hover:bg-white/60 transition-all flex items-center gap-3"
        >
          <DollarSign className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium text-text-primary text-sm">Billing & Budget</p>
            <p className="text-xs text-text-secondary">Invoices, escrow, and budget caps</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
