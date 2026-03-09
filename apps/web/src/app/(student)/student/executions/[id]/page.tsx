'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  DollarSign,
  CheckCircle,
  AlertCircle,
  Upload,
  Play,
  Pause,
  Send,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Plus,
  Trash2,
  Target,
  MessageSquare,
  Shield,
  Loader2,
} from 'lucide-react';
import {
  getExecution,
  clockIn,
  clockOut,
  submitDeliverables,
  completeMilestone,
  getExecutionRevisions,
  Execution,
} from '@/lib/marketplace-api';
import { track, EVENTS } from '@/lib/analytics';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ExecutionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [execution, setExecution] = useState<Execution | null>(null);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [revisions, setRevisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Submit form
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [deliverableUrls, setDeliverableUrls] = useState<string[]>(['']);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // QA Preview
  const [qaPreview, setQaPreview] = useState<any>(null);
  const [qaLoading, setQaLoading] = useState(false);

  // AI Assistant
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [assistantLoading, setAssistantLoading] = useState(false);

  const executionId = params.id as string;

  useEffect(() => {
    loadData();
  }, [executionId]);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [execData, revData] = await Promise.all([
        getExecution(executionId, token),
        getExecutionRevisions(executionId, token).catch(() => []),
      ]);
      setExecution(execData);

      const onboardedKey = `onboarded_${executionId}`;
      if (['assigned', 'pending_review', 'pending_screening'].includes(execData.status) && !onboardingChecked && !localStorage.getItem(onboardedKey)) {
        try {
          const obRes = await fetch(`${API_URL}/api/agent/onboarding/${execData.workUnitId}`, { headers: { Authorization: `Bearer ${token}` } });
          let hasOnboarding = false;
          if (obRes.ok) {
            const obData = await obRes.json();
            hasOnboarding = (obData.blocks?.length > 0) || !!obData.welcome || !!obData.instructions;
          }

          if (hasOnboarding) {
            router.replace(`/student/executions/${executionId}/onboard`);
            return;
          }
        } catch {}
        setOnboardingChecked(true);
      }
      setRevisions(revData);
    } catch (err) {
      console.error('Failed to load execution:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleQAPreview() {
    try {
      setQaLoading(true);
      const token = await getToken();
      if (!token) return;
      const urls = deliverableUrls.filter(u => u.trim());
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/executions/${executionId}/qa-preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableUrls: urls }),
      });
      if (res.ok) {
        const data = await res.json();
        setQaPreview(data);
      }
    } catch (err) {
      console.error('QA preview failed:', err);
    } finally {
      setQaLoading(false);
    }
  }

  async function handleAskAssistant(e: React.FormEvent) {
    e.preventDefault();
    if (!assistantQuestion.trim() || assistantQuestion.length < 10) return;
    try {
      setAssistantLoading(true);
      setAssistantAnswer(null);
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/executions/${executionId}/assist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: assistantQuestion }),
      });
      if (res.ok) {
        const data = await res.json();
        setAssistantAnswer(data.answer);
      }
    } catch (err) {
      setAssistantAnswer('Sorry, the assistant is currently unavailable.');
    } finally {
      setAssistantLoading(false);
    }
  }

  async function handleClockIn() {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await clockIn(executionId, token);
      track(EVENTS.TASK_CLOCKED_IN, { executionId });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock in');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleClockOut() {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await clockOut(executionId, token);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock out');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSubmit() {
    const urls = deliverableUrls.filter(u => u.trim());
    if (urls.length === 0) {
      setError('At least one deliverable URL is required');
      return;
    }
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await submitDeliverables(executionId, { deliverableUrls: urls, submissionNotes }, token);
      setShowSubmitForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCompleteMilestone(milestoneId: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await completeMilestone(executionId, milestoneId, {}, token);
      await loadData();
    } catch (err) {
      console.error('Failed to complete milestone:', err);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-[#f5f5f8] rounded w-48"></div>
          <div className="h-48 bg-[#f5f5f8] rounded-2xl"></div>
          <div className="h-32 bg-[#f5f5f8] rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-12 h-12 text-[#e0e0e8] mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-[#1f1f2e]">Execution not found</h2>
      </div>
    );
  }

  const isPending = ['pending_screening', 'pending_review'].includes(execution.status);
  const isActive = ['assigned', 'clocked_in', 'revision_needed'].includes(execution.status);
  const canSubmit = ['assigned', 'clocked_in', 'revision_needed'].includes(execution.status);
  const completedMilestones = execution.milestones?.filter(m => m.completedAt).length || 0;
  const totalMilestones = execution.milestones?.length || 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <Link
        href="/student/executions"
        className="inline-flex items-center gap-2 text-sm text-[#6b6b80] hover:text-[#1f1f2e] mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to My Work
      </Link>

      {error && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-[#a2a3fc] flex-shrink-0" />
          <p className="text-sm text-[#6b6b80]">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-[#a0a0b0] hover:text-[#1f1f2e]">×</button>
        </div>
      )}

      {/* Pending Screening Banner */}
      {execution.status === 'pending_screening' && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 flex-1">
            <AlertCircle className="w-5 h-5 text-[#a2a3fc] mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#1f1f2e]">Screening Interview Required</p>
              <p className="text-xs text-[#6b6b80] mt-0.5">
                Complete the screening interview before you can clock in and start working on this task.
              </p>
            </div>
          </div>
          {execution.interviewLink && (
            <a
              href={execution.interviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] transition-colors flex-shrink-0"
            >
              <MessageSquare className="w-4 h-4" />
              Start Interview
            </a>
          )}
        </div>
      )}

      {/* Pending Review — full approval waiting page */}
      {execution.status === 'pending_review' && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] p-6 mb-6">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#f0f0ff] rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-[#a2a3fc]" />
            </div>
            <h2 className="text-lg font-semibold text-[#1f1f2e]">Application Under Review</h2>
            <p className="text-sm text-[#6b6b80] mt-1">
              The company is reviewing your application for this task.
            </p>
          </div>

          <div className="space-y-4">
            {/* Task info */}
            <div className="bg-[#f5f5f8] rounded-lg p-4">
              <h3 className="text-sm font-medium text-[#1f1f2e] mb-2">{execution.workUnit?.title}</h3>
              <div className="flex flex-wrap gap-3 text-xs text-[#6b6b80]">
                <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${((execution.workUnit?.priceInCents || 0) / 100).toFixed(0)}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {execution.workUnit?.deadlineHours || 0}h deadline</span>
              </div>
            </div>

            {/* What was submitted */}
            <div>
              <h4 className="text-xs font-medium text-[#6b6b80] mb-2">What's being reviewed</h4>
              <div className="space-y-1.5 text-xs text-[#6b6b80]">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                  <span>Your profile and qualifications</span>
                </div>
                {execution.workUnit?.infoCollectionTemplateId && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                    <span>Screening interview completed</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc]" />
                  <span>Skill match verified</span>
                </div>
              </div>
            </div>

            {/* What to expect */}
            <div>
              <h4 className="text-xs font-medium text-[#6b6b80] mb-2">What happens next</h4>
              <div className="space-y-1.5 text-xs text-[#6b6b80]">
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f0f0ff] text-[#a2a3fc] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">1</span>
                  <span>The company reviews your application and interview transcript</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f5f5f5] text-[#6b6b80] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">2</span>
                  <span>If approved, you'll be assigned and can start working</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-[#f5f5f5] text-[#6b6b80] flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5">3</span>
                  <span>You'll receive a notification with next steps</span>
                </div>
              </div>
            </div>

            {/* Applied timestamp */}
            <div className="pt-3 border-t border-[#f0f0f5] text-xs text-[#a0a0b0] text-center">
              Applied {new Date(execution.assignedAt || (execution as any).createdAt || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-[#f0f0f5] p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-[#1f1f2e]">{execution.workUnit?.title || 'Task'}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-[#6b6b80]">
              <span className="flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" />
                ${((execution.workUnit?.priceInCents || 0) / 100).toFixed(0)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Due: {new Date(execution.deadlineAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            execution.status === 'approved' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'clocked_in' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'submitted' ? 'bg-[#f0f0ff] text-[#7b7cee]' :
            execution.status === 'revision_needed' ? 'bg-[#f5f5f5] text-[#6b6b80]' :
            execution.status === 'failed' ? 'bg-[#f5f5f5] text-[#6b6b80]' :
            execution.status === 'pending_screening' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
            execution.status === 'pending_review' ? 'bg-[#f0f0ff] text-[#7b7cee]' :
            'bg-[#f5f5f5] text-[#6b6b80]'
          }`}>
            {execution.status === 'pending_screening' ? 'Screening Required' :
             execution.status === 'pending_review' ? 'Under Review' :
             execution.status.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Actions */}
        {isActive && (
          <div className="flex flex-wrap gap-3 pt-4 border-t border-[#f0f0f5]">
            {execution.status === 'assigned' || execution.status === 'revision_needed' ? (
              <button
                onClick={handleClockIn}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] disabled:opacity-50 transition-colors"
              >
                <Play className="w-4 h-4" />
                Clock In
              </button>
            ) : execution.status === 'clocked_in' ? (
              <button
                onClick={handleClockOut}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f5] text-[#1f1f2e] rounded-lg text-sm font-medium hover:bg-[#eaeaec] disabled:opacity-50 transition-colors"
              >
                <Pause className="w-4 h-4" />
                Clock Out
              </button>
            ) : null}

            {canSubmit && (
              <button
                onClick={() => setShowSubmitForm(!showSubmitForm)}
                className="flex items-center gap-2 px-4 py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] transition-colors"
              >
                <Upload className="w-4 h-4" />
                Submit Deliverables
              </button>
            )}
          </div>
        )}
      </div>

      {/* Submit Form */}
      {showSubmitForm && (
        <div className="bg-white rounded-xl border border-[#e0e0f0] p-6 mb-6">
          <h2 className="font-semibold text-[#1f1f2e] mb-4">Submit Deliverables</h2>
          <div className="space-y-4">
            {deliverableUrls.map((url, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="url"
                  value={url}
                  onChange={e => {
                    const updated = [...deliverableUrls];
                    updated[i] = e.target.value;
                    setDeliverableUrls(updated);
                  }}
                  placeholder="Deliverable URL (e.g. Google Drive, GitHub)"
                  className="flex-1 px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc]"
                />
                {deliverableUrls.length > 1 && (
                  <button
                    onClick={() => setDeliverableUrls(deliverableUrls.filter((_, j) => j !== i))}
                    className="p-2 text-[#a0a0b0] hover:text-[#1f1f2e]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setDeliverableUrls([...deliverableUrls, ''])}
              className="flex items-center gap-1 text-sm text-[#a2a3fc] hover:text-[#7b7cee]"
            >
              <Plus className="w-3.5 h-3.5" />
              Add URL
            </button>
            <div>
              <label className="text-sm font-medium text-[#1f1f2e]">Notes (optional)</label>
              <textarea
                value={submissionNotes}
                onChange={e => setSubmissionNotes(e.target.value)}
                rows={3}
                placeholder="Any notes about your submission..."
                className="w-full mt-1 px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc] resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={actionLoading}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] disabled:opacity-50 transition-colors"
              >
                {actionLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit
                  </>
                )}
              </button>
              <button
                onClick={() => setShowSubmitForm(false)}
                className="px-4 py-2 text-sm text-[#6b6b80] hover:text-[#1f1f2e]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Milestones */}
      {execution.milestones && execution.milestones.length > 0 && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#f0f0f5] flex items-center justify-between">
            <h2 className="font-semibold text-[#1f1f2e]">Milestones</h2>
            <span className="text-sm text-[#6b6b80]">
              {completedMilestones}/{totalMilestones} completed
            </span>
          </div>
          <div className="divide-y divide-[#f0f0f5]">
            {execution.milestones
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map(milestone => (
                <div key={milestone.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      milestone.completedAt ? 'bg-[#f0f0ff]' : 'bg-[#f5f5f5]'
                    }`}>
                      {milestone.completedAt ? (
                        <CheckCircle className="w-4 h-4 text-[#a2a3fc]" />
                      ) : (
                        <Target className="w-4 h-4 text-[#a0a0b0]" />
                      )}
                    </div>
                    <div>
                      <div className={`text-sm ${milestone.completedAt ? 'text-[#1f1f2e]' : 'text-[#6b6b80]'}`}>
                        {milestone.description}
                      </div>
                      {milestone.completedAt && (
                        <div className="text-xs text-[#a0a0b0] mt-0.5">
                          Completed: {new Date(milestone.completedAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                  {!milestone.completedAt && isActive && (
                    <button
                      onClick={() => handleCompleteMilestone(milestone.id)}
                      className="px-3 py-1.5 bg-[#f0f0ff] text-[#a2a3fc] rounded-lg text-xs font-medium hover:bg-[#e8e8ff] transition-colors"
                    >
                      Mark Complete
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Revision History */}
      {revisions.length > 0 && (
        <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#f0f0f5]">
            <h2 className="font-semibold text-[#1f1f2e] flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Revision History ({revisions.length})
            </h2>
          </div>
          <div className="divide-y divide-[#f0f0f5]">
            {revisions.map((rev, i) => (
              <div key={rev.id || i} className="px-6 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#1f1f2e]">
                    Revision #{rev.revisionNumber || i + 1}
                  </span>
                  <span className="text-xs text-[#a0a0b0]">
                    {new Date(rev.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {rev.overallFeedback && (
                  <p className="text-sm text-[#6b6b80]">{rev.overallFeedback}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* QA Preview + AI Assistant */}
      {isActive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* QA Preview */}
          <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#f0f0f5] flex items-center justify-between">
              <h2 className="font-semibold text-[#1f1f2e] flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#a2a3fc]" />
                QA Pre-Check
              </h2>
              <button
                onClick={handleQAPreview}
                disabled={qaLoading}
                className="px-3 py-1.5 bg-[#f0f0ff] text-[#a2a3fc] rounded-lg text-xs font-medium hover:bg-[#e8e8ff] transition-colors disabled:opacity-50"
              >
                {qaLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Run Check'}
              </button>
            </div>
            <div className="p-6">
              {!qaPreview ? (
                <p className="text-sm text-[#6b6b80]">
                  Run a pre-submission quality check to catch issues before submitting your work.
                </p>
              ) : (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-[#a2a3fc] font-medium">✓ {qaPreview.checksPassed} passed</span>
                    {qaPreview.checksWarning > 0 && (
                      <span className="text-[#6b6b80] font-medium">⚠ {qaPreview.checksWarning} warnings</span>
                    )}
                    {qaPreview.checksFailed > 0 && (
                      <span className="text-[#1f1f2e] font-medium">✕ {qaPreview.checksFailed} blockers</span>
                    )}
                  </div>
                  {/* Blockers */}
                  {qaPreview.blockers?.length > 0 && (
                    <div className="bg-[#f5f5f8] rounded-lg p-3">
                      <p className="text-xs font-medium text-[#1f1f2e] mb-1">Blockers:</p>
                      <ul className="text-xs text-[#6b6b80] space-y-1">
                        {qaPreview.blockers.map((b: string, i: number) => (
                          <li key={i}>• {b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Warnings */}
                  {qaPreview.warnings?.length > 0 && (
                    <div className="bg-[#f5f5f8] rounded-lg p-3">
                      <p className="text-xs font-medium text-[#1f1f2e] mb-1">Warnings:</p>
                      <ul className="text-xs text-[#6b6b80] space-y-1">
                        {qaPreview.warnings.map((w: string, i: number) => (
                          <li key={i}>• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {qaPreview.blockers?.length === 0 && (
                    <p className="text-sm text-[#a2a3fc] font-medium">{qaPreview.message}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* AI Assistant */}
          <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#f0f0f5] flex items-center justify-between">
              <h2 className="font-semibold text-[#1f1f2e] flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#a2a3fc]" />
                AI Assistant
              </h2>
              <button
                onClick={() => setShowAssistant(!showAssistant)}
                className="text-xs text-[#a2a3fc] font-medium"
              >
                {showAssistant ? 'Hide' : 'Show'}
              </button>
            </div>
            {showAssistant && (
              <div className="p-6">
                <form onSubmit={handleAskAssistant} className="space-y-3">
                  <textarea
                    value={assistantQuestion}
                    onChange={e => setAssistantQuestion(e.target.value)}
                    className="w-full px-3 py-2 border border-[#f0f0f5] rounded-lg text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#a2a3fc]/30 focus:border-[#a2a3fc]"
                    placeholder="Ask about requirements, deliverable format, or how to approach this task..."
                  />
                  <button
                    type="submit"
                    disabled={assistantLoading || assistantQuestion.length < 10}
                    className="w-full py-2 bg-[#a2a3fc] text-white rounded-lg text-sm font-medium hover:bg-[#8b8cf0] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {assistantLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {assistantLoading ? 'Thinking...' : 'Ask'}
                  </button>
                </form>
                {assistantAnswer && (
                  <div className="mt-4 p-3 bg-[#f5f5f8] rounded-lg">
                    <p className="text-sm text-[#1f1f2e] whitespace-pre-wrap">{assistantAnswer}</p>
                    <p className="text-[10px] text-[#a0a0b0] mt-2 italic">
                      This assistant provides guidance only, not actual deliverables.
                    </p>
                  </div>
                )}
              </div>
            )}
            {!showAssistant && (
              <div className="p-6">
                <p className="text-sm text-[#6b6b80]">
                  Need help with task requirements? The AI assistant can clarify instructions without doing the work for you.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result */}
      {execution.status === 'approved' && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle className="w-6 h-6 text-[#a2a3fc]" />
            <h2 className="text-lg font-semibold text-[#1f1f2e]">Task Approved!</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {execution.qualityScore != null && (
              <div>
                <span className="text-[#a2a3fc]">Quality Score:</span>{' '}
                <span className="font-semibold">{execution.qualityScore}%</span>
              </div>
            )}
            {execution.expEarned > 0 && (
              <div>
                <span className="text-[#a2a3fc]">EXP Earned:</span>{' '}
                <span className="font-semibold">+{execution.expEarned}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
