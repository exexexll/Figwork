'use client';

import React from 'react';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { ArrowRight, CheckCircle, FileText, ExternalLink, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function fmt(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts: React.ReactNode[] = [];
  let remaining = text
    .replace(/^#{1,3}\s+(.+)$/gm, '**$1**')
    .replace(/^- /gm, '• ');
  let key = 0;

  while (remaining.length > 0) {
    const mdLinkMatch = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const urlMatch = remaining.match(/(?<!\]\()(?<!\()(https?:\/\/[^\s<>)\]]+)/);

    const candidates: { idx: number; type: string; match: RegExpMatchArray }[] = [];
    if (mdLinkMatch) candidates.push({ idx: remaining.indexOf(mdLinkMatch[0]), type: 'mdlink', match: mdLinkMatch });
    if (boldMatch) candidates.push({ idx: remaining.indexOf(boldMatch[0]), type: 'bold', match: boldMatch });
    if (urlMatch) {
      const uidx = remaining.indexOf(urlMatch[0]);
      const insideMd = mdLinkMatch && uidx >= remaining.indexOf(mdLinkMatch[0]) && uidx < remaining.indexOf(mdLinkMatch[0]) + mdLinkMatch[0].length;
      if (!insideMd) candidates.push({ idx: uidx, type: 'url', match: urlMatch });
    }

    candidates.sort((a, b) => a.idx - b.idx);
    const w = candidates[0];
    if (!w || w.idx === -1) { parts.push(remaining); break; }
    if (w.idx > 0) parts.push(remaining.slice(0, w.idx));

    if (w.type === 'mdlink') {
      parts.push(<a key={key++} href={w.match[2]} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-800 underline underline-offset-2">{w.match[1]}</a>);
    } else if (w.type === 'bold') {
      parts.push(<strong key={key++}>{w.match[1]}</strong>);
    } else {
      const clean = w.match[0].replace(/[.,;:!?)]+$/, '');
      const tail = w.match[0].slice(clean.length);
      let label = clean;
      try { const u = new URL(clean); label = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch {}
      parts.push(<a key={key++} href={clean} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-800 underline underline-offset-2">{label}</a>);
      if (tail) parts.push(tail);
    }

    remaining = remaining.slice(w.idx + w.match[0].length);
  }
  return parts;
}

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

      // Load active contracts — only those scoped to this work unit + unscoped ones
      try {
        const contractRes = await fetch(`${API_URL}/api/agent/contracts`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (contractRes.ok) {
          const data = await contractRes.json();
          const wuPrefix = `wu-${execData.workUnitId.slice(0, 8)}`;
          const filtered = (data.contracts || []).filter((c: any) =>
            c.status === 'active' && (c.slug?.startsWith(wuPrefix) || !c.slug?.startsWith('wu-'))
          );
          setContracts(filtered);
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
          {viewingContract.content.split('\n').map((line, i) => (
            <div key={i}>{line.trim() ? fmt(line) : <div className="h-3" />}</div>
          ))}
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
        {/* Visual onboarding blocks from the business panel */}
        {(onboarding as any)?.blocks?.length > 0 && (
          <div className="space-y-4">
            {(onboarding as any).blocks.map((block: any, i: number) => (
              <div key={block.id || i}>
                {block.type === 'hero' && (
                  <div className="text-center py-6">
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">{fmt(block.content?.heading || '')}</h2>
                    <p className="text-slate-500">{fmt(block.content?.subheading || '')}</p>
                  </div>
                )}
                {block.type === 'text' && (
                  <div className="bg-white rounded-xl p-5 border border-slate-100">
                    {block.content?.heading && <h3 className="text-lg font-semibold text-slate-900 mb-2">{fmt(block.content.heading)}</h3>}
                    <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{fmt(block.content?.body || '')}</p>
                  </div>
                )}
                {block.type === 'checklist' && (
                  <div className="bg-white rounded-xl p-5 border border-slate-100">
                    {block.content?.heading && <h3 className="text-lg font-semibold text-slate-900 mb-3">{fmt(block.content.heading)}</h3>}
                    <ul className="space-y-2">
                      {(block.content?.items || []).map((item: string, j: number) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-slate-600">
                          <CheckCircle className="w-4 h-4 text-violet-500 mt-0.5 flex-shrink-0" />
                          {fmt(item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {block.type === 'cta' && (
                  <div className="rounded-xl p-6 text-center bg-violet-50">
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">{fmt(block.content?.heading || '')}</h3>
                    <p className="text-sm text-slate-500">{fmt(block.content?.body || '')}</p>
                  </div>
                )}
                {block.type === 'image' && block.content?.url && (
                  <img src={block.content.url} alt={block.content.caption || ''} className="w-full rounded-xl" />
                )}
                {block.type === 'video' && block.content?.url && (
                  <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                    <a href={block.content.url} target="_blank" rel="noopener noreferrer" className="text-white text-sm">▶ {block.content.title || 'Watch Video'}</a>
                  </div>
                )}
                {block.type === 'file' && block.content?.url && (
                  <a href={block.content.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg text-sm text-slate-700 hover:bg-slate-100">
                    <FileText className="w-4 h-4" />
                    {block.content.filename || 'Download file'}
                  </a>
                )}
                {block.type === 'divider' && <hr className="border-slate-200" />}
              </div>
            ))}
          </div>
        )}

        {/* Legacy welcome message (if no blocks) */}
        {onboarding?.welcome && !(onboarding as any)?.blocks?.length && (
          <div className="bg-slate-50 rounded-lg p-5">
            <p className="text-sm text-slate-700">{fmt(onboarding.welcome)}</p>
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
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{fmt(onboarding.instructions)}</p>
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
            onClick={() => {
              localStorage.setItem(`onboarded_${executionId}`, 'true');
              router.push(`/student/executions/${executionId}`);
            }}
            disabled={!canProceed}
            className="w-full py-3 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            Start Working <ArrowRight className="w-4 h-4" />
          </button>
          {contracts.length === 0 && (
            <button
              onClick={() => {
                localStorage.setItem(`onboarded_${executionId}`, 'true');
                router.push(`/student/executions/${executionId}`);
              }}
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
