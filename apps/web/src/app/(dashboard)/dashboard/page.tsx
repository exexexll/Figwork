'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Send, Plus, ChevronDown, X, GripVertical, Check, Paperclip, FileText } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  toolName?: string;
  toolResult?: string;
}

interface Conversation {
  id: string;
  title: string | null;
  updatedAt: string;
}

function timeAgo(d: string): string {
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60000) return 'now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConvList, setShowConvList] = useState(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(420);
  const [panelTab, setPanelTab] = useState<'overview' | 'execution' | 'financial' | 'legal'>('overview');
  const [sideData, setSideData] = useState<any>(null);
  const [selectedWU, setSelectedWU] = useState<any>(null);
  const [interviewDetail, setInterviewDetail] = useState<any>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [onboardWelcome, setOnboardWelcome] = useState('');
  const [onboardInstructions, setOnboardInstructions] = useState('');
  const [onboardChecklist, setOnboardChecklist] = useState('');
  const [onboardExamples, setOnboardExamples] = useState('');
  const [contracts, setContracts] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizing = useRef(false);

  useEffect(() => { loadConversations(); loadPanel(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Data loading ──

  async function loadConversations() {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/agent/conversations`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) { const d = await r.json(); setConversations(d.conversations || []); }
    } catch {}
  }

  async function loadConversation(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/agent/conversations/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) {
        const d = await r.json();
        setConversationId(d.id);
        setMessages((d.messages || []).map((m: any) => ({
          id: m.id, role: m.role, content: m.content,
          toolName: m.toolCalls?.[0]?.function?.name,
          toolResult: m.toolResults?.content,
        })));
      }
    } catch {}
    setShowConvList(false);
  }

  async function loadPanel() {
    try {
      const t = await getToken(); if (!t) return;
      const [wuRes, billingRes, tplRes] = await Promise.all([
        fetch(`${API_URL}/api/workunits`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/payments/company/balance`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/templates`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
      ]);
      setSideData({
        workUnits: Array.isArray(wuRes) ? wuRes : [],
        billing: billingRes,
        templates: (tplRes?.data || []).map((t: any) => ({ id: t.id, name: t.name })),
      });
    } catch {}
  }

  async function selectWU(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/workunits/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) {
        const d = await r.json();
        setSelectedWU(d);
        setPanelTab('overview');
        setPendingChanges({});
        if (d.infoCollectionTemplateId) loadInterview(d.infoCollectionTemplateId);
        else setInterviewDetail(null);
        loadOnboarding(d.id);
        loadContracts();
      }
    } catch {}
  }

  async function loadInterview(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/templates/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) { const d = await r.json(); setInterviewDetail(d.data || d); }
    } catch {}
  }

  // ── Panel actions ──

  function stageChange(field: string, value: any) {
    setPendingChanges(prev => ({ ...prev, [field]: value }));
  }

  async function confirmChanges() {
    if (!selectedWU || Object.keys(pendingChanges).length === 0) return;
    setSaving(true);
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/workunits/${selectedWU.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingChanges),
      });
      setPendingChanges({});
      await selectWU(selectedWU.id);
    } catch {}
    setSaving(false);
  }

  async function reviewExec(execId: string, verdict: string) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/executions/${execId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (selectedWU) selectWU(selectedWU.id);
    } catch {}
  }

  async function approveApp(execId: string) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/executions/${execId}/approve-application`, {
        method: 'POST', headers: { Authorization: `Bearer ${t}` },
      });
      if (selectedWU) selectWU(selectedWU.id);
    } catch {}
  }

  async function fundAndPublish() {
    if (!selectedWU) return;
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/workunits/${selectedWU.id}/fund-escrow`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      await fetch(`${API_URL}/api/workunits/${selectedWU.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      await selectWU(selectedWU.id);
      loadPanel();
    } catch {}
  }

  async function generateLink() {
    if (!interviewDetail) return;
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/templates/${interviewDetail.id}/links`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkType: 'permanent' }),
      });
      loadInterview(interviewDetail.id);
    } catch {}
  }

  async function saveOnboarding() {
    if (!selectedWU) return;
    try {
      const t = await getToken(); if (!t) return;
      // Save onboarding data as part of the work unit's address/metadata
      // Using the company profile's address field to store onboarding config
      const res = await fetch(`${API_URL}/api/companies/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const profile = await res.json();
        const existing = (typeof profile.address === 'object' && profile.address) || {};
        const onboardingPages = existing.onboardingPages || {};
        onboardingPages[selectedWU.id] = {
          welcome: onboardWelcome,
          instructions: onboardInstructions,
          checklist: onboardChecklist.split('\n').filter(Boolean),
          exampleWorkUrls: onboardExamples.split('\n').filter(Boolean),
        };
        await fetch(`${API_URL}/api/companies/me`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: { ...existing, onboardingPages } }),
        });
      }
    } catch {}
  }

  // Load onboarding when selecting a work unit
  async function loadOnboarding(wuId: string) {
    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/companies/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const profile = await res.json();
        const pages = (profile.address as any)?.onboardingPages || {};
        const page = pages[wuId] || {};
        setOnboardWelcome(page.welcome || '');
        setOnboardInstructions(page.instructions || '');
        setOnboardChecklist((page.checklist || []).join('\n'));
        setOnboardExamples((page.exampleWorkUrls || []).join('\n'));
      }
    } catch {
      setOnboardWelcome('');
      setOnboardInstructions('');
      setOnboardChecklist('');
      setOnboardExamples('');
    }
  }

  async function loadContracts() {
    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/agent/contracts`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setContracts(data.contracts || []);
      }
    } catch {}
  }

  // ── Chat ──

  function startNew() { setConversationId(null); setMessages([]); setShowConvList(false); inputRef.current?.focus(); }

  async function deleteConv(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/agent/conversations/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
      if (conversationId === id) startNew();
      loadConversations();
    } catch {}
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    // Read attached files — upload to backend for processing
    let fullMessage = text;
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        try {
          const isText = file.type.startsWith('text/') ||
            file.name.endsWith('.txt') || file.name.endsWith('.csv') ||
            file.name.endsWith('.md') || file.name.endsWith('.json');

          if (isText) {
            const content = await file.text();
            fullMessage += `\n\n--- FILE: ${file.name} ---\n${content.slice(0, 12000)}${content.length > 12000 ? '\n...(truncated)' : ''}\n--- END FILE ---`;
          } else {
            // For PDF/DOCX/images — send as base64 to backend for extraction
            const t = await getToken();
            if (t) {
              const formData = new FormData();
              formData.append('file', file);
              const extractRes = await fetch(`${API_URL}/api/agent/extract-file`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${t}` },
                body: formData,
              }).catch(() => null);

              if (extractRes?.ok) {
                const extracted = await extractRes.json();
                fullMessage += `\n\n--- FILE: ${file.name} ---\n${extracted.text?.slice(0, 12000) || '[Could not extract text]'}${(extracted.text?.length || 0) > 12000 ? '\n...(truncated)' : ''}\n--- END FILE ---`;
              } else {
                fullMessage += `\n\n[Attached: ${file.name}, ${(file.size / 1024).toFixed(0)}KB — could not extract text]`;
              }
            }
          }
        } catch {
          fullMessage += `\n\n[Attached: ${file.name}]`;
        }
      }
    }

    const displayMsg = attachedFiles.length > 0
      ? `${text}\n${attachedFiles.map(f => `📎 ${f.name}`).join('\n')}`
      : text;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: displayMsg };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachedFiles([]);
    setStreaming(true);
    const aId = `a-${Date.now()}`;
    setMessages(prev => [...prev, { id: aId, role: 'assistant', content: '' }]);

    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: fullMessage }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') {
              setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: (m.content || '') + ev.content } : m));
            } else if (ev.type === 'tool' && ev.status === 'done' && ev.result) {
              setMessages(prev => [...prev, { id: `t-${Date.now()}-${Math.random()}`, role: 'tool', content: null, toolName: ev.name, toolResult: ev.result }]);
            } else if (ev.type === 'done') {
              if (ev.conversationId) setConversationId(ev.conversationId);
              loadConversations();
              loadPanel();
              if (selectedWU) selectWU(selectedWU.id);
            } else if (ev.type === 'error') {
              setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: ev.message || 'Error occurred.' } : m));
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: 'Connection lost.' } : m));
    } finally { setStreaming(false); }
  }

  // ── Resize handler ──
  function onMouseDown() {
    resizing.current = true;
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(320, Math.min(700, w)));
    };
    const onUp = () => { resizing.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const getVal = (field: string, fallback: any) => pendingChanges[field] !== undefined ? pendingChanges[field] : fallback;
  const hasChanges = Object.keys(pendingChanges).length > 0;

  return (
    <div className="flex h-[calc(100vh-48px)]">
      {/* ── Chat (left) ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Conv switcher */}
        <div className="h-9 flex items-center justify-between px-4 border-b border-slate-200/30 flex-shrink-0 relative">
          <button onClick={() => setShowConvList(!showConvList)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700">
            {conversationId ? (conversations.find(c => c.id === conversationId)?.title?.slice(0, 40) || 'Chat') : 'New chat'}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showConvList && (
            <div className="absolute top-8 left-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 max-h-72 overflow-y-auto">
              <button onClick={startNew} className="w-full text-left px-3 py-1.5 text-[11px] text-slate-400 hover:bg-slate-50 flex items-center gap-1.5">
                <Plus className="w-3 h-3" /> New
              </button>
              {conversations.map(c => (
                <div key={c.id} className="flex items-center group">
                  <button onClick={() => loadConversation(c.id)} className={`flex-1 text-left px-3 py-1.5 text-[11px] truncate hover:bg-slate-50 ${c.id === conversationId ? 'text-slate-900' : 'text-slate-500'}`}>
                    {c.title?.slice(0, 35) || 'Untitled'} <span className="text-slate-300 ml-1">{timeAgo(c.updatedAt)}</span>
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteConv(c.id); }} className="px-1.5 text-slate-200 hover:text-slate-500 opacity-0 group-hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!panelOpen && (
            <button onClick={() => { setPanelOpen(true); loadPanel(); }} className="text-[11px] text-slate-400 hover:text-slate-700">panel</button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md space-y-4">
                <p className="text-slate-400 text-sm text-center">What do you need done?</p>
                {['Create a task for content writing, $30, 24h deadline',
                  'Show my active tasks',
                  'How much have I spent this month?',
                  'Set up a screening interview',
                  'Review pending submissions',
                ].map((s, i) => (
                  <button key={i} onClick={() => setInput(s)} className="block w-full text-left px-3 py-2 text-sm text-slate-500 hover:text-slate-800 hover:bg-white rounded-lg transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map(msg => {
                if (msg.role === 'user') return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-white rounded-xl rounded-br-sm px-3.5 py-2.5 max-w-[70%] shadow-sm">
                      <p className="text-sm text-slate-900 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                );
                if (msg.role === 'tool') return (
                  <p key={msg.id} className="text-xs text-slate-500 whitespace-pre-wrap pl-0.5">{msg.toolResult}</p>
                );
                return (
                  <div key={msg.id} className="pl-0.5">
                    <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                      {streaming && messages[messages.length - 1]?.id === msg.id && <span className="inline-block w-1 h-3.5 bg-slate-300 ml-0.5 animate-pulse" />}
                    </p>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-6 py-3 border-t border-slate-200/40 flex-shrink-0">
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 rounded text-[10px] text-slate-500">
                  <FileText className="w-2.5 h-2.5" />
                  {f.name.slice(0, 20)}{f.name.length > 20 ? '...' : ''}
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-slate-500 ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <button
              onClick={() => document.getElementById('chat-file-input')?.click()}
              className="p-1.5 text-slate-300 hover:text-slate-500 flex-shrink-0"
              title="Attach file"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <input
              id="chat-file-input"
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                setAttachedFiles(prev => [...prev, ...files]);
                e.target.value = '';
              }}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              className="flex-1 resize-none text-sm text-slate-900 placeholder:text-slate-300 border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 bg-transparent py-1.5 outline-none"
              placeholder="What do you need done?"
              disabled={streaming}
            />
            <button onClick={send} disabled={streaming || !input.trim()} className="p-1.5 text-slate-300 hover:text-slate-700 disabled:text-slate-200 flex-shrink-0">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Resize handle ── */}
      {panelOpen && (
        <div onMouseDown={onMouseDown} className="w-1 cursor-col-resize bg-transparent hover:bg-slate-200 transition-colors flex-shrink-0" />
      )}

      {/* ── Panel (right) ── */}
      {panelOpen && (
        <div style={{ width: panelWidth }} className="border-l border-slate-200/40 bg-white/60 flex flex-col flex-shrink-0 overflow-hidden">
          <div className="h-9 flex items-center justify-between px-3 border-b border-slate-50 flex-shrink-0">
            <span className="text-[11px] text-slate-400 truncate">{selectedWU ? selectedWU.title : 'Work units'}</span>
            <button onClick={() => setPanelOpen(false)} className="text-slate-300 hover:text-slate-500"><X className="w-3 h-3" /></button>
          </div>

          {/* Tabs */}
          {selectedWU && (
            <div className="px-3 pt-1.5 flex gap-3 border-b border-slate-50 flex-shrink-0">
              {['overview', 'execution', 'financial', 'legal'].map(tab => (
                <button key={tab} onClick={() => setPanelTab(tab as any)}
                  className={`pb-1.5 text-[11px] capitalize ${panelTab === tab ? 'text-slate-900 border-b border-slate-900' : 'text-slate-400'}`}>
                  {tab}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3 py-2.5 text-xs">
            {!sideData ? (
              <div className="py-8 text-center"><div className="animate-spin rounded-full h-3 w-3 border border-slate-200 border-t-slate-400 mx-auto" /></div>
            ) : selectedWU ? (
              <>
                {/* Overview */}
                {panelTab === 'overview' && (
                  <div className="space-y-2.5">
                    <Row label="Title" value={getVal('title', selectedWU.title)} onChange={v => stageChange('title', v)} />
                    <SelectRow label="Status" value={getVal('status', selectedWU.status)} options={['draft', 'active', 'paused', 'cancelled']} onChange={v => stageChange('status', v)} />
                    <Row label="Price ($)" value={`${((getVal('priceInCents', selectedWU.priceInCents)) / 100)}`} onChange={v => { const n = parseFloat(v); if (!isNaN(n)) stageChange('priceInCents', Math.round(n * 100)); }} />
                    <Row label="Deadline (h)" value={`${getVal('deadlineHours', selectedWU.deadlineHours)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n)) stageChange('deadlineHours', n); }} />
                    <SelectRow label="Tier" value={getVal('minTier', selectedWU.minTier)} options={['novice', 'pro', 'elite']} onChange={v => stageChange('minTier', v)} />
                    <SelectRow label="Assignment" value={getVal('assignmentMode', selectedWU.assignmentMode || 'auto')} options={['auto', 'manual']} onChange={v => stageChange('assignmentMode', v)} />
                    <Row label="Complexity" value={`${getVal('complexityScore', selectedWU.complexityScore)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n) && n >= 1 && n <= 5) stageChange('complexityScore', n); }} />
                    <Row label="Revision limit" value={`${getVal('revisionLimit', selectedWU.revisionLimit)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n) && n >= 0) stageChange('revisionLimit', n); }} />
                    <div>
                      <span className="text-slate-400">Skills</span>
                      <input value={getVal('requiredSkills', selectedWU.requiredSkills)?.join?.(', ') || ''} onChange={e => stageChange('requiredSkills', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        className="w-full text-[11px] text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-0.5 mt-0.5" />
                    </div>
                    <div>
                      <span className="text-slate-400">Criteria</span>
                      {(selectedWU.acceptanceCriteria || []).map((c: any, i: number) => (
                        <p key={i} className="text-slate-600 py-0.5">{i + 1}. {c.criterion}</p>
                      ))}
                    </div>
                    <div>
                      <span className="text-slate-400">Spec</span>
                      <textarea value={getVal('spec', selectedWU.spec)} onChange={e => stageChange('spec', e.target.value)}
                        className="w-full text-[11px] text-slate-600 bg-transparent border border-slate-100 rounded p-1.5 focus:ring-0 focus:border-slate-300 resize-none mt-0.5" rows={4} />
                    </div>
                  </div>
                )}

                {/* Execution */}
                {panelTab === 'execution' && (
                  <div className="space-y-3">
                    <div>
                      <span className="text-slate-400 block mb-1">Interview</span>
                      <select value={selectedWU.infoCollectionTemplateId || ''} onChange={e => {
                        const v = e.target.value || null;
                        stageChange('infoCollectionTemplateId', v);
                        if (v) loadInterview(v); else setInterviewDetail(null);
                      }} className="w-full text-[11px] text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-0.5">
                        <option value="">None</option>
                        {(sideData.templates || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>

                    {interviewDetail && (
                      <div className="space-y-2 pt-1 border-t border-slate-50">
                        <p className="text-slate-700">{interviewDetail.name} · {interviewDetail.timeLimitMinutes}min · {interviewDetail.mode}</p>
                        <p className="text-slate-400">{interviewDetail.questions?.length || 0} questions · voice {interviewDetail.enableVoiceOutput ? 'on' : 'off'}</p>
                        {(interviewDetail.links || []).filter((l: any) => l.isActive).slice(0, 3).map((l: any) => (
                          <p key={l.id} className="text-slate-500 truncate">/interview/{l.token}</p>
                        ))}
                        <button onClick={generateLink} className="text-slate-400 hover:text-slate-700">+ link</button>
                      </div>
                    )}

                    <div>
                      <span className="text-slate-400 block mb-1">Applicants & Executions</span>
                      {selectedWU.executions?.length > 0 ? selectedWU.executions.map((e: any) => (
                        <div key={e.id} className="py-1.5 border-b border-slate-50 last:border-0">
                          <p className="text-slate-700">{e.student?.name || '?'} — {e.status}</p>
                          {e.deadlineAt && <p className="text-slate-400">deadline {new Date(e.deadlineAt).toLocaleDateString()}</p>}
                          {e.qualityScore != null && <p className="text-slate-400">quality {e.qualityScore}%</p>}
                          <div className="flex gap-2 mt-0.5">
                            {e.status === 'pending_review' && <>
                              <button onClick={() => approveApp(e.id)} className="text-slate-500 hover:text-slate-900">assign</button>
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-slate-400 hover:text-slate-600">reject</button>
                            </>}
                            {e.status === 'submitted' && <>
                              <button onClick={() => reviewExec(e.id, 'approved')} className="text-slate-500 hover:text-slate-900">approve</button>
                              <button onClick={() => reviewExec(e.id, 'revision_needed')} className="text-slate-500 hover:text-slate-900">revise</button>
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-slate-400 hover:text-slate-600">reject</button>
                            </>}
                            {['assigned', 'clocked_in'].includes(e.status) && (
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-slate-400 hover:text-slate-600">cancel</button>
                            )}
                          </div>
                        </div>
                      )) : <p className="text-slate-400">None yet</p>}
                    </div>

                    {/* Onboarding Page */}
                    <div className="pt-2 border-t border-slate-50">
                      <span className="text-slate-400 block mb-1">Contractor Onboarding</span>
                      <div className="space-y-2">
                        <div>
                          <span className="text-slate-400 text-[10px]">Welcome message</span>
                          <textarea
                            value={onboardWelcome}
                            onChange={e => setOnboardWelcome(e.target.value)}
                            className="w-full text-xs text-slate-600 bg-transparent border border-slate-100 rounded p-1.5 focus:ring-0 focus:border-slate-300 resize-none mt-0.5"
                            rows={2}
                            placeholder="Welcome to this task! Here's what you need to know..."
                          />
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Instructions</span>
                          <textarea
                            value={onboardInstructions}
                            onChange={e => setOnboardInstructions(e.target.value)}
                            className="w-full text-xs text-slate-600 bg-transparent border border-slate-100 rounded p-1.5 focus:ring-0 focus:border-slate-300 resize-none mt-0.5"
                            rows={3}
                            placeholder="1. Read the spec carefully&#10;2. Check deliverable format&#10;3. Submit before deadline"
                          />
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Checklist</span>
                          <textarea
                            value={onboardChecklist}
                            onChange={e => setOnboardChecklist(e.target.value)}
                            className="w-full text-xs text-slate-600 bg-transparent border border-slate-100 rounded p-1.5 focus:ring-0 focus:border-slate-300 resize-none mt-0.5"
                            rows={2}
                            placeholder="Read spec&#10;Review examples&#10;Check deadline"
                          />
                          <span className="text-slate-300 text-[10px]">one item per line</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px]">Example work / reference URLs</span>
                          <textarea
                            value={onboardExamples}
                            onChange={e => setOnboardExamples(e.target.value)}
                            className="w-full text-xs text-slate-600 bg-transparent border border-slate-100 rounded p-1.5 focus:ring-0 focus:border-slate-300 resize-none mt-0.5"
                            rows={2}
                            placeholder="https://example.com/sample-work.pdf&#10;https://drive.google.com/file/..."
                          />
                          <span className="text-slate-300 text-[10px]">one URL per line</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={saveOnboarding} className="text-slate-500 hover:text-slate-900 text-xs">
                            save
                          </button>
                          <button onClick={() => setInput(`Update the onboarding page for "${selectedWU?.title}" — write a professional welcome message and detailed step-by-step instructions based on the task spec`)} className="text-slate-400 hover:text-slate-700 text-xs">
                            AI write →
                          </button>
                          <a
                            href={`/dashboard/settings/onboarding-editor?workUnitId=${selectedWU?.id}`}
                            target="_blank"
                            className="text-slate-400 hover:text-slate-700 text-xs"
                          >
                            full editor →
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Financial */}
                {panelTab === 'financial' && (
                  <div className="space-y-3">
                    <div className="flex justify-between"><span className="text-slate-400">Price</span><span className="text-slate-700">${(selectedWU.priceInCents / 100).toFixed(2)}</span></div>
                    {selectedWU.escrow && <>
                      <div className="flex justify-between"><span className="text-slate-400">Escrow</span><span className="text-slate-700">{selectedWU.escrow.status}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Fee</span><span className="text-slate-700">${(selectedWU.escrow.platformFeeInCents / 100).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Contractor gets</span><span className="text-slate-700">${(selectedWU.escrow.netAmountInCents / 100).toFixed(2)}</span></div>
                      {selectedWU.escrow.status === 'pending' && (
                        <button onClick={fundAndPublish} className="text-slate-500 hover:text-slate-900">fund + publish</button>
                      )}
                    </>}
                    {sideData.billing && (
                      <div className="pt-2 border-t border-slate-50 space-y-1">
                        <div className="flex justify-between"><span className="text-slate-400">Total escrow</span><span className="text-slate-700">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                        <div className="flex justify-between"><span className="text-slate-400">This month</span><span className="text-slate-700">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                      </div>
                    )}
                  </div>
                )}

                {/* Legal */}
                {panelTab === 'legal' && (
                  <div className="space-y-4">
                    {/* Active contracts */}
                    <div>
                      <span className="text-slate-400 block mb-1">Contracts</span>
                      <p className="text-slate-500 text-[10px] mb-2">Contractors must sign active contracts before starting work.</p>
                      {contracts.length > 0 ? contracts.map((c: any) => (
                        <div key={c.id} className="py-1.5 border-b border-slate-50 last:border-0">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-slate-700">{c.title}</p>
                              <p className="text-slate-400">v{c.version} · {c.status} · {c._count?.signatures || 0} signed</p>
                            </div>
                          </div>
                        </div>
                      )) : <p className="text-slate-400">No contracts yet</p>}
                    </div>

                    {/* Quick create */}
                    <div className="pt-2 border-t border-slate-50 space-y-1.5">
                      <button onClick={() => setInput(`Create a contractor agreement for "${selectedWU?.title}" that covers scope of work, deliverables, IP assignment, confidentiality, payment terms, and termination. Attach it to this work unit.`)}
                        className="block text-slate-500 hover:text-slate-900">
                        create task-specific contract →
                      </button>
                      <button onClick={() => setInput('Create a general NDA for all contractors')}
                        className="block text-slate-500 hover:text-slate-900">
                        create NDA →
                      </button>
                      <button onClick={() => setInput(`Draft a statement of work for "${selectedWU?.title}" — $${((selectedWU?.priceInCents || 0) / 100).toFixed(0)}, ${selectedWU?.deadlineHours}h`)}
                        className="block text-slate-500 hover:text-slate-900">
                        draft SOW →
                      </button>
                      <button onClick={() => setInput('List all contracts and their signature status')}
                        className="block text-slate-500 hover:text-slate-900">
                        view all contracts →
                      </button>
                    </div>

                    {/* Compliance */}
                    <div className="pt-2 border-t border-slate-50">
                      <span className="text-slate-400 block mb-1">Compliance</span>
                      <div className="space-y-0.5 text-slate-500">
                        <p>W-9 — collected at contractor onboarding</p>
                        <p>1099-NEC — auto-generated for $600+ earnings</p>
                        <p>KYC — Stripe Identity verification</p>
                        <p>IC classification — independent contractor</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Confirm button */}
                {hasChanges && (
                  <div className="pt-3 mt-3 border-t border-slate-50">
                    <button onClick={confirmChanges} disabled={saving}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-slate-700 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50">
                      <Check className="w-3 h-3" />
                      {saving ? 'Saving...' : `Confirm ${Object.keys(pendingChanges).length} change${Object.keys(pendingChanges).length > 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Work unit list */
              <div className="space-y-3">
                {sideData.billing && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between"><span className="text-slate-400">Escrow</span><span className="text-slate-700">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">Month</span><span className="text-slate-700">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                  </div>
                )}
                <div>
                  <span className="text-slate-400 block mb-1">Work units</span>
                  {(sideData.workUnits || []).map((wu: any) => (
                    <button key={wu.id} onClick={() => selectWU(wu.id)} className="w-full text-left py-1 hover:bg-slate-50 rounded">
                      <p className="text-slate-700 truncate">{wu.title}</p>
                      <p className="text-slate-400">{wu.status} · ${(wu.priceInCents / 100).toFixed(0)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedWU && (
            <div className="px-3 py-1.5 border-t border-slate-50 flex-shrink-0">
              <button onClick={() => { setSelectedWU(null); setInterviewDetail(null); setPendingChanges({}); }} className="text-[11px] text-slate-400 hover:text-slate-600">← all</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline components ──

function Row({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="text-right text-[11px] text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-0 w-28 min-w-0" />
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-slate-400">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="text-[11px] text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-0 pr-5">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
