'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { ArrowRight, CheckCircle, FileText, ExternalLink, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface OnboardingData {
  welcome: string;
  instructions: string;
  checklist: string[];
  exampleWorkUrls: string[];
}

interface Contract {
  id: string;
  title: string;
  content: string;
  version: number;
}

export default function ExecutionOnboardPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const executionId = params.id as string;

  const [execution, setExecution] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [signedContracts, setSignedContracts] = useState<Set<string>>(new Set());
  const [checklistDone, setChecklistDone] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);
  const [viewingContract, setViewingContract] = useState<Contract | null>(null);

  useEffect(() => { loadData(); }, [executionId]);

  async function loadData() {
    try {
      const t = await getToken(); if (!t) return;

      // Load execution
      const execRes = await fetch(`${API_URL}/api/executions/${executionId}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!execRes.ok) { router.push(`/student/executions/${executionId}`); return; }
      const execData = await execRes.json();
      setExecution(execData);

      // Load onboarding data
      try {
        const onboardRes = await fetch(`${API_URL}/api/agent/onboarding/${execData.workUnitId}`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (onboardRes.ok) {
          const data = await onboardRes.json();
          setOnboarding(data);
        }
      } catch {}

      // Load active contracts
      try {
        const contractRes = await fetch(`${API_URL}/api/agent/contracts`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (contractRes.ok) {
          const data = await contractRes.json();
          setContracts((data.contracts || []).filter((c: any) => c.status === 'active'));
        }
      } catch {}

      // Check which contracts student already signed
      // For now, start with none signed
    } catch {
      router.push(`/student/executions/${executionId}`);
    } finally {
      setLoading(false);
    }
  }

  async function signContract(contract: Contract) {
    setSigning(contract.id);
    try {
      const t = await getToken(); if (!t) return;

      // Create signature record
      await fetch(`${API_URL}/api/onboarding-config/agreements/${contract.id}/sign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedName: 'Electronic Signature' }),
      });

      setSignedContracts(prev => { const n = new Set(Array.from(prev)); n.add(contract.id); return n; });
      setViewingContract(null);
    } catch {}
    setSigning(null);
  }

  function toggleChecklist(idx: number) {
    setChecklistDone(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const unsignedContracts = contracts.filter(c => !signedContracts.has(c.id));
  const allContractsSigned = unsignedContracts.length === 0;
  const allChecklistDone = !(onboarding?.checklist && onboarding.checklist.length > 0) || checklistDone.size >= (onboarding?.checklist?.length ?? 0);
  const canProceed = allContractsSigned;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-200 border-t-slate-900 mx-auto" />
      </div>
    );
  }

  // Contract viewing modal
  if (viewingContract) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={() => setViewingContract(null)} className="text-sm text-slate-400 hover:text-slate-700 mb-4">← back</button>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">{viewingContract.title}</h1>
        <p className="text-xs text-slate-400 mb-6">Version {viewingContract.version}</p>
        <div className="bg-slate-50 rounded-lg p-6 mb-6 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">
          {viewingContract.content}
        </div>
        <button
          onClick={() => signContract(viewingContract)}
          disabled={signing === viewingContract.id}
          className="px-6 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          {signing === viewingContract.id ? 'Signing...' : 'I agree — Sign electronically'}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">
        {execution?.workUnit?.title || 'Task Onboarding'}
      </h1>
      <p className="text-sm text-slate-500 mb-8">Complete the following before you start working.</p>

      <div className="space-y-6">
        {/* Welcome message */}
        {onboarding?.welcome && (
          <div className="bg-slate-50 rounded-lg p-5">
            <p className="text-sm text-slate-700">{onboarding.welcome}</p>
          </div>
        )}

        {/* Contracts to sign */}
        {contracts.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-3">Agreements to sign</h2>
            <div className="space-y-2">
              {contracts.map(contract => {
                const isSigned = signedContracts.has(contract.id);
                return (
                  <div key={contract.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-2">
                      {isSigned ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400" />
                      )}
                      <span className={`text-sm ${isSigned ? 'text-slate-400' : 'text-slate-700'}`}>{contract.title}</span>
                    </div>
                    {!isSigned && (
                      <button onClick={() => setViewingContract(contract)} className="text-xs text-slate-500 hover:text-slate-900">
                        review & sign
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Instructions */}
        {onboarding?.instructions && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">Instructions</h2>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{onboarding.instructions}</p>
          </div>
        )}

        {/* Deliverable format from work unit */}
        {execution?.workUnit?.deliverableFormat?.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">Deliverable format</h2>
            <div className="flex flex-wrap gap-2">
              {execution.workUnit.deliverableFormat.map((f: string, i: number) => (
                <span key={i} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">{f}</span>
              ))}
            </div>
          </div>
        )}

        {/* Checklist */}
        {onboarding?.checklist && onboarding.checklist.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">Checklist</h2>
            <div className="space-y-1.5">
              {onboarding!.checklist.map((item: string, i: number) => (
                <label key={i} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checklistDone.has(i)}
                    onChange={() => toggleChecklist(i)}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                  />
                  <span className={`text-sm ${checklistDone.has(i) ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Communication */}
        {(onboarding as any)?.communicationChannel && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">Communication</h2>
            <p className="text-sm text-slate-600">{(onboarding as any).communicationChannel}</p>
          </div>
        )}

        {/* Submission method */}
        {(onboarding as any)?.deliverableSubmissionMethod && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">How to submit</h2>
            <p className="text-sm text-slate-600">{(onboarding as any).deliverableSubmissionMethod}</p>
          </div>
        )}

        {/* Example work */}
        {onboarding?.exampleWorkUrls && onboarding.exampleWorkUrls.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-slate-900 mb-2">Example work & references</h2>
            <div className="space-y-1">
              {onboarding!.exampleWorkUrls.map((url: string, i: number) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {url.length > 60 ? url.slice(0, 60) + '...' : url}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Proceed button */}
        <div className="pt-4">
          {!canProceed && (
            <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" />
              Sign all agreements to continue
            </p>
          )}
          <button
            onClick={() => router.push(`/student/executions/${executionId}`)}
            disabled={!canProceed}
            className="w-full py-3 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Start Working <ArrowRight className="w-4 h-4" />
          </button>
          {contracts.length === 0 && (
            <button
              onClick={() => router.push(`/student/executions/${executionId}`)}
              className="w-full mt-2 py-2 text-slate-400 text-xs hover:text-slate-700"
            >
              skip onboarding
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
