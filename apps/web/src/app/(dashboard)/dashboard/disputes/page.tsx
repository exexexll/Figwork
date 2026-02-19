'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  User,
  MessageSquare,
} from 'lucide-react';
import {
  getCompanyDisputes,
  CompanyDispute,
} from '@/lib/marketplace-api';

export default function CompanyDisputesPage() {
  const { getToken } = useAuth();
  const [disputes, setDisputes] = useState<CompanyDispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDisputes();
  }, []);

  async function fetchDisputes() {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await getCompanyDisputes(token);
      setDisputes(data.disputes || []);
    } catch (error) {
      console.error('Failed to fetch disputes:', error);
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'filed':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'under_review':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'resolved_student':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'resolved_company':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'partial':
        return 'bg-violet-50 text-violet-700 border-violet-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'filed':
        return <Clock className="w-4 h-4" />;
      case 'under_review':
        return <MessageSquare className="w-4 h-4" />;
      case 'resolved_company':
        return <CheckCircle className="w-4 h-4" />;
      case 'resolved_student':
        return <XCircle className="w-4 h-4" />;
      default:
        return <AlertTriangle className="w-4 h-4" />;
    }
  }

  function formatStatus(status: string) {
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Disputes</h1>
        <p className="text-text-secondary mt-1">
          Disputes related to your work units
        </p>
      </div>

      {disputes.length === 0 ? (
        <div className="card">
          <div className="p-12 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <CheckCircle className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-2">No Disputes</h3>
            <p className="text-text-secondary max-w-sm mx-auto">
              No disputes have been filed for your tasks.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <div key={dispute.id} className="card">
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                        dispute.status
                      )}`}
                    >
                      {getStatusIcon(dispute.status)}
                      {formatStatus(dispute.status)}
                    </span>
                    <span className="text-xs text-text-secondary">
                      Filed by: {dispute.filedBy}
                    </span>
                  </div>
                  <span className="text-sm text-text-secondary">
                    {new Date(dispute.filedAt).toLocaleDateString()}
                  </span>
                </div>

                {dispute.workUnitTitle && (
                  <p className="text-sm font-medium text-text-primary mb-2">
                    Task: {dispute.workUnitTitle}
                  </p>
                )}

                <p className="text-text-primary mb-3">{dispute.reason}</p>

                <div className="flex items-center gap-4 text-sm text-text-secondary">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>{dispute.student.name}</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-600 capitalize">
                      {dispute.student.tier}
                    </span>
                  </div>
                </div>

                {dispute.resolution && (
                  <div className="mt-4 pt-4 border-t border-border-light">
                    <h4 className="text-sm font-medium text-text-secondary mb-1">Resolution</h4>
                    <p className="text-sm text-text-primary">{dispute.resolution}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
