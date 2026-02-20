'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Send, Plus, ChevronDown, X, GripVertical, Check, Paperclip, FileText, Globe, Loader2, Sparkles, Calculator, Search, FileCheck, Eye, Save, Trash2, Type, Image, CheckSquare, AlertCircle, MoveUp, MoveDown, Palette } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  content: string | null;
  toolName?: string;
  toolResult?: string;
  statusLabel?: string;
  statusPhase?: 'start' | 'done';
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

/** Parse markdown-style bold/italic into React elements */
function formatText(text: string): React.ReactNode[] {
  // Split on **bold** and *italic* patterns
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Match **bold** first (greedy but not across newlines)
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Match *italic* (single asterisk, not double)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);

    // Find the earliest match
    const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : -1;
    const italicIdx = italicMatch ? remaining.indexOf(italicMatch[0]) : -1;

    let earliest = -1;
    let matchType: 'bold' | 'italic' | null = null;
    let matchObj: RegExpMatchArray | null = null;

    if (boldIdx !== -1 && (italicIdx === -1 || boldIdx <= italicIdx)) {
      earliest = boldIdx; matchType = 'bold'; matchObj = boldMatch;
    } else if (italicIdx !== -1) {
      earliest = italicIdx; matchType = 'italic'; matchObj = italicMatch;
    }

    if (earliest === -1 || !matchObj) {
      parts.push(remaining);
      break;
    }

    // Add text before the match
    if (earliest > 0) {
      parts.push(remaining.slice(0, earliest));
    }

    // Add the styled element
    if (matchType === 'bold') {
      parts.push(<span key={key++} className="font-semibold text-slate-950">{matchObj[1]}</span>);
    } else {
      parts.push(<span key={key++} className="italic text-slate-700">{matchObj[1]}</span>);
    }

    remaining = remaining.slice(earliest + matchObj[0].length);
  }

  return parts;
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
  const [panelWidth, setPanelWidth] = useState(480);
  const [panelTab, setPanelTab] = useState<'overview' | 'execution' | 'financial' | 'legal' | 'onboard'>('overview');
  const [sideData, setSideData] = useState<any>(null);
  const [selectedWU, setSelectedWU] = useState<any>(null);
  const [interviewDetail, setInterviewDetail] = useState<any>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);

  // Onboarding editor state (block-based)
  type BlockType = 'hero' | 'text' | 'image' | 'video' | 'file' | 'checklist' | 'cta' | 'divider';
  interface PageBlock { id: string; type: BlockType; content: Record<string, any>; }
  const [obBlocks, setObBlocks] = useState<PageBlock[]>([]);
  const [obAccentColor, setObAccentColor] = useState('#a78bfa');
  const [obLogoUrl, setObLogoUrl] = useState('');
  const [obCompanyName, setObCompanyName] = useState('');
  const [obEditingBlock, setObEditingBlock] = useState<string | null>(null);
  const [obPreview, setObPreview] = useState(false);
  const [obSaving, setObSaving] = useState(false);
  const [obSaved, setObSaved] = useState(false);

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
    setObSaving(true); setObSaved(false);
    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/companies/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) { setObSaving(false); return; }
      const profile = await res.json();
      const existing = (typeof profile.address === 'object' && profile.address) || {};
      const onboardingPages = existing.onboardingPages || {};
      onboardingPages[selectedWU.id] = {
        accentColor: obAccentColor,
        logoUrl: obLogoUrl,
        blocks: obBlocks,
      };
      await fetch(`${API_URL}/api/companies/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: { ...existing, onboardingPages } }),
      });
      setObSaved(true);
      setTimeout(() => setObSaved(false), 3000);
    } catch {}
    setObSaving(false);
  }

  async function loadOnboarding(wuId: string) {
    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/companies/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const profile = await res.json();
        setObCompanyName(profile.companyName || '');
        setObLogoUrl(profile.website ? `https://logo.clearbit.com/${profile.website.replace(/https?:\/\//, '')}` : '');
        const addr = profile.address as any;
        let saved = null;
        if (addr?.onboardingPages?.[wuId]?.blocks) saved = addr.onboardingPages[wuId];
        else if (addr?.onboardingPage?.blocks) saved = addr.onboardingPage;
        if (saved?.blocks?.length > 0) {
          setObBlocks(saved.blocks);
          if (saved.accentColor) setObAccentColor(saved.accentColor);
          if (saved.logoUrl) setObLogoUrl(saved.logoUrl);
        } else {
          setObBlocks([
            { id: 'def-hero', type: 'hero', content: { heading: 'Welcome to {companyName}', subheading: 'Review the info below before getting started.' } },
            { id: 'def-text', type: 'text', content: { heading: 'About This Task', body: 'Read the spec carefully and ask questions if anything is unclear.' } },
            { id: 'def-checklist', type: 'checklist', content: { heading: 'What We Expect', items: ['Deliver work on time', 'Follow acceptance criteria', 'Respond to POW check-ins'] } },
          ]);
        }
      }
    } catch {
      setObBlocks([]);
    }
  }

  function obAddBlock(type: BlockType) {
    const defaults: Record<BlockType, Record<string, any>> = {
      hero: { heading: 'Welcome', subheading: 'Brief intro...' },
      text: { heading: '', body: 'Content...' },
      image: { url: '', alt: 'Image', caption: '' },
      video: { url: '', title: 'Video' },
      file: { url: '', filename: 'Document', description: '' },
      checklist: { heading: 'Checklist', items: ['Item 1', 'Item 2'] },
      cta: { heading: 'Ready?', body: 'Make sure to review everything.', buttonText: "I'm Ready" },
      divider: {},
    };
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setObBlocks(prev => [...prev, { id, type, content: { ...defaults[type] } }]);
    setObEditingBlock(id);
  }

  function obRemoveBlock(id: string) {
    setObBlocks(prev => prev.filter(b => b.id !== id));
    if (obEditingBlock === id) setObEditingBlock(null);
  }

  function obMoveBlock(id: string, dir: 'up' | 'down') {
    setObBlocks(prev => {
      const a = [...prev]; const i = a.findIndex(b => b.id === id);
      if (dir === 'up' && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
      else if (dir === 'down' && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
      return a;
    });
  }

  function obUpdateBlock(id: string, key: string, value: any) {
    setObBlocks(prev => prev.map(b => b.id === id ? { ...b, content: { ...b.content, [key]: value } } : b));
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
            } else if (ev.type === 'tool_status') {
              const statusId = `status-${ev.name}-${Date.now()}`;
              if (ev.phase === 'start') {
                setMessages(prev => [...prev, { id: statusId, role: 'status', content: null, toolName: ev.name, statusLabel: ev.label, statusPhase: 'start' }]);
              } else if (ev.phase === 'done') {
                // Mark the last matching status as done
                setMessages(prev => {
                  const idx = [...prev].reverse().findIndex(m => m.role === 'status' && m.toolName === ev.name && m.statusPhase === 'start');
                  if (idx === -1) return prev;
                  const realIdx = prev.length - 1 - idx;
                  return prev.map((m, i) => i === realIdx ? { ...m, statusPhase: 'done' } : m);
                });
              }
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
      setPanelWidth(Math.max(380, Math.min(800, w)));
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
                if (msg.role === 'status') return (
                  <ToolStatus key={msg.id} label={msg.statusLabel || ''} toolName={msg.toolName || ''} phase={msg.statusPhase || 'start'} />
                );
                if (msg.role === 'tool') return null; // tool results are hidden — agent synthesizes them
                return (
                  <div key={msg.id} className="pl-0.5">
                    <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed">
                      {msg.content ? formatText(msg.content) : null}
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
        <div style={{ width: panelWidth }} className="border-l border-slate-200/50 bg-white/80 flex flex-col flex-shrink-0 overflow-hidden">
          <div className="h-10 flex items-center justify-between px-4 border-b border-slate-100 flex-shrink-0">
            <span className="text-xs font-medium text-slate-700 truncate">{selectedWU ? selectedWU.title : 'Work units'}</span>
            <button onClick={() => setPanelOpen(false)} className="text-slate-300 hover:text-slate-500"><X className="w-3.5 h-3.5" /></button>
          </div>

          {/* Tabs */}
          {selectedWU && (
            <div className="px-4 pt-2 flex gap-3 border-b border-slate-100 flex-shrink-0 overflow-x-auto">
              {['overview', 'execution', 'financial', 'legal', 'onboard'].map(tab => (
                <button key={tab} onClick={() => setPanelTab(tab as any)}
                  className={`pb-2 text-xs capitalize whitespace-nowrap ${panelTab === tab ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
                  {tab}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 text-[13px]">
            {!sideData ? (
              <div className="py-8 text-center"><div className="animate-spin rounded-full h-3 w-3 border border-slate-200 border-t-slate-400 mx-auto" /></div>
            ) : selectedWU ? (
              <>
                {/* Overview */}
                {panelTab === 'overview' && (
                  <div className="space-y-3">
                    <Row label="Title" value={getVal('title', selectedWU.title)} onChange={v => stageChange('title', v)} />
                    <SelectRow label="Status" value={getVal('status', selectedWU.status)} options={['draft', 'active', 'paused', 'cancelled']} onChange={v => stageChange('status', v)} />
                    <Row label="Price ($)" value={`${((getVal('priceInCents', selectedWU.priceInCents)) / 100)}`} onChange={v => { const n = parseFloat(v); if (!isNaN(n)) stageChange('priceInCents', Math.round(n * 100)); }} />
                    <Row label="Deadline (h)" value={`${getVal('deadlineHours', selectedWU.deadlineHours)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n)) stageChange('deadlineHours', n); }} />
                    <SelectRow label="Tier" value={getVal('minTier', selectedWU.minTier)} options={['novice', 'pro', 'elite']} onChange={v => stageChange('minTier', v)} />
                    <SelectRow label="Assignment" value={getVal('assignmentMode', selectedWU.assignmentMode || 'auto')} options={['auto', 'manual']} onChange={v => stageChange('assignmentMode', v)} />
                    <Row label="Complexity" value={`${getVal('complexityScore', selectedWU.complexityScore)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n) && n >= 1 && n <= 5) stageChange('complexityScore', n); }} />
                    <Row label="Revision limit" value={`${getVal('revisionLimit', selectedWU.revisionLimit)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n) && n >= 0) stageChange('revisionLimit', n); }} />
                    <div>
                      <span className="text-slate-500 text-xs">Skills</span>
                      <input value={getVal('requiredSkills', selectedWU.requiredSkills)?.join?.(', ') || ''} onChange={e => stageChange('requiredSkills', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        className="w-full text-xs text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-1 mt-0.5" />
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Criteria</span>
                      {(selectedWU.acceptanceCriteria || []).map((c: any, i: number) => (
                        <p key={i} className="text-slate-700 py-0.5 text-xs">{i + 1}. {c.criterion}</p>
                      ))}
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Spec</span>
                      <textarea value={getVal('spec', selectedWU.spec)} onChange={e => stageChange('spec', e.target.value)}
                        className="w-full text-xs text-slate-700 bg-transparent border border-slate-100 rounded p-2 focus:ring-0 focus:border-slate-300 resize-none mt-0.5" rows={5} />
                    </div>
                  </div>
                )}

                {/* Execution */}
                {panelTab === 'execution' && (
                  <div className="space-y-3">
                    <div>
                      <span className="text-slate-500 text-xs block mb-1">Interview</span>
                      <select value={selectedWU.infoCollectionTemplateId || ''} onChange={e => {
                        const v = e.target.value || null;
                        stageChange('infoCollectionTemplateId', v);
                        if (v) loadInterview(v); else setInterviewDetail(null);
                      }} className="w-full text-xs text-slate-700 bg-transparent border-0 border-b border-slate-100 focus:border-slate-400 focus:ring-0 py-1">
                        <option value="">None</option>
                        {(sideData.templates || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>

                    {interviewDetail && (
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <p className="text-xs text-slate-700">{interviewDetail.name} · {interviewDetail.timeLimitMinutes}min · {interviewDetail.mode}</p>
                        <p className="text-xs text-slate-500">{interviewDetail.questions?.length || 0} questions · voice {interviewDetail.enableVoiceOutput ? 'on' : 'off'}</p>
                        {(interviewDetail.links || []).filter((l: any) => l.isActive).slice(0, 3).map((l: any) => (
                          <p key={l.id} className="text-slate-500 truncate">/interview/{l.token}</p>
                        ))}
                        <button onClick={generateLink} className="text-slate-400 hover:text-slate-700">+ link</button>
                      </div>
                    )}

                    <div>
                      <span className="text-slate-500 text-xs block mb-1">Applicants & Executions</span>
                      {selectedWU.executions?.length > 0 ? selectedWU.executions.map((e: any) => (
                        <div key={e.id} className="py-2 border-b border-slate-100 last:border-0">
                          <p className="text-xs text-slate-800 font-medium">{e.student?.name || '?'} <span className="font-normal text-slate-500">— {e.status}</span></p>
                          {e.deadlineAt && <p className="text-xs text-slate-500 mt-0.5">deadline {new Date(e.deadlineAt).toLocaleDateString()}</p>}
                          {e.qualityScore != null && <p className="text-xs text-slate-500">quality {e.qualityScore}%</p>}
                          <div className="flex gap-2 mt-1">
                            {e.status === 'pending_review' && <>
                              <button onClick={() => approveApp(e.id)} className="text-xs text-emerald-600 hover:text-emerald-800">assign</button>
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-xs text-red-400 hover:text-red-600">reject</button>
                            </>}
                            {e.status === 'submitted' && <>
                              <button onClick={() => reviewExec(e.id, 'approved')} className="text-xs text-emerald-600 hover:text-emerald-800">approve</button>
                              <button onClick={() => reviewExec(e.id, 'revision_needed')} className="text-xs text-amber-600 hover:text-amber-800">revise</button>
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-xs text-red-400 hover:text-red-600">reject</button>
                            </>}
                            {['assigned', 'clocked_in'].includes(e.status) && (
                              <button onClick={() => reviewExec(e.id, 'failed')} className="text-xs text-red-400 hover:text-red-600">cancel</button>
                            )}
                          </div>
                        </div>
                      )) : <p className="text-slate-400">None yet</p>}
                    </div>

                  </div>
                )}

                {/* Financial */}
                {panelTab === 'financial' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center"><span className="text-slate-500">Price</span><span className="text-slate-900 font-medium">${(selectedWU.priceInCents / 100).toFixed(2)}</span></div>
                    {selectedWU.escrow && <>
                      <div className="flex justify-between items-center"><span className="text-slate-500">Escrow</span><span className={`font-medium ${selectedWU.escrow.status === 'funded' ? 'text-emerald-600' : 'text-amber-600'}`}>{selectedWU.escrow.status}</span></div>
                      <div className="flex justify-between items-center"><span className="text-slate-500">Platform fee</span><span className="text-slate-700">${(selectedWU.escrow.platformFeeInCents / 100).toFixed(2)}</span></div>
                      <div className="flex justify-between items-center"><span className="text-slate-500">Contractor receives</span><span className="text-slate-700">${(selectedWU.escrow.netAmountInCents / 100).toFixed(2)}</span></div>
                      {selectedWU.escrow.status === 'pending' && (
                        <button onClick={fundAndPublish} className="w-full mt-2 py-1.5 text-xs text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors">Fund & Publish</button>
                      )}
                    </>}
                    {sideData.billing && (
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <div className="flex justify-between items-center"><span className="text-slate-500">Total escrow</span><span className="text-slate-900 font-medium">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                        <div className="flex justify-between items-center"><span className="text-slate-500">This month</span><span className="text-slate-900 font-medium">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                      </div>
                    )}
                    <button onClick={() => setInput(`What should I pay for "${selectedWU?.title}"? Research market rates and give me a pricing recommendation.`)}
                      className="w-full mt-1 py-1.5 text-xs text-slate-600 border border-slate-200 rounded hover:bg-white transition-colors flex items-center justify-center gap-1.5">
                      <Calculator className="w-3 h-3" /> Get pricing recommendation
                    </button>
                  </div>
                )}

                {/* Legal */}
                {panelTab === 'legal' && (
                  <div className="space-y-4">
                    <div>
                      <span className="text-slate-500 text-xs block mb-1.5">Contracts</span>
                      <p className="text-[11px] text-slate-400 mb-2">Contractors must sign active contracts before starting work.</p>
                      {contracts.length > 0 ? contracts.map((c: any) => (
                        <div key={c.id} className="py-2 border-b border-slate-100 last:border-0">
                          <p className="text-xs text-slate-800">{c.title}</p>
                          <p className="text-[11px] text-slate-500">v{c.version} · {c.status} · {c._count?.signatures || 0} signed</p>
                        </div>
                      )) : <p className="text-xs text-slate-400">No contracts yet</p>}
                    </div>

                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <button onClick={() => setInput(`Create a contractor agreement for "${selectedWU?.title}" that covers scope of work, deliverables, IP assignment, confidentiality, payment terms, and termination. Attach it to this work unit.`)}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        create task-specific contract →
                      </button>
                      <button onClick={() => setInput('Create a general NDA for all contractors')}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        create NDA →
                      </button>
                      <button onClick={() => setInput(`Draft a statement of work for "${selectedWU?.title}" — $${((selectedWU?.priceInCents || 0) / 100).toFixed(0)}, ${selectedWU?.deadlineHours}h`)}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        draft SOW →
                      </button>
                      <button onClick={() => setInput('List all contracts and their signature status')}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        view all contracts →
                      </button>
                    </div>

                    <div className="pt-3 border-t border-slate-100">
                      <span className="text-slate-500 text-xs block mb-1.5">Compliance</span>
                      <div className="space-y-1 text-xs text-slate-600">
                        <p>W-9 — collected at contractor onboarding</p>
                        <p>1099-NEC — auto-generated for $600+ earnings</p>
                        <p>KYC — Stripe Identity verification</p>
                        <p>IC classification — independent contractor</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Onboard tab — full visual editor */}
                {panelTab === 'onboard' && (
                  <div className="space-y-3">
                    {/* Preview toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-xs font-medium">Onboarding Page</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => setObPreview(!obPreview)}
                          className={`text-[10px] px-2 py-0.5 rounded ${obPreview ? 'bg-slate-900 text-white' : 'text-slate-500 border border-slate-200 hover:bg-slate-50'}`}>
                          <Eye className="w-3 h-3 inline mr-0.5" /> {obPreview ? 'editing' : 'preview'}
                        </button>
                        <button onClick={saveOnboarding} disabled={obSaving}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
                          <Save className="w-3 h-3 inline mr-0.5" /> {obSaving ? '...' : obSaved ? '✓' : 'save'}
                        </button>
                      </div>
                    </div>

                    {obPreview ? (
                      /* Preview mode */
                      <div className="bg-[#faf8fc] rounded-lg p-3 space-y-3">
                        {obLogoUrl && <img src={obLogoUrl} alt="" className="h-6 mx-auto" onError={e => (e.currentTarget.style.display = 'none')} />}
                        {obBlocks.map(block => (
                          <PanelBlockPreview key={block.id} block={block} accentColor={obAccentColor} companyName={obCompanyName} />
                        ))}
                      </div>
                    ) : (
                      <>
                        {/* Accent color */}
                        <div>
                          <span className="text-[10px] text-slate-400 block mb-1">Accent color</span>
                          <div className="flex gap-1.5">
                            {['#a78bfa','#3b82f6','#10b981','#f59e0b','#ec4899','#ef4444','#14b8a6','#64748b'].map(c => (
                              <button key={c} onClick={() => setObAccentColor(c)}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${obAccentColor === c ? 'border-slate-900 scale-110' : 'border-transparent'}`}
                                style={{ backgroundColor: c }} />
                            ))}
                          </div>
                        </div>

                        {/* Add block */}
                        <div>
                          <span className="text-[10px] text-slate-400 block mb-1">Add block</span>
                          <div className="flex flex-wrap gap-1">
                            {([
                              ['hero', '✦'], ['text', '¶'], ['image', '🖼'], ['video', '▶'], ['file', '📎'], ['checklist', '☑'], ['cta', '→'], ['divider', '—']
                            ] as [BlockType, string][]).map(([t, icon]) => (
                              <button key={t} onClick={() => obAddBlock(t)}
                                className="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-white hover:border-slate-300 transition-colors">
                                {icon} {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Block list */}
                        {obBlocks.length === 0 ? (
                          <div className="py-6 text-center border-2 border-dashed border-slate-200 rounded-lg">
                            <p className="text-xs text-slate-400">Add blocks above to build the page</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {obBlocks.map((block, idx) => (
                              <div key={block.id} className={`rounded-lg border transition-all ${obEditingBlock === block.id ? 'border-violet-300 bg-violet-50/30' : 'border-slate-200 bg-white'}`}>
                                {/* Block header */}
                                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-100">
                                  <div className="flex items-center gap-1.5">
                                    <GripVertical className="w-3 h-3 text-slate-300" />
                                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{block.type}</span>
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    <button onClick={() => obMoveBlock(block.id, 'up')} disabled={idx === 0} className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                                      <MoveUp className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => obMoveBlock(block.id, 'down')} disabled={idx === obBlocks.length - 1} className="p-0.5 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                                      <MoveDown className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => setObEditingBlock(obEditingBlock === block.id ? null : block.id)} className="p-0.5 text-slate-400 hover:text-violet-500">
                                      <Type className="w-3 h-3" />
                                    </button>
                                    <button onClick={() => obRemoveBlock(block.id)} className="p-0.5 text-slate-400 hover:text-red-500">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>

                                {/* Block content */}
                                <div className="p-2.5">
                                  {obEditingBlock === block.id ? (
                                    <PanelBlockEditor block={block} onChange={obUpdateBlock} />
                                  ) : (
                                    <PanelBlockPreview block={block} accentColor={obAccentColor} companyName={obCompanyName} />
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* AI write button */}
                        <button onClick={() => setInput(`Design a professional onboarding page for "${selectedWU?.title}". Use the set_onboarding tool with blocks array to create hero, text, checklist, and cta blocks. Call the tool directly — don't just describe what you'd create.`)}
                          className="w-full text-xs text-slate-600 border border-slate-200 rounded py-1.5 hover:bg-white transition-colors flex items-center justify-center gap-1.5">
                          <Sparkles className="w-3 h-3" /> AI design this page
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Confirm button */}
                {hasChanges && (
                  <div className="pt-3 mt-3 border-t border-slate-100">
                    <button onClick={confirmChanges} disabled={saving}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-white bg-slate-900 rounded hover:bg-slate-800 disabled:opacity-50 transition-colors">
                      <Check className="w-3.5 h-3.5" />
                      {saving ? 'Saving...' : `Confirm ${Object.keys(pendingChanges).length} change${Object.keys(pendingChanges).length > 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Work unit list */
              <div className="space-y-4">
                {sideData.billing && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-slate-500 text-xs">Escrow</span><span className="text-slate-900 font-medium text-xs">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 text-xs">This month</span><span className="text-slate-900 font-medium text-xs">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 text-xs block mb-2">Work units</span>
                  {(sideData.workUnits || []).map((wu: any) => (
                    <button key={wu.id} onClick={() => selectWU(wu.id)} className="w-full text-left py-2 px-2 hover:bg-white rounded-lg transition-colors">
                      <p className="text-xs text-slate-800 truncate">{wu.title}</p>
                      <p className="text-[11px] text-slate-500">{wu.status} · ${(wu.priceInCents / 100).toFixed(0)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedWU && (
            <div className="px-4 py-2 border-t border-slate-100 flex-shrink-0">
              <button onClick={() => { setSelectedWU(null); setInterviewDetail(null); setPendingChanges({}); }} className="text-xs text-slate-500 hover:text-slate-800">← all work units</button>
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
      <span className="text-slate-500 text-xs flex-shrink-0">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="text-right text-xs text-slate-800 bg-transparent border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 py-0.5 w-32 min-w-0" />
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-slate-500 text-xs">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="text-xs text-slate-800 bg-transparent border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 py-0.5 pr-5">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function ToolStatus({ label, toolName, phase }: { label: string; toolName: string; phase: 'start' | 'done' }) {
  const icon = (() => {
    if (toolName === 'web_search' || toolName === 'calculate_pricing') return <Globe className="w-3 h-3" />;
    if (toolName.includes('list') || toolName.includes('get')) return <Search className="w-3 h-3" />;
    if (toolName.includes('create') || toolName.includes('draft')) return <Sparkles className="w-3 h-3" />;
    if (toolName.includes('estimate') || toolName.includes('billing') || toolName.includes('fund')) return <Calculator className="w-3 h-3" />;
    if (toolName.includes('contract') || toolName.includes('review')) return <FileCheck className="w-3 h-3" />;
    return <Loader2 className="w-3 h-3" />;
  })();

  return (
    <div className="flex items-center gap-2 py-1 pl-0.5">
      <span className={`${phase === 'start' ? 'text-violet-500 animate-pulse' : 'text-emerald-500'}`}>
        {phase === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      </span>
      <span className={`text-xs ${phase === 'start' ? 'text-slate-500' : 'text-slate-400'}`}>
        {label}{phase === 'start' ? '…' : ''}
      </span>
      {phase === 'done' && <span className="text-emerald-500 text-[10px]">✓</span>}
    </div>
  );
}

// ── Onboarding block editor (panel-sized) ──

function PanelBlockEditor({ block, onChange }: { block: { id: string; type: string; content: Record<string, any> }; onChange: (id: string, key: string, value: any) => void }) {
  const inputCls = "w-full px-2 py-1.5 rounded border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white";
  const labelCls = "text-[10px] font-medium text-slate-500 mb-0.5 block";

  switch (block.type) {
    case 'hero':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Heading</label><input type="text" value={block.content.heading || ''} onChange={e => onChange(block.id, 'heading', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Subheading</label><textarea value={block.content.subheading || ''} onChange={e => onChange(block.id, 'subheading', e.target.value)} className={`${inputCls} resize-none h-14`} /></div>
        </div>
      );
    case 'text':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Heading</label><input type="text" value={block.content.heading || ''} onChange={e => onChange(block.id, 'heading', e.target.value)} className={inputCls} placeholder="Optional heading" /></div>
          <div><label className={labelCls}>Body</label><textarea value={block.content.body || ''} onChange={e => onChange(block.id, 'body', e.target.value)} className={`${inputCls} resize-none h-24`} /></div>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Image URL</label><input type="url" value={block.content.url || ''} onChange={e => onChange(block.id, 'url', e.target.value)} className={inputCls} placeholder="https://..." /></div>
          <div><label className={labelCls}>Caption</label><input type="text" value={block.content.caption || ''} onChange={e => onChange(block.id, 'caption', e.target.value)} className={inputCls} /></div>
          {block.content.url && <img src={block.content.url} alt="" className="w-full rounded max-h-24 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />}
        </div>
      );
    case 'checklist':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Heading</label><input type="text" value={block.content.heading || ''} onChange={e => onChange(block.id, 'heading', e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Items (one per line)</label>
            <textarea value={(block.content.items || []).join('\n')} onChange={e => onChange(block.id, 'items', e.target.value.split('\n').filter(Boolean))} className={`${inputCls} resize-none h-20`} placeholder="Item 1&#10;Item 2" />
          </div>
        </div>
      );
    case 'cta':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Heading</label><input type="text" value={block.content.heading || ''} onChange={e => onChange(block.id, 'heading', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Body</label><textarea value={block.content.body || ''} onChange={e => onChange(block.id, 'body', e.target.value)} className={`${inputCls} resize-none h-12`} /></div>
          <div><label className={labelCls}>Button text</label><input type="text" value={block.content.buttonText || ''} onChange={e => onChange(block.id, 'buttonText', e.target.value)} className={inputCls} /></div>
        </div>
      );
    case 'video':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Video URL</label><input type="url" value={block.content.url || ''} onChange={e => onChange(block.id, 'url', e.target.value)} className={inputCls} placeholder="https://youtube.com/watch?v=..." /></div>
          <div><label className={labelCls}>Title</label><input type="text" value={block.content.title || ''} onChange={e => onChange(block.id, 'title', e.target.value)} className={inputCls} /></div>
        </div>
      );
    case 'file':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>File URL</label><input type="url" value={block.content.url || ''} onChange={e => onChange(block.id, 'url', e.target.value)} className={inputCls} placeholder="https://drive.google.com/..." /></div>
          <div><label className={labelCls}>Filename</label><input type="text" value={block.content.filename || ''} onChange={e => onChange(block.id, 'filename', e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Description</label><input type="text" value={block.content.description || ''} onChange={e => onChange(block.id, 'description', e.target.value)} className={inputCls} /></div>
        </div>
      );
    case 'divider':
      return <div className="text-[10px] text-slate-400 text-center py-1">— divider —</div>;
    default:
      return null;
  }
}

function PanelBlockPreview({ block, accentColor, companyName }: { block: { id: string; type: string; content: Record<string, any> }; accentColor: string; companyName: string }) {
  const resolve = (s: string) => s?.replace('{companyName}', companyName || 'Your Company') || '';

  switch (block.type) {
    case 'hero':
      return (
        <div className="text-center py-1">
          <p className="text-xs font-bold text-slate-800">{resolve(block.content.heading)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{resolve(block.content.subheading)}</p>
        </div>
      );
    case 'text':
      return (
        <div>
          {block.content.heading && <p className="text-xs font-semibold text-slate-800 mb-0.5">{block.content.heading}</p>}
          <p className="text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">{block.content.body}</p>
        </div>
      );
    case 'image':
      return block.content.url ? (
        <div>
          <img src={block.content.url} alt="" className="w-full rounded max-h-20 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
          {block.content.caption && <p className="text-[10px] text-slate-400 text-center mt-0.5">{block.content.caption}</p>}
        </div>
      ) : (
        <div className="py-3 text-center border border-dashed border-slate-200 rounded"><p className="text-[10px] text-slate-400">No image</p></div>
      );
    case 'checklist':
      return (
        <div>
          {block.content.heading && <p className="text-xs font-semibold text-slate-800 mb-1">{block.content.heading}</p>}
          <ul className="space-y-0.5">
            {(block.content.items || []).map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                <CheckSquare className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: accentColor }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'cta':
      return (
        <div className="text-center py-1.5 px-2 rounded" style={{ backgroundColor: `${accentColor}15` }}>
          <p className="text-xs font-semibold text-slate-800">{block.content.heading}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{block.content.body}</p>
          <span className="inline-block mt-1 px-3 py-1 rounded text-white text-[10px] font-medium" style={{ backgroundColor: accentColor }}>
            {block.content.buttonText || 'Continue'}
          </span>
        </div>
      );
    case 'video':
      return (
        <div>
          {block.content.title && <p className="text-xs font-semibold text-slate-800 mb-1">{block.content.title}</p>}
          {block.content.url ? (
            <div className="rounded overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
              <a href={block.content.url} target="_blank" rel="noopener noreferrer" className="text-white text-xs flex items-center gap-1">▶ Watch Video</a>
            </div>
          ) : (
            <div className="py-3 text-center border border-dashed border-slate-200 rounded"><p className="text-[10px] text-slate-400">No video URL</p></div>
          )}
        </div>
      );
    case 'file':
      return (
        <div className="flex items-start gap-2 p-2 bg-slate-50 rounded">
          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-slate-700">{block.content.filename || 'Document'}</p>
            {block.content.description && <p className="text-[10px] text-slate-500">{block.content.description}</p>}
            {block.content.url && <a href={block.content.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-violet-500 hover:underline">Download →</a>}
          </div>
        </div>
      );
    case 'divider':
      return <hr className="border-slate-200" />;
    default:
      return null;
  }
}
