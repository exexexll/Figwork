'use client';

import { useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import {
  Building2,
  CreditCard,
  FileSignature,
  Check,
  ArrowRight,
  X,
  Globe,
  MapPin,
  Sparkles,
} from 'lucide-react';
import {
  registerCompany,
  getCompanyProfile,
  updateCompanyBilling,
  CompanyProfile,
} from '@/lib/marketplace-api';

const DEFAULT_STEPS = [
  { id: 'company', label: 'Business Info', icon: Building2, required: true },
  { id: 'billing', label: 'Billing', icon: CreditCard, required: true },
  { id: 'contract', label: 'Agreement', icon: FileSignature, required: true },
];

export default function CompanyOnboardingPage() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Company Info
  const [companyName, setCompanyName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [website, setWebsite] = useState('');
  const [ein, setEin] = useState('');
  const [address, setAddress] = useState({
    street: '', city: '', state: '', zip: '', country: 'US',
  });

  // Step 2: Billing
  const [billingMethod, setBillingMethod] = useState<'card' | 'ach'>('card');
  const [monthlyBudgetCap, setMonthlyBudgetCap] = useState('');

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    try {
      const token = await getToken();
      if (!token) return;
      const p = await getCompanyProfile(token).catch(() => null);
      if (p) {
        // Check if fully onboarded
        if (p.verificationStatus === 'verified' && p.contractStatus === 'signed' && p.stripeCustomerId) {
          router.push('/dashboard');
          return;
        }

        setProfile(p);
        setCompanyName(p.companyName || '');
        setLegalName(p.legalName || '');
        setWebsite(p.website || '');

        // Determine resume step
        let step = 0;
        if (p.companyName) step = 1;
        if (p.stripeCustomerId) step = 2;
        if (p.contractStatus === 'signed') { router.push('/dashboard'); return; }
        setCurrentStep(step);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCompanyInfoSubmit() {
    if (!companyName.trim()) {
      setError('Company name is required');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      if (!profile) {
        localStorage.setItem('figwork_role', 'company');
        await registerCompany({
          companyName,
          email: user?.primaryEmailAddress?.emailAddress || '',
          legalName: legalName || undefined,
          ein: ein || undefined,
          address: address.street ? address : undefined,
          website: website || undefined,
        }, token);
      } else {
        // Update
        const { updateCompanyProfile } = await import('@/lib/marketplace-api');
        await updateCompanyProfile({
          companyName,
          legalName: legalName || undefined,
          website: website || undefined,
        }, token);
      }

      await loadProfile();
      setCurrentStep(1);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleBillingSubmit() {
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      await updateCompanyBilling({
        billingMethod,
        monthlyBudgetCap: monthlyBudgetCap ? parseInt(monthlyBudgetCap) * 100 : undefined,
      }, token);

      // Start Stripe setup
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/companies/billing/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMethod }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, '_blank');
        }
      }

      setCurrentStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to save billing');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleContractSubmit() {
    setActionLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/companies/contract/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          window.open(data.url, '_blank');
        }
      }

      // After contract is signed (via DocuSign webhook or polling)
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Failed to generate contract');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#faf8fc] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-light border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8fc]">
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at top right, rgba(196,181,253,0.12) 0%, transparent 40%)',
      }} />

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <img src="/iconfigwork.png" alt="Figwork" className="h-8 w-8" />
          <span className="text-lg font-semibold text-[#1f1f2e]">figwork</span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#1f1f2e] text-white ml-1">Business</span>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1 mb-10">
          {DEFAULT_STEPS.map((step, i) => (
            <div key={step.id} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
              i < currentStep ? 'bg-[#a78bfa]' :
              i === currentStep ? 'bg-[#c4b5fd]' :
              'bg-[#e8e4f0]'
            }`} />
          ))}
        </div>

        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-medium tracking-widest uppercase text-[#a78bfa]">
            Step {currentStep + 1} of {DEFAULT_STEPS.length}
          </span>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
            {error}
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Step 1: Company Info */}
        {currentStep === 0 && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Tell us about your business</h1>
            <p className="text-[#6b6b80] mb-8">We use this to set up your account and generate contracts.</p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">Company Name *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 focus:border-[#c4b5fd]"
                  placeholder="Acme Inc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                  Legal Name <span className="text-[#a0a0b0] font-normal">(if different)</span>
                </label>
                <input
                  type="text"
                  value={legalName}
                  onChange={e => setLegalName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                  placeholder="Acme Incorporated"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                    <Globe className="w-3.5 h-3.5 inline mr-1" />Website
                  </label>
                  <input
                    type="url"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#1f1f2e] mb-2">EIN (optional)</label>
                  <input
                    type="text"
                    value={ein}
                    onChange={e => setEin(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                    placeholder="XX-XXXXXXX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                  <MapPin className="w-3.5 h-3.5 inline mr-1" />Business Address (optional)
                </label>
                <input
                  type="text"
                  value={address.street}
                  onChange={e => setAddress(prev => ({ ...prev, street: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 mb-3"
                  placeholder="Street address"
                />
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={address.city}
                    onChange={e => setAddress(prev => ({ ...prev, city: e.target.value }))}
                    className="px-3 py-2.5 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                    placeholder="City"
                  />
                  <input
                    type="text"
                    value={address.state}
                    onChange={e => setAddress(prev => ({ ...prev, state: e.target.value }))}
                    className="px-3 py-2.5 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                    placeholder="State"
                  />
                  <input
                    type="text"
                    value={address.zip}
                    onChange={e => setAddress(prev => ({ ...prev, zip: e.target.value }))}
                    className="px-3 py-2.5 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40 text-sm"
                    placeholder="ZIP"
                  />
                </div>
              </div>

              <button
                onClick={handleCompanyInfoSubmit}
                disabled={actionLoading || !companyName.trim()}
                className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--gradient-fig)' }}
              >
                {actionLoading ? 'Saving...' : 'Continue'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Billing */}
        {currentStep === 1 && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Set up billing</h1>
            <p className="text-[#6b6b80] mb-8">
              Choose how you'd like to pay. Funds are held in escrow and only released when you approve work.
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-3">Payment Method</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'card' as const, label: 'Credit Card', sub: 'Visa, Mastercard, Amex' },
                    { id: 'ach' as const, label: 'Bank Transfer', sub: 'ACH direct debit' },
                  ].map(method => (
                    <button
                      key={method.id}
                      onClick={() => setBillingMethod(method.id)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        billingMethod === method.id
                          ? 'border-[#a78bfa] bg-[#f3f0f8]'
                          : 'border-[#e8e4f0] bg-white hover:border-[#c4b5fd]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          billingMethod === method.id ? 'border-[#a78bfa]' : 'border-[#e8e4f0]'
                        }`}>
                          {billingMethod === method.id && <div className="w-2 h-2 rounded-full bg-[#a78bfa]" />}
                        </div>
                        <span className="font-medium text-[#1f1f2e] text-sm">{method.label}</span>
                      </div>
                      <p className="text-xs text-[#a0a0b0] ml-6">{method.sub}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#1f1f2e] mb-2">
                  Monthly Budget Cap <span className="text-[#a0a0b0] font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#a0a0b0]">$</span>
                  <input
                    type="number"
                    value={monthlyBudgetCap}
                    onChange={e => setMonthlyBudgetCap(e.target.value)}
                    className="w-full pl-8 pr-4 py-3 rounded-xl border border-[#e8e4f0] bg-white focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
                    placeholder="No limit"
                  />
                </div>
                <p className="text-xs text-[#a0a0b0] mt-1">We'll alert you when spending approaches this amount.</p>
              </div>

              <div className="p-4 bg-[#f3f0f8] rounded-xl">
                <h4 className="font-medium text-[#1f1f2e] text-sm mb-2">How pricing works</h4>
                <ul className="space-y-1.5 text-xs text-[#6b6b80]">
                  <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-[#a78bfa] mt-0.5 flex-shrink-0" /> You set the price for each task — that's what you pay</li>
                  <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-[#a78bfa] mt-0.5 flex-shrink-0" /> Figwork takes a 15% platform fee (included in task price)</li>
                  <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-[#a78bfa] mt-0.5 flex-shrink-0" /> Funds held in escrow until you approve delivery</li>
                  <li className="flex items-start gap-2"><Check className="w-3.5 h-3.5 text-[#a78bfa] mt-0.5 flex-shrink-0" /> Full refund if work doesn't meet criteria</li>
                </ul>
              </div>

              <button
                onClick={handleBillingSubmit}
                disabled={actionLoading}
                className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: 'var(--gradient-fig)' }}
              >
                {actionLoading ? 'Setting up...' : 'Set Up Payment'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Contract */}
        {currentStep === 2 && (
          <div>
            <h1 className="text-3xl font-bold text-[#1f1f2e] mb-2">Service agreement</h1>
            <p className="text-[#6b6b80] mb-8">
              Review and sign the Figwork service agreement. This covers task terms, payment handling, and IP ownership.
            </p>

            <div className="p-6 bg-white rounded-xl border border-[#e8e4f0] mb-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'var(--gradient-fig-subtle)' }}>
                  <FileSignature className="w-6 h-6 text-[#a78bfa]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#1f1f2e]">Master Service Agreement</h3>
                  <p className="text-sm text-[#6b6b80]">Electronic signature via DocuSign</p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-[#6b6b80]">
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                  <span>All intellectual property from completed tasks transfers to you</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                  <span>Contractors are independent — no employment liability</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                  <span>Dispute resolution process with 72-hour SLA</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#a78bfa] mt-0.5 flex-shrink-0" />
                  <span>Cancel anytime — no long-term commitment</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleContractSubmit}
              disabled={actionLoading}
              className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'var(--gradient-fig)' }}
            >
              {actionLoading ? 'Generating...' : 'Review & Sign Agreement'}
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        )}

        <p className="text-center text-xs text-[#a0a0b0] mt-8">
          Your data is encrypted and stored securely. We comply with SOC 2 and GDPR.
        </p>
      </div>
    </div>
  );
}
