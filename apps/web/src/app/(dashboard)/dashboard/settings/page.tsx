'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Building2,
  FileText,
  Users,
  Shield,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Mic,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  getCompanyProfile,
  CompanyProfile,
} from '@/lib/marketplace-api';
import { getTemplates } from '@/lib/api';
import type { Template } from '@/lib/types';

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        if (!token) return;

        const [profileData, templatesData] = await Promise.all([
          getCompanyProfile(token).catch(() => null),
          getTemplates(token).catch(() => ({ data: [] })),
        ]);

        setProfile(profileData);
        setTemplates(templatesData?.data || []);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getToken]);

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

  const onboardingComplete = profile &&
    profile.verificationStatus === 'verified' &&
    profile.stripeCustomerId &&
    profile.contractStatus === 'signed';

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">
          Manage your company profile, screening interviews, and preferences.
        </p>
      </div>

      {/* Onboarding Status */}
      {!onboardingComplete && (
        <Link
          href="/dashboard/onboard"
          className="flex items-center gap-4 p-5 mb-8 rounded-xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
        >
          <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-amber-800">Complete Your Setup</h3>
            <p className="text-sm text-amber-700">
              Finish onboarding to start posting tasks — billing, contracts, and verification.
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-amber-600" />
        </Link>
      )}

      <div className="space-y-6">
        {/* Company Profile */}
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <div className="flex items-center gap-4">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Company Profile</h3>
                  <p className="text-sm text-text-secondary">Business info, legal name, address</p>
                </div>
              </div>
              <Link
                href="/dashboard/onboard"
                className="text-sm text-primary font-medium hover:text-primary-dark"
              >
                Edit
              </Link>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-secondary">Company</span>
                <p className="font-medium text-text-primary">{profile?.companyName || 'Not set'}</p>
              </div>
              <div>
                <span className="text-text-secondary">Verification</span>
                <p className="font-medium text-text-primary capitalize flex items-center gap-1">
                  {profile?.verificationStatus === 'verified' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                  {profile?.verificationStatus || 'Pending'}
                </p>
              </div>
              <div>
                <span className="text-text-secondary">Billing</span>
                <p className="font-medium text-text-primary">
                  {profile?.stripeCustomerId ? 'Connected' : 'Not configured'}
                </p>
              </div>
              <div>
                <span className="text-text-secondary">Contract</span>
                <p className="font-medium text-text-primary capitalize">
                  {profile?.contractStatus || 'Pending'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interview Template Library */}
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-6 border-b border-border-light">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-violet-50">
                  <Mic className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Interview Templates</h3>
                  <p className="text-sm text-text-secondary">
                    Manage reusable screening interviews — attach them to individual work units
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/templates"
                className="text-sm text-primary font-medium hover:text-primary-dark"
              >
                Manage →
              </Link>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-6 text-sm text-text-secondary">
                <span><strong className="text-text-primary">{templates.length}</strong> template{templates.length !== 1 ? 's' : ''}</span>
                <span className="text-border">·</span>
                <span>Attached per work unit in Work Units → Screening Interview</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Session History */}
        <Card>
          <CardContent className="p-0">
            <Link
              href="/dashboard/sessions"
              className="flex items-center justify-between p-6 hover:bg-white/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-50">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Interview Sessions</h3>
                  <p className="text-sm text-text-secondary">
                    View transcripts and results from screening interviews
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-text-secondary" />
            </Link>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardContent className="p-0">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-50">
                  <Shield className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">Security & Compliance</h3>
                  <p className="text-sm text-text-secondary">Data protection and platform policies</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-text-secondary">
                  <CheckCircle className="w-4 h-4 text-green-500" /> Escrow-protected payments
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <CheckCircle className="w-4 h-4 text-green-500" /> End-to-end encrypted data
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <CheckCircle className="w-4 h-4 text-green-500" /> Independent contractor compliance
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <CheckCircle className="w-4 h-4 text-green-500" /> Automated tax reporting (1099)
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
