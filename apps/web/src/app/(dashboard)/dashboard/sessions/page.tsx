'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Clock, CheckCircle, XCircle, AlertCircle, MessageSquare, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { getSessions } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Session } from '@/lib/types';

const statusConfig = {
  completed: {
    icon: CheckCircle,
    label: 'Completed',
    className: 'bg-green-50 text-green-700',
    iconClass: 'text-green-500',
  },
  in_progress: {
    icon: Clock,
    label: 'In Progress',
    className: 'bg-amber-50 text-amber-700',
    iconClass: 'text-amber-500',
  },
  abandoned: {
    icon: XCircle,
    label: 'Abandoned',
    className: 'bg-gray-50 text-gray-700',
    iconClass: 'text-gray-500',
  },
  pending: {
    icon: Clock,
    label: 'Pending',
    className: 'bg-blue-50 text-blue-700',
    iconClass: 'text-blue-500',
  },
  error: {
    icon: AlertCircle,
    label: 'Error',
    className: 'bg-red-50 text-red-700',
    iconClass: 'text-red-500',
  },
};

export default function SessionsPage() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const token = await getToken();
        if (!token) return;

        const res = await getSessions(token);
        setSessions(res.data || []);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSessions();
  }, [getToken]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border rounded w-1/4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-border/50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Sessions</h1>
        <p className="text-text-secondary mt-1">
          Review transcripts and summaries from applications and inquiries.
        </p>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <Clock className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">No sessions yet</h3>
            <p className="text-text-secondary">
              Sessions will appear here once candidates complete interviews.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => {
            const status = statusConfig[session.status as keyof typeof statusConfig] || statusConfig.pending;
            const StatusIcon = status.icon;

            return (
              <Link key={session.id} href={`/dashboard/sessions/${session.id}`}>
                <Card className="hover:shadow-soft-md transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center',
                            status.className
                          )}
                        >
                          <StatusIcon className={cn('w-5 h-5', status.iconClass)} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-text-primary group-hover:text-primary-dark transition-colors">
                              {session.templateName}
                            </p>
                            {/* Mode indicator */}
                            {session.mode === 'inquiry' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <MessageSquare className="w-3 h-3" />
                                Inquiry
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                                <FileText className="w-3 h-3" />
                                Application
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-sm text-text-secondary">
                            <span>
                              {new Date(session.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="w-1 h-1 rounded-full bg-border" />
                            <span>{session.messageCount} messages</span>
                            {session.hasSummary && (
                              <>
                                <span className="w-1 h-1 rounded-full bg-border" />
                                <span className="text-primary">Summary available</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'px-3 py-1 rounded-full text-xs font-medium',
                          status.className
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
