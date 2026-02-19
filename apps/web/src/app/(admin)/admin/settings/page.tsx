'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Settings, RefreshCw, AlertTriangle, CheckCircle, Shield, Server, FileText, ChevronRight } from 'lucide-react';

export default function AdminSettingsPage() {
  const { getToken } = useAuth();
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<{ job: string; success: boolean; message: string } | null>(null);

  async function runManualJob(job: string) {
    setRunningJob(job);
    setJobResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/${job}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setJobResult({
        job,
        success: res.ok,
        message: data.message || (res.ok ? 'Job completed successfully' : 'Job failed'),
      });
    } catch (error) {
      setJobResult({
        job,
        success: false,
        message: 'Failed to execute job',
      });
    } finally {
      setRunningJob(null);
    }
  }

  const jobs = [
    {
      id: 'run-early-warnings',
      name: 'Early Warnings Check',
      description: 'Check all active executions for deadline, inactivity, and POW issues',
      icon: AlertTriangle,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      id: 'run-coaching',
      name: 'Coaching Analysis',
      description: 'Analyze student performance patterns and generate coaching recommendations',
      icon: RefreshCw,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      id: 'trigger-defect-analysis',
      name: 'Defect Analysis',
      description: 'Run defect analysis on recent failed or revised executions',
      icon: Settings,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      id: 'generate-weekly-reports',
      name: 'Weekly Reports',
      description: 'Generate and send weekly quality reports to all companies',
      icon: Server,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      id: 'cleanup-expired',
      name: 'Cleanup Expired Data',
      description: 'Clean up expired sessions, orphaned files, and stale data',
      icon: Shield,
      color: 'text-violet-600',
      bgColor: 'bg-violet-50',
    },
  ];

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Admin Settings</h1>
        <p className="text-text-secondary mt-1">System configuration and manual job triggers</p>
      </div>

      {/* Job Result Banner */}
      {jobResult && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            jobResult.success ? 'bg-green-50' : 'bg-red-50'
          }`}
        >
          {jobResult.success ? (
            <CheckCircle className="w-5 h-5 text-green-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-red-600" />
          )}
          <div>
            <p className={`font-medium ${jobResult.success ? 'text-green-800' : 'text-red-800'}`}>
              {jobResult.job.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </p>
            <p className={`text-sm ${jobResult.success ? 'text-green-700' : 'text-red-700'}`}>
              {jobResult.message}
            </p>
          </div>
          <button
            onClick={() => setJobResult(null)}
            className="ml-auto text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Configuration Links */}
      <div className="card mb-8">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Configuration</h2>
          <div className="space-y-3">
            <Link
              href="/admin/legal-onboarding"
              className="flex items-center justify-between p-4 border border-border-light rounded-lg hover:border-primary-light transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-violet-50">
                  <FileText className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-medium text-text-primary">Legal Onboarding</h3>
                  <p className="text-sm text-text-secondary">
                    Configure onboarding steps, legal agreements, and gate levels for workers
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-primary transition-colors" />
            </Link>
          </div>
        </div>
      </div>

      {/* Manual Jobs */}
      <div className="card mb-8">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Manual Job Triggers</h2>
          <p className="text-sm text-text-secondary mb-6">
            These jobs typically run automatically on schedules but can be triggered manually when
            needed.
          </p>

          <div className="space-y-4">
            {jobs.map(job => {
              const Icon = job.icon;
              const isRunning = runningJob === job.id;

              return (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-4 border border-border-light rounded-lg hover:border-primary-light transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-lg flex items-center justify-center ${job.bgColor}`}
                    >
                      <Icon className={`w-5 h-5 ${job.color}`} />
                    </div>
                    <div>
                      <h3 className="font-medium text-text-primary">{job.name}</h3>
                      <p className="text-sm text-text-secondary">{job.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => runManualJob(job.id)}
                    disabled={isRunning || runningJob !== null}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-border-light hover:border-primary-light hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isRunning ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Running...
                      </span>
                    ) : (
                      'Run Now'
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="card">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">System Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">
                API URL
              </p>
              <p className="font-mono text-sm text-text-primary">
                {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
              </p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-1">
                Environment
              </p>
              <p className="font-mono text-sm text-text-primary">
                {process.env.NODE_ENV || 'development'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
