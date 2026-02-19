'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  MoveUp,
  MoveDown,
  FileText,
  Shield,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  GripVertical,
  Check,
  X,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  User,
  Phone,
  CreditCard,
  Receipt,
  Edit3,
  Sparkles,
  Globe,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  getAdminOnboardingSteps,
  updateOnboardingStep,
  reorderOnboardingSteps,
  createOnboardingStep,
  deleteOnboardingStep,
  getAdminAgreements,
  createAgreement,
  updateAgreement,
  archiveAgreement,
  type AdminOnboardingStep,
  type LegalAgreementFull,
} from '@/lib/marketplace-api';

// Icon map for step types
const STEP_ICONS: Record<string, any> = {
  User,
  Phone,
  FileText,
  Shield,
  Receipt,
  CreditCard,
  Lock,
  ShieldCheck,
};

// Gate level labels and colors
const GATE_LEVELS = [
  { value: 'browse', label: 'Browse', icon: Globe, color: 'text-green-600', bg: 'bg-green-50', description: 'Required to browse marketplace' },
  { value: 'accept', label: 'Accept Tasks', icon: ShieldCheck, color: 'text-blue-600', bg: 'bg-blue-50', description: 'Required to accept tasks' },
  { value: 'payout', label: 'Get Paid', icon: Wallet, color: 'text-purple-600', bg: 'bg-purple-50', description: 'Required to receive payouts' },
];

// Agreement templates for quick creation
const AGREEMENT_TEMPLATES = [
  {
    title: 'Independent Contractor Agreement',
    slug: 'contractor-agreement',
    content: `# Independent Contractor Agreement

This Independent Contractor Agreement ("Agreement") is entered into between Figwork, Inc. ("Company") and the undersigned individual ("Contractor").

## 1. Engagement
Company engages Contractor as an independent contractor, not an employee, to perform services as described in individual Work Units posted on the Figwork platform.

## 2. Independent Contractor Status
Contractor acknowledges that they are an independent contractor and not an employee of Company. Contractor shall be responsible for all taxes, including self-employment taxes.

## 3. Compensation
Contractor will be compensated at the rate specified in each accepted Work Unit, less applicable platform fees as disclosed at the time of acceptance.

## 4. Confidentiality
Contractor agrees to maintain the confidentiality of all proprietary information received through the platform and during task performance.

## 5. Intellectual Property
All work product created during the performance of Work Units shall be considered "work made for hire" and shall be the property of the posting Company.

## 6. Term and Termination
Either party may terminate this Agreement at any time. Outstanding obligations for accepted Work Units survive termination.

## 7. Dispute Resolution
Any disputes shall be resolved through the Figwork dispute resolution process first, and if unresolved, through binding arbitration.

By signing below, you acknowledge that you have read, understood, and agree to be bound by the terms of this Agreement.`,
  },
  {
    title: 'Non-Disclosure Agreement',
    slug: 'nda',
    content: `# Non-Disclosure Agreement

This Non-Disclosure Agreement ("NDA") is entered into between Figwork, Inc. ("Disclosing Party") and the undersigned individual ("Receiving Party").

## 1. Confidential Information
"Confidential Information" includes all non-public information shared through the platform, including but not limited to: task specifications, company data, trade secrets, and proprietary methodologies.

## 2. Obligations
The Receiving Party agrees to:
- Not disclose Confidential Information to any third party
- Use Confidential Information only for the purpose of performing assigned tasks
- Take reasonable measures to protect the confidentiality of such information

## 3. Exceptions
This NDA does not apply to information that:
- Is publicly available
- Was known to the Receiving Party before disclosure
- Is independently developed without use of Confidential Information

## 4. Duration
The obligations under this NDA shall survive for a period of two (2) years after the termination of the contractor relationship.

## 5. Return of Materials
Upon termination, the Receiving Party shall return or destroy all materials containing Confidential Information.

By signing below, you acknowledge that you have read, understood, and agree to be bound by the terms of this NDA.`,
  },
  {
    title: 'Acceptable Use Policy',
    slug: 'acceptable-use',
    content: `# Acceptable Use Policy

This Acceptable Use Policy ("Policy") governs your use of the Figwork platform as a contractor.

## 1. Account Integrity
- You must provide accurate and truthful information
- You may not create multiple accounts
- You must complete tasks yourself (no subcontracting without approval)

## 2. Quality Standards
- All deliverables must meet the acceptance criteria specified in the Work Unit
- You must respond to Proof of Work check-ins within the required timeframe
- Plagiarism or submission of AI-generated content without disclosure is prohibited

## 3. Communication
- Be professional and respectful in all communications
- Report issues promptly through the proper channels
- Do not contact companies directly outside the platform for task-related matters

## 4. Prohibited Activities
- Manipulating quality scores or reviews
- Sharing account access with others
- Using the platform for any illegal purposes
- Harassment of any kind

## 5. Enforcement
Violations may result in warnings, temporary suspension, or permanent removal from the platform, at Figwork's sole discretion.

By signing below, you acknowledge that you have read, understood, and agree to abide by this Policy.`,
  },
];

export default function LegalOnboardingPage() {
  const { getToken } = useAuth();

  // Steps state
  const [steps, setSteps] = useState<AdminOnboardingStep[]>([]);
  const [agreements, setAgreements] = useState<LegalAgreementFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // UI state
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<'steps' | 'agreements' | 'gates'>('steps');
  const [showNewAgreement, setShowNewAgreement] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState<LegalAgreementFull | null>(null);

  // New agreement form
  const [newAgreement, setNewAgreement] = useState({
    title: '',
    slug: '',
    content: '',
    status: 'draft' as string,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;

      const [stepsRes, agreementsRes] = await Promise.all([
        getAdminOnboardingSteps(token),
        getAdminAgreements(token),
      ]);

      setSteps(stepsRes.steps);
      setAgreements(agreementsRes.agreements);
    } catch (err) {
      console.error('Failed to load onboarding config:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStep(stepId: string, field: 'enabled' | 'required', value: boolean) {
    const token = await getToken();
    if (!token) return;

    try {
      await updateOnboardingStep(stepId, { [field]: value }, token);
      setSteps(prev =>
        prev.map(s => (s.id === stepId ? { ...s, [field]: value } : s))
      );
      flash('Step updated');
    } catch (err) {
      console.error('Failed to update step:', err);
    }
  }

  async function handleUpdateGateLevel(stepId: string, gateLevel: string) {
    const token = await getToken();
    if (!token) return;

    try {
      await updateOnboardingStep(stepId, { gateLevel }, token);
      setSteps(prev =>
        prev.map(s => (s.id === stepId ? { ...s, gateLevel } : s))
      );
      flash('Gate level updated');
    } catch (err) {
      console.error('Failed to update gate level:', err);
    }
  }

  async function handleMoveStep(stepId: string, direction: 'up' | 'down') {
    const idx = steps.findIndex(s => s.id === stepId);
    if (direction === 'up' && idx <= 0) return;
    if (direction === 'down' && idx >= steps.length - 1) return;

    const newSteps = [...steps];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]];

    // Update order indices
    const order = newSteps.map((s, i) => ({ id: s.id, orderIndex: i }));

    const token = await getToken();
    if (!token) return;

    try {
      const res = await reorderOnboardingSteps(order, token);
      setSteps(res.steps);
    } catch (err) {
      console.error('Failed to reorder:', err);
    }
  }

  async function handleAddAgreementStep(agreementId: string) {
    const token = await getToken();
    if (!token) return;

    const agreement = agreements.find(a => a.id === agreementId);
    if (!agreement) return;

    try {
      const res = await createOnboardingStep(
        {
          stepType: 'agreement',
          label: agreement.title,
          description: `Read and sign the ${agreement.title}`,
          icon: 'FileText',
          enabled: true,
          required: true,
          gateLevel: 'accept',
          agreementId,
        },
        token
      );
      setSteps(prev => [...prev, res.step]);
      flash('Agreement step added');
    } catch (err) {
      console.error('Failed to add step:', err);
    }
  }

  async function handleDeleteStep(stepId: string) {
    const token = await getToken();
    if (!token) return;

    try {
      await deleteOnboardingStep(stepId, token);
      setSteps(prev => prev.filter(s => s.id !== stepId));
      if (selectedStepId === stepId) setSelectedStepId(null);
      flash('Step removed');
    } catch (err: any) {
      alert(err.message || 'Cannot delete this step');
    }
  }

  async function handleCreateAgreement() {
    if (!newAgreement.title || !newAgreement.slug || !newAgreement.content) return;

    const token = await getToken();
    if (!token) return;

    try {
      const res = await createAgreement(newAgreement, token);
      setAgreements(prev => [res.agreement, ...prev]);
      setShowNewAgreement(false);
      setNewAgreement({ title: '', slug: '', content: '', status: 'draft' });
      flash('Agreement created');
    } catch (err: any) {
      alert(err.message || 'Failed to create agreement');
    }
  }

  async function handleUpdateAgreement() {
    if (!editingAgreement) return;

    const token = await getToken();
    if (!token) return;

    try {
      const res = await updateAgreement(
        editingAgreement.id,
        {
          title: editingAgreement.title,
          content: editingAgreement.content,
          status: editingAgreement.status,
        },
        token
      );
      setAgreements(prev =>
        prev.map(a => (a.id === editingAgreement.id ? { ...a, ...res.agreement } : a))
      );
      setEditingAgreement(null);
      flash('Agreement updated');
    } catch (err: any) {
      alert(err.message || 'Failed to update');
    }
  }

  async function handlePublishAgreement(id: string) {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await updateAgreement(id, { status: 'active' }, token);
      setAgreements(prev =>
        prev.map(a => (a.id === id ? { ...a, ...res.agreement } : a))
      );
      flash('Agreement published');
    } catch (err) {
      console.error('Failed to publish:', err);
    }
  }

  async function handleArchiveAgreement(id: string) {
    const token = await getToken();
    if (!token) return;

    try {
      await archiveAgreement(id, token);
      setAgreements(prev =>
        prev.map(a => (a.id === id ? { ...a, status: 'archived' } : a))
      );
      flash('Agreement archived');
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  }

  async function handleBumpVersion(id: string) {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await updateAgreement(id, { bumpVersion: true }, token);
      setAgreements(prev =>
        prev.map(a => (a.id === id ? { ...a, ...res.agreement } : a))
      );
      flash('Version bumped — workers will need to re-sign');
    } catch (err) {
      console.error('Failed to bump version:', err);
    }
  }

  function useTemplate(template: typeof AGREEMENT_TEMPLATES[0]) {
    setNewAgreement({
      title: template.title,
      slug: template.slug,
      content: template.content,
      status: 'draft',
    });
    setShowNewAgreement(true);
  }

  function flash(message: string) {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(null), 3000);
  }

  const selectedStep = steps.find(s => s.id === selectedStepId);

  // Gate summary
  const gateSummary = {
    browse: steps.filter(s => s.enabled && s.required && s.gateLevel === 'browse'),
    accept: steps.filter(s => s.enabled && s.required && ['browse', 'accept'].includes(s.gateLevel)),
    payout: steps.filter(s => s.enabled && s.required),
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-light border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/admin/settings"
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Settings
          </Link>
          <h1 className="text-2xl font-semibold text-text-primary">Legal Onboarding Configuration</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Configure what workers must complete before they can browse, accept tasks, or get paid.
          </p>
        </div>
        {saveMessage && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            <Check className="w-4 h-4" />
            {saveMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ================================ */}
        {/* LEFT COLUMN: Steps & Agreements */}
        {/* ================================ */}
        <div className="col-span-2 space-y-6">
          {/* GATE SUMMARY CARDS */}
          <div className="grid grid-cols-3 gap-3">
            {GATE_LEVELS.map(gate => {
              const Icon = gate.icon;
              const gateSteps = gate.value === 'browse'
                ? gateSummary.browse
                : gate.value === 'accept'
                ? gateSummary.accept
                : gateSummary.payout;

              return (
                <div
                  key={gate.value}
                  className={`p-4 rounded-xl border border-[#e8e4f0] ${gate.bg}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${gate.color}`} />
                    <span className={`text-sm font-semibold ${gate.color}`}>
                      {gate.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{gate.description}</p>
                  <div className="text-lg font-bold text-slate-700">
                    {gateSteps.length} step{gateSteps.length !== 1 ? 's' : ''}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {gateSteps.map(s => s.label).join(', ') || 'None required'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ONBOARDING STEPS */}
          <div className="bg-white rounded-xl border border-[#e8e4f0]">
            <button
              onClick={() => setExpandedSection(expandedSection === 'steps' ? 'gates' : 'steps')}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-[#a78bfa]" />
                <div>
                  <h2 className="font-semibold text-text-primary">Onboarding Steps</h2>
                  <p className="text-xs text-text-secondary">
                    {steps.filter(s => s.enabled).length} active · {steps.filter(s => s.enabled && s.required).length} required
                  </p>
                </div>
              </div>
              {expandedSection === 'steps' ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {expandedSection === 'steps' && (
              <div className="border-t border-[#f3f0f8] px-5 pb-5">
                <div className="mt-4 space-y-2">
                  {steps.map((step, idx) => {
                    const IconComponent = STEP_ICONS[step.icon || 'Shield'] || Shield;
                    const isSelected = selectedStepId === step.id;
                    const gateConfig = GATE_LEVELS.find(g => g.value === step.gateLevel);

                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#a78bfa] bg-[#faf8fc] shadow-sm'
                            : step.enabled
                            ? 'border-[#e8e4f0] hover:border-[#c4b5fd]'
                            : 'border-[#e8e4f0] bg-slate-50 opacity-60'
                        }`}
                        onClick={() => setSelectedStepId(isSelected ? null : step.id)}
                      >
                        {/* Grip + Move */}
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={e => { e.stopPropagation(); handleMoveStep(step.id, 'up'); }}
                            disabled={idx === 0}
                            className="p-0.5 text-slate-300 hover:text-slate-500 disabled:opacity-30"
                          >
                            <MoveUp className="w-3 h-3" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleMoveStep(step.id, 'down'); }}
                            disabled={idx === steps.length - 1}
                            className="p-0.5 text-slate-300 hover:text-slate-500 disabled:opacity-30"
                          >
                            <MoveDown className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Icon */}
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            step.enabled ? 'bg-[#f3f0f8]' : 'bg-slate-100'
                          }`}
                        >
                          <IconComponent className={`w-4 h-4 ${step.enabled ? 'text-[#a78bfa]' : 'text-slate-400'}`} />
                        </div>

                        {/* Label */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${step.enabled ? 'text-text-primary' : 'text-slate-400'}`}>
                              {step.label}
                            </span>
                            {step.required && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">
                                Required
                              </span>
                            )}
                            {step.stepType === 'agreement' && step.agreement && (
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                step.agreement.status === 'active'
                                  ? 'bg-green-50 text-green-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}>
                                v{step.agreement.version} · {step.agreement.status}
                              </span>
                            )}
                          </div>
                          {step.description && (
                            <p className="text-xs text-text-secondary truncate">
                              {step.description}
                            </p>
                          )}
                        </div>

                        {/* Gate Indicator */}
                        {gateConfig && (
                          <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${gateConfig.bg} ${gateConfig.color}`}>
                            {gateConfig.label}
                          </span>
                        )}

                        {/* Toggle */}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleToggleStep(step.id, 'enabled', !step.enabled);
                          }}
                          className={`relative w-10 h-5 rounded-full transition-all ${
                            step.enabled ? 'bg-[#a78bfa]' : 'bg-slate-200'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                              step.enabled ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Add agreement step button */}
                {agreements.filter(a => a.status === 'active').length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#f3f0f8]">
                    <p className="text-xs text-text-secondary mb-2">Add agreement as onboarding step:</p>
                    <div className="flex flex-wrap gap-2">
                      {agreements
                        .filter(a => a.status === 'active')
                        .filter(a => !steps.some(s => s.agreementId === a.id))
                        .map(agreement => (
                          <button
                            key={agreement.id}
                            onClick={() => handleAddAgreementStep(agreement.id)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-[#c4b5fd] text-[#a78bfa] hover:bg-[#faf8fc] transition-all"
                          >
                            <Plus className="w-3 h-3" />
                            {agreement.title}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LEGAL AGREEMENTS */}
          <div className="bg-white rounded-xl border border-[#e8e4f0]">
            <button
              onClick={() => setExpandedSection(expandedSection === 'agreements' ? 'steps' : 'agreements')}
              className="w-full flex items-center justify-between px-5 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-[#a78bfa]" />
                <div>
                  <h2 className="font-semibold text-text-primary">Legal Agreements</h2>
                  <p className="text-xs text-text-secondary">
                    {agreements.filter(a => a.status === 'active').length} active · {agreements.length} total
                  </p>
                </div>
              </div>
              {expandedSection === 'agreements' ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {expandedSection === 'agreements' && (
              <div className="border-t border-[#f3f0f8] px-5 pb-5">
                {/* Template Quick Start */}
                {agreements.length === 0 && !showNewAgreement && (
                  <div className="mt-4 p-4 bg-[#faf8fc] rounded-xl border border-dashed border-[#c4b5fd]">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-[#a78bfa]" />
                      <span className="text-sm font-medium text-text-primary">Quick Start — Use a template</span>
                    </div>
                    <div className="space-y-2">
                      {AGREEMENT_TEMPLATES.map(tpl => (
                        <button
                          key={tpl.slug}
                          onClick={() => useTemplate(tpl)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white border border-[#e8e4f0] hover:border-[#c4b5fd] transition-all"
                        >
                          <FileText className="w-4 h-4 text-[#a78bfa] flex-shrink-0" />
                          <div>
                            <span className="text-sm font-medium text-text-primary">{tpl.title}</span>
                            <p className="text-[10px] text-text-secondary">
                              {tpl.content.split('\n').slice(0, 2).join(' ').substring(0, 80)}...
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Agreement List */}
                <div className="mt-4 space-y-3">
                  {agreements.map(agreement => (
                    <div
                      key={agreement.id}
                      className="p-4 rounded-xl border border-[#e8e4f0] hover:border-[#c4b5fd] transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-text-primary text-sm">{agreement.title}</h3>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              agreement.status === 'active'
                                ? 'bg-green-50 text-green-600'
                                : agreement.status === 'draft'
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
                              {agreement.status}
                            </span>
                            <span className="text-[10px] text-text-secondary">
                              v{agreement.version}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary mt-1">
                            /{agreement.slug} · {agreement._count?.signatures || 0} signatures
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setEditingAgreement({ ...agreement })}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#a78bfa] hover:bg-[#faf8fc]"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {agreement.status === 'draft' && (
                            <button
                              onClick={() => handlePublishAgreement(agreement.id)}
                              className="p-1.5 rounded-lg text-green-500 hover:text-green-700 hover:bg-green-50"
                              title="Publish"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {agreement.status === 'active' && (
                            <button
                              onClick={() => handleBumpVersion(agreement.id)}
                              className="p-1.5 rounded-lg text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                              title="Bump version (require re-sign)"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {agreement.status !== 'archived' && (
                            <button
                              onClick={() => handleArchiveAgreement(agreement.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
                              title="Archive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Create new agreement */}
                {!showNewAgreement && !editingAgreement && (
                  <button
                    onClick={() => setShowNewAgreement(true)}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[#c4b5fd] text-sm font-medium text-[#a78bfa] hover:bg-[#faf8fc] transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Create New Agreement
                  </button>
                )}

                {/* New Agreement Form */}
                {showNewAgreement && (
                  <div className="mt-4 p-4 rounded-xl border border-[#a78bfa] bg-[#faf8fc]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-text-primary text-sm">New Agreement</h3>
                      <button onClick={() => setShowNewAgreement(false)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Title</label>
                        <input
                          type="text"
                          value={newAgreement.title}
                          onChange={e => setNewAgreement(prev => ({ ...prev, title: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                          placeholder="e.g. Independent Contractor Agreement"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Slug</label>
                        <input
                          type="text"
                          value={newAgreement.slug}
                          onChange={e =>
                            setNewAgreement(prev => ({
                              ...prev,
                              slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                          placeholder="contractor-agreement"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">
                          Content <span className="text-text-muted">(Markdown supported)</span>
                        </label>
                        <textarea
                          value={newAgreement.content}
                          onChange={e => setNewAgreement(prev => ({ ...prev, content: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm resize-none h-64 font-mono focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                          placeholder="# Agreement Title&#10;&#10;Agreement content..."
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={newAgreement.status === 'active'}
                            onChange={e =>
                              setNewAgreement(prev => ({
                                ...prev,
                                status: e.target.checked ? 'active' : 'draft',
                              }))
                            }
                            className="rounded border-slate-300"
                          />
                          <span className="text-text-secondary">Publish immediately</span>
                        </label>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setShowNewAgreement(false)}
                          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary border border-[#e8e4f0] hover:border-[#c4b5fd]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateAgreement}
                          disabled={!newAgreement.title || !newAgreement.slug || !newAgreement.content}
                          className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--gradient-fig)' }}
                        >
                          Create Agreement
                        </button>
                      </div>
                    </div>

                    {/* Template suggestions */}
                    {!newAgreement.content && (
                      <div className="mt-3 pt-3 border-t border-[#e8e4f0]">
                        <p className="text-[10px] text-text-secondary mb-2">Start from a template:</p>
                        <div className="flex flex-wrap gap-1">
                          {AGREEMENT_TEMPLATES.map(tpl => (
                            <button
                              key={tpl.slug}
                              onClick={() => useTemplate(tpl)}
                              className="text-[10px] px-2 py-1 rounded text-[#a78bfa] bg-white border border-[#e8e4f0] hover:border-[#c4b5fd]"
                            >
                              {tpl.title}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Edit Agreement Form */}
                {editingAgreement && (
                  <div className="mt-4 p-4 rounded-xl border border-[#a78bfa] bg-[#faf8fc]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-text-primary text-sm">
                        Edit: {editingAgreement.title}
                      </h3>
                      <button onClick={() => setEditingAgreement(null)} className="text-slate-400 hover:text-slate-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">Title</label>
                        <input
                          type="text"
                          value={editingAgreement.title}
                          onChange={e =>
                            setEditingAgreement(prev => (prev ? { ...prev, title: e.target.value } : null))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-secondary mb-1 block">
                          Content <span className="text-text-muted">(Markdown)</span>
                        </label>
                        <textarea
                          value={editingAgreement.content}
                          onChange={e =>
                            setEditingAgreement(prev =>
                              prev ? { ...prev, content: e.target.value } : null
                            )
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm resize-none h-64 font-mono focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                        />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-text-secondary">
                        <span>Status: <strong>{editingAgreement.status}</strong></span>
                        <span>Version: <strong>{editingAgreement.version}</strong></span>
                        <span>Signatures: <strong>{editingAgreement._count?.signatures || 0}</strong></span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingAgreement(null)}
                          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary border border-[#e8e4f0] hover:border-[#c4b5fd]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleUpdateAgreement}
                          className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                          style={{ background: 'var(--gradient-fig)' }}
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ================================ */}
        {/* RIGHT COLUMN: Step Details */}
        {/* ================================ */}
        <div className="col-span-1">
          {selectedStep ? (
            <div className="bg-white rounded-xl border border-[#e8e4f0] p-5 sticky top-24">
              <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#a78bfa]" />
                Step Settings
              </h3>

              <div className="space-y-4">
                {/* Step Type */}
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">Step Type</label>
                  <div className="px-3 py-2 bg-slate-50 rounded-lg text-sm text-text-primary font-mono">
                    {selectedStep.stepType}
                  </div>
                </div>

                {/* Label */}
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">Label</label>
                  <input
                    type="text"
                    value={selectedStep.label}
                    onChange={async e => {
                      const newLabel = e.target.value;
                      setSteps(prev =>
                        prev.map(s => (s.id === selectedStep.id ? { ...s, label: newLabel } : s))
                      );
                    }}
                    onBlur={async () => {
                      const token = await getToken();
                      if (token) {
                        await updateOnboardingStep(selectedStep.id, { label: selectedStep.label }, token);
                        flash('Label updated');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">Description</label>
                  <textarea
                    value={selectedStep.description || ''}
                    onChange={async e => {
                      const newDesc = e.target.value;
                      setSteps(prev =>
                        prev.map(s =>
                          s.id === selectedStep.id ? { ...s, description: newDesc } : s
                        )
                      );
                    }}
                    onBlur={async () => {
                      const token = await getToken();
                      if (token) {
                        await updateOnboardingStep(
                          selectedStep.id,
                          { description: selectedStep.description || '' },
                          token
                        );
                        flash('Description updated');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                  />
                </div>

                {/* Enabled */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-text-primary block">Enabled</label>
                    <p className="text-[10px] text-text-secondary">Show this step in onboarding</p>
                  </div>
                  <button
                    onClick={() => handleToggleStep(selectedStep.id, 'enabled', !selectedStep.enabled)}
                    className={`relative w-10 h-5 rounded-full transition-all ${
                      selectedStep.enabled ? 'bg-[#a78bfa]' : 'bg-slate-200'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        selectedStep.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Required */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-text-primary block">Required</label>
                    <p className="text-[10px] text-text-secondary">Must complete to pass gate</p>
                  </div>
                  <button
                    onClick={() =>
                      handleToggleStep(selectedStep.id, 'required', !selectedStep.required)
                    }
                    className={`relative w-10 h-5 rounded-full transition-all ${
                      selectedStep.required ? 'bg-red-400' : 'bg-slate-200'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        selectedStep.required ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Gate Level */}
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-2">Gate Level</label>
                  <div className="space-y-1.5">
                    {GATE_LEVELS.map(gate => {
                      const Icon = gate.icon;
                      return (
                        <button
                          key={gate.value}
                          onClick={() => handleUpdateGateLevel(selectedStep.id, gate.value)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                            selectedStep.gateLevel === gate.value
                              ? `${gate.bg} ${gate.color} border border-current`
                              : 'border border-[#e8e4f0] text-text-secondary hover:border-[#c4b5fd]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {gate.label}
                          {selectedStep.gateLevel === gate.value && (
                            <Check className="w-3 h-3 ml-auto" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Delete (agreement steps only) */}
                {selectedStep.stepType === 'agreement' && (
                  <div className="pt-3 border-t border-[#f3f0f8]">
                    <button
                      onClick={() => handleDeleteStep(selectedStep.id)}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-red-500 border border-red-200 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove Step
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#e8e4f0] p-5 sticky top-24">
              <div className="text-center py-8">
                <Shield className="w-10 h-10 text-[#c4b5fd] mx-auto mb-3" />
                <h3 className="font-medium text-text-primary text-sm mb-1">Select a step</h3>
                <p className="text-xs text-text-secondary">
                  Click on any onboarding step to configure its settings, gate level, and requirements.
                </p>
              </div>

              {/* How it works */}
              <div className="mt-6 pt-6 border-t border-[#f3f0f8] space-y-3">
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">How Gates Work</h4>
                {GATE_LEVELS.map(gate => {
                  const Icon = gate.icon;
                  return (
                    <div key={gate.value} className="flex items-start gap-2">
                      <Icon className={`w-4 h-4 mt-0.5 ${gate.color} flex-shrink-0`} />
                      <div>
                        <span className={`text-xs font-medium ${gate.color}`}>{gate.label}</span>
                        <p className="text-[10px] text-text-secondary">{gate.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
