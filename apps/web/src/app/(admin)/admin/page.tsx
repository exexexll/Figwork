'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Users,
  Briefcase,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';

interface Analytics {
  students: {
    total: number;
    active: number;
    byTier: Record<string, number>;
  };
  workUnits: {
    total: number;
    active: number;
    byCategory: Record<string, number>;
  };
  executions: {
    total: number;
    completed: number;
    inProgress: number;
    avgQualityScore: number;
    avgCompletionTime: number;
  };
  payouts: {
    totalPaid: number;
    pending: number;
  };
  disputes: {
    open: number;
    resolved: number;
  };
}

export default function AdminOverviewPage() {
  const { getToken } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  async function fetchAnalytics() {
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="grid grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-border/50 rounded-lg" />
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
        <h1 className="text-2xl font-semibold text-text-primary">Admin Dashboard</h1>
        <p className="text-text-secondary mt-1">Platform overview and quick actions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="card">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  {analytics?.students.total || 0}
                </p>
                <p className="text-sm text-text-secondary">Total Students</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-light">
              <span className="text-green-600 text-sm font-medium">
                {analytics?.students.active || 0} active
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-50">
                <Briefcase className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  {analytics?.workUnits.total || 0}
                </p>
                <p className="text-sm text-text-secondary">Work Units</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-light">
              <span className="text-blue-600 text-sm font-medium">
                {analytics?.workUnits.active || 0} active
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-green-50">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  ${((analytics?.payouts.totalPaid || 0) / 100).toLocaleString()}
                </p>
                <p className="text-sm text-text-secondary">Total Paid Out</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-light">
              <span className="text-amber-600 text-sm font-medium">
                ${((analytics?.payouts.pending || 0) / 100).toLocaleString()} pending
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-red-50">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  {analytics?.disputes.open || 0}
                </p>
                <p className="text-sm text-text-secondary">Open Disputes</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-light">
              <Link href="/admin/disputes" className="text-primary text-sm font-medium">
                View all →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        {/* Execution Stats */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Execution Metrics</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-text-secondary">Completed</span>
                </div>
                <span className="font-semibold text-text-primary">
                  {analytics?.executions.completed || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span className="text-text-secondary">In Progress</span>
                </div>
                <span className="font-semibold text-text-primary">
                  {analytics?.executions.inProgress || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  <span className="text-text-secondary">Avg Quality Score</span>
                </div>
                <span className="font-semibold text-text-primary">
                  {Math.round((analytics?.executions.avgQualityScore || 0) * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tier Distribution */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Student Tiers</h2>
            <div className="space-y-3">
              {['elite', 'pro', 'novice'].map(tier => {
                const count = analytics?.students.byTier?.[tier] || 0;
                const total = analytics?.students.total || 1;
                const percentage = (count / total) * 100;

                return (
                  <div key={tier}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium capitalize text-text-primary">
                        {tier}
                      </span>
                      <span className="text-sm text-text-secondary">{count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          width: `${percentage}%`,
                          background:
                            tier === 'elite'
                              ? 'linear-gradient(to right, #7c3aed, #a78bfa)'
                              : tier === 'pro'
                              ? 'linear-gradient(to right, #3b82f6, #93c5fd)'
                              : 'linear-gradient(to right, #6b7280, #9ca3af)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              href="/admin/disputes?status=filed"
              className="p-4 rounded-lg border border-border-light hover:border-primary-light hover:bg-white/60 transition-all text-center"
            >
              <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-500" />
              <span className="text-sm font-medium text-text-primary">New Disputes</span>
            </Link>
            <Link
              href="/admin/students?kycStatus=pending"
              className="p-4 rounded-lg border border-border-light hover:border-primary-light hover:bg-white/60 transition-all text-center"
            >
              <Users className="w-6 h-6 mx-auto mb-2 text-blue-500" />
              <span className="text-sm font-medium text-text-primary">Pending KYC</span>
            </Link>
            <button
              onClick={() => runEarlyWarnings()}
              className="p-4 rounded-lg border border-border-light hover:border-primary-light hover:bg-white/60 transition-all text-center"
            >
              <Clock className="w-6 h-6 mx-auto mb-2 text-red-500" />
              <span className="text-sm font-medium text-text-primary">Run Warnings</span>
            </button>
            <button
              onClick={() => runCoaching()}
              className="p-4 rounded-lg border border-border-light hover:border-primary-light hover:bg-white/60 transition-all text-center"
            >
              <TrendingUp className="w-6 h-6 mx-auto mb-2 text-green-500" />
              <span className="text-sm font-medium text-text-primary">Run Coaching</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  async function runEarlyWarnings() {
    const token = await getToken();
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/run-early-warnings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    alert('Early warnings check initiated');
  }

  async function runCoaching() {
    const token = await getToken();
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/run-coaching`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    alert('Coaching check initiated');
  }
}
