'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  AlertCircle,
  Mic,
  Users,
  Zap,
  Loader2,
  XCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { getTaskDetail, acceptTask, TaskDetail } from '@/lib/marketplace-api';
import { track, EVENTS } from '@/lib/analytics';

/* ── helpers ── */

function fmt(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts: React.ReactNode[] = [];
  let remaining = text
    .replace(/^#{1,3}\s+(.+)$/gm, '**$1**')
    .replace(/^- /gm, '• ');
  let key = 0;
  while (remaining.length > 0) {
    const mdLink = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    const bold = remaining.match(/\*\*(.+?)\*\*/);
    const url = remaining.match(/(?<!\]\()(?<!\()(https?:\/\/[^\s<>)\]]+)/);
    const c: { idx: number; t: string; m: RegExpMatchArray }[] = [];
    if (mdLink) c.push({ idx: remaining.indexOf(mdLink[0]), t: 'md', m: mdLink });
    if (bold) c.push({ idx: remaining.indexOf(bold[0]), t: 'b', m: bold });
    if (url) {
      const ui = remaining.indexOf(url[0]);
      const inside = mdLink && ui >= remaining.indexOf(mdLink[0]) && ui < remaining.indexOf(mdLink[0]) + mdLink[0].length;
      if (!inside) c.push({ idx: ui, t: 'u', m: url });
    }
    c.sort((a, b) => a.idx - b.idx);
    const w = c[0];
    if (!w || w.idx === -1) { parts.push(remaining); break; }
    if (w.idx > 0) parts.push(remaining.slice(0, w.idx));
    if (w.t === 'md') parts.push(<a key={key++} href={w.m[2]} target="_blank" rel="noopener noreferrer" className="text-[#a2a3fc] hover:text-[#7b7cee] underline underline-offset-2">{w.m[1]}</a>);
    else if (w.t === 'b') parts.push(<span key={key++} className="font-semibold text-[#1f1f2e]">{w.m[1]}</span>);
    else { const cl = w.m[0].replace(/[.,;:!?)]+$/, ''); const tail = w.m[0].slice(cl.length); let lbl = cl; try { const u = new URL(cl); lbl = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch {} parts.push(<a key={key++} href={cl} target="_blank" rel="noopener noreferrer" className="text-[#a2a3fc] hover:text-[#7b7cee] underline underline-offset-2">{lbl}</a>); if (tail) parts.push(tail); }
    remaining = remaining.slice(w.idx + w.m[0].length);
  }
  return parts;
}

/** Parse markdown-ish spec into heading/body sections */
function parseSpec(spec: string): { heading: string; body: string }[] {
  if (!spec) return [];
  const sections: { heading: string; body: string }[] = [];
  const lines = spec.split('\n');
  let heading = ''; let body: string[] = [];
  for (const line of lines) {
    const hm = line.match(/^#{1,3}\s+(.+)$/);
    if (hm) { if (heading || body.length) sections.push({ heading, body: body.join('\n').trim() }); heading = hm[1]; body = []; }
    else body.push(line);
  }
  if (heading || body.length) sections.push({ heading, body: body.join('\n').trim() });
  return sections;
}

const TIER_LABEL: Record<string, string> = { novice: 'Novice+', pro: 'Pro+', elite: 'Elite' };

/* ── collapsible section ── */
function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#f0f0f5] last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left group"
      >
        <span className="text-sm font-semibold text-[#1f1f2e] group-hover:text-[#a2a3fc] transition-colors">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-[#a0a0b0]" /> : <ChevronDown className="w-4 h-4 text-[#a0a0b0]" />}
      </button>
      {open && <div className="pb-5">{children}</div>}
    </div>
  );
}

/* ── main page ── */
export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taskId = params.id as string;

  useEffect(() => { loadTask(); }, [taskId]);

  async function loadTask() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      setTask(await getTaskDetail(taskId, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    try {
      setAccepting(true);
      setError(null);
      const token = await getToken();
      if (!token) return;
      const result = await acceptTask(taskId, token);
      track(EVENTS.TASK_ACCEPTED, { workUnitId: taskId, requiresScreening: result.requiresScreening });
      router.push(`/student/executions/${result.id}/onboard`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept task');
    } finally {
      setAccepting(false);
    }
  }

  /* ── loading / empty ── */
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-[#f5f5f8] rounded w-28" />
          <div className="h-8 bg-[#f5f5f8] rounded w-3/4" />
          <div className="h-px bg-[#f0f0f5]" />
          <div className="h-40 bg-[#f5f5f8] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-10 h-10 text-[#e0e0e8] mx-auto mb-3" />
        <h2 className="text-base font-semibold text-[#1f1f2e] mb-1">Task not found</h2>
        <p className="text-sm text-[#6b6b80] mb-4">{error || 'This task may have been removed.'}</p>
        <Link href="/student/tasks" className="text-[#a2a3fc] hover:text-[#7b7cee] text-sm font-medium">← Back to Tasks</Link>
      </div>
    );
  }

  const elig = task.eligibility;
  const criteria = task.acceptanceCriteria || [];
  const formats = task.deliverableFormat || [];
  const milestones = task.milestoneTemplates || [];
  const specSections = parseSpec(task.spec);

  const stats = [
    { label: 'Deadline', value: `${task.deadlineHours}h` },
    { label: 'Complexity', value: `${task.complexityScore}/5` },
    { label: 'Revisions', value: `Up to ${task.revisionLimit ?? 2}` },
    task.matchScore != null ? { label: 'Match', value: `${Math.round(task.matchScore * 100)}%` } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      {/* Back */}
      <Link
        href="/student/tasks"
        className="inline-flex items-center gap-1.5 text-xs text-[#a0a0b0] hover:text-[#1f1f2e] mb-5 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to Tasks
      </Link>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-[#fafaff] border border-[#e8e8f0] rounded-lg px-4 py-3 mb-5 text-sm text-[#6b6b80]">
          <AlertCircle className="w-4 h-4 text-[#a2a3fc] flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-[#a0a0b0] hover:text-[#1f1f2e] text-lg leading-none">×</button>
        </div>
      )}

      {/* ─── Header ─── */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-xl sm:text-2xl font-bold text-[#1f1f2e] leading-tight">{task.title}</h1>
          <div className="text-right flex-shrink-0">
            <div className="text-2xl font-bold text-[#1f1f2e]">${(task.priceInCents / 100).toFixed(0)}</div>
            {task.estimatedPayout != null && (
              <div className="text-xs text-[#a2a3fc] font-medium">~${(task.estimatedPayout / 100).toFixed(0)} payout</div>
            )}
          </div>
        </div>

        {/* Tags line */}
        <div className="flex items-center gap-2 flex-wrap text-xs mb-4">
          {task.company && (
            <span className="text-[#6b6b80]">{task.company.companyName}</span>
          )}
          {task.company && <span className="text-[#e0e0e8]">·</span>}
          <span className="text-[#6b6b80]">{TIER_LABEL[task.minTier] || 'Novice+'}</span>
          {task.requiresScreening && (
            <>
              <span className="text-[#e0e0e8]">·</span>
              <span className="inline-flex items-center gap-1 text-[#a2a3fc]">
                <Mic className="w-3 h-3" /> Screening
              </span>
            </>
          )}
          {task.assignmentMode === 'manual' && (
            <>
              <span className="text-[#e0e0e8]">·</span>
              <span className="inline-flex items-center gap-1 text-[#6b6b80]">
                <Users className="w-3 h-3" /> Manual Review
              </span>
            </>
          )}
          </div>

        {/* Stats strip */}
        <div className="flex items-center gap-5 text-xs border-t border-b border-[#f0f0f5] py-3">
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-[#a0a0b0]">{s.label}</span>
              <span className="font-semibold text-[#1f1f2e]">{s.value}</span>
            </div>
          ))}
        </div>
          </div>

      {/* ─── Accept bar ─── */}
        {elig && elig.eligible && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6 p-4 bg-[#fafaff] rounded-xl border border-[#f0f0f5]">
            {task.requiresScreening && (
            <p className="text-xs text-[#6b6b80] flex-1 flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-[#a2a3fc] flex-shrink-0" />
              Screening interview required after accepting.
            </p>
            )}
            {task.assignmentMode === 'manual' && !task.requiresScreening && (
            <p className="text-xs text-[#6b6b80] flex-1 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-[#a0a0b0] flex-shrink-0" />
              The company will review your profile before assignment.
            </p>
          )}
          {!task.requiresScreening && task.assignmentMode !== 'manual' && <div className="flex-1" />}
            <button
              onClick={handleAccept}
              disabled={accepting}
            className="px-6 py-2.5 bg-[#a2a3fc] text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-[#8b8cf0] transition-colors whitespace-nowrap"
            >
            {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {task.assignmentMode === 'manual' ? 'Apply' : 'Accept Task'}
            </button>
          </div>
        )}

      {/* Ineligible notice */}
      {elig && !elig.eligible && (
        <div className="mb-6 p-4 bg-[#f5f5f8] rounded-xl text-xs text-[#6b6b80] space-y-1">
          <p className="font-medium text-[#1f1f2e] text-sm">You can't accept this task</p>
          {!elig.meetsComplexity && <p>• Task complexity exceeds your tier limit</p>}
          {!elig.meetsTier && <p>• Requires a higher tier</p>}
          {elig.alreadyAccepted && <p>• You already have an active execution</p>}
      </div>
      )}

      {/* ─── Body — all collapsible sections ─── */}
      <div className="bg-white rounded-xl border border-[#f0f0f5] px-6">

        {/* Task Description */}
        <Section title="Task Description" defaultOpen>
          {specSections.length > 0 ? (
            <div className="space-y-5">
              {specSections.map((s, i) => (
                <div key={i}>
                  {s.heading && (
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#a0a0b0] mb-2">{s.heading}</h3>
                  )}
                  {s.body && (
                    <div className="text-sm text-[#3a3a4a] leading-relaxed space-y-1.5">
                      {s.body.split('\n').map((ln, j) =>
                        !ln.trim() ? <div key={j} className="h-2" /> : <div key={j}>{fmt(ln)}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
      </div>
          ) : (
            <div className="text-sm text-[#3a3a4a] whitespace-pre-wrap leading-relaxed">{fmt(task.spec)}</div>
          )}
        </Section>

        {/* Required Skills */}
      {task.requiredSkills.length > 0 && (
          <Section title={`Required Skills (${task.requiredSkills.length})`} defaultOpen>
          <div className="flex flex-wrap gap-2">
            {task.requiredSkills.map(skill => {
                const match = elig?.skillMatch?.includes(skill);
              return (
                <span
                  key={skill}
                  className={cn(
                      'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium',
                      match ? 'bg-[#f0f0ff] text-[#a2a3fc]' : 'bg-[#f5f5f5] text-[#6b6b80]'
                  )}
                >
                    {match ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3 opacity-40" />}
                  {skill}
                </span>
              );
            })}
          </div>
          {elig && elig.missingSkills.length > 0 && (
              <p className="text-[11px] text-[#a0a0b0] mt-2">
                Missing {elig.missingSkills.length} skill{elig.missingSkills.length > 1 ? 's' : ''} — you can still accept but may score lower.
            </p>
          )}
          </Section>
      )}

        {/* Acceptance Criteria */}
        {criteria.length > 0 && (
          <Section title={`Acceptance Criteria (${criteria.length})`} defaultOpen={false}>
            <ol className="space-y-3">
              {criteria.map((ac, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-[#f5f5f8] flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-[#6b6b80]">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-[#3a3a4a] leading-relaxed">{ac.criterion}</p>
                    {ac.required && (
                      <span className="text-[10px] font-semibold text-[#a2a3fc] uppercase tracking-wide">Required</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Deliverable Format */}
        {formats.length > 0 && (
          <Section title="Deliverable Format" defaultOpen={false}>
            <ul className="space-y-2">
              {formats.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#3a3a4a]">
                  <CheckCircle className="w-3.5 h-3.5 text-[#a2a3fc] flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </Section>
        )}

      {/* Milestones */}
      {milestones.length > 0 && (
          <Section title={`Milestones (${milestones.length})`} defaultOpen={false}>
          <div className="space-y-3">
            {milestones.map((m, i) => (
                <div key={m.id} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-[#f0f0ff] flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-[#a2a3fc]">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm text-[#3a3a4a]">{m.description}</p>
                    <p className="text-[11px] text-[#a0a0b0]">At {Math.round(m.expectedCompletion * 100)}% completion</p>
                </div>
              </div>
            ))}
          </div>
          </Section>
      )}

      {/* Screening Info */}
      {task.requiresScreening && (
          <Section title="Screening Interview" defaultOpen={false}>
            <div className="text-sm text-[#6b6b80] space-y-2">
              <p>This task requires an AI-powered screening interview before you can start working.</p>
              <ul className="text-xs space-y-1 text-[#a0a0b0]">
                <li>• Questions relevant to the task requirements</li>
                <li>• Typically takes 5–15 minutes</li>
                <li>• Reviewed {task.assignmentMode === 'manual' ? 'by the company' : 'automatically'} before you can clock in</li>
              </ul>
          </div>
          </Section>
        )}
        </div>

      {/* Bottom spacer for mobile scroll */}
      <div className="h-6" />
    </div>
  );
}
