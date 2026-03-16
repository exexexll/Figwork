'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMarketplaceEvent, MARKETPLACE_EVENTS, marketplaceSocket } from '@/lib/marketplace-socket';
import { Send, Plus, ChevronDown, X, GripVertical, Check, Paperclip, FileText, Globe, Loader2, Sparkles, Calculator, Search, FileCheck, Eye, Save, Trash2, Type, Image, CheckSquare, AlertCircle, MoveUp, MoveDown, Palette, Clock, CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface PlanTask {
  id: string;
  label: string;
  tool?: string;
  detail?: string;
  done: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status' | 'thinking';
  content: string | null;
  toolName?: string;
  toolResult?: string;
  statusLabel?: string;
  statusPhase?: 'start' | 'done';
  planTasks?: PlanTask[];
}

interface ToolStatusGroup {
  toolName: string;
  label: string;
  count: number;
  phase: 'start' | 'done';
  lastUpdate: number;
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
  if (!text) return [];

  // Pre-process: strip markdown headers → bold, bullets
  let processed = text
    .replace(/^#{1,3}\s+(.+)$/gm, '**$1**')
    .replace(/^- /gm, '• ')
    .replace(/^\d+\)\s+/gm, (m) => m);

  const parts: React.ReactNode[] = [];
  let remaining = processed;
  let key = 0;

  // Inline patterns: markdown link, bold, italic, bare URL
  while (remaining.length > 0) {
    const mdLinkMatch = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    const urlMatch = remaining.match(/(?<!\]\()(?<!\()(https?:\/\/[^\s<>)\]]+)/);

    // Find earliest match
    const candidates: { idx: number; type: string; match: RegExpMatchArray }[] = [];
    if (mdLinkMatch) candidates.push({ idx: remaining.indexOf(mdLinkMatch[0]), type: 'mdlink', match: mdLinkMatch });
    if (boldMatch) candidates.push({ idx: remaining.indexOf(boldMatch[0]), type: 'bold', match: boldMatch });
    if (italicMatch) candidates.push({ idx: remaining.indexOf(italicMatch[0]), type: 'italic', match: italicMatch });
    if (urlMatch) candidates.push({ idx: remaining.indexOf(urlMatch[0]), type: 'url', match: urlMatch });

    // Filter out URL matches that are inside an mdLink match
    const filtered = candidates.filter(c => {
      if (c.type === 'url' && mdLinkMatch) {
        const mdStart = remaining.indexOf(mdLinkMatch[0]);
        const mdEnd = mdStart + mdLinkMatch[0].length;
        return !(c.idx >= mdStart && c.idx < mdEnd);
      }
      return true;
    });

    filtered.sort((a, b) => a.idx - b.idx);
    const winner = filtered[0];

    if (!winner || winner.idx === -1) {
      parts.push(remaining);
      break;
    }

    if (winner.idx > 0) parts.push(remaining.slice(0, winner.idx));

    switch (winner.type) {
      case 'mdlink': {
        const label = winner.match[1];
        const href = winner.match[2];
        parts.push(<a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-800 underline underline-offset-2">{label}</a>);
        break;
      }
      case 'bold':
        parts.push(<span key={key++} className="font-semibold text-slate-950">{winner.match[1]}</span>);
        break;
      case 'italic':
        parts.push(<span key={key++} className="italic text-slate-700">{winner.match[1]}</span>);
        break;
      case 'url': {
        const url = winner.match[0];
        // Clean trailing punctuation
        const clean = url.replace(/[.,;:!?)]+$/, '');
        const tail = url.slice(clean.length);
        // Show a friendly label: domain + path
        let label = clean;
        try { const u = new URL(clean); label = u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : ''); } catch {}
        parts.push(<a key={key++} href={clean} target="_blank" rel="noopener noreferrer" className="text-violet-600 hover:text-violet-800 underline underline-offset-2">{label}</a>);
        if (tail) parts.push(tail);
        break;
      }
    }

    remaining = remaining.slice(winner.idx + winner.match[0].length);
  }

  return parts;
}

// Task-related tools that should show inline, not in header
const TASK_RELATED_TOOLS = ['create_work_unit', 'update_work_unit', 'set_onboarding', 'create_contract', 'update_contract', 'activate_contract'];

export default function DashboardPage() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const [toolStatusGroups, setToolStatusGroups] = useState<Map<string, ToolStatusGroup>>(new Map());
  const [planningProgress, setPlanningProgress] = useState<{ current: number; total: number; stage: string; detail?: string; subCurrent?: number; subTotal?: number } | null>(null);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const [panelTab, setPanelTab] = useState<'overview' | 'execution' | 'financial' | 'legal' | 'onboard' | 'review'>('overview');
  const [execMessages, setExecMessages] = useState<any[]>([]);
  const [execMsgInput, setExecMsgInput] = useState('');
  const [execMsgLoading, setExecMsgLoading] = useState(false);
  const [execMsgUnread, setExecMsgUnread] = useState(0);
  const [execMsgAttachments, setExecMsgAttachments] = useState<Array<{ url: string; filename: string; mimetype: string; size: number }>>([]);
  const [execMsgUploading, setExecMsgUploading] = useState(false);
  const [sideData, setSideData] = useState<any>(null);
  const [selectedWU, setSelectedWU] = useState<any>(null);
  const [interviewDetail, setInterviewDetail] = useState<any>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [pastedImages, setPastedImages] = useState<{ data: string; name: string }[]>([]); // base64 images
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [contracts, setContracts] = useState<any[]>([]);
  const [expandedContract, setExpandedContract] = useState<any>(null);
  const [editingContractContent, setEditingContractContent] = useState('');

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
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizing = useRef(false);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const streamAbortedRef = useRef(false);
  const isUserLeavingRef = useRef(false);
  const lastStreamingMessageRef = useRef<string>('');

  useEffect(() => { loadConversations(); loadPanel(); }, []);
  
  // Chat continuity: handle window/tab switching
  // Stream continues when switching tabs/windows, only stops when explicitly leaving chat
  useEffect(() => {
    const handleVisibilityChange = () => {
      // When window becomes visible again after switching tabs/windows, streaming continues
      // We don't set isUserLeavingRef here - that's only for explicit chat actions
      if (!document.hidden && streaming && streamReaderRef.current && !isUserLeavingRef.current) {
        // Stream continues automatically - no action needed
        // The reader will keep processing in the background
      }
    };

    const handleBeforeUnload = () => {
      // Only stop stream when actually closing the tab/window
      isUserLeavingRef.current = true;
      if (streamReaderRef.current) {
        streamReaderRef.current.cancel().catch(() => {});
      }
    };

    // Note: visibilitychange fires when switching tabs/windows, but we DON'T stop the stream
    // Only beforeunload (actual page close) stops it
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [streaming]);
  
  // Auto-refresh panel every 60s to catch new applicants (avoid 429s)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) { // Only refresh when tab is visible
        loadPanel();
        if (selectedWU) selectWU(selectedWU.id, false);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [selectedWU]);
  // Smart auto-scroll: only scroll if user is near the bottom
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 200) {
      // Use requestAnimationFrame to avoid layout thrashing during streaming
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [messages]);

  // Real-time message updates via WebSocket
  useMarketplaceEvent(MARKETPLACE_EVENTS.EXECUTION_MESSAGE_NEW, (data: any) => {
    if (!selectedWU) return;
    const activeExec = selectedWU.executions?.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
    if (activeExec && data.executionId === activeExec.id && data.message) {
      const msg = data.message;
      setExecMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Update unread count if message is from student/AI
      if (msg.senderType !== 'company') {
        setExecMsgUnread(prev => prev + 1);
        // Auto-mark as read if messages tab is open
        if (panelTab === 'review') {
          getToken().then(token => {
            if (token && activeExec) {
              fetch(`${API_URL}/api/executions/${activeExec.id}/messages/read-all`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => {});
            }
          });
        }
      }
    }
  }, [selectedWU, panelTab]);

  // Subscribe to execution room when messages tab is opened
  useEffect(() => {
    if (panelTab === 'review' && selectedWU) {
      const activeExec = selectedWU.executions?.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
      if (activeExec && marketplaceSocket.isConnected()) {
        // Subscribe to execution room for real-time updates
        (marketplaceSocket as any).socket?.emit('subscribe:execution', activeExec.id);
        return () => {
          (marketplaceSocket as any).socket?.emit('unsubscribe:execution', activeExec.id);
        };
      }
    }
  }, [panelTab, selectedWU]);

  // ── Data loading ──

  async function loadConversations() {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/agent/conversations`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) { const d = await r.json(); setConversations(d.conversations || []); }
    } catch {}
  }

  async function loadConversation(id: string) {
    // Mark that user is switching conversations (explicit action)
    isUserLeavingRef.current = true;
    // Abort any active stream
    if (streamReaderRef.current) {
      streamReaderRef.current.cancel().catch(() => {});
      streamReaderRef.current = null;
    }
    setStreaming(false);
    
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
    setToolStatusGroups(new Map());
    setPlanningProgress(null);
    isUserLeavingRef.current = false; // Reset for loaded conversation
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

  async function selectWU(id: string, resetTab = true) {
    try {
      const t = await getToken(); if (!t) return;
      const r = await fetch(`${API_URL}/api/workunits/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) {
        const d = await r.json();
        setSelectedWU(d);
        if (resetTab) { setPanelTab('overview'); setPendingChanges({}); }
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
      await selectWU(selectedWU.id, false);
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
      if (selectedWU) selectWU(selectedWU.id, false);
    } catch {}
  }

  async function approveApp(execId: string) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/executions/${execId}/approve-application`, {
        method: 'POST', headers: { Authorization: `Bearer ${t}` },
      });
      if (selectedWU) selectWU(selectedWU.id, false);
    } catch {}
  }

  async function rejectApp(execId: string) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/executions/${execId}/reject`, {
        method: 'POST', headers: { Authorization: `Bearer ${t}` },
      });
      if (selectedWU) selectWU(selectedWU.id, false);
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
      await selectWU(selectedWU.id, false);
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

  async function loadContract(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      // Load full contract content via the agent contracts endpoint
      const res = await fetch(`${API_URL}/api/agent/contracts`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        const contract = (data.contracts || []).find((c: any) => c.id === id);
        if (contract) {
          setExpandedContract(contract);
          setEditingContractContent(contract.content || '');
        }
      }
    } catch {}
  }

  async function saveContract() {
    if (!expandedContract) return;
    try {
      const t = await getToken(); if (!t) return;
      // Use the agent chat to update — or call the API directly
      // For now, update via Prisma through a simple fetch
      await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `__internal: update contract ${expandedContract.id} with new content`,
        }),
      }).catch(() => null);
      // Simpler: use the update_contract tool logic via direct DB update
      // Actually let's add a proper endpoint
    } catch {}
  }

  async function deleteContractDirect(id: string) {
    try {
      const t = await getToken(); if (!t) return;
      // First try to delete
      let res = await fetch(`${API_URL}/api/agent/contracts/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${t}` },
      });
      // If it's active, archive first then delete
      if (res.status === 400) {
        await fetch(`${API_URL}/api/agent/contracts/${id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'archived' }),
        });
        res = await fetch(`${API_URL}/api/agent/contracts/${id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${t}` },
        });
      }
      setExpandedContract(null);
      loadContracts();
    } catch {}
  }

  async function updateContractDirect(id: string, data: { content?: string; title?: string; status?: string }) {
    try {
      const t = await getToken(); if (!t) return;
      await fetch(`${API_URL}/api/agent/contracts/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      loadContracts();
      if (expandedContract?.id === id) {
        setExpandedContract((prev: any) => prev ? { ...prev, ...data } : null);
      }
    } catch {}
  }

  async function loadExecMessages() {
    if (!selectedWU) return;
    const activeExec = selectedWU.executions?.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
    if (!activeExec) return;
    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/executions/${activeExec.id}/messages`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setExecMessages(data.messages || []);
        setExecMsgUnread(data.unreadCount || 0);
        // Mark as read
        if (data.unreadCount > 0) {
          fetch(`${API_URL}/api/executions/${activeExec.id}/messages/read-all`, {
            method: 'POST', headers: { Authorization: `Bearer ${t}` },
          }).catch(() => {});
        }
      }
    } catch {}
  }

  async function loadContracts() {
    try {
      const t = await getToken(); if (!t) return;
      // Always load ALL contracts — filter client-side for the selected WU
      const res = await fetch(`${API_URL}/api/agent/contracts`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        const all = data.contracts || [];
        if (selectedWU) {
          // Show contracts scoped to this WU (slug contains wu-{id prefix}) + unscoped contracts
          const wuPrefix = `wu-${selectedWU.id.slice(0, 8)}`;
          const filtered = all.filter((c: any) => c.slug?.startsWith(wuPrefix) || !c.slug?.startsWith('wu-'));
          setContracts(filtered);
        } else {
          setContracts(all);
        }
      }
    } catch {}
  }

  // ── Chat ──

  function startNew() { 
    // Mark that user is explicitly leaving the current chat
    isUserLeavingRef.current = true;
    // Abort any active stream
    if (streamReaderRef.current) {
      streamReaderRef.current.cancel().catch(() => {});
      streamReaderRef.current = null;
    }
    setConversationId(null); 
    setMessages([]); 
    setShowConvList(false); 
    setToolStatusGroups(new Map());
    setPlanningProgress(null);
    setStreaming(false);
    streamAbortedRef.current = false;
    isUserLeavingRef.current = false; // Reset for new chat
    inputRef.current?.focus(); 
  }

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

    // Add pasted images as base64 for GPT-4o vision
    if (pastedImages.length > 0) {
      for (const img of pastedImages) {
        fullMessage += `\n\n[IMAGE: ${img.name} — analyze this image and describe what you see]`;
      }
    }

    // Inject currently selected work unit context so agent knows which WU to operate on
    if (selectedWU) {
      fullMessage += `\n\n[CONTEXT: Currently viewing work unit "${selectedWU.title}" (ID: ${selectedWU.id}). Any contracts, onboarding, or edits should apply to THIS work unit only, not other work units.]`;
    }

    const hasAttachments = attachedFiles.length > 0 || pastedImages.length > 0;
    const displayMsg = hasAttachments
      ? `${text}\n${attachedFiles.map(f => `📎 ${f.name}`).join('\n')}${pastedImages.map(img => `🖼 ${img.name}`).join('\n')}`
      : text;

    // Build the message payload — include images for GPT-5.2 vision
    // Filter out any oversized images (>500KB base64)
    const imagePayloads = pastedImages.map(img => img.data).filter(d => d.length < 500000);

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: displayMsg };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachedFiles([]);
    setPastedImages([]);
    setSuggestions([]);
    setStreaming(true);
    streamAbortedRef.current = false;
    isUserLeavingRef.current = false;
    const aId = `a-${Date.now()}`;
    setMessages(prev => [...prev, { id: aId, role: 'assistant', content: '' }]);

    try {
      const t = await getToken(); if (!t) return;
      const res = await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: fullMessage, images: imagePayloads.length > 0 ? imagePayloads : undefined }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      
      // Store reader reference for continuity
      streamReaderRef.current = reader;
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        // Check if user explicitly left
        if (isUserLeavingRef.current) {
          reader.cancel().catch(() => {});
          break;
        }
        
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
            } else if (ev.type === 'thinking_start') {
              // Insert thinking message BEFORE the assistant message so it renders above
              const thinkingId = `think-${Date.now()}`;
              // Auto-expand while actively thinking
              setExpandedThinking(prev => new Set(prev).add(thinkingId));
              setMessages(prev => {
                const assistantIdx = prev.findIndex(m => m.id === aId);
                const thinkMsg: Message = { id: thinkingId, role: 'thinking', content: '', statusLabel: 'Thinking...', toolName: 'thinking' };
                if (assistantIdx >= 0) {
                  const copy = [...prev];
                  copy.splice(assistantIdx, 0, thinkMsg);
                  return copy;
                }
                return [...prev, thinkMsg];
              });
            } else if (ev.type === 'thinking') {
              // Stream thinking content into the thinking message
              setMessages(prev => {
                for (let i = prev.length - 1; i >= 0; i--) {
                  if (prev[i].role === 'thinking') {
                    const copy = [...prev];
                    copy[i] = { ...copy[i], content: (copy[i].content || '') + ev.content };
                    return copy;
                  }
                }
                return [...prev, { id: `think-${Date.now()}`, role: 'thinking', content: ev.content, toolName: 'thinking' }];
              });
            } else if (ev.type === 'plan_tasks') {
              // Planner created a task checklist — attach to the thinking message
              const tasks: PlanTask[] = (ev.tasks || []).map((t: any) => ({ ...t, done: false }));
              setMessages(prev => {
                for (let i = prev.length - 1; i >= 0; i--) {
                  if (prev[i].role === 'thinking') {
                    const copy = [...prev];
                    copy[i] = { ...copy[i], planTasks: tasks };
                    return copy;
                  }
                }
                return prev;
              });
            } else if (ev.type === 'plan_task_complete') {
              // Executor completed a checklist item — check it off
              const taskId = ev.taskId;
              setMessages(prev => prev.map(m => {
                if (m.role === 'thinking' && m.planTasks) {
                  return { ...m, planTasks: m.planTasks.map(t => t.id === taskId ? { ...t, done: true } : t) };
                }
                return m;
              }));
            } else if (ev.type === 'thinking_end') {
              // Thinking complete — keep expanded if there are tasks, update label
              setMessages(prev => prev.map(m => m.role === 'thinking' && !m.statusPhase ? { ...m, statusPhase: 'done', statusLabel: m.planTasks?.length ? 'Plan' : 'Thought process' } : m));
              // Don't collapse if there are plan tasks (user wants to see progress)
              setMessages(prev => {
                const hasActiveTasks = prev.some(m => m.role === 'thinking' && m.planTasks?.some(t => !t.done));
                if (!hasActiveTasks) setExpandedThinking(new Set());
                return prev;
              });
            } else if (ev.type === 'planning_progress') {
              // Granular progress from within planning tools (e.g., which contract is being drafted)
              setPlanningProgress(prev => {
                const base = prev || { current: 1, total: 5, stage: ev.stage };
                return {
                  ...base,
                  stage: ev.stage || base.stage,
                  detail: ev.detail,
                  subCurrent: ev.current,
                  subTotal: ev.total,
                };
              });
            } else if (ev.type === 'tool_status') {
              // Track planning progress first (exclude from toolStatusGroups)
              const planningTools = ['plan_analyze', 'plan_decompose', 'plan_price', 'plan_legal', 'plan_execute'];
              const isPlanningTool = planningTools.includes(ev.name);
              
              if (isPlanningTool) {
                const stageNames: Record<string, string> = {
                  plan_analyze: 'Analyzing',
                  plan_decompose: 'Designing',
                  plan_price: 'Pricing',
                  plan_legal: 'Legal',
                  plan_execute: 'Executing',
                };
                const stageIndex = planningTools.indexOf(ev.name);
                if (ev.phase === 'start') {
                  setPlanningProgress({ current: stageIndex + 1, total: planningTools.length, stage: stageNames[ev.name] });
                } else if (ev.phase === 'done') {
                  if (stageIndex === planningTools.length - 1) {
                    // Last stage done, clear after delay
                    setTimeout(() => setPlanningProgress(null), 2000);
                  } else {
                    // Intermediate stage done — show as completed, update label to "Done"
                    setPlanningProgress(prev => prev ? { ...prev, stage: `${stageNames[ev.name]} ✓` } : null);
                  }
                }
              } else {
                // Group repeated tool calls instead of showing each one (excluding planning tools)
                setToolStatusGroups(prev => {
                  const newMap = new Map(prev);
                  const key = ev.name;
                  const existing = newMap.get(key);
                  
                  if (ev.phase === 'start') {
                    if (existing) {
                      // Increment count for repeated tool calls
                      newMap.set(key, {
                        ...existing,
                        count: existing.count + 1,
                        phase: 'start',
                        lastUpdate: Date.now(),
                      });
                    } else {
                      // New tool call
                      newMap.set(key, {
                        toolName: ev.name,
                        label: ev.label,
                        count: 1,
                        phase: 'start',
                        lastUpdate: Date.now(),
                      });
                    }
                  } else if (ev.phase === 'done') {
                    if (existing) {
                      // Mark as done but keep count
                      newMap.set(key, {
                        ...existing,
                        phase: 'done',
                        lastUpdate: Date.now(),
                      });
                      // Auto-remove after 2 seconds
                      setTimeout(() => {
                        setToolStatusGroups(prev2 => {
                          const nextMap = new Map(prev2);
                          nextMap.delete(key);
                          return nextMap;
                        });
                      }, 2000);
                    }
                  }
                  
                  return newMap;
                });
              }

            } else if (ev.type === 'tool' && ev.status === 'done' && ev.result) {
              setMessages(prev => [...prev, { id: `t-${Date.now()}-${Math.random()}`, role: 'tool', content: null, toolName: ev.name, toolResult: ev.result }]);
              // Live-update panel when agent modifies work unit data
              if (ev.name === 'update_work_unit' && selectedWU) {
                selectWU(selectedWU.id, false); // Refresh without resetting tab
              }
              if (ev.name === 'set_onboarding' && selectedWU) {
                loadOnboarding(selectedWU.id); // Refresh onboarding blocks
                if (panelTab !== 'onboard') setPanelTab('onboard'); // Switch to onboard tab to show changes
              }
              if ((ev.name === 'create_contract' || ev.name === 'activate_contract' || ev.name === 'delete_contract') && selectedWU) {
                loadContracts(); // Refresh contract list
                if (panelTab !== 'legal') setPanelTab('legal');
              }
              if (ev.name === 'create_work_unit' || ev.name === 'plan_execute') {
                loadPanel(); // Refresh work unit list after creation or plan execution
              }
              if (ev.name === 'publish_work_unit' || ev.name === 'fund_escrow') {
                if (selectedWU) selectWU(selectedWU.id, false); // Refresh financial data
                loadPanel();
              }
            } else if (ev.type === 'suggestions') {
              setSuggestions(ev.items || []);
            } else if (ev.type === 'done') {
              if (ev.conversationId) setConversationId(ev.conversationId);
              loadConversations();
              loadPanel();
              if (selectedWU) selectWU(selectedWU.id, false);
              // Clear all progress indicators when stream completes
              setPlanningProgress(null);
              setToolStatusGroups(new Map());
            } else if (ev.type === 'error') {
              setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: ev.message || 'Error occurred.' } : m));
              // Clear progress indicators on error too
              setPlanningProgress(null);
              setToolStatusGroups(new Map());
            }
          } catch {}
        }
      }
      
      // Clear reader reference when stream completes normally
      streamReaderRef.current = null;
    } catch (err: any) {
      // Only show error if user didn't explicitly leave
      if (!isUserLeavingRef.current) {
        setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: 'Connection lost.' } : m));
      }
      streamReaderRef.current = null;
    } finally { 
      setStreaming(false);
      streamReaderRef.current = null;
      // Always clear progress indicators when stream ends
      setPlanningProgress(null);
      setToolStatusGroups(new Map());
    }
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

  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="flex h-[calc(100vh-48px)] relative">
      {/* ── Chat ── */}
      <div className={`flex-1 flex flex-col min-w-0 ${isMobile && panelOpen ? 'hidden' : ''}`}>
        {/* Action indicators header - tool status groups and planning progress */}
        {(toolStatusGroups.size > 0 || planningProgress) && (
          <div className="h-auto min-h-[36px] px-3 md:px-4 py-1.5 border-b border-slate-200/30 bg-slate-50/50 flex items-center gap-2 flex-wrap">
            {/* Planning progress bar */}
            {planningProgress && (
              <div className="flex items-center gap-2 px-2 py-1 bg-violet-50 rounded border border-violet-200 max-w-[420px]">
                <Loader2 className="w-3 h-3 animate-spin text-violet-600 flex-shrink-0" />
                <div className="flex-1 min-w-[140px]">
                  <div className="flex items-center justify-between text-[10px] text-violet-700 mb-0.5">
                    <span className="font-medium">{planningProgress.stage}</span>
                    <span>{planningProgress.current}/{planningProgress.total}</span>
                  </div>
                  {/* Sub-progress bar */}
                  {planningProgress.subTotal && planningProgress.subTotal > 0 ? (
                    <div className="h-1 bg-violet-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-violet-500 transition-all duration-300"
                        style={{ width: `${(planningProgress.subCurrent! / planningProgress.subTotal) * 100}%` }}
                      />
                    </div>
                  ) : (
                    <div className="h-1 bg-violet-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-violet-500 transition-all duration-300"
                        style={{ width: `${(planningProgress.current / planningProgress.total) * 100}%` }}
                      />
                    </div>
                  )}
                  {/* Detail text */}
                  {planningProgress.detail && (
                    <p className="text-[9px] text-violet-500 mt-0.5 truncate">{planningProgress.detail}</p>
                  )}
                </div>
              </div>
            )}
            {/* Grouped tool status indicators */}
            {Array.from(toolStatusGroups.values()).map(group => (
              <ToolStatusCompact key={group.toolName} group={group} />
            ))}
          </div>
        )}
        {/* Conv switcher */}
        <div className="h-9 flex items-center justify-between px-3 md:px-4 border-b border-slate-200/30 flex-shrink-0 relative">
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
            <button onClick={() => { setPanelOpen(true); loadPanel(); }}
              className="text-[11px] text-slate-400 hover:text-slate-700 md:text-[11px] flex items-center gap-1">
              <GripVertical className="w-3 h-3 md:hidden" />
              <span className="hidden md:inline">panel</span>
              <span className="md:hidden text-xs">Tasks</span>
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3 md:px-6 py-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md space-y-4">
                <p className="text-slate-400 text-sm text-center">What do you need done?</p>
                {['Plan a project — describe what you need and I\'ll design the full execution plan',
                  'Create a task for content writing, $30, 24h deadline',
                  'Show my active tasks',
                  'How much have I spent this month?',
                  'Set up a screening interview',
                ].map((s, i) => (
                  <button key={i} onClick={() => setInput(s)} className="block w-full text-left px-3 py-2 text-sm text-slate-500 hover:text-slate-800 hover:bg-white rounded-lg transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, idx) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="bg-white rounded-xl rounded-br-sm px-3.5 py-2.5 max-w-[70%] shadow-sm">
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                }
                if (msg.role === 'status') return null; // Status indicators moved to header
                if (msg.role === 'tool') return null; // tool results are hidden — agent synthesizes them
                
                // Thinking/Plan messages — collapsible block with optional checklist
                if (msg.role === 'thinking') {
                  const isExpanded = expandedThinking.has(msg.id);
                  const isDone = msg.statusPhase === 'done';
                  const isActiveThinking = streaming && !isDone;
                  const hasTasks = !!(msg.planTasks && msg.planTasks.length > 0);
                  const completedCount = msg.planTasks?.filter(t => t.done).length || 0;
                  const totalCount = msg.planTasks?.length || 0;
                  const hasContent = !!(msg.content && msg.content.length > 0);
                  
                  // Label: "Thinking..." while active, "Plan (3/7)" with tasks, "Thought process" otherwise
                  const label = isActiveThinking && !hasTasks
                    ? 'Thinking...'
                    : hasTasks
                      ? `Plan${isDone ? '' : ` (${completedCount}/${totalCount})`}`
                      : (msg.statusLabel || 'Thought process');

                  return (
                    <div key={msg.id} className="pl-0.5 mb-1">
                      <button
                        onClick={() => setExpandedThinking(prev => {
                          const next = new Set(prev);
                          if (next.has(msg.id)) next.delete(msg.id);
                          else next.add(msg.id);
                          return next;
                        })}
                        className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-500 transition-colors select-none"
                      >
                        <span className={`inline-block transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} style={{ fontSize: '8px' }}>&#9654;</span>
                        <span>{label}</span>
                        {isActiveThinking && <span className="inline-block w-1 h-2.5 bg-slate-300 ml-0.5 animate-pulse rounded-sm" />}
                      </button>
                      {isExpanded && (
                        <div className="mt-1 ml-3 pl-2 border-l border-slate-200/60">
                          {/* Brief reasoning text */}
                          {hasContent && (
                            <p className="text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed font-mono mb-1.5">
                              {msg.content}
                            </p>
                          )}
                          {/* Task checklist */}
                          {hasTasks && (
                            <div className="space-y-0.5">
                              {msg.planTasks!.map(task => (
                                <div key={task.id} className="flex items-start gap-1.5 text-[11px]">
                                  <span className={`mt-px flex-shrink-0 ${task.done ? 'text-emerald-500' : 'text-slate-300'}`}>
                                    {task.done ? '\u2713' : '\u25CB'}
                                  </span>
                                  <span className={task.done ? 'text-slate-400 line-through' : 'text-slate-500'}>
                                    {task.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Loading state */}
                          {!hasContent && !hasTasks && isActiveThinking && (
                            <p className="text-[11px] text-slate-300 font-mono animate-pulse">...</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                
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
        <div className="px-3 md:px-6 py-3 border-t border-slate-200/40 flex-shrink-0">
          {/* Floating suggestions */}
          {suggestions.length > 0 && messages.length > 0 && !streaming && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => setInput(s)}
                  className="px-2.5 py-1 text-[11px] text-violet-600/80 bg-violet-50/60 hover:bg-violet-100/80 rounded-full border border-violet-200/50 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* Attached files + pasted images preview */}
          {(attachedFiles.length > 0 || pastedImages.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((f, i) => (
                <span key={`f-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-50 rounded text-[10px] text-slate-500">
                  <FileText className="w-2.5 h-2.5" />
                  {f.name.slice(0, 20)}{f.name.length > 20 ? '...' : ''}
                  <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-slate-500 ml-0.5">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              {pastedImages.map((img, i) => (
                <span key={`img-${i}`} className="inline-flex items-center gap-1 px-1 py-0.5 bg-slate-50 rounded">
                  <img src={img.data} alt="" className="h-6 w-6 rounded object-cover" />
                  <span className="text-[10px] text-slate-500">image</span>
                  <button onClick={() => setPastedImages(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-slate-500 ml-0.5">
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
              onPaste={e => {
                const items = Array.from(e.clipboardData?.items || []);
                for (const item of items) {
                  if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) continue;
                    // Compress image to max 800px and JPEG quality 0.7 to prevent oversized payloads
                    const img = new window.Image();
                    img.onload = () => {
                      const canvas = document.createElement('canvas');
                      const maxDim = 800;
                      let w = img.width, h = img.height;
                      if (w > maxDim || h > maxDim) {
                        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
                        else { w = Math.round(w * maxDim / h); h = maxDim; }
                      }
                      canvas.width = w; canvas.height = h;
                      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
                      const compressed = canvas.toDataURL('image/jpeg', 0.7);
                      setPastedImages(prev => [...prev, { data: compressed, name: `pasted-${Date.now()}.jpg` }]);
                      URL.revokeObjectURL(img.src);
                    };
                    img.src = URL.createObjectURL(file);
                  }
                }
              }}
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

      {/* ── Resize handle (desktop only) ── */}
      {panelOpen && !isMobile && (
        <div onMouseDown={onMouseDown} className="w-1 cursor-col-resize bg-transparent hover:bg-slate-200 transition-colors flex-shrink-0" />
      )}

      {/* ── Panel ── */}
      {panelOpen && (
        <div
          style={isMobile ? undefined : { width: panelWidth }}
          className={`${isMobile ? 'absolute inset-0 z-30' : 'border-l border-slate-200/50'} bg-gradient-to-b from-white/95 via-white/90 to-violet-50/30 flex flex-col flex-shrink-0 overflow-hidden`}
        >
          <div className="h-10 flex items-center justify-between px-4 border-b border-slate-100 flex-shrink-0">
            <span className="text-xs font-medium text-slate-700 truncate">{selectedWU ? selectedWU.title : 'Work units'}</span>
            <div className="flex items-center gap-2">
              {isMobile && (
                <button onClick={() => setPanelOpen(false)} className="text-xs text-violet-500 hover:text-violet-700">← Chat</button>
              )}
              <button onClick={() => setPanelOpen(false)} className="text-slate-300 hover:text-slate-500"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          {/* Tabs */}
          {selectedWU && (
            <div className="px-4 pt-2 flex gap-3 border-b border-slate-100 flex-shrink-0 overflow-x-auto">
              {['overview', 'execution', 'financial', 'legal', 'onboard', 'review'].map(tab => (
                <button key={tab} onClick={() => { setPanelTab(tab as any); if (tab === 'legal') loadContracts(); if (tab === 'review') loadExecMessages(); }}
                  className={`pb-2 text-xs capitalize whitespace-nowrap ${panelTab === tab ? 'text-slate-900 border-b-2 border-violet-400' : 'text-slate-400 hover:text-slate-600'}`}>
                  {tab === 'review' && execMsgUnread > 0 ? <>{tab} <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white rounded-full text-[10px]">{execMsgUnread}</span></> : tab}
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
                  <div className="space-y-4">
                    {/* ── Progress card ── */}
                    {(() => {
                      const execs = selectedWU.executions || [];
                      const deliverableCount = selectedWU.deliverableCount || Math.max(execs.length, 1);
                      const completed = execs.filter((e: any) => e.status === 'approved').length;
                      const submitted = execs.filter((e: any) => e.status === 'submitted').length;
                      const active = execs.filter((e: any) => ['assigned', 'clocked_in'].includes(e.status)).length;
                      const revisions = execs.filter((e: any) => e.status === 'revision_needed').length;
                      const nearestDeadline = execs
                        .filter((e: any) => e.deadlineAt && ['assigned', 'clocked_in'].includes(e.status))
                        .sort((a: any, b: any) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime())[0];
                      const hoursLeft = nearestDeadline ? Math.round((new Date(nearestDeadline.deadlineAt).getTime() - Date.now()) / 3600000) : null;
                      const progress = deliverableCount > 0 ? Math.round((completed / deliverableCount) * 100) : 0;

                      return (
                        <div className="rounded-lg bg-slate-50/80 p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-slate-700">{completed}/{deliverableCount} delivered</span>
                            <span className="text-[11px] text-slate-400">{progress}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all" style={{ width: `${Math.max(progress, 2)}%` }} />
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                            {active > 0 && <span>{active} active</span>}
                            {submitted > 0 && <span>{submitted} review</span>}
                            {revisions > 0 && <span className="text-amber-600">{revisions} revision</span>}
                            {hoursLeft !== null && (
                              <span className={hoursLeft < 0 ? 'text-red-500' : ''}>
                                {hoursLeft > 0 ? `${hoursLeft}h left` : `${Math.abs(hoursLeft)}h overdue`}
                              </span>
                            )}
                            {execs.length === 0 && <span>No work started</span>}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Title & Status ── */}
                    <Row label="Title" value={getVal('title', selectedWU.title)} onChange={v => stageChange('title', v)} />
                    <SelectRow label="Status" value={getVal('status', selectedWU.status)} options={['draft', 'active', 'paused', 'cancelled']} onChange={v => stageChange('status', v)} />

                    {/* ── Pricing & Timeline ── */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-slate-100">
                      <Row label="Price ($)" value={`${((getVal('priceInCents', selectedWU.priceInCents)) / 100)}`} onChange={v => { const n = parseFloat(v); if (!isNaN(n)) stageChange('priceInCents', Math.round(n * 100)); }} />
                      <Row label="Deadline (h)" value={`${getVal('deadlineHours', selectedWU.deadlineHours)}`} onChange={v => { const n = parseInt(v); if (!isNaN(n)) stageChange('deadlineHours', n); }} />
                      <Row label="Deliverables" value={`${getVal('deliverableCount', selectedWU.deliverableCount || 1)}`} onChange={v => { if (v === '') return; const n = parseInt(v); if (!isNaN(n)) stageChange('deliverableCount', Math.max(1, n)); }} />
                      <Row label="Revisions" value={`${getVal('revisionLimit', selectedWU.revisionLimit)}`} onChange={v => { if (v === '') return; const n = parseInt(v); if (!isNaN(n)) stageChange('revisionLimit', Math.max(0, n)); }} />
                    </div>

                    {/* ── Matching ── */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-2 border-t border-slate-100">
                      <SelectRow label="Tier" value={getVal('minTier', selectedWU.minTier)} options={['novice', 'pro', 'elite']} onChange={v => stageChange('minTier', v)} />
                      <Row label="Complexity" value={`${getVal('complexityScore', selectedWU.complexityScore)}`} onChange={v => { if (v === '') return; const n = parseInt(v); if (!isNaN(n)) stageChange('complexityScore', Math.max(1, Math.min(5, n))); }} />
                      <SelectRow label="Assignment" value={getVal('assignmentMode', selectedWU.assignmentMode || 'auto')} options={['auto', 'manual']} onChange={v => stageChange('assignmentMode', v)} />
                    </div>

                    {/* ── Skills ── */}
                    <div className="pt-2 border-t border-slate-100">
                      <input placeholder="Skills (comma separated)" value={getVal('requiredSkills', selectedWU.requiredSkills)?.join?.(', ') || ''} onChange={e => stageChange('requiredSkills', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        className="w-full text-xs text-slate-700 bg-transparent border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 py-1 placeholder:text-slate-300" />
                    </div>

                    {/* ── Acceptance criteria ── */}
                    {(selectedWU.acceptanceCriteria || []).length > 0 && (
                      <div className="pt-2 border-t border-slate-100">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Acceptance criteria</span>
                        <ul className="mt-1.5 space-y-1">
                          {(selectedWU.acceptanceCriteria || []).map((c: any, i: number) => (
                            <li key={i} className="text-xs text-slate-700 flex items-start gap-1.5">
                              <span className="text-slate-300 mt-px">•</span>{c.criterion}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* ── Spec ── */}
                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Spec</span>
                        <button onClick={() => setPendingChanges(prev => ({ ...prev, _editingSpec: !prev._editingSpec }))} className="text-[10px] text-violet-500 hover:text-violet-700">
                          {pendingChanges._editingSpec ? 'preview' : 'edit'}
                        </button>
                      </div>
                      {pendingChanges._editingSpec ? (
                        <textarea value={getVal('spec', selectedWU.spec)} onChange={e => stageChange('spec', e.target.value)}
                          className="w-full text-xs text-slate-700 bg-slate-50/50 border border-slate-200 rounded-md p-2 focus:ring-1 focus:ring-violet-200 focus:border-violet-300 resize-none" rows={8} />
                      ) : (
                        <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                          {formatText(getVal('spec', selectedWU.spec) || '')}
                        </div>
                      )}
                    </div>

                    {/* ── Schedule & Dependencies ── */}
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Schedule</span>
                      <div>
                        <input
                          type="datetime-local"
                          value={getVal('scheduledPublishAt', selectedWU.scheduledPublishAt ? new Date(selectedWU.scheduledPublishAt).toISOString().slice(0, 16) : '') || ''}
                          onChange={e => stageChange('scheduledPublishAt', e.target.value || null)}
                          className="w-full text-xs text-slate-700 bg-transparent border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 py-1"
                          min={new Date().toISOString().slice(0, 16)}
                        />
                        {(getVal('scheduledPublishAt', selectedWU.scheduledPublishAt)) && (
                          <button onClick={() => stageChange('scheduledPublishAt', null)} className="text-[10px] text-slate-400 hover:text-slate-600 mt-0.5">Clear</button>
                        )}
                      </div>

                      {/* Dependencies this WU depends on */}
                      {selectedWU.publishConditions && (() => {
                        const conds = selectedWU.publishConditions as any;
                        const deps = conds?.dependencies || [];
                        return deps.length > 0 ? (
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">Depends on ({conds.logic})</label>
                            {deps.map((d: any, i: number) => {
                              const depWU = (sideData.workUnits || []).find((w: any) => w.id === d.workUnitId);
                              return (
                                <div key={i} className="text-xs text-slate-600 py-0.5 flex items-center gap-1">
                                  <span className="truncate">{depWU?.title || d.workUnitId?.slice(0, 8) + '…'}</span>
                                  <span className="text-slate-400 text-[10px] flex-shrink-0">{d.condition}</span>
                                </div>
                              );
                            })}
                            {selectedWU.status === 'draft' && (
                              <button onClick={() => stageChange('publishConditions', null)} className="text-[10px] text-slate-400 hover:text-slate-600 mt-1">Clear</button>
                            )}
                          </div>
                        ) : null;
                      })()}

                      {/* Warning: other WUs depend on this one */}
                      {(() => {
                        const dependents = (sideData.workUnits || []).filter((w: any) => {
                          const pc = w.publishConditions as any;
                          if (!pc?.dependencies) return false;
                          return pc.dependencies.some((d: any) => d.workUnitId === selectedWU.id);
                        });
                        if (dependents.length === 0) return null;
                        return (
                          <div className="p-2 bg-slate-50 rounded text-[10px] text-slate-500">
                            <span className="font-medium text-slate-600">{dependents.length} task{dependents.length > 1 ? 's' : ''} depend{dependents.length === 1 ? 's' : ''} on this</span>
                            {dependents.slice(0, 3).map((w: any) => (
                              <div key={w.id} className="truncate mt-0.5">{w.title}</div>
                            ))}
                            {dependents.length > 3 && <div className="mt-0.5">+{dependents.length - 3} more</div>}
                            {['paused', 'cancelled'].includes(getVal('status', selectedWU.status)) && (
                              <div className="mt-1 text-[10px] text-slate-500 font-medium">Changing status may block dependent tasks.</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* ── Contractor Progress ── */}
                    {selectedWU.executions?.length > 0 && (() => {
                      const exec = selectedWU.executions.find((e: any) => !['cancelled', 'failed'].includes(e.status)) || selectedWU.executions[0];
                      if (!exec) return null;
                      return (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Contractor</span>
                          <div className="flex justify-between text-xs"><span className="text-slate-400">Name</span><span className="text-slate-700">{exec.student?.name || 'Assigned'}</span></div>
                          <div className="flex justify-between text-xs"><span className="text-slate-400">Stage</span><span className="text-slate-700 capitalize">{exec.status?.replace(/_/g, ' ')}</span></div>
                          {exec.statusUpdate && (
                            <div className="p-1.5 bg-slate-50 rounded text-[10px] text-slate-600">{exec.statusUpdate}</div>
                          )}
                          {exec.milestones?.length > 0 && (() => {
                            const done = exec.milestones.filter((m: any) => m.completedAt).length;
                            return (
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className="text-slate-400">Milestones</span>
                                <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-slate-400 rounded-full" style={{ width: `${(done / exec.milestones.length) * 100}%` }} />
                                </div>
                                <span className="text-slate-500">{done}/{exec.milestones.length}</span>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}

                    {/* ── Actions ── */}
                    <div className="flex gap-2 pt-3 border-t border-slate-100">
                      {selectedWU.status === 'active' && (
                        <button onClick={() => {
                          const deps = (sideData.workUnits || []).filter((w: any) => {
                            const pc = w.publishConditions as any;
                            return pc?.dependencies?.some((d: any) => d.workUnitId === selectedWU.id);
                          });
                          if (deps.length > 0 && !confirm(`${deps.length} task(s) depend on this one (${deps.map((w: any) => w.title).join(', ')}). Pausing may block them. Continue?`)) return;
                          stageChange('status', 'paused');
                        }}
                          className="flex-1 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 transition-colors">
                          Pause
                        </button>
                      )}
                      {selectedWU.status === 'paused' && (
                        <button onClick={() => stageChange('status', 'active')}
                          className="flex-1 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 transition-colors">
                          Resume
                        </button>
                      )}
                      {selectedWU.status === 'draft' && (
                        <button onClick={fundAndPublish}
                          className="flex-1 py-1.5 text-xs font-medium text-white bg-slate-800 rounded-md hover:bg-slate-900 transition-colors">
                          Publish
                        </button>
                      )}
                      <button onClick={async () => {
                        const deps = (sideData.workUnits || []).filter((w: any) => {
                          const pc = w.publishConditions as any;
                          return pc?.dependencies?.some((d: any) => d.workUnitId === selectedWU.id);
                        });
                        const depWarning = deps.length > 0 ? `\n\n⚠ ${deps.length} task(s) depend on this one and will lose their dependency.` : '';
                        if (!confirm(`Delete "${selectedWU.title}"?${depWarning}`)) return;
                        const t = await getToken(); if (!t) return;
                        await fetch(`${API_URL}/api/workunits/${selectedWU.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
                        setSelectedWU(null);
                        loadPanel();
                      }}
                        className="py-1.5 px-3 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {/* Execution */}
                {panelTab === 'execution' && (
                  <div className="space-y-4">
                    {/* Interview selector */}
                    <div>
                      <select value={selectedWU.infoCollectionTemplateId || ''} onChange={e => {
                        const v = e.target.value || null;
                        stageChange('infoCollectionTemplateId', v);
                        if (v) loadInterview(v); else setInterviewDetail(null);
                      }} className="w-full text-xs text-slate-700 bg-slate-50/80 border border-slate-200 rounded-md focus:border-violet-300 focus:ring-1 focus:ring-violet-200 py-1.5 px-2">
                        <option value="">No screening interview</option>
                        {(sideData.templates || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>

                    {interviewDetail && (
                      <div className="rounded-lg bg-slate-50/80 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <span className="font-medium">{interviewDetail.name}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">{interviewDetail.timeLimitMinutes}min</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">{interviewDetail.questions?.length || 0}q</span>
                        </div>
                        {(interviewDetail.links || []).filter((l: any) => l.isActive).slice(0, 3).map((l: any) => (
                          <div key={l.id} className="flex items-center gap-1.5 bg-white rounded px-2 py-1">
                            <code className="text-[10px] text-slate-500 truncate flex-1">/interview/{l.token}</code>
                            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/interview/${l.token}`); }} className="text-[10px] text-violet-500 hover:text-violet-700 font-medium flex-shrink-0">copy</button>
                          </div>
                        ))}
                        <button onClick={generateLink} className="text-[11px] text-slate-400 hover:text-violet-600 transition-colors">+ new link</button>
                      </div>
                    )}

                    {/* Applicants list */}
                    <div className="pt-1">
                      {selectedWU.executions?.length > 0 ? selectedWU.executions.map((e: any) => {
                        const statusColor: Record<string, string> = {
                          pending_review: 'bg-blue-50 text-blue-600', pending_screening: 'bg-blue-50 text-blue-600',
                          assigned: 'bg-slate-100 text-slate-600', clocked_in: 'bg-emerald-50 text-emerald-600',
                          submitted: 'bg-violet-50 text-violet-600', approved: 'bg-emerald-50 text-emerald-700',
                          revision_needed: 'bg-amber-50 text-amber-600', failed: 'bg-red-50 text-red-500', cancelled: 'bg-slate-100 text-slate-400',
                        };
                        return (
                          <div key={e.id} className="py-2.5 border-b border-slate-100 last:border-0 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">{e.student?.name || 'Unknown'}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor[e.status] || 'bg-slate-100 text-slate-500'}`}>{e.status.replace(/_/g, ' ')}</span>
                                {e.qualityScore != null && <span className="text-[10px] text-slate-400">{e.qualityScore}%</span>}
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                              {['pending_review', 'pending_screening'].includes(e.status) && <>
                                <button onClick={() => approveApp(e.id)} className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium">assign</button>
                                <button onClick={() => rejectApp(e.id)} className="text-[10px] px-2 py-0.5 rounded bg-red-50 text-red-400 hover:bg-red-100 font-medium">reject</button>
                              </>}
                              {e.status === 'submitted' && <>
                                <button onClick={() => reviewExec(e.id, 'approved')} className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium">approve</button>
                                <button onClick={() => reviewExec(e.id, 'revision_needed')} className="text-[10px] px-2 py-0.5 rounded bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium">revise</button>
                                <button onClick={() => reviewExec(e.id, 'failed')} className="text-[10px] px-2 py-0.5 rounded bg-red-50 text-red-400 hover:bg-red-100 font-medium">reject</button>
                              </>}
                              {['assigned', 'clocked_in'].includes(e.status) && (
                                <button onClick={() => rejectApp(e.id)} className="text-[10px] px-2 py-0.5 rounded bg-red-50 text-red-400 hover:bg-red-100 font-medium">cancel</button>
                              )}
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="text-center py-6">
                          <p className="text-xs text-slate-400">No applicants yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Financial */}
                {panelTab === 'financial' && (
                  <div className="space-y-4">
                    {selectedWU.escrow ? (
                      <div className="rounded-lg bg-slate-50/80 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Escrow</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${selectedWU.escrow.status === 'funded' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{selectedWU.escrow.status}</span>
                        </div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Total</span><span className="text-slate-900 font-medium">${(selectedWU.priceInCents / 100).toFixed(2)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Fee ({Math.round((selectedWU.platformFeePercent || 0.15) * 100)}%)</span><span className="text-slate-600">${(selectedWU.escrow.platformFeeInCents / 100).toFixed(2)}</span></div>
                        <div className="flex justify-between text-xs border-t border-slate-200 pt-2"><span className="text-slate-500">Contractor payout</span><span className="text-slate-900 font-medium">${(selectedWU.escrow.netAmountInCents / 100).toFixed(2)}</span></div>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-slate-50/80 p-3 text-center">
                        <p className="text-xs text-slate-400">No escrow created yet</p>
                        <p className="text-[10px] text-slate-300 mt-0.5">Publish to fund escrow</p>
                      </div>
                    )}
                    {selectedWU.escrow && <>
                      {selectedWU.escrow.status === 'pending' && (
                        <button onClick={fundAndPublish} className="w-full py-1.5 text-xs font-medium text-white bg-gradient-to-r from-violet-600 to-indigo-600 rounded-md hover:from-violet-700 hover:to-indigo-700 shadow-sm transition-all">Fund & Publish</button>
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
                    {expandedContract ? (
                      /* Expanded contract view */
                      <div className="space-y-3">
                        <button onClick={() => setExpandedContract(null)} className="text-xs text-slate-500 hover:text-slate-800">← back to contracts</button>
                        <div className="flex justify-between items-start">
                          <div>
                            <input
                              value={expandedContract.title}
                              onChange={e => setExpandedContract((prev: any) => prev ? { ...prev, title: e.target.value } : null)}
                              className="text-sm font-medium text-slate-900 bg-transparent border-0 border-b border-slate-200 focus:border-slate-400 focus:ring-0 w-full py-0.5"
                            />
                            <p className="text-[11px] text-slate-500 mt-1">v{expandedContract.version} · {expandedContract.status} · {expandedContract._count?.signatures || 0} signed</p>
                          </div>
                        </div>
                        <textarea
                          value={editingContractContent}
                          onChange={e => setEditingContractContent(e.target.value)}
                          className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-lg p-3 focus:ring-1 focus:ring-violet-300 focus:border-violet-300 resize-none leading-relaxed"
                          rows={16}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              await updateContractDirect(expandedContract.id, { content: editingContractContent, title: expandedContract.title });
                            }}
                            className="flex-1 py-1.5 text-xs text-white bg-slate-900 rounded hover:bg-slate-800 transition-colors"
                          >
                            Save changes
                          </button>
                          {expandedContract.status === 'draft' && (
                            <button
                              onClick={async () => {
                                await updateContractDirect(expandedContract.id, { status: 'active' });
                              }}
                              className="py-1.5 px-3 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 transition-colors"
                            >
                              Activate
                            </button>
                          )}
                          {expandedContract.status === 'active' && (
                            <button
                              onClick={async () => {
                                await updateContractDirect(expandedContract.id, { status: 'archived' });
                              }}
                              className="py-1.5 px-3 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50 transition-colors"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setInput(`Review and improve this contract: "${expandedContract.title}". Check for legal completeness and suggest improvements.`)}
                            className="flex-1 text-xs text-slate-500 border border-slate-200 rounded py-1.5 hover:bg-white transition-colors flex items-center justify-center gap-1">
                            <Sparkles className="w-3 h-3" /> AI review
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${expandedContract.title}"?`)) deleteContractDirect(expandedContract.id); }}
                            className="py-1.5 px-3 text-xs text-red-400 border border-red-200 rounded hover:bg-red-50 transition-colors">
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Contract list */
                      <>
                        <div>
                          <span className="text-slate-500 text-xs block mb-1.5">Contracts</span>
                          <p className="text-[11px] text-slate-400 mb-2">Click to view and edit. Activate for contractors to sign.</p>
                          {contracts.length > 0 ? contracts.map((c: any) => (
                            <div key={c.id} className="flex items-center group py-2 border-b border-slate-100 last:border-0">
                              <button onClick={() => loadContract(c.id)} className="flex-1 text-left hover:bg-white rounded transition-colors">
                                <p className="text-xs text-slate-800">{c.title}</p>
                                <p className="text-[11px] text-slate-500">v{c.version} · <span className={c.status === 'active' ? 'text-emerald-600' : c.status === 'draft' ? 'text-amber-600' : 'text-slate-400'}>{c.status}</span> · {c._count?.signatures || 0} signed</p>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${c.title}"?`)) deleteContractDirect(c.id); }}
                                className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )) : <p className="text-xs text-slate-400">No contracts yet</p>}
                        </div>

                        <div className="pt-3 border-t border-slate-100 space-y-2">
                      <button onClick={() => setInput(`Create a contractor agreement for "${selectedWU?.title}" (work unit ID: ${selectedWU?.id}) that covers scope of work, deliverables, IP assignment, confidentiality, payment terms, and termination. Attach it to this work unit using the workUnitId.`)}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        create task-specific contract →
                      </button>
                      <button onClick={() => setInput(`Create an NDA for "${selectedWU?.title}" (work unit ID: ${selectedWU?.id}). Attach it to this work unit.`)}
                        className="block text-xs text-slate-600 hover:text-slate-900">
                        create NDA →
                      </button>
                          <button onClick={() => setInput(`Draft a statement of work for "${selectedWU?.title}" — $${((selectedWU?.priceInCents || 0) / 100).toFixed(0)}, ${selectedWU?.deadlineHours}h`)}
                            className="block text-xs text-slate-600 hover:text-slate-900">
                            draft SOW →
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
                      </>
                    )}
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

                {/* Messages Tab */}
                {panelTab === 'review' && (
                  <div className="space-y-3">
                    {/* Milestone Review Section */}
                    {(() => {
                      const activeExec = selectedWU?.executions?.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
                      const milestones = activeExec?.milestones?.filter((m: any) => m.status === 'submitted') || [];
                      if (milestones.length > 0) {
                        return (
                          <div className="mb-4">
                            <p className="text-xs font-medium text-slate-500 mb-2">Submitted milestones</p>
                            <div className="space-y-2">
                              {milestones.map((m: any) => (
                                <div key={m.id} className="bg-slate-50 rounded-lg p-3">
                                  <p className="text-xs text-slate-700 font-medium">{m.template?.description || 'Milestone'}</p>
                                  {m.evidenceUrl && <a href={m.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-violet-500 hover:underline block mt-1">View deliverable</a>}
                                  {m.fileUrls?.length > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{m.fileUrls.length} file(s) attached</p>}
                                  {m.notes && <p className="text-[11px] text-slate-400 mt-1">{m.notes}</p>}
                                  <div className="flex gap-2 mt-2">
                                    <button
                                      onClick={async () => {
                                        const token = await getToken(); if (!token) return;
                                        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/executions/${activeExec.id}/milestones/${m.id}/review`, {
                                          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ verdict: 'approved' }),
                                        });
                                        loadPanel();
                                      }}
                                      className="text-[11px] px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded font-medium hover:bg-emerald-100"
                                    >Approve</button>
                                    <button
                                      onClick={async () => {
                                        const feedback = prompt('Revision feedback:');
                                        if (!feedback) return;
                                        const token = await getToken(); if (!token) return;
                                        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/executions/${activeExec.id}/milestones/${m.id}/review`, {
                                          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ verdict: 'revision_needed', feedback }),
                                        });
                                        loadPanel();
                                      }}
                                      className="text-[11px] px-2.5 py-1 bg-amber-50 text-amber-600 rounded font-medium hover:bg-amber-100"
                                    >Revise</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Messages Section */}
                    {(() => {
                      const activeExec = selectedWU?.executions?.find((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status));
                      if (!activeExec) {
                        return (
                          <div className="py-8 text-center">
                            <p className="text-xs text-slate-400">No active contractor.</p>
                            <p className="text-[11px] text-slate-300 mt-1">Messages and reviews appear when a contractor is assigned.</p>
                          </div>
                        );
                      }
                      return (
                        <div className="flex flex-col" style={{ maxHeight: '500px' }}>
                          <div className="text-xs text-slate-500 mb-2">
                            Chat with <span className="font-medium text-slate-700">{activeExec.student?.name || 'Contractor'}</span>
                          </div>
                          <div className="flex-1 overflow-y-auto space-y-2 mb-3" style={{ maxHeight: '360px' }}>
                            {execMessages.length === 0 && (
                              <p className="text-xs text-slate-400 text-center py-6">No messages yet. Send a message to your contractor.</p>
                            )}
                            {execMessages.map((msg: any, i: number) => {
                              const attachments = msg.attachments && typeof msg.attachments === 'object' && Array.isArray(msg.attachments) ? msg.attachments : [];
                              const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              const isRead = msg.readAt && msg.senderType !== 'company';
                              return (
                                <div key={msg.id || i} className={`flex ${msg.senderType === 'company' ? 'justify-end' : 'justify-start'}`}>
                                  <div className="max-w-[80%]">
                                    {msg.senderType !== 'company' && (
                                      <p className="text-[10px] font-medium mb-0.5 ml-1 text-slate-600">
                                        {msg.senderType === 'ai' ? 'AI' : msg.senderName || 'Contractor'}
                                      </p>
                                    )}
                                    <div className={`rounded-lg px-3 py-2 text-xs ${
                                      msg.senderType === 'company' ? 'bg-violet-500 text-white' :
                                      msg.senderType === 'ai' ? 'bg-slate-50 text-slate-600 border border-slate-100' :
                                      'bg-slate-100 text-slate-800'
                                    }`}>
                                      <p className="whitespace-pre-wrap">{msg.content}</p>
                                      {attachments.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                          {attachments.map((att: any, ai: number) => (
                                            <a key={ai} href={att.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[10px] opacity-80 hover:opacity-100 underline">
                                              <Paperclip className="w-3 h-3" />
                                              <span className="truncate">{att.filename || 'Attachment'}</span>
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <div className={`flex items-center gap-1 text-[10px] mt-0.5 ${msg.senderType === 'company' ? 'justify-end' : 'justify-start'}`}>
                                      <span className="text-slate-400">{time}</span>
                                      {msg.senderType === 'company' && isRead && (
                                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {execMsgAttachments.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {execMsgAttachments.map((att, idx) => (
                                <div key={idx} className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-[10px]">
                                  <Paperclip className="w-3 h-3 text-slate-500" />
                                  <span className="text-slate-700 truncate max-w-[100px]">{att.filename}</span>
                                  <button type="button" onClick={() => setExecMsgAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-slate-600">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          <form onSubmit={async (e) => {
                            e.preventDefault();
                            if ((!execMsgInput.trim() && execMsgAttachments.length === 0) || execMsgLoading || execMsgInput.length > 10000) return;
                            const content = execMsgInput.trim() || '(file attachment)';
                            const attachments = execMsgAttachments;
                            setExecMsgInput('');
                            setExecMsgAttachments([]);
                            setExecMsgLoading(true);
                            try {
                              const token = await getToken();
                              if (!token) return;
                              const res = await fetch(`${API_URL}/api/executions/${activeExec.id}/messages`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content, messageType: 'text', attachments: attachments.length > 0 ? attachments : undefined }),
                              });
                              if (res.ok) {
                                const msg = await res.json();
                                setExecMessages(prev => [...prev, msg]);
                                setExecMsgUnread(0);
                              } else {
                                const err = await res.json().catch(() => ({}));
                                alert(err.message || 'Failed to send message. Please try again.');
                                setExecMsgInput(content === '(file attachment)' ? '' : content);
                                setExecMsgAttachments(attachments);
                              }
                            } catch (err) {
                              console.error('Send message error:', err);
                              alert('Connection error. Please try again.');
                              setExecMsgInput(content === '(file attachment)' ? '' : content);
                              setExecMsgAttachments(attachments);
                            } finally { setExecMsgLoading(false); }
                          }} className="flex gap-2">
                            <input type="file" id="exec-msg-file" className="hidden" multiple onChange={async (e) => {
                              const files = Array.from(e.target.files || []);
                              if (files.length === 0) return;
                              setExecMsgUploading(true);
                              try {
                                const token = await getToken();
                                if (!token) return;
                                const uploads = await Promise.all(files.map(async (file) => {
                                  const formData = new FormData();
                                  formData.append('file', file);
                                  const uploadRes = await fetch(`${API_URL}/api/agent/upload-onboarding-file`, {
                                    method: 'POST',
                                    headers: { Authorization: `Bearer ${token}` },
                                    body: formData,
                                  });
                                  if (uploadRes.ok) {
                                    const data = await uploadRes.json();
                                    return { url: data.url, filename: data.filename || file.name, mimetype: data.mimetype || file.type, size: data.size || file.size };
                                  }
                                  throw new Error('Upload failed');
                                }));
                                setExecMsgAttachments(prev => [...prev, ...uploads]);
                              } catch (err) {
                                alert('Failed to upload file(s). Please try again.');
                              } finally {
                                setExecMsgUploading(false);
                                (e.target as HTMLInputElement).value = '';
                              }
                            }} />
                            <label htmlFor="exec-msg-file" className="px-2 py-1.5 border border-slate-200 rounded text-xs hover:bg-slate-50 cursor-pointer flex items-center">
                              {execMsgUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                            </label>
                            <input
                              value={execMsgInput}
                              onChange={e => {
                                if (e.target.value.length <= 10000) setExecMsgInput(e.target.value);
                              }}
                              maxLength={10000}
                              className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-violet-300"
                              placeholder="Message contractor..."
                            />
                            <button type="submit" disabled={execMsgLoading || (!execMsgInput.trim() && execMsgAttachments.length === 0)}
                              className="px-2.5 py-1.5 bg-violet-500 text-white rounded text-xs hover:bg-violet-600 disabled:opacity-50">
                              Send
                            </button>
                          </form>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Confirm button */}
                {hasChanges && (
                  <div className="pt-3 mt-3 border-t border-slate-100">
                    <button onClick={confirmChanges} disabled={saving}
                      className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-white bg-gradient-to-r from-violet-600 to-indigo-600 rounded hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all">
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
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="text-slate-500 text-xs flex-shrink-0">{label}</span>
      <input value={local} onChange={e => { setLocal(e.target.value); onChange(e.target.value); }}
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
      <span className={`${phase === 'start' ? 'text-violet-500' : 'text-emerald-500'}`}>
        {phase === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      </span>
      <span className={`text-xs ${phase === 'start' ? 'text-violet-600/70' : 'text-slate-400'}`}>
        {label}{phase === 'start' ? '…' : ''}
      </span>
      {phase === 'done' && <span className="text-emerald-500 text-[10px]">✓</span>}
    </div>
  );
}

function ToolStatusCompact({ group }: { group: ToolStatusGroup }) {
  const icon = (() => {
    if (group.toolName === 'web_search' || group.toolName === 'calculate_pricing') return <Globe className="w-3 h-3" />;
    if (group.toolName.includes('list') || group.toolName.includes('get')) return <Search className="w-3 h-3" />;
    if (group.toolName.includes('create') || group.toolName.includes('draft')) return <Sparkles className="w-3 h-3" />;
    if (group.toolName.includes('estimate') || group.toolName.includes('billing') || group.toolName.includes('fund')) return <Calculator className="w-3 h-3" />;
    if (group.toolName.includes('contract') || group.toolName.includes('review')) return <FileCheck className="w-3 h-3" />;
    return <Loader2 className="w-3 h-3" />;
  })();

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-white rounded border border-slate-200 shadow-sm">
      <span className={group.phase === 'start' ? 'text-violet-500' : 'text-emerald-500'}>
        {group.phase === 'start' ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      </span>
      <span className={`text-[10px] ${group.phase === 'start' ? 'text-violet-600/80' : 'text-slate-500'}`}>
        {group.label}
      </span>
      {group.count > 1 && (
        <span className={`text-[10px] font-semibold px-1 py-0.5 rounded ${group.phase === 'start' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {group.count}
        </span>
      )}
      {group.phase === 'done' && <span className="text-emerald-500 text-[10px]">✓</span>}
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
          <OnboardingFileUpload blockId={block.id} onChange={onChange} />
        </div>
      );
    case 'video':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Video URL</label><input type="url" value={block.content.url || ''} onChange={e => onChange(block.id, 'url', e.target.value)} className={inputCls} placeholder="https://youtube.com/..." /></div>
          <div><label className={labelCls}>Title</label><input type="text" value={block.content.title || ''} onChange={e => onChange(block.id, 'title', e.target.value)} className={inputCls} /></div>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-2">
          <div><label className={labelCls}>Image URL</label><input type="url" value={block.content.url || ''} onChange={e => onChange(block.id, 'url', e.target.value)} className={inputCls} placeholder="https://..." /></div>
          <div><label className={labelCls}>Caption</label><input type="text" value={block.content.caption || ''} onChange={e => onChange(block.id, 'caption', e.target.value)} className={inputCls} /></div>
          {block.content.url && <img src={block.content.url} alt="" className="w-full rounded max-h-24 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />}
          <OnboardingFileUpload blockId={block.id} onChange={onChange} isImage />
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
          <p className="text-xs font-bold text-slate-800">{formatText(resolve(block.content.heading))}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{formatText(resolve(block.content.subheading))}</p>
        </div>
      );
    case 'text':
      return (
        <div>
          {block.content.heading && <p className="text-xs font-semibold text-slate-800 mb-0.5">{formatText(block.content.heading)}</p>}
          <p className="text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">{formatText(block.content.body)}</p>
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
          {block.content.heading && <p className="text-xs font-semibold text-slate-800 mb-1">{formatText(block.content.heading)}</p>}
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
          <p className="text-xs font-semibold text-slate-800">{formatText(block.content.heading)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">{formatText(block.content.body)}</p>
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

function OnboardingFileUpload({ blockId, onChange, isImage }: { blockId: string; onChange: (id: string, key: string, value: any) => void; isImage?: boolean }) {
  const { getToken } = useAuth();
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/api/agent/upload-onboarding-file`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          onChange(blockId, 'url', data.url);
          if (!isImage) onChange(blockId, 'filename', data.filename || file.name);
        }
      }
    } catch {}
    setUploading(false);
    e.target.value = '';
  }

  return (
    <label className="inline-flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 cursor-pointer">
      <Paperclip className="w-3 h-3" />
      {uploading ? 'Uploading...' : isImage ? 'Upload image' : 'Upload file'}
      <input type="file" className="hidden" accept={isImage ? 'image/*' : '*'} onChange={handleUpload} />
    </label>
  );
}
