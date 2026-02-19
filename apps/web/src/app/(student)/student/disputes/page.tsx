'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, Plus, Clock, CheckCircle, XCircle, MessageSquare } from 'lucide-react';

interface Dispute {
  id: string;
  executionId: string | null;
  reason: string;
  status: string;
  resolution: string | null;
  filedAt: string;
  resolvedAt: string | null;
  workUnitTitle?: string;
}

export default function StudentDisputesPage() {
  const { getToken } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewDispute, setShowNewDispute] = useState(false);
  const [newDispute, setNewDispute] = useState({
    executionId: '',
    reason: '',
    evidenceUrls: [] as string[],
  });
  const [executions, setExecutions] = useState<Array<{ id: string; title: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDisputes();
    fetchExecutions();
  }, []);

  async function fetchDisputes() {
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/students/me/disputes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

  async function fetchExecutions() {
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/executions/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Filter to completed/failed executions that can be disputed
        const disputableExecutions = (data.executions || [])
          .filter((e: any) => ['approved', 'failed', 'revision_needed'].includes(e.status))
          .map((e: any) => ({
            id: e.id,
            title: e.workUnit?.title || 'Unknown Task',
          }));
        setExecutions(disputableExecutions);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    }
  }

  async function handleSubmitDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!newDispute.reason.trim()) return;

    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/students/me/disputes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          executionId: newDispute.executionId || null,
          reason: newDispute.reason,
          evidenceUrls: newDispute.evidenceUrls,
        }),
      });

      if (res.ok) {
        setShowNewDispute(false);
        setNewDispute({ executionId: '', reason: '', evidenceUrls: [] });
        fetchDisputes();
      }
    } catch (error) {
      console.error('Failed to submit dispute:', error);
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
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Disputes</h1>
          <p className="text-text-secondary mt-1">
            File and track disputes for task-related issues
          </p>
        </div>
        <button
          onClick={() => setShowNewDispute(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium transition-all"
          style={{ background: 'var(--gradient-fig)' }}
        >
          <Plus className="w-4 h-4" />
          File Dispute
        </button>
      </div>

      {/* New Dispute Form */}
      {showNewDispute && (
        <div className="card mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">File a New Dispute</h2>
            <form onSubmit={handleSubmitDispute} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Related Task (Optional)
                </label>
                <select
                  value={newDispute.executionId}
                  onChange={e => setNewDispute({ ...newDispute, executionId: e.target.value })}
                  className="input w-full"
                >
                  <option value="">General Dispute (No specific task)</option>
                  {executions.map(exec => (
                    <option key={exec.id} value={exec.id}>
                      {exec.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Reason for Dispute *
                </label>
                <textarea
                  value={newDispute.reason}
                  onChange={e => setNewDispute({ ...newDispute, reason: e.target.value })}
                  className="input w-full h-32 resize-none"
                  placeholder="Describe the issue in detail. Include specific examples and any relevant context..."
                  required
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting || !newDispute.reason.trim()}
                  className="btn-primary px-6 py-2 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Dispute'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewDispute(false)}
                  className="px-4 py-2 text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disputes List */}
      {disputes.length === 0 ? (
        <div className="card">
          <div className="p-12 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <AlertTriangle className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-2">No Disputes</h3>
            <p className="text-text-secondary max-w-sm mx-auto">
              You haven't filed any disputes yet. If you have an issue with a task or payment,
              you can file a dispute to have it reviewed.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {disputes.map(dispute => (
            <div key={dispute.id} className="card">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                          dispute.status
                        )}`}
                      >
                        {getStatusIcon(dispute.status)}
                        {formatStatus(dispute.status)}
                      </span>
                      {dispute.workUnitTitle && (
                        <span className="text-sm text-text-secondary">
                          Task: {dispute.workUnitTitle}
                        </span>
                      )}
                    </div>
                    <p className="text-text-primary">{dispute.reason}</p>
                  </div>
                  <div className="text-right text-sm text-text-secondary">
                    <div>Filed: {new Date(dispute.filedAt).toLocaleDateString()}</div>
                    {dispute.resolvedAt && (
                      <div>Resolved: {new Date(dispute.resolvedAt).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>

                {dispute.resolution && (
                  <div className="mt-4 pt-4 border-t border-border-light">
                    <h4 className="text-sm font-medium text-text-secondary mb-2">Resolution</h4>
                    <p className="text-text-primary">{dispute.resolution}</p>
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
