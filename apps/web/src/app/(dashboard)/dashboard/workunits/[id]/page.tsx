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
  Users,
  Play,
  Pause,
  Eye,
  Shield,
  Target,
  ChevronRight,
  Star,
  Lightbulb,
  Loader2,
  Mic,
  FileText,
  UserCheck,
  XCircle,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import {
  getWorkUnit,
  updateWorkUnit,
  fundWorkUnitEscrow,
  getWorkUnitCandidates,
  reviewExecution,
  WorkUnitDetailed,
  Execution,
  UpdateWorkUnitInput,
} from '@/lib/marketplace-api';
import { getTemplates } from '@/lib/api';

export default function WorkUnitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [workUnit, setWorkUnit] = useState<WorkUnitDetailed | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState<string | null>(null);
  const [reviewQuality, setReviewQuality] = useState(85);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [improvements, setImprovements] = useState<any>(null);
  const [improvementsLoading, setImprovementsLoading] = useState(false);

  // Edit mode state for Task Settings
  const [editingSettings, setEditingSettings] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editAssignmentMode, setEditAssignmentMode] = useState<'auto' | 'manual'>('auto');
  const [editScreeningTemplateId, setEditScreeningTemplateId] = useState<string | null>(null);
  const [editMinTier, setEditMinTier] = useState<'novice' | 'pro' | 'elite'>('novice');
  const [editComplexity, setEditComplexity] = useState(3);
  const [editRequiredSkills, setEditRequiredSkills] = useState('');
  const [editDeliverableFormat, setEditDeliverableFormat] = useState('');
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);

  const workUnitId = params.id as string;

  useEffect(() => {
    loadData();
  }, [workUnitId]);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [wuData, candData] = await Promise.all([
        getWorkUnit(workUnitId, token),
        getWorkUnitCandidates(workUnitId, token).catch(() => []),
      ]);
      setWorkUnit(wuData);
      setCandidates(candData);
    } catch (err) {
      console.error('Failed to load work unit:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(status: 'active' | 'paused' | 'cancelled') {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await updateWorkUnit(workUnitId, { status }, token);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  }

  function enterEditMode() {
    if (!workUnit) return;
    setEditAssignmentMode((workUnit as any).assignmentMode || 'auto');
    setEditScreeningTemplateId(workUnit.infoCollectionTemplateId || null);
    setEditMinTier(workUnit.minTier as 'novice' | 'pro' | 'elite');
    setEditComplexity(workUnit.complexityScore);
    setEditRequiredSkills(((workUnit as any).requiredSkills || []).join(', '));
    setEditDeliverableFormat(((workUnit as any).deliverableFormat || []).join(', '));
    setEditingSettings(true);
    // Load interview templates for the screening dropdown
    loadTemplates();
  }

  async function loadTemplates() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await getTemplates(token);
      setTemplates((res as any)?.data || res || []);
    } catch {
      // Templates optional — don't block the UI
    }
  }

  async function saveSettings() {
    try {
      setSettingsSaving(true);
      const token = await getToken();
      if (!token) return;

      const updates: UpdateWorkUnitInput = {
        assignmentMode: editAssignmentMode,
        infoCollectionTemplateId: editScreeningTemplateId || null,
        minTier: editMinTier,
        complexityScore: editComplexity,
        requiredSkills: editRequiredSkills
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        deliverableFormat: editDeliverableFormat
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      };

      await updateWorkUnit(workUnitId, updates, token);
      setEditingSettings(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleLoadImprovements() {
    try {
      setImprovementsLoading(true);
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/workunits/${workUnitId}/improvements`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setImprovements(await res.json());
      }
    } catch (err) {
      console.error('Failed to load improvements:', err);
    } finally {
      setImprovementsLoading(false);
    }
  }

  async function handleFundEscrow() {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await fundWorkUnitEscrow(workUnitId, token);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fund escrow');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReview(executionId: string, verdict: 'approved' | 'revision_needed' | 'failed') {
    try {
      setActionLoading(true);
      const token = await getToken();
      if (!token) return;
      await reviewExecution(executionId, {
        verdict,
        qualityScore: verdict === 'approved' ? reviewQuality : undefined,
        feedback: reviewFeedback || undefined,
      }, token);
      setShowReview(null);
      setReviewFeedback('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-48"></div>
          <div className="h-48 bg-slate-200 rounded-2xl"></div>
        </div>
      </div>
    );
  }

  if (!workUnit) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-700">Work unit not found</h2>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
      <Link
        href="/dashboard/workunits"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Work Units
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{workUnit.title}</h1>
            <p className="text-sm text-slate-600 mt-2">{workUnit.spec}</p>
          </div>
          <span className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${
            workUnit.status === 'active' ? 'bg-green-100 text-green-700' :
            workUnit.status === 'draft' ? 'bg-slate-100 text-slate-600' :
            workUnit.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
            workUnit.status === 'completed' ? 'bg-blue-100 text-blue-700' :
            'bg-red-100 text-red-700'
          }`}>
            {workUnit.status}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-t border-slate-100">
          <div>
            <div className="text-xs text-slate-500">Price</div>
            <div className="font-semibold">${(workUnit.priceInCents / 100).toFixed(0)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Deadline</div>
            <div className="font-semibold">{workUnit.deadlineHours}h</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Category</div>
            <div className="font-semibold">{workUnit.category}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Escrow</div>
            <div className={`font-semibold ${
              workUnit.escrow?.status === 'funded' ? 'text-green-600' : 'text-orange-600'
            }`}>
              {workUnit.escrow?.status || 'None'}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
          {workUnit.status === 'draft' && workUnit.escrow?.status !== 'funded' && (
            <button
              onClick={handleFundEscrow}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <DollarSign className="w-4 h-4" />
              Fund Escrow
            </button>
          )}
          {workUnit.status === 'draft' && workUnit.escrow?.status === 'funded' && (
            <button
              onClick={() => handleStatusChange('active')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Play className="w-4 h-4" />
              Activate
            </button>
          )}
          {workUnit.status === 'active' && (
            <button
              onClick={() => handleStatusChange('paused')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 disabled:opacity-50 transition-colors"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
          )}
          {workUnit.status === 'paused' && (
            <button
              onClick={() => handleStatusChange('active')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Play className="w-4 h-4" />
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Task Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Acceptance Criteria */}
        {Array.isArray((workUnit as any).acceptanceCriteria) && (workUnit as any).acceptanceCriteria.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-slate-500" />
              Acceptance Criteria
            </h2>
            <div className="space-y-2">
              {((workUnit as any).acceptanceCriteria as Array<{ criterion: string; required: boolean }>).map((ac, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${ac.required ? 'bg-red-100' : 'bg-slate-100'}`}>
                    <span className="text-[10px] font-bold text-slate-600">{i + 1}</span>
                  </div>
                  <div>
                    <p className="text-sm text-slate-700">{ac.criterion}</p>
                    {ac.required && <span className="text-[10px] font-medium text-red-600 uppercase">Required</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deliverable Format & Settings */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-500" />
              Task Settings
            </h2>
            {!editingSettings ? (
              <button
                onClick={enterEditMode}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={saveSettings}
                  disabled={settingsSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {settingsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={() => setEditingSettings(false)}
                  disabled={settingsSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            )}
          </div>

          {!editingSettings ? (
            /* ── View Mode ── */
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500">Assignment Mode</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                  (workUnit as any).assignmentMode === 'manual'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {(workUnit as any).assignmentMode === 'manual' ? (
                    <><Users className="w-3 h-3" /> Manual Review</>
                  ) : (
                    <><UserCheck className="w-3 h-3" /> Auto-Match</>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500">Screening Interview</span>
                {workUnit.infoCollectionTemplateId ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                    <Mic className="w-3 h-3" /> Required
                  </span>
                ) : (
                  <span className="text-slate-400 text-xs">Not required</span>
                )}
              </div>

              <div className="py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm block mb-1.5">Required Skills</span>
                {(workUnit as any).requiredSkills?.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {((workUnit as any).requiredSkills as string[]).map((s: string) => (
                      <span key={s} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{s}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs">None specified</span>
                )}
              </div>

              <div className="py-2 border-b border-slate-50">
                <span className="text-slate-500 text-sm block mb-1.5">Deliverable Format</span>
                {(workUnit as any).deliverableFormat?.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {((workUnit as any).deliverableFormat as string[]).map((f: string) => (
                      <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                        <CheckCircle className="w-3 h-3 text-green-500" />{f}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-slate-400 text-xs">Any format</span>
                )}
              </div>

              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-slate-500">Min Tier</span>
                <span className="font-medium text-slate-700 capitalize">{workUnit.minTier}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-500">Complexity</span>
                <span className="font-medium text-slate-700">
                  {workUnit.complexityScore}/5 — {['Simple', 'Easy', 'Medium', 'Hard', 'Expert'][workUnit.complexityScore - 1]}
                </span>
              </div>
            </div>
          ) : (
            /* ── Edit Mode ── */
            <div className="space-y-4 text-sm">
              {/* Assignment Mode */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Assignment Mode</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditAssignmentMode('auto')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      editAssignmentMode === 'auto'
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <UserCheck className="w-4 h-4" /> Auto-Match
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditAssignmentMode('manual')}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      editAssignmentMode === 'manual'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Users className="w-4 h-4" /> Manual Review
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {editAssignmentMode === 'auto'
                    ? 'First qualified student is auto-assigned.'
                    : 'You review applicants and pick who to assign.'}
                </p>
              </div>

              {/* Screening Interview */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Screening Interview</label>
                <select
                  value={editScreeningTemplateId || ''}
                  onChange={e => setEditScreeningTemplateId(e.target.value || null)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None — no screening required</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  Select an interview template to require candidates to complete before starting.
                </p>
              </div>

              {/* Min Tier */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Minimum Tier</label>
                <div className="flex gap-2">
                  {(['novice', 'pro', 'elite'] as const).map(tier => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => setEditMinTier(tier)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                        editMinTier === tier
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              {/* Complexity */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">
                  Complexity: {editComplexity}/5 — {['Simple', 'Easy', 'Medium', 'Hard', 'Expert'][editComplexity - 1]}
                </label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={editComplexity}
                  onChange={e => setEditComplexity(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>Simple</span><span>Easy</span><span>Medium</span><span>Hard</span><span>Expert</span>
                </div>
              </div>

              {/* Required Skills */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Required Skills</label>
                <input
                  type="text"
                  value={editRequiredSkills}
                  onChange={e => setEditRequiredSkills(e.target.value)}
                  placeholder="e.g. Design, React, Python"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Comma-separated list of skills.</p>
              </div>

              {/* Deliverable Format */}
              <div>
                <label className="block text-slate-600 font-medium mb-1.5">Deliverable Format</label>
                <input
                  type="text"
                  value={editDeliverableFormat}
                  onChange={e => setEditDeliverableFormat(e.target.value)}
                  placeholder="e.g. PDF document, Figma file, ZIP archive"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">Comma-separated list of expected deliverable formats.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Executions / Applications */}
      {workUnit.executions && workUnit.executions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">
              {(workUnit as any).assignmentMode === 'manual' ? 'Applications' : 'Executions'} ({workUnit.executions.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {workUnit.executions.map((exec: any) => {
              const statusConfig: Record<string, { label: string; className: string }> = {
                pending_screening: { label: 'Screening', className: 'bg-amber-100 text-amber-700' },
                pending_review: { label: 'Awaiting Review', className: 'bg-purple-100 text-purple-700' },
                assigned: { label: 'Assigned', className: 'bg-slate-100 text-slate-600' },
                clocked_in: { label: 'Working', className: 'bg-green-100 text-green-700' },
                submitted: { label: 'Submitted', className: 'bg-blue-100 text-blue-700' },
                in_review: { label: 'In Review', className: 'bg-blue-100 text-blue-700' },
                revision_needed: { label: 'Revision', className: 'bg-orange-100 text-orange-700' },
                approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
                failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
                cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500' },
              };
              const sc = statusConfig[exec.status] || { label: exec.status, className: 'bg-slate-100 text-slate-600' };

              return (
              <div key={exec.id} className="p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                      <Users className="w-4 h-4 text-slate-500" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{exec.student?.name || 'Student'}</div>
                        <div className="text-xs text-slate-500">
                          {exec.student?.tier} tier · Avg quality: {exec.student?.avgQualityScore != null ? `${Math.round(exec.student.avgQualityScore)}%` : 'N/A'}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${sc.className}`}>
                      {sc.label}
                    </span>
                  </div>

                  {/* Assign / Reject actions for manual mode pending_review */}
                  {exec.status === 'pending_review' && (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            setActionLoading(true);
                            const token = await getToken();
                            if (!token) return;
                            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/executions/${exec.id}/assign`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            });
                            await loadData();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to assign');
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                        disabled={actionLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        <UserCheck className="w-4 h-4" />
                        Assign
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            setActionLoading(true);
                            const token = await getToken();
                            if (!token) return;
                            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/executions/${exec.id}/reject`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            });
                            await loadData();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to reject');
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                        disabled={actionLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject
                      </button>
                      {exec.infoSessionId && (
                        <Link
                          href={`/dashboard/workunits/${workUnitId}/interview/${exec.infoSessionId}`}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-colors"
                        >
                          <Mic className="w-4 h-4" />
                          View Interview
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Screening in progress */}
                  {exec.status === 'pending_screening' && (
                    <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                      <Mic className="w-3 h-3" />
                      Candidate is completing the screening interview...
                </div>
                  )}

                  {/* Review controls for submitted work */}
                {(exec.status === 'submitted' || exec.status === 'in_review') && (
                  <>
                    {showReview === exec.id ? (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                        <div>
                          <label className="text-sm font-medium text-slate-700">Quality Score (0-100)</label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={reviewQuality}
                            onChange={e => setReviewQuality(parseInt(e.target.value))}
                            className="w-full mt-1"
                          />
                          <div className="text-sm text-slate-500">{reviewQuality}%</div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-slate-700">Feedback</label>
                          <textarea
                            value={reviewFeedback}
                            onChange={e => setReviewFeedback(e.target.value)}
                            rows={3}
                            placeholder="Optional feedback..."
                            className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReview(exec.id, 'approved')}
                            disabled={actionLoading}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleReview(exec.id, 'revision_needed')}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                          >
                            Request Revision
                          </button>
                          <button
                            onClick={() => handleReview(exec.id, 'failed')}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => setShowReview(null)}
                            className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <button
                          onClick={() => setShowReview(exec.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                        >
                          <Eye className="w-4 h-4" />
                          Review Submission
                        </button>
                      </div>
                    )}
                  </>
                )}

                {exec.qualityScore != null && (
                  <div className="mt-3 flex items-center gap-4 text-sm text-slate-500">
                    <span>Quality: <strong className="text-slate-900">{exec.qualityScore}%</strong></span>
                    {exec.expEarned > 0 && <span>EXP: <strong className="text-purple-600">+{exec.expEarned}</strong></span>}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Task Improvement Suggestions */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            Improvement Suggestions
          </h2>
          <button
            onClick={handleLoadImprovements}
            disabled={improvementsLoading}
            className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            {improvementsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Analyze'}
          </button>
        </div>
        <div className="p-6">
          {!improvements ? (
            <p className="text-sm text-slate-500">
              Run an AI analysis to get data-driven suggestions for improving this task based on past execution patterns.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Health Badge */}
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  improvements.overallHealth === 'good' ? 'bg-green-100 text-green-700' :
                  improvements.overallHealth === 'needs_attention' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {improvements.overallHealth === 'good' ? '✓ Healthy' :
                   improvements.overallHealth === 'needs_attention' ? '⚠ Needs Attention' :
                   '✕ Critical'}
                </span>
                <span className="text-xs text-slate-500">
                  {improvements.defectCount} defects · {Math.round(improvements.revisionRate * 100)}% revision rate
                </span>
              </div>

              {/* Suggestions */}
              {improvements.suggestions?.length > 0 ? (
                <div className="space-y-3">
                  {improvements.suggestions.map((s: any, i: number) => (
                    <div key={i} className={`p-3 rounded-lg border ${
                      s.priority === 'high' ? 'border-red-200 bg-red-50' :
                      s.priority === 'medium' ? 'border-amber-200 bg-amber-50' :
                      'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold uppercase ${
                          s.priority === 'high' ? 'text-red-600' :
                          s.priority === 'medium' ? 'text-amber-600' : 'text-slate-600'
                        }`}>{s.priority}</span>
                        <span className="text-sm font-medium text-slate-900">{s.title}</span>
                      </div>
                      <p className="text-xs text-slate-600">{s.description}</p>
                      {s.suggestedValue && (
                        <p className="text-xs mt-1 text-primary font-medium">
                          Suggestion: {s.suggestedValue}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-green-700">No issues found. This task is performing well.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Interview & Onboarding */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Interview & Onboarding</h2>
          <div className="flex items-center gap-3 text-xs">
            {workUnit.infoCollectionTemplateId ? (
              <Link href={`/dashboard/templates/${workUnit.infoCollectionTemplateId}`} className="text-slate-500 hover:text-slate-900">
                Edit interview
              </Link>
            ) : (
              <Link href="/dashboard/templates/new" className="text-slate-500 hover:text-slate-900">
                Create interview
              </Link>
            )}
            <span className="text-slate-300">·</span>
            <Link href="/dashboard/sessions" className="text-slate-500 hover:text-slate-900">
              Sessions
            </Link>
            <span className="text-slate-300">·</span>
            <Link href={`/dashboard/settings/onboarding-editor?workUnitId=${workUnitId}`} className="text-slate-500 hover:text-slate-900">
              Onboarding page
            </Link>
            <span className="text-slate-300">·</span>
            <Link href="/dashboard/templates" className="text-slate-500 hover:text-slate-900">
              All templates
            </Link>
          </div>
        </div>
        <div className="px-6 py-4 text-sm text-slate-600">
          {workUnit.infoCollectionTemplateId
            ? 'Screening interview is attached. Candidates complete it before starting work.'
            : 'No screening interview. Candidates can accept this task directly.'}
        </div>
      </div>

      {/* Candidates — with assign/reject in manual mode */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">
              Candidates ({candidates.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {candidates.map((student: any) => (
              <div key={student.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900">{student.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {student.tier} · {student.tasksCompleted} tasks · {Math.round(student.avgQualityScore * 100)}% quality · {Math.round(student.matchScore * 100)}% match
                    </div>
                  </div>
                  {(workUnit as any).assignmentMode === 'manual' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            setActionLoading(true);
                            const token = await getToken();
                            if (!token) return;
                            const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
                            const res = await fetch(`${API_URL}/api/executions/assign`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ workUnitId, studentId: student.id }),
                            });
                            if (!res.ok) {
                              const data = await res.json();
                              setError(data.error || 'Failed to assign');
                              return;
                            }
                            await loadData();
                          } catch (err) {
                            setError('Failed to assign');
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                        disabled={actionLoading}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                      >
                        Assign
                      </button>
                      <button
                        onClick={() => {
                          setCandidates(prev => prev.filter(c => c.id !== student.id));
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-400 border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-600"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
