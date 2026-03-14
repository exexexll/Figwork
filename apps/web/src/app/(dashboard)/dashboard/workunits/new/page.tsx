'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  Plus,
  Trash2,
  AlertCircle,
  Sparkles,
  DollarSign,
  Clock,
  Mic,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { createWorkUnit, CreateWorkUnitInput, getWorkUnits, type PublishConditions, type PublishDependency, type WorkUnitDetailed } from '@/lib/marketplace-api';
import { getTemplates } from '@/lib/api';
import type { Template } from '@/lib/types';
import { track, EVENTS } from '@/lib/analytics';

export default function NewWorkUnitPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState('');
  const [category, setCategory] = useState('');
  const [priceInCents, setPriceInCents] = useState(1000);
  const [deadlineHours, setDeadlineHours] = useState(24);
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [deliverableFormat, setDeliverableFormat] = useState<string[]>(['']);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<Array<{ criterion: string; required: boolean }>>([
    { criterion: '', required: true },
  ]);
  const [milestones, setMilestones] = useState<Array<{ description: string; expectedCompletion: number }>>([]);
  const [complexityScore, setComplexityScore] = useState(1);
  const [minTier, setMinTier] = useState<'novice' | 'pro' | 'elite'>('novice');
  const [revisionLimit, setRevisionLimit] = useState(2);

  // Screening & Assignment
  const [assignmentMode, setAssignmentMode] = useState<'auto' | 'manual'>('auto');
  const [enableScreening, setEnableScreening] = useState(false);
  const [infoCollectionTemplateId, setInfoCollectionTemplateId] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);

  // Publishing
  const [publishMode, setPublishMode] = useState<'immediate' | 'scheduled' | 'conditional'>('immediate');
  const [scheduledPublishAt, setScheduledPublishAt] = useState('');
  const [publishLogic, setPublishLogic] = useState<'AND' | 'OR'>('AND');
  const [dependencies, setDependencies] = useState<Array<PublishDependency & { id: string }>>([]);
  const [availableWorkUnits, setAvailableWorkUnits] = useState<WorkUnitDetailed[]>([]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await getTemplates(token);
        setTemplates(res?.data || []);
      } catch {}
    }
    loadTemplates();
  }, [getToken]);

  useEffect(() => {
    async function loadWorkUnits() {
      if (publishMode !== 'conditional') return;
      try {
        const token = await getToken();
        if (!token) return;
        // Fetch all work units (any status) so they can be selected as dependencies
        const wus = await getWorkUnits(token);
        setAvailableWorkUnits(wus);
      } catch {}
    }
    loadWorkUnits();
  }, [getToken, publishMode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanedCriteria = acceptanceCriteria.filter(ac => ac.criterion.trim());
    const cleanedFormat = deliverableFormat.filter(f => f.trim());

    if (cleanedCriteria.length === 0) {
      setError('At least one acceptance criterion is required');
      return;
    }
    if (cleanedFormat.length === 0) {
      setError('At least one deliverable format is required');
      return;
    }

    // Validate scheduling
    if (publishMode === 'scheduled' && !scheduledPublishAt) {
      setError('Please select a publish date and time');
      return;
    }
    if (publishMode === 'conditional') {
      const validDeps = dependencies.filter(d => d.workUnitId);
      if (validDeps.length === 0) {
        setError('Add at least one dependency for conditional publishing');
        return;
      }
    }

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;

      const data: CreateWorkUnitInput = {
        title,
        spec,
        category,
        priceInCents,
        deadlineHours,
        requiredSkills,
        deliverableFormat: cleanedFormat,
        acceptanceCriteria: cleanedCriteria,
        milestones: milestones.filter(m => m.description.trim()),
        complexityScore,
        minTier,
        revisionLimit,
        assignmentMode,
        infoCollectionTemplateId: enableScreening && infoCollectionTemplateId ? infoCollectionTemplateId : undefined,
        scheduledPublishAt: publishMode === 'scheduled' && scheduledPublishAt ? scheduledPublishAt : undefined,
        publishConditions: publishMode === 'conditional' && dependencies.length > 0 ? {
          logic: publishLogic,
          dependencies: dependencies.map(d => {
            const { id, ...dep } = d;
            return dep;
          }),
        } : undefined,
      };

      const result = await createWorkUnit(data, token);
      track(EVENTS.WORK_UNIT_CREATED, { workUnitId: result.id, category: data.category });
      router.push(`/dashboard/workunits/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create work unit');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <Link
        href="/dashboard/workunits"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Work Units
      </Link>

      <h1 className="text-2xl font-semibold text-text-primary mb-6">Create Work Unit</h1>

      {error && (
        <Card className="!border-red-200 !bg-red-50/50 p-4 mb-6 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardContent className="p-6 space-y-4">
          <h2 className="font-semibold text-text-primary">Basic Information</h2>
          
          <div>
            <label className="text-sm font-medium text-text-secondary">Title *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              minLength={5}
              placeholder="e.g. Design a Logo for Tech Startup"
              className="w-full mt-1 px-3 py-2.5 input"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-secondary">Specification *</label>
            <textarea
              value={spec}
              onChange={e => setSpec(e.target.value)}
              required
              minLength={50}
              rows={6}
              placeholder="Provide a detailed description of the task, requirements, and context..."
              className="w-full mt-1 px-3 py-2.5 input resize-none"
            />
            <p className="text-xs text-text-muted mt-1">{spec.length} characters (minimum 50)</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-text-secondary">Category *</label>
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                required
                placeholder="e.g. design, writing, coding"
                className="w-full mt-1 px-3 py-2.5 input"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-secondary flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" />
                Price (USD) *
              </label>
              <input
                type="number"
                value={priceInCents / 100}
                onChange={e => setPriceInCents(Math.round(parseFloat(e.target.value) * 100))}
                required
                min={5}
                step={0.01}
                className="w-full mt-1 px-3 py-2.5 input"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium text-text-secondary flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Deadline (hours) *
              </label>
              <input
                type="number"
                value={deadlineHours}
                onChange={e => setDeadlineHours(parseInt(e.target.value))}
                required
                min={1}
                className="w-full mt-1 px-3 py-2.5 input"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-secondary">Complexity (1-5)</label>
              <select
                value={complexityScore}
                onChange={e => setComplexityScore(parseInt(e.target.value))}
                className="w-full mt-1 px-3 py-2.5 input"
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n} - {['Simple', 'Easy', 'Medium', 'Hard', 'Expert'][n - 1]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-text-secondary">Min Tier</label>
              <select
                value={minTier}
                onChange={e => setMinTier(e.target.value as any)}
                className="w-full mt-1 px-3 py-2.5 input"
              >
                <option value="novice">Novice</option>
                <option value="pro">Pro</option>
                <option value="elite">Elite</option>
              </select>
            </div>
          </div>
          </CardContent>
        </Card>

        {/* Skills */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-text-primary">Required Skills</h2>
          <div className="flex flex-wrap gap-2">
            {requiredSkills.map(skill => (
              <span key={skill} className="inline-flex items-center gap-1 px-3 py-1 bg-primary-light/20 text-primary-dark rounded-lg text-sm">
                {skill}
                <button type="button" onClick={() => setRequiredSkills(requiredSkills.filter(s => s !== skill))} className="text-primary hover:text-primary-dark">×</button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = skillInput.trim();
                    if (trimmed && !requiredSkills.includes(trimmed)) {
                      setRequiredSkills([...requiredSkills, trimmed]);
                      setSkillInput('');
                    }
                  }
                }}
                placeholder="Add skill (press Enter)"
                className="px-3 py-1 border border-slate-200 rounded-lg text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Acceptance Criteria */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-text-primary">Acceptance Criteria *</h2>
          {acceptanceCriteria.map((ac, i) => (
            <div key={i} className="flex items-start gap-3">
              <input
                type="text"
                value={ac.criterion}
                onChange={e => {
                  const updated = [...acceptanceCriteria];
                  updated[i] = { ...updated[i], criterion: e.target.value };
                  setAcceptanceCriteria(updated);
                }}
                placeholder={`Criterion ${i + 1}`}
                className="flex-1 px-3 py-2 input"
              />
              <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap pt-2">
                <input
                  type="checkbox"
                  checked={ac.required}
                  onChange={e => {
                    const updated = [...acceptanceCriteria];
                    updated[i] = { ...updated[i], required: e.target.checked };
                    setAcceptanceCriteria(updated);
                  }}
                  className="rounded"
                />
                Required
              </label>
              {acceptanceCriteria.length > 1 && (
                <button
                  type="button"
                  onClick={() => setAcceptanceCriteria(acceptanceCriteria.filter((_, j) => j !== i))}
                  className="p-2 text-text-muted hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAcceptanceCriteria([...acceptanceCriteria, { criterion: '', required: true }])}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary-dark"
          >
            <Plus className="w-4 h-4" />
            Add Criterion
          </button>
        </div>

        {/* Deliverable Format */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-text-primary">Deliverable Format *</h2>
          {deliverableFormat.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="text"
                value={f}
                onChange={e => {
                  const updated = [...deliverableFormat];
                  updated[i] = e.target.value;
                  setDeliverableFormat(updated);
                }}
                placeholder="e.g. PNG file, PDF document, GitHub repo link"
                className="flex-1 px-3 py-2 input"
              />
              {deliverableFormat.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDeliverableFormat(deliverableFormat.filter((_, j) => j !== i))}
                  className="p-2 text-text-muted hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDeliverableFormat([...deliverableFormat, ''])}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary-dark"
          >
            <Plus className="w-4 h-4" />
            Add Format
          </button>
        </div>

        {/* Candidate Assignment Mode */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <h2 className="font-semibold text-text-primary">Candidate Assignment</h2>
            <p className="text-sm text-text-secondary">
              Choose how contractors are assigned to this task.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAssignmentMode('auto')}
                className={cn(
                  'p-4 rounded-xl border text-left transition-all',
                  assignmentMode === 'auto'
                    ? 'border-[#a78bfa] bg-[#f3f0f8]'
                    : 'border-[#e8e4f0] hover:border-[#c4b5fd]'
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-[#a78bfa]" />
                  <span className="font-medium text-text-primary text-sm">Auto-Match</span>
                </div>
                <p className="text-xs text-text-secondary">
                  Figwork automatically assigns the best-matched contractor based on skills, tier, and history.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setAssignmentMode('manual')}
                className={cn(
                  'p-4 rounded-xl border text-left transition-all',
                  assignmentMode === 'manual'
                    ? 'border-[#a78bfa] bg-[#f3f0f8]'
                    : 'border-[#e8e4f0] hover:border-[#c4b5fd]'
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-[#a78bfa]" />
                  <span className="font-medium text-text-primary text-sm">Manual Review</span>
                </div>
                <p className="text-xs text-text-secondary">
                  You review candidate profiles and interview transcripts, then select who to assign.
                </p>
              </button>
            </div>

            {assignmentMode === 'manual' && (
              <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                Candidates who pass screening will appear in your review queue. You'll see their profiles, 
                interview transcripts, and match scores before assigning work.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Screening Interview (optional) */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-text-primary">Screening Interview</h2>
                <p className="text-sm text-text-secondary">
                  Optionally require an AI interview before candidates can start this task.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnableScreening(!enableScreening)}
                className={cn(
                  'relative w-11 h-6 rounded-full transition-colors',
                  enableScreening ? 'bg-[#a78bfa]' : 'bg-[#e8e4f0]'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                    enableScreening ? 'translate-x-5.5 left-0.5' : 'left-0.5'
                  )}
                  style={{ transform: enableScreening ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>

            {enableScreening && (
              <div className="space-y-3">
                {templates.length > 0 ? (
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Select Interview Template
                    </label>
                    <select
                      value={infoCollectionTemplateId}
                      onChange={e => setInfoCollectionTemplateId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                    >
                      <option value="">Choose a template...</option>
                      {templates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t._count?.questions ?? 0} questions)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Quick-create option */}
                <Link
                  href="/dashboard/templates/new"
                  className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-[#c4b5fd] hover:bg-[#f3f0f8] transition-colors"
                >
                  <Plus className="w-4 h-4 text-[#a78bfa]" />
                  <span className="text-sm text-[#a78bfa] font-medium">
                    {templates.length > 0 ? 'Create new template' : 'Create your first interview template'}
                  </span>
                </Link>

                <div className="p-3 bg-[#faf8fc] rounded-lg text-xs text-text-secondary">
                  <strong>How it works:</strong> When a candidate accepts this task, they'll complete 
                  the screening interview first. You'll see their transcript and AI summary before 
                  they can start work{assignmentMode === 'manual' ? ' — and you choose who to assign.' : '.'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Milestones (optional) */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-text-primary">Milestones (optional)</h2>
          <p className="text-sm text-text-secondary">Break the task into measurable milestones</p>
          {milestones.map((m, i) => (
            <div key={i} className="flex items-start gap-3">
              <input
                type="text"
                value={m.description}
                onChange={e => {
                  const updated = [...milestones];
                  updated[i] = { ...updated[i], description: e.target.value };
                  setMilestones(updated);
                }}
                placeholder={`Milestone ${i + 1}`}
                className="flex-1 px-3 py-2 input"
              />
              <button
                type="button"
                onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}
                className="p-2 text-text-muted hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMilestones([...milestones, { description: '', expectedCompletion: (milestones.length + 1) / (milestones.length + 2) }])}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary-dark"
          >
            <Plus className="w-4 h-4" />
            Add Milestone
          </button>
        </div>

        {/* Publishing */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-[#a78bfa]" />
              <h2 className="font-semibold text-text-primary">Publishing</h2>
            </div>
            <p className="text-sm text-text-secondary">Choose when this task becomes visible to contractors.</p>

            <div className="space-y-1">
              {[
                { value: 'immediate', label: 'Publish manually', desc: 'You activate the task when ready — default behavior' },
                { value: 'scheduled', label: 'Schedule for a specific date', desc: 'Auto-publish at a date and time you set' },
                { value: 'conditional', label: 'Publish when conditions are met', desc: 'Link to other tasks — publish when dependencies complete' },
              ].map(opt => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition-colors',
                    publishMode === opt.value
                      ? 'border-[#c4b5fd] bg-[#faf8fc]'
                      : 'border-transparent hover:bg-[#fafafa]'
                  )}
                >
                  <input
                    type="radio"
                    name="publishMode"
                    value={opt.value}
                    checked={publishMode === opt.value}
                    onChange={e => setPublishMode(e.target.value as any)}
                    className="w-4 h-4 mt-0.5 accent-[#a78bfa]"
                  />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                    <p className="text-xs text-text-secondary mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {publishMode === 'scheduled' && (
              <div className="mt-2 p-4 bg-[#faf8fc] rounded-lg border border-[#e8e4f0] space-y-3">
                <label className="block text-sm font-medium text-text-primary">Publish Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledPublishAt}
                  onChange={e => setScheduledPublishAt(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                  min={new Date().toISOString().slice(0, 16)}
                />
                <p className="text-xs text-text-secondary">
                  The task will automatically go live at this time. Escrow must be funded before the scheduled time.
                </p>
              </div>
            )}

            {publishMode === 'conditional' && (
              <div className="mt-2 p-4 bg-[#faf8fc] rounded-lg border border-[#e8e4f0] space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">When should this task publish?</label>
                  <div className="flex gap-3">
                    {[
                      { value: 'AND', label: 'All conditions met', desc: 'Every dependency must pass' },
                      { value: 'OR', label: 'Any condition met', desc: 'First one wins' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPublishLogic(opt.value as 'AND' | 'OR')}
                        className={cn(
                          'flex-1 p-3 rounded-lg border text-left transition-colors',
                          publishLogic === opt.value
                            ? 'border-[#c4b5fd] bg-white'
                            : 'border-[#e8e4f0] bg-transparent hover:bg-white'
                        )}
                      >
                        <span className="text-sm font-medium text-text-primary block">{opt.label}</span>
                        <span className="text-xs text-text-secondary">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Dependencies {dependencies.length > 0 && <span className="text-text-muted font-normal">({dependencies.length})</span>}
                  </label>

                  <div className="space-y-3">
                    {dependencies.map((dep, idx) => {
                      const selectedWu = availableWorkUnits.find(w => w.id === dep.workUnitId);
                      return (
                        <div key={dep.id} className="p-3 bg-white border border-[#e8e4f0] rounded-xl space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                              Dependency {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => setDependencies(deps => deps.filter(d => d.id !== dep.id))}
                              className="text-text-muted hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <select
                            value={dep.workUnitId}
                            onChange={e => {
                              const updated = [...dependencies];
                              updated[idx] = { ...updated[idx], workUnitId: e.target.value };
                              setDependencies(updated);
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                          >
                            <option value="">Select a task...</option>
                            {availableWorkUnits.map(wu => (
                              <option key={wu.id} value={wu.id}>
                                {wu.title} — {wu.status} · ${(wu.priceInCents / 100).toFixed(0)}
                              </option>
                            ))}
                          </select>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">Wait until</label>
                              <select
                                value={dep.condition}
                                onChange={e => {
                                  const updated = [...dependencies];
                                  const newCondition = e.target.value as any;
                                  updated[idx] = {
                                    ...updated[idx],
                                    condition: newCondition,
                                    onFailure: newCondition === 'failed' ? 'notify' : undefined,
                                  };
                                  setDependencies(updated);
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-[#e8e4f0] bg-white text-xs"
                              >
                                <option value="published">Published (active)</option>
                                <option value="completed">Completed (approved)</option>
                                <option value="failed">Failed / cancelled</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">Share with contractor</label>
                              <select
                                value={dep.shareContext}
                                onChange={e => {
                                  const updated = [...dependencies];
                                  updated[idx] = { ...updated[idx], shareContext: e.target.value as any };
                                  setDependencies(updated);
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-[#e8e4f0] bg-white text-xs"
                              >
                                <option value="none">Nothing</option>
                                <option value="summary">Summary only</option>
                                <option value="full">Full context + deliverables</option>
                              </select>
                            </div>
                          </div>

                          {dep.condition === 'failed' && (
                            <div>
                              <label className="block text-[11px] text-text-muted mb-1">If dependency fails...</label>
                              <select
                                value={dep.onFailure || 'notify'}
                                onChange={e => {
                                  const updated = [...dependencies];
                                  updated[idx] = { ...updated[idx], onFailure: e.target.value as any };
                                  setDependencies(updated);
                                }}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-[#e8e4f0] bg-white text-xs"
                              >
                                <option value="publish">Publish this task anyway</option>
                                <option value="cancel">Cancel this task</option>
                                <option value="notify">Notify me to decide</option>
                              </select>
                            </div>
                          )}

                          {selectedWu && (
                            <p className="text-[11px] text-text-muted">
                              {dep.condition === 'published' && `Will publish when "${selectedWu.title}" goes active`}
                              {dep.condition === 'completed' && `Will publish when "${selectedWu.title}" has an approved execution`}
                              {dep.condition === 'failed' && `Reacts when "${selectedWu.title}" fails or is cancelled`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDependencies([
                      ...dependencies,
                      { id: `dep-${Date.now()}`, workUnitId: '', condition: 'completed', shareContext: 'summary' },
                    ])}
                    className="flex items-center gap-2 text-sm text-[#a78bfa] hover:text-[#7c3aed] font-medium mt-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Dependency
                  </button>
                </div>

                {dependencies.length > 0 && (
                  <div className="p-3 bg-white rounded-lg border border-[#e8e4f0] text-xs text-text-secondary">
                    <strong className="text-text-primary">How it works:</strong>{' '}
                    {publishLogic === 'AND'
                      ? `This task will auto-publish once all ${dependencies.length} dependenc${dependencies.length === 1 ? 'y is' : 'ies are'} met.`
                      : `This task will auto-publish as soon as any 1 of the ${dependencies.length} dependencies is met.`}
                    {' '}Escrow must be funded beforehand.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Onboarding Page Note */}
        <div className="p-4 bg-pink-50/50 border border-pink-100 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-pink-800">Contractor Onboarding Page</p>
            <p className="text-xs text-pink-600 mt-0.5">
              Customize after creating — edit the onboarding page from the work unit detail view.
            </p>
          </div>
          <span className="text-xs text-pink-400">Available after save</span>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between py-4">
          <Link href="/dashboard/workunits" className="text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || !title || !spec || !category}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Create Work Unit
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
