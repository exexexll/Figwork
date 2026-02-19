'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  User,
  Building2,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';

interface Dispute {
  id: string;
  executionId: string | null;
  studentId: string;
  companyId: string;
  filedBy: string;
  reason: string;
  status: string;
  resolution: string | null;
  resolutionType: string | null;
  filedAt: string;
  resolvedAt: string | null;
  student: { name: string; clerkId: string };
  company: { companyName: string };
}

export default function AdminDisputesPage() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolutionForm, setResolutionForm] = useState({
    resolutionType: 'resolved_student' as string,
    resolutionText: '',
    payoutAdjustment: '',
    expAdjustment: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');

  useEffect(() => {
    fetchDisputes();
  }, [statusFilter]);

  async function fetchDisputes() {
    try {
      const token = await getToken();
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/disputes${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setDisputes(data.disputes || []);
      }
    } catch (error) {
      console.error('Failed to fetch disputes:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDispute || !resolutionForm.resolutionText.trim()) return;

    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/disputes/${selectedDispute.id}/resolve`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            resolutionType: resolutionForm.resolutionType,
            resolutionText: resolutionForm.resolutionText,
            payoutAdjustment: resolutionForm.payoutAdjustment
              ? parseInt(resolutionForm.payoutAdjustment)
              : undefined,
            expAdjustment: resolutionForm.expAdjustment
              ? parseInt(resolutionForm.expAdjustment)
              : undefined,
          }),
        }
      );

      if (res.ok) {
        setSelectedDispute(null);
        setResolutionForm({
          resolutionType: 'resolved_student',
          resolutionText: '',
          payoutAdjustment: '',
          expAdjustment: '',
        });
        fetchDisputes();
      }
    } catch (error) {
      console.error('Failed to resolve dispute:', error);
    } finally {
      setSubmitting(false);
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'filed':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'under_review':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'resolved_student':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'resolved_company':
        return 'bg-red-50 text-red-700 border-red-200';
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
      case 'resolved_student':
        return <CheckCircle className="w-4 h-4" />;
      case 'resolved_company':
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
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Disputes</h1>
          <p className="text-text-secondary mt-1">
            Review and resolve disputes between students and companies
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="input"
        >
          <option value="">All Statuses</option>
          <option value="filed">Filed</option>
          <option value="under_review">Under Review</option>
          <option value="resolved_student">Resolved (Student)</option>
          <option value="resolved_company">Resolved (Company)</option>
          <option value="partial">Partial</option>
        </select>
      </div>

      {/* Disputes List */}
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
            <p className="text-text-secondary">
              {statusFilter
                ? `No disputes with status "${formatStatus(statusFilter)}"`
                : 'All disputes have been resolved'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <div
              key={dispute.id}
              onClick={() => setSelectedDispute(dispute)}
              className="card cursor-pointer hover:shadow-soft-lg transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
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

                    <p className="text-text-primary mb-3 line-clamp-2">{dispute.reason}</p>

                    <div className="flex items-center gap-6 text-sm text-text-secondary">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>{dispute.student.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        <span>{dispute.company.companyName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right text-sm text-text-secondary">
                      <div>{new Date(dispute.filedAt).toLocaleDateString()}</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-text-secondary" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolution Modal */}
      {selectedDispute && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-light">
              <h2 className="text-xl font-semibold text-text-primary">Resolve Dispute</h2>
            </div>

            <div className="p-6">
              {/* Dispute Details */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                      selectedDispute.status
                    )}`}
                  >
                    {getStatusIcon(selectedDispute.status)}
                    {formatStatus(selectedDispute.status)}
                  </span>
                </div>
                <p className="text-text-primary mb-4">{selectedDispute.reason}</p>
                <div className="flex items-center gap-6 text-sm text-text-secondary">
                  <div>
                    <span className="font-medium">Student:</span> {selectedDispute.student.name}
                  </div>
                  <div>
                    <span className="font-medium">Company:</span>{' '}
                    {selectedDispute.company.companyName}
                  </div>
                </div>
              </div>

              {/* Resolution Form */}
              {!selectedDispute.status.startsWith('resolved') && (
                <form onSubmit={handleResolve} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Resolution Type
                    </label>
                    <select
                      value={resolutionForm.resolutionType}
                      onChange={e =>
                        setResolutionForm({ ...resolutionForm, resolutionType: e.target.value })
                      }
                      className="input w-full"
                    >
                      <option value="resolved_student">Resolved in Student's Favor</option>
                      <option value="resolved_company">Resolved in Company's Favor</option>
                      <option value="partial">Partial Resolution</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Resolution Details *
                    </label>
                    <textarea
                      value={resolutionForm.resolutionText}
                      onChange={e =>
                        setResolutionForm({ ...resolutionForm, resolutionText: e.target.value })
                      }
                      className="input w-full h-32 resize-none"
                      placeholder="Explain the resolution decision..."
                      required
                    />
                  </div>

                  {resolutionForm.resolutionType === 'partial' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          Payout Adjustment (cents)
                        </label>
                        <input
                          type="number"
                          value={resolutionForm.payoutAdjustment}
                          onChange={e =>
                            setResolutionForm({
                              ...resolutionForm,
                              payoutAdjustment: e.target.value,
                            })
                          }
                          className="input w-full"
                          placeholder="e.g., 500 for $5"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          EXP Adjustment
                        </label>
                        <input
                          type="number"
                          value={resolutionForm.expAdjustment}
                          onChange={e =>
                            setResolutionForm({ ...resolutionForm, expAdjustment: e.target.value })
                          }
                          className="input w-full"
                          placeholder="e.g., -50 or +100"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-4">
                    <button
                      type="submit"
                      disabled={submitting || !resolutionForm.resolutionText.trim()}
                      className="btn-primary px-6 py-2 disabled:opacity-50"
                    >
                      {submitting ? 'Submitting...' : 'Resolve Dispute'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedDispute(null)}
                      className="px-4 py-2 text-text-secondary hover:text-text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Already Resolved */}
              {selectedDispute.resolution && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <h4 className="font-medium text-green-800 mb-2">Resolution</h4>
                  <p className="text-green-700">{selectedDispute.resolution}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
