'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/components/ui/card';
import {
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Star,
  Zap,
  Target,
  Award,
  Briefcase,
  User,
  Camera,
} from 'lucide-react';
import {
  getStudentProfile,
  getStudentExecutions,
  getPendingPOW,
  getStudentBalance,
  StudentProfile,
  Execution,
  POWLog,
} from '@/lib/marketplace-api';

const TIER_COLORS = {
  novice: { bg: 'bg-border-light', text: 'text-text-secondary' },
  pro: { bg: 'bg-primary-light/20', text: 'text-primary-dark' },
  elite: { bg: 'bg-accent-light', text: 'text-amber-700' },
};

const TIER_ICONS = {
  novice: Star,
  pro: Zap,
  elite: Award,
};

export default function StudentDashboard() {
  const { getToken } = useAuth();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [pendingPOW, setPendingPOW] = useState<POWLog[]>([]);
  const [balance, setBalance] = useState<{
    pendingInCents: number;
    totalEarnedInCents: number;
    monthlyEarnedInCents: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const token = await getToken();
        if (!token) return;

        const [profileData, executionsData, powData, balanceData] = await Promise.all([
          getStudentProfile(token),
          getStudentExecutions(token),
          getPendingPOW(token),
          getStudentBalance(token),
        ]);

        setProfile(profileData);
        setExecutions(Array.isArray(executionsData) ? executionsData : []);
        setPendingPOW(Array.isArray(powData) ? powData : []);
        setBalance(balanceData);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [getToken]);

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-32 bg-border/50 rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <Card className="p-6 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-text-primary mb-1">Error Loading Dashboard</h2>
          <p className="text-text-secondary text-sm">{error}</p>
          {error.includes('profile') && (
            <Link
              href="/student/onboarding"
              className="inline-flex items-center gap-2 mt-4 btn-primary text-sm"
            >
              Complete Onboarding
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </Card>
      </div>
    );
  }

  if (!profile) return null;

  const activeExecutions = executions.filter(e => 
    !['approved', 'failed', 'cancelled'].includes(e.status)
  );
  const completedToday = executions.filter(e => 
    e.completedAt && new Date(e.completedAt).toDateString() === new Date().toDateString()
  ).length;

  const TierIcon = TIER_ICONS[profile.tier as keyof typeof TIER_ICONS] || Star;
  const tierColors = TIER_COLORS[profile.tier as keyof typeof TIER_COLORS] || TIER_COLORS.novice;

  return (
    <div className="p-6 sm:p-8 max-w-6xl mx-auto">
      {/* Welcome Banner */}
      <div
        className="rounded-lg p-6 sm:p-8 mb-8 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 40%, #f9a8d4 100%)' }}
      >
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-2">
              Welcome back, {profile.name.split(' ')[0]}!
            </h1>
            <p className="text-white/80">
              {completedToday > 0 
                ? `You've completed ${completedToday} task${completedToday > 1 ? 's' : ''} today.`
                : 'Ready to start your day?'}
            </p>
          </div>
          <div className={cn('flex items-center gap-3 px-4 py-3 rounded-lg bg-white/20 backdrop-blur-sm')}>
            <TierIcon className="w-6 h-6 text-white" />
            <div>
              <div className="font-semibold capitalize text-white">{profile.tier}</div>
              <div className="text-xs text-white/70">{profile.totalExp.toLocaleString()} EXP</div>
            </div>
          </div>
        </div>
      </div>

      {/* POW Alert */}
      {pendingPOW.length > 0 && (
        <Link
          href="/student/pow"
          className="flex items-center justify-between bg-accent-light/60 border border-accent/30 rounded-lg p-4 mb-8 hover:bg-accent-light transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <AlertCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="font-semibold text-text-primary">
                {pendingPOW.length} POW Check{pendingPOW.length > 1 ? 's' : ''} Pending
              </div>
              <div className="text-sm text-text-secondary">Submit your proof of work to continue</div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-text-muted group-hover:translate-x-1 transition-transform" />
        </Link>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <Clock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">{activeExecutions.length}</p>
                <p className="text-xs text-text-secondary">Active Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-50">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">{profile.tasksCompleted}</p>
                <p className="text-xs text-text-secondary">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-50">
                <Target className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  {(profile.avgQualityScore * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-text-secondary">Quality Score</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-50">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-green-600">
                  ${((balance?.monthlyEarnedInCents || 0) / 100).toFixed(0)}
                </p>
                <p className="text-xs text-text-secondary">This Month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        {/* Active Work */}
        <Card>
          <div className="px-6 py-4 border-b border-border-light flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Active Work</h2>
            <Link href="/student/executions" className="text-sm text-primary hover:text-primary-dark">
              View All
            </Link>
          </div>
          
          {activeExecutions.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="w-10 h-10 text-border mx-auto mb-3" />
              <p className="text-text-secondary mb-3">No active tasks</p>
              <Link
                href="/student/tasks"
                className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary-dark"
              >
                Browse available tasks
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {activeExecutions.slice(0, 4).map((execution) => (
                <Link
                  key={execution.id}
                  href={`/student/executions/${execution.id}`}
                  className="flex items-center justify-between p-4 hover:bg-white/50 transition-colors"
                >
                  <div>
                    <div className="font-medium text-text-primary">
                      {execution.workUnit?.title || 'Task'}
                    </div>
                    <div className="text-sm text-text-secondary flex items-center gap-2 mt-1">
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium',
                        execution.status === 'clocked_in' 
                          ? 'bg-green-50 text-green-700'
                          : execution.status === 'submitted'
                          ? 'bg-primary-light/20 text-primary-dark'
                          : execution.status === 'revision_needed'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-border-light text-text-secondary'
                      )}>
                        {execution.status.replace('_', ' ')}
                      </span>
                      {execution.deadlineAt && (
                        <span className="text-text-muted text-xs">
                          Due: {new Date(execution.deadlineAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-text-muted" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Earnings Summary */}
        <Card>
          <div className="px-6 py-4 border-b border-border-light flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Earnings</h2>
            <Link href="/student/earnings" className="text-sm text-primary hover:text-primary-dark">
              View Details
            </Link>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-green-50/50 rounded-lg p-4">
                <div className="text-sm text-green-700/70 mb-1">Available</div>
                <div className="text-2xl font-bold text-green-700">
                  ${((balance?.pendingInCents || 0) / 100).toFixed(2)}
                </div>
              </div>
              <div
                className="rounded-lg p-4"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <div className="text-sm text-text-secondary mb-1">Total Earned</div>
                <div className="text-2xl font-bold text-text-primary">
                  ${((balance?.totalEarnedInCents || 0) / 100).toFixed(2)}
                </div>
              </div>
            </div>
            
            {(balance?.pendingInCents || 0) > 0 && (
              <Link
                href="/student/earnings"
                className="block w-full text-center py-3 rounded-lg font-medium text-white transition-all duration-300 hover:shadow-glow"
                style={{ background: 'var(--gradient-fig)' }}
              >
                Request Payout
              </Link>
            )}
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { href: '/student/tasks', icon: Briefcase, label: 'Find Tasks', desc: 'Browse available work', color: 'text-primary' },
            { href: '/student/profile', icon: User, label: 'Profile', desc: 'Update skills & files', color: 'text-secondary' },
            { href: '/student/pow', icon: Camera, label: 'POW History', desc: 'View check-ins', color: 'text-accent-warm' },
            { href: '/student/earnings', icon: DollarSign, label: 'Payouts', desc: 'Manage earnings', color: 'text-green-600' },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <Card className="h-full hover:shadow-soft-lg cursor-pointer group">
                <div
                  className="h-1 opacity-0 group-hover:opacity-60 transition-opacity rounded-t-lg"
                  style={{ background: 'var(--gradient-fig)' }}
                />
                <CardContent className="p-5">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                    style={{ background: 'var(--gradient-fig-subtle)' }}
                  >
                    <item.icon className={cn('w-5 h-5', item.color)} />
                  </div>
                  <div className="font-medium text-text-primary group-hover:text-primary-dark transition-colors">
                    {item.label}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5">{item.desc}</div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
