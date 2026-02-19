'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import {
  User,
  Phone,
  FileText,
  Shield,
  Receipt,
  CreditCard,
  Check,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Upload,
  X,
  Sparkles,
  Lock,
  ShieldCheck,
  ScrollText,
} from 'lucide-react';
import {
  getStudentProfile,
  registerStudent,
  updateStudentProfile,
  verifyStudentPhone,
  uploadStudentFile,
  getActiveOnboardingConfig,
  signAgreement,
  type OnboardingStepConfig,
} from '@/lib/marketplace-api';

const SKILL_OPTIONS = [
  'Writing', 'Design', 'Data Entry', 'Research', 'Social Media',
  'Web Development', 'Marketing', 'Video Editing', 'Translation',
  'Customer Support', 'Sales', 'Accounting', 'Photography', 'Tutoring',
];

// Icon map for dynamic step icons
const ICON_MAP: Record<string, any> = {
  User,
  Phone,
  FileText,
  Shield,
  Receipt,
  CreditCard,
  Lock,
  ShieldCheck,
  ScrollText,
};

interface OnboardingState {
  currentStep: number;
  profile: any;
  // Step: Basics
  name: string;
  skills: string[];
  customSkill: string;
  // Step: Phone
  phone: string;
  verificationCode: string;
  codeSent: boolean;
  // Step: Files
  files: File[];
  uploadedFiles: string[];
  // Step: Agreement
  agreementScrolled: boolean;
  signedName: string;
}

export default function StudentOnboardingPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();

  const [state, setState] = useState<OnboardingState>({
    currentStep: 0,
    profile: null,
    name: '',
    skills: [],
    customSkill: '',
    phone: '',
    verificationCode: '',
    codeSent: false,
    files: [],
    uploadedFiles: [],
    agreementScrolled: false,
    signedName: '',
  });

  // Dynamic steps from config
  const [configSteps, setConfigSteps] = useState<OnboardingStepConfig[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agreementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;

      // Load config + profile in parallel
      const [config, profile] = await Promise.all([
        getActiveOnboardingConfig(token).catch(() => null),
        getStudentProfile(token).catch(() => null),
      ]);

      // Set config steps (fallback to hardcoded if config not available)
      if (config?.steps && config.steps.length > 0) {
        setConfigSteps(config.steps);
      } else {
        // Fallback: hardcoded defaults
        setConfigSteps([
          { id: 'fallback-profile', stepType: 'profile', label: 'Profile', description: null, icon: 'User', required: true, gateLevel: 'browse', completed: false, needsResign: false },
          { id: 'fallback-phone', stepType: 'phone', label: 'Phone', description: null, icon: 'Phone', required: false, gateLevel: 'accept', completed: false, needsResign: false },
          { id: 'fallback-files', stepType: 'portfolio', label: 'Portfolio', description: null, icon: 'FileText', required: false, gateLevel: 'accept', completed: false, needsResign: false },
          { id: 'fallback-kyc', stepType: 'kyc', label: 'Identity', description: null, icon: 'Shield', required: true, gateLevel: 'accept', completed: false, needsResign: false },
          { id: 'fallback-tax', stepType: 'tax', label: 'Tax Info', description: null, icon: 'Receipt', required: true, gateLevel: 'payout', completed: false, needsResign: false },
          { id: 'fallback-payout', stepType: 'payout', label: 'Payout', description: null, icon: 'CreditCard', required: true, gateLevel: 'payout', completed: false, needsResign: false },
        ]);
      }
      setConfigLoaded(true);

      if (profile) {
        // Find the first uncompleted step to resume from
        let resumeStep = 0;
        if (config?.steps) {
          const firstIncomplete = config.steps.findIndex(s => !s.completed);
          if (firstIncomplete === -1) {
            // All done — redirect
            router.push('/student');
            return;
          }
          resumeStep = firstIncomplete;
        } else {
          // Fallback resume logic
          if (profile.name && profile.skillTags?.length > 0) resumeStep = 1;
          if (profile.phone) resumeStep = 2;
          if (resumeStep >= 2) resumeStep = 3;
          if (profile.kycStatus === 'verified') resumeStep = 4;
          if (profile.taxStatus === 'verified') resumeStep = 5;
          if (profile.stripeConnectStatus === 'active') {
            router.push('/student');
            return;
          }
        }

        setState(prev => ({
          ...prev,
          currentStep: resumeStep,
          profile,
          name: profile.name || '',
          skills: profile.skillTags || [],
          phone: profile.phone || '',
        }));
      } else {
        setState(prev => ({
          ...prev,
          name: user?.fullName || user?.firstName || '',
        }));
      }
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }

  // =============================
  // Step Handlers
  // =============================

  function toggleSkill(skill: string) {
    setState(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill],
    }));
  }

  function addCustomSkill() {
    if (state.customSkill.trim() && !state.skills.includes(state.customSkill.trim())) {
      setState(prev => ({
        ...prev,
        skills: [...prev.skills, prev.customSkill.trim()],
        customSkill: '',
      }));
    }
  }

  async function handleProfileSubmit() {
    if (!state.name.trim() || state.skills.length === 0) {
      setError('Please enter your name and select at least one skill');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      if (!state.profile) {
        await registerStudent(
          {
            email: user?.primaryEmailAddress?.emailAddress || '',
            name: state.name,
            phone: '',
            skillTags: state.skills,
          },
          token
        );
        localStorage.setItem('figwork_role', 'student');
      } else {
        await updateStudentProfile({ name: state.name, skillTags: state.skills }, token);
      }

      await loadData();
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to save profile');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSendCode() {
    if (!state.phone || state.phone.length < 10) {
      setError('Please enter a valid phone number');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      await updateStudentProfile({ phone: state.phone } as any, token);
      setState(prev => ({ ...prev, codeSent: true }));
    } catch (err: any) {
      setError(err.message || 'Failed to send code');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleVerifyCode() {
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      await verifyStudentPhone(state.verificationCode, token);
      goNext();
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFilesUpload() {
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      for (const file of state.files) {
        await uploadStudentFile(
          {
            filename: file.name,
            fileType: file.type,
            category: file.name.toLowerCase().includes('resume') ? 'resume' : 'portfolio',
          },
          token
        );
      }
      goNext();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSignAgreement() {
    if (state.signedName.trim().length < 2) {
      setError('Please type your full legal name to sign');
      return;
    }
    setActionLoading(true);
    setError(null);

    const currentStepConfig = configSteps[state.currentStep];
    if (!currentStepConfig?.agreement?.id) {
      setError('Agreement not found');
      setActionLoading(false);
      return;
    }

    try {
      const token = await getToken();
      if (!token) return;

      await signAgreement(currentStepConfig.agreement.id, state.signedName, token);
      setState(prev => ({ ...prev, signedName: '', agreementScrolled: false }));
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to sign agreement');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleKYCStart() {
    setActionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/students/kyc/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.open(data.url, '_blank');
      }
      goNext();
    } catch (err) {
      setError('Failed to start verification');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTaxStart() {
    setActionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/students/tax/form`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.open(data.url, '_blank');
      }
      goNext();
    } catch (err) {
      setError('Failed to start tax form');
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePayoutSetup() {
    setActionLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/students/connect/onboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.location.href = data.url;
          return;
        }
      }
      router.push('/student');
    } catch (err) {
      setError('Failed to start payout setup');
    } finally {
      setActionLoading(false);
    }
  }

  function goNext() {
    // If already on the last step, re-fetch to check completion & redirect
    if (state.currentStep >= configSteps.length - 1) {
      loadData();
      return;
    }
    setState(prev => ({
      ...prev,
      currentStep: Math.min(prev.currentStep + 1, configSteps.length - 1),
    }));
    setError(null);
  }

  function skipOptionalStep() {
    goNext();
  }

  // Handle agreement scroll detection
  function handleAgreementScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const scrolledToBottom =
      Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 20;
    if (scrolledToBottom && !state.agreementScrolled) {
      setState(prev => ({ ...prev, agreementScrolled: true }));
    }
  }

  // Simple markdown renderer for agreements
  function renderMarkdown(content: string): string {
    return content
      .replace(/^### (.*)/gm, '<h3 class="text-base font-semibold text-[#1f1f2e] mt-4 mb-2">$1</h3>')
      .replace(/^## (.*)/gm, '<h2 class="text-lg font-semibold text-[#1f1f2e] mt-6 mb-3">$1</h2>')
      .replace(/^# (.*)/gm, '<h1 class="text-xl font-bold text-[#1f1f2e] mt-6 mb-3">$1</h1>')
      .replace(/^\- (.*)/gm, '<li class="ml-4 text-[#6b6b80]">$1</li>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
  }

  // =============================
  // Render
  // =============================

  if (loading || !configLoaded) {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-light border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const currentStepConfig = configSteps[state.currentStep];
  const currentIcon = currentStepConfig
    ? ICON_MAP[currentStepConfig.icon || 'Shield'] || Shield
    : Shield;
  const StepIcon = currentIcon;

  return (
    <div className="min-h-screen bg-[#faf8fc]">
      {/* Ambient */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at top left, rgba(196,181,253,0.15) 0%, transparent 40%)',
        }}
      />

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <img src="/iconfigwork.png" alt="Figwork" className="h-8 w-8" />
          <span className="text-lg font-semibold text-[#1f1f2e]">figwork</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-10">
          {configSteps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-1 flex-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                  i < state.currentStep
                    ? 'bg-[#a78bfa]'
                    : i === state.currentStep
                    ? 'bg-[#c4b5fd]'
                    : 'bg-[#e8e4f0]'
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step Label */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-medium tracking-widest uppercase text-[#a78bfa]">
            Step {state.currentStep + 1} of {configSteps.length}
          </span>
          {currentStepConfig && !currentStepConfig.required && (
            <span className="text-xs text-[#a0a0b0]">&middot; Optional</span>
          )}
          {currentStepConfig?.completed && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check className="w-3 h-3" /> Complete
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================================ */}
        {/* DYNAMIC STEP CONTENT             */}
        {/* ================================ */}

        {/* PROFILE STEP */}
        {currentStepConfig?.stepType === 'profile' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Let&apos;s get you set up</h1>
            <p className="text-[#6b6b80] mb-8">
              Tell us about yourself so we can match you with the right tasks.
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">Full Name</label>
                <input
                  type="text"
                  value={state.name}
                  onChange={e => setState(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd] transition-all"
                  placeholder="Your full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                  Skills <span className="text-[#a0a0b0] font-normal">(select all that apply)</span>
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {SKILL_OPTIONS.map(skill => (
                    <button
                      key={skill}
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        state.skills.includes(skill)
                          ? 'bg-[#a78bfa] text-white shadow-sm'
                          : 'bg-white border border-[#e8e4f0] text-[#6b6b80] hover:border-[#c4b5fd]'
                      }`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={state.customSkill}
                    onChange={e => setState(prev => ({ ...prev, customSkill: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addCustomSkill()}
                    className="flex-1 px-3 py-2 rounded-lg border border-[#e8e4f0] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                    placeholder="Add a custom skill..."
                  />
                  <button
                    onClick={addCustomSkill}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-[#a78bfa] bg-[#f3f0f8] hover:bg-[#e8e4f0]"
                  >
                    Add
                  </button>
                </div>
              </div>

              <button
                onClick={handleProfileSubmit}
                disabled={actionLoading || !state.name.trim() || state.skills.length === 0}
                className="w-full py-3.5 rounded-xl text-white font-semibold transition-all duration-300 hover:shadow-glow hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:shadow-none disabled:hover:translate-y-0 flex items-center justify-center gap-2"
                style={{ background: 'var(--gradient-fig)' }}
              >
                {actionLoading ? 'Saving...' : 'Continue'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* PHONE STEP */}
        {currentStepConfig?.stepType === 'phone' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Add your phone number</h1>
            <p className="text-[#6b6b80] mb-8">
              {currentStepConfig.description ||
                'Phone is used for proof-of-work check-ins when working on tasks.'}
              {!currentStepConfig.required && (
                <span className="text-[#a78bfa]">
                  {' '}
                  You can add this later, but it&apos;s required before accepting your first task.
                </span>
              )}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={state.phone}
                  onChange={e => setState(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd]"
                  placeholder="+1 (555) 000-0000"
                />
              </div>

              {!state.codeSent ? (
                <div className="space-y-3">
                  <button
                    onClick={handleSendCode}
                    disabled={actionLoading || !state.phone}
                    className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'var(--gradient-fig)' }}
                  >
                    {actionLoading ? 'Sending...' : 'Verify Phone'}
                  </button>
                  {!currentStepConfig.required && (
                    <button
                      onClick={skipOptionalStep}
                      className="w-full py-3 rounded-xl text-[#6b6b80] font-medium border border-[#e8e4f0] hover:border-[#c4b5fd] hover:text-[#1f1f2e] transition-all"
                    >
                      Skip for now
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      value={state.verificationCode}
                      onChange={e =>
                        setState(prev => ({ ...prev, verificationCode: e.target.value }))
                      }
                      className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                      placeholder="000000"
                      maxLength={6}
                    />
                  </div>
                  <button
                    onClick={handleVerifyCode}
                    disabled={actionLoading || state.verificationCode.length < 6}
                    className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'var(--gradient-fig)' }}
                  >
                    {actionLoading ? 'Verifying...' : 'Verify & Continue'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* PORTFOLIO STEP */}
        {currentStepConfig?.stepType === 'portfolio' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Upload your work</h1>
            <p className="text-[#6b6b80] mb-8">
              {currentStepConfig.description ||
                'A resume or portfolio helps us match you to better-paying tasks.'}
              {!currentStepConfig.required && (
                <span className="text-[#a78bfa]"> You can skip this and add later.</span>
              )}
            </p>

            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-[#e8e4f0] rounded-xl p-8 text-center hover:border-[#c4b5fd] transition-colors cursor-pointer"
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <Upload className="w-8 h-8 text-[#a78bfa] mx-auto mb-3" />
                <p className="text-sm text-[#6b6b80]">
                  Drop files here or <span className="text-[#a78bfa] font-medium">browse</span>
                </p>
                <p className="text-xs text-[#a0a0b0] mt-1">
                  Resume, portfolio, certifications (PDF, DOC, images)
                </p>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    setState(prev => ({ ...prev, files: [...prev.files, ...files] }));
                  }}
                />
              </div>

              {state.files.length > 0 && (
                <div className="space-y-2">
                  {state.files.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-white rounded-lg border border-[#e8e4f0]"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#a78bfa]" />
                        <span className="text-sm text-[#1f1f2e]">{file.name}</span>
                        <span className="text-xs text-[#a0a0b0]">
                          ({(file.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setState(prev => ({
                            ...prev,
                            files: prev.files.filter((_, idx) => idx !== i),
                          }))
                        }
                      >
                        <X className="w-4 h-4 text-[#a0a0b0] hover:text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={state.files.length > 0 ? handleFilesUpload : skipOptionalStep}
                  disabled={actionLoading}
                  className="flex-1 py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'var(--gradient-fig)' }}
                >
                  {actionLoading
                    ? 'Uploading...'
                    : state.files.length > 0
                    ? 'Upload & Continue'
                    : 'Continue'}
                  <ArrowRight className="w-4 h-4" />
                </button>
                {state.files.length > 0 && (
                  <button
                    onClick={skipOptionalStep}
                    className="px-6 py-3.5 rounded-xl text-[#6b6b80] font-medium border border-[#e8e4f0] hover:border-[#c4b5fd]"
                  >
                    Skip
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================================ */}
        {/* AGREEMENT STEP (New — Dynamic)   */}
        {/* ================================ */}
        {currentStepConfig?.stepType === 'agreement' && currentStepConfig.agreement && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">
              {currentStepConfig.agreement.title}
            </h1>
            <p className="text-[#6b6b80] mb-6">
              {currentStepConfig.needsResign
                ? 'This agreement has been updated. Please review and re-sign below.'
                : 'Please read the following agreement carefully before signing.'}
            </p>

            {/* Agreement Content — scrollable */}
            <div
              ref={agreementRef}
              onScroll={handleAgreementScroll}
              className="bg-white rounded-xl border border-[#e8e4f0] p-6 mb-6 max-h-96 overflow-y-auto prose prose-sm"
              style={{ scrollBehavior: 'smooth' }}
            >
              <div
                className="text-sm text-[#4a4a5c] leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(currentStepConfig.agreement.content || ''),
                }}
              />
            </div>

            {/* Scroll indicator */}
            {!state.agreementScrolled && (
              <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <ArrowLeft className="w-3.5 h-3.5 rotate-[-90deg]" />
                Please scroll to the bottom to read the full agreement
              </div>
            )}

            {/* Signature */}
            <div className="space-y-4">
              <div className="p-5 bg-[#faf8fc] rounded-xl border border-[#e8e4f0]">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--gradient-fig-subtle)' }}
                  >
                    <ScrollText className="w-5 h-5 text-[#a78bfa]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1f1f2e] text-sm">Electronic Signature</h3>
                    <p className="text-xs text-[#6b6b80]">
                      Type your full legal name to sign this agreement
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  value={state.signedName}
                  onChange={e => setState(prev => ({ ...prev, signedName: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white text-lg italic focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd]"
                  placeholder="Your full legal name"
                  style={{ fontFamily: 'cursive, serif' }}
                />

                <div className="flex items-start gap-2 mt-3">
                  <Check className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-[#6b6b80]">
                    By signing, I acknowledge that I have read, understood, and agree to be bound by
                    the terms of this {currentStepConfig.agreement.title}.
                  </p>
                </div>
              </div>

              <button
                onClick={handleSignAgreement}
                disabled={
                  actionLoading ||
                  state.signedName.trim().length < 2 ||
                  !state.agreementScrolled
                }
                className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                style={{ background: 'var(--gradient-fig)' }}
              >
                {actionLoading ? 'Signing...' : 'Sign & Continue'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* KYC STEP */}
        {currentStepConfig?.stepType === 'kyc' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Verify your identity</h1>
            <p className="text-[#6b6b80] mb-8">
              {currentStepConfig.description ||
                'Quick identity check so companies know they\'re working with real people. Takes about 2 minutes.'}
            </p>

            <div className="p-6 bg-white rounded-xl border border-[#e8e4f0] mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <Shield className="w-6 h-6 text-[#a78bfa]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1f1f2e]">Identity Verification</h3>
                  <p className="text-sm text-[#6b6b80]">Powered by Stripe Identity</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-[#6b6b80] mb-4">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Photo of government-issued ID
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Quick selfie for face match
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Data encrypted end-to-end
                </li>
              </ul>
            </div>

            <button
              onClick={handleKYCStart}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-fig)' }}
            >
              {actionLoading ? 'Starting...' : 'Start Verification'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* TAX STEP */}
        {currentStepConfig?.stepType === 'tax' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Tax information</h1>
            <p className="text-[#6b6b80] mb-8">
              {currentStepConfig.description ||
                'Required for US tax reporting. Your W-9 info stays encrypted and is only used for 1099 generation.'}
            </p>

            <div className="p-6 bg-white rounded-xl border border-[#e8e4f0] mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <Receipt className="w-6 h-6 text-[#a78bfa]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1f1f2e]">W-9 Tax Form</h3>
                  <p className="text-sm text-[#6b6b80]">Secure collection via Stripe Tax</p>
                </div>
              </div>
              <p className="text-sm text-[#a0a0b0]">
                You&apos;ll receive a 1099-NEC if you earn over $600 in a calendar year.
              </p>
            </div>

            <button
              onClick={handleTaxStart}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-fig)' }}
            >
              {actionLoading ? 'Starting...' : 'Complete Tax Form'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* PAYOUT STEP */}
        {currentStepConfig?.stepType === 'payout' && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Set up payouts</h1>
            <p className="text-[#6b6b80] mb-8">
              {currentStepConfig.description ||
                'Last step! Connect your bank account so you can get paid for completed work.'}
            </p>

            <div className="p-6 bg-white rounded-xl border border-[#e8e4f0] mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <CreditCard className="w-6 h-6 text-[#a78bfa]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1f1f2e]">Stripe Connect</h3>
                  <p className="text-sm text-[#6b6b80]">Instant payouts to your bank</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-[#6b6b80]">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Direct deposit or debit card
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Instant payouts available at Pro
                  tier
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa]" /> Figwork never sees your banking
                  details
                </li>
              </ul>
            </div>

            <button
              onClick={handlePayoutSetup}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-fig)' }}
            >
              {actionLoading ? 'Setting up...' : 'Connect Bank Account'}
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Skip Setup — available after step 1 (profile created) */}
        {state.currentStep >= 1 && (
          <div className="mt-8 pt-6 border-t border-[#e8e4f0]">
            <button
              onClick={() => router.push('/student')}
              className="w-full py-3 rounded-xl text-[#6b6b80] font-medium border border-[#e8e4f0] hover:border-[#c4b5fd] hover:text-[#1f1f2e] transition-all text-sm"
            >
              Skip for now — Browse available tasks
            </button>
            <p className="text-center text-xs text-[#a0a0b0] mt-2">
              You can complete setup later from Profile & Files. Tasks require full setup to accept.
            </p>
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-xs text-[#a0a0b0] mt-6">
          Your data is encrypted and stored securely. We never share it without your consent.
        </p>
      </div>
    </div>
  );
}
