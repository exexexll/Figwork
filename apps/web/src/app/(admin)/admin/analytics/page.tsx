'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Users,
  Briefcase,
  DollarSign,
  Clock,
  Star,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface Analytics {
  students: {
    total: number;
    active: number;
    byTier: Record<string, number>;
    newLast30Days: number;
  };
  workUnits: {
    total: number;
    active: number;
    byCategory: Record<string, number>;
    newLast30Days: number;
  };
  executions: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    avgQualityScore: number;
    avgCompletionTime: number;
    last30Days: number;
  };
  payouts: {
    totalPaid: number;
    pending: number;
    last30Days: number;
  };
  disputes: {
    open: number;
    resolved: number;
    avgResolutionTime: number;
  };
  quality: {
    avgQualityScore: number;
    avgOnTimeRate: number;
    avgRevisionRate: number;
    defectRate: number;
  };
}

export default function AdminAnalyticsPage() {
  const { getToken } = useAuth();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    fetchAnalytics();
  }, [period]);

  async function fetchAnalytics() {
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/analytics?period=${period}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Analytics</h1>
          <p className="text-text-secondary mt-1">Platform performance metrics and insights</p>
        </div>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as typeof period)}
          className="input"
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
          <option value="all">All Time</option>
        </select>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <MetricCard
          icon={<Users className="w-5 h-5" />}
          iconBg="bg-primary-light/20"
          iconColor="text-primary"
          title="Total Students"
          value={analytics?.students.total || 0}
          change={analytics?.students.newLast30Days || 0}
          changeLabel="new this month"
        />
        <MetricCard
          icon={<Briefcase className="w-5 h-5" />}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          title="Work Units"
          value={analytics?.workUnits.total || 0}
          change={analytics?.workUnits.active || 0}
          changeLabel="active"
        />
        <MetricCard
          icon={<CheckCircle className="w-5 h-5" />}
          iconBg="bg-green-100"
          iconColor="text-green-600"
          title="Executions"
          value={analytics?.executions.completed || 0}
          change={analytics?.executions.last30Days || 0}
          changeLabel="this month"
        />
        <MetricCard
          icon={<DollarSign className="w-5 h-5" />}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
          title="Total Paid"
          value={`$${((analytics?.payouts.totalPaid || 0) / 100).toLocaleString()}`}
          change={((analytics?.payouts.last30Days || 0) / 100)}
          changeLabel="this month"
          formatChange={v => `$${v.toLocaleString()}`}
        />
      </div>

      {/* Quality Metrics */}
      <div className="card mb-8">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-6">Quality Metrics</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <QualityMetric
              label="Avg Quality Score"
              value={analytics?.quality.avgQualityScore || 0}
              format={v => `${Math.round(v * 100)}%`}
              good={true}
            />
            <QualityMetric
              label="On-Time Rate"
              value={analytics?.quality.avgOnTimeRate || 0}
              format={v => `${Math.round(v * 100)}%`}
              good={true}
            />
            <QualityMetric
              label="Revision Rate"
              value={analytics?.quality.avgRevisionRate || 0}
              format={v => `${Math.round(v * 100)}%`}
              good={false}
            />
            <QualityMetric
              label="Defect Rate"
              value={analytics?.quality.defectRate || 0}
              format={v => `${Math.round(v * 100)}%`}
              good={false}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tier Distribution */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Student Tiers</h2>
            <div className="space-y-4">
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
                      <span className="text-sm text-text-secondary">
                        {count} ({Math.round(percentage)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div
                        className="h-3 rounded-full transition-all duration-500"
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

        {/* Category Distribution */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Work Unit Categories</h2>
            <div className="space-y-3">
              {Object.entries(analytics?.workUnits.byCategory || {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([category, count]) => {
                  const total = analytics?.workUnits.total || 1;
                  const percentage = (count / total) * 100;

                  return (
                    <div key={category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium capitalize text-text-primary">
                          {category}
                        </span>
                        <span className="text-sm text-text-secondary">{count}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Execution Breakdown */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Execution Status</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-600" />
                <p className="text-2xl font-semibold text-green-700">
                  {analytics?.executions.completed || 0}
                </p>
                <p className="text-xs text-green-600">Completed</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg text-center">
                <Clock className="w-6 h-6 mx-auto mb-2 text-blue-600" />
                <p className="text-2xl font-semibold text-blue-700">
                  {analytics?.executions.inProgress || 0}
                </p>
                <p className="text-xs text-blue-600">In Progress</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-red-600" />
                <p className="text-2xl font-semibold text-red-700">
                  {analytics?.executions.failed || 0}
                </p>
                <p className="text-xs text-red-600">Failed</p>
              </div>
              <div className="p-4 bg-amber-50 rounded-lg text-center">
                <Star className="w-6 h-6 mx-auto mb-2 text-amber-600" />
                <p className="text-2xl font-semibold text-amber-700">
                  {Math.round((analytics?.executions.avgQualityScore || 0) * 100)}%
                </p>
                <p className="text-xs text-amber-600">Avg Quality</p>
              </div>
            </div>
          </div>
        </div>

        {/* Disputes Summary */}
        <div className="card">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Disputes</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <span className="text-amber-800">Open Disputes</span>
                </div>
                <span className="text-xl font-semibold text-amber-700">
                  {analytics?.disputes.open || 0}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-green-800">Resolved</span>
                </div>
                <span className="text-xl font-semibold text-green-700">
                  {analytics?.disputes.resolved || 0}
                </span>
              </div>
              {analytics?.disputes.avgResolutionTime && (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-gray-600" />
                    <span className="text-gray-800">Avg Resolution Time</span>
                  </div>
                  <span className="text-xl font-semibold text-gray-700">
                    {Math.round(analytics.disputes.avgResolutionTime / 24)}d
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  iconBg,
  iconColor,
  title,
  value,
  change,
  changeLabel,
  formatChange,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  value: number | string;
  change: number;
  changeLabel: string;
  formatChange?: (v: number) => string;
}) {
  return (
    <div className="card">
      <div className="p-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconBg}`}>
            <div className={iconColor}>{icon}</div>
          </div>
          <div>
            <p className="text-2xl font-semibold text-text-primary">{value}</p>
            <p className="text-sm text-text-secondary">{title}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border-light">
          <span className="text-green-600 text-sm font-medium">
            +{formatChange ? formatChange(change) : change} {changeLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function QualityMetric({
  label,
  value,
  format,
  good,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  good: boolean;
}) {
  const isGood = good ? value >= 0.8 : value <= 0.2;
  const isBad = good ? value < 0.6 : value > 0.4;

  return (
    <div className="text-center">
      <div
        className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 ${
          isGood ? 'bg-green-100' : isBad ? 'bg-red-100' : 'bg-amber-100'
        }`}
      >
        <span
          className={`text-xl font-bold ${
            isGood ? 'text-green-700' : isBad ? 'text-red-700' : 'text-amber-700'
          }`}
        >
          {format(value)}
        </span>
      </div>
      <p className="text-sm text-text-secondary">{label}</p>
      <div className="flex items-center justify-center gap-1 mt-1">
        {isGood ? (
          <TrendingUp className="w-4 h-4 text-green-500" />
        ) : isBad ? (
          <TrendingDown className="w-4 h-4 text-red-500" />
        ) : (
          <BarChart3 className="w-4 h-4 text-amber-500" />
        )}
        <span
          className={`text-xs ${
            isGood ? 'text-green-600' : isBad ? 'text-red-600' : 'text-amber-600'
          }`}
        >
          {isGood ? 'Good' : isBad ? 'Needs Attention' : 'Average'}
        </span>
      </div>
    </div>
  );
}
