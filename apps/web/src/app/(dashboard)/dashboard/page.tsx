'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Send, Plus, ChevronDown, PanelRight, X } from 'lucide-react';

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

export default function DashboardPage() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showConversations, setShowConversations] = useState(false);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [sideData, setSideData] = useState<any>(null);
  const [selectedWorkUnit, setSelectedWorkUnit] = useState<any>(null);
  const [sidePanelTab, setSidePanelTab] = useState<'overview' | 'execution' | 'financial'>('overview');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadConversations() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/agent/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {}
  }

  async function loadConversation(id: string) {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/agent/conversations/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversationId(data.id);
        setMessages(
          (data.messages || []).map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolName: m.toolCalls?.[0]?.function?.name,
            toolResult: m.toolResults?.content,
          }))
        );
      }
    } catch {}
    setShowConversations(false);
  }

  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setShowConversations(false);
    inputRef.current?.focus();
  }

  async function deleteConversation(id: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/api/agent/conversations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (conversationId === id) startNewConversation();
      loadConversations();
    } catch {}
  }

  async function loadSidePanel() {
    try {
      const token = await getToken();
      if (!token) return;

      const [wuRes, billingRes] = await Promise.all([
        fetch(`${API_URL}/api/workunits`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : []),
        fetch(`${API_URL}/api/payments/company/balance`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
      ]);

      setSideData({
        workUnits: Array.isArray(wuRes) ? wuRes : [],
        billing: billingRes,
      });
    } catch {}
  }

  async function selectWorkUnit(id: string) {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_URL}/api/workunits/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setSelectedWorkUnit(data);
        setSidePanelTab('overview');
      }
    } catch {}
  }

  async function updateWorkUnitField(field: string, value: any) {
    if (!selectedWorkUnit) return;
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/api/workunits/${selectedWorkUnit.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      setSelectedWorkUnit((prev: any) => prev ? { ...prev, [field]: value } : null);
    } catch {}
  }

  async function reviewFromPanel(executionId: string, verdict: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/api/executions/${executionId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (selectedWorkUnit) selectWorkUnit(selectedWorkUnit.id);
    } catch {}
  }

  async function fundEscrowFromPanel() {
    if (!selectedWorkUnit) return;
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/api/workunits/${selectedWorkUnit.id}/fund-escrow`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      selectWorkUnit(selectedWorkUnit.id);
    } catch {}
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId, message: text }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'text') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: (m.content || '') + event.content } : m
                )
              );
            } else if (event.type === 'tool') {
              if (event.status === 'done' && event.result) {
                setMessages(prev => [
                  ...prev,
                  {
                    id: `t-${Date.now()}-${Math.random()}`,
                    role: 'tool',
                    content: null,
                    toolName: event.name,
                    toolResult: event.result,
                  },
                ]);
              }
            } else if (event.type === 'done') {
              if (event.conversationId) {
                setConversationId(event.conversationId);
              }
              loadConversations();
              if (showSidePanel) {
                loadSidePanel();
                // Also refresh selected work unit if one is open
                if (selectedWorkUnit) selectWorkUnit(selectedWorkUnit.id);
              }
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: err?.message?.includes('Failed to fetch') ? 'Connection lost. Check if the server is running.' : 'Something went wrong. Try again.' }
            : m
        )
      );
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col h-[calc(100vh-48px)]">
        {/* Chat header — conversation switcher */}
        <div className="h-10 border-b border-slate-50 flex items-center justify-between px-5 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowConversations(!showConversations)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900"
            >
              {conversationId ? (conversations.find(c => c.id === conversationId)?.title || 'Conversation') : 'New conversation'}
              <ChevronDown className="w-3 h-3" />
            </button>

            {showConversations && (
              <div className="absolute top-7 left-0 w-72 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto">
                <button
                  onClick={startNewConversation}
                  className="w-full text-left px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Plus className="w-3 h-3" />
                  New conversation
                </button>
                {conversations.map(c => (
                  <div key={c.id} className="flex items-center group">
                    <button
                      onClick={() => loadConversation(c.id)}
                      className={`flex-1 text-left px-3 py-2 text-xs hover:bg-slate-50 truncate ${
                        c.id === conversationId ? 'text-slate-900' : 'text-slate-500'
                      }`}
                    >
                      {c.title || 'Untitled'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                      className="px-2 py-2 text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { setShowSidePanel(!showSidePanel); if (!showSidePanel) loadSidePanel(); }}
            className="text-slate-400 hover:text-slate-600"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md space-y-6">
                <p className="text-slate-400 text-sm text-center">
                  What do you need done?
                </p>
                <div className="space-y-2">
                  {[
                    'Create a new task for UGC content creation',
                    'Show me what tasks are active',
                    'How much have I spent this month?',
                    'Set up a screening interview for writers',
                    'Review pending submissions',
                  ].map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(suggestion); }}
                      className="block w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map(msg => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-slate-100 rounded-2xl rounded-br-md px-4 py-2.5 max-w-md">
                      <p className="text-sm text-slate-900 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                );
              }

              if (msg.role === 'tool') {
                return (
                  <div key={msg.id} className="pl-1">
                    <p className="text-xs text-slate-400 whitespace-pre-wrap">
                      {msg.toolResult}
                    </p>
                  </div>
                );
              }

              // assistant
              return (
                <div key={msg.id} className="pl-1">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                    {streaming && messages[messages.length - 1]?.id === msg.id && (
                      <span className="inline-block w-1.5 h-4 bg-slate-300 ml-0.5 animate-pulse" />
                    )}
                  </p>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 px-5 py-3 flex-shrink-0">
          <div className="max-w-2xl mx-auto flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              className="flex-1 resize-none text-sm text-slate-900 placeholder:text-slate-400 border-0 border-b border-slate-200 focus:border-slate-900 focus:ring-0 bg-transparent py-2 outline-none transition-colors"
              placeholder="What do you need done?"
              disabled={streaming}
            />
            <button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              className="p-2 text-slate-400 hover:text-slate-900 disabled:text-slate-200 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Side panel — work unit detail viewer */}
      {showSidePanel && (
        <div className="w-96 border-l border-slate-100 h-[calc(100vh-48px)] flex flex-col flex-shrink-0">
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-50">
            <span className="text-xs text-slate-400">
              {selectedWorkUnit ? selectedWorkUnit.title : 'Status'}
            </span>
            <button onClick={() => setShowSidePanel(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tab buttons */}
          {selectedWorkUnit && (
            <div className="px-4 pt-2 flex gap-4 border-b border-slate-50">
              {['overview', 'execution', 'financial'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidePanelTab(tab as any)}
                  className={`pb-2 text-xs capitalize ${sidePanelTab === tab ? 'text-slate-900 border-b border-slate-900' : 'text-slate-400'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!sideData ? (
              <div className="py-8 text-center">
                <div className="animate-spin rounded-full h-4 w-4 border border-slate-200 border-t-slate-400 mx-auto" />
              </div>
            ) : selectedWorkUnit ? (
              <>
                {/* Tab 1: Overview */}
                {sidePanelTab === 'overview' && (
                  <div className="space-y-3 text-sm">
                    <EditableField label="Title" value={selectedWorkUnit.title} onSave={v => updateWorkUnitField('title', v)} />
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-xs">Status</span>
                      <select
                        value={selectedWorkUnit.status}
                        onChange={e => updateWorkUnitField('status', e.target.value)}
                        className="text-xs text-slate-900 bg-transparent border-0 border-b border-slate-200 focus:border-slate-900 focus:ring-0 py-0.5 pr-6"
                      >
                        <option value="draft">draft</option>
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </div>
                    <EditableField label="Price" value={`${(selectedWorkUnit.priceInCents / 100).toFixed(0)}`} onSave={v => updateWorkUnitField('priceInCents', parseInt(v) * 100)} type="number" />
                    <EditableField label="Deadline (hours)" value={`${selectedWorkUnit.deadlineHours}`} onSave={v => updateWorkUnitField('deadlineHours', parseInt(v))} type="number" />
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-xs">Min tier</span>
                      <select
                        value={selectedWorkUnit.minTier}
                        onChange={e => updateWorkUnitField('minTier', e.target.value)}
                        className="text-xs text-slate-900 bg-transparent border-0 border-b border-slate-200 focus:border-slate-900 focus:ring-0 py-0.5 pr-6"
                      >
                        <option value="novice">novice</option>
                        <option value="pro">pro</option>
                        <option value="elite">elite</option>
                      </select>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-xs">Assignment</span>
                      <select
                        value={selectedWorkUnit.assignmentMode || 'auto'}
                        onChange={e => updateWorkUnitField('assignmentMode', e.target.value)}
                        className="text-xs text-slate-900 bg-transparent border-0 border-b border-slate-200 focus:border-slate-900 focus:ring-0 py-0.5 pr-6"
                      >
                        <option value="auto">auto</option>
                        <option value="manual">manual</option>
                      </select>
                    </div>
                    <EditableField
                      label="Complexity (1-5)"
                      value={`${selectedWorkUnit.complexityScore || 1}`}
                      onSave={v => updateWorkUnitField('complexityScore', parseInt(v))}
                      type="number"
                    />
                    <EditableField
                      label="Revision limit"
                      value={`${selectedWorkUnit.revisionLimit || 2}`}
                      onSave={v => updateWorkUnitField('revisionLimit', parseInt(v))}
                      type="number"
                    />
                    <div>
                      <span className="text-slate-400 text-xs block mb-1">Skills</span>
                      <EditableTagList
                        tags={selectedWorkUnit.requiredSkills || []}
                        onSave={tags => updateWorkUnitField('requiredSkills', tags)}
                      />
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block mb-1">Deliverable format</span>
                      <EditableTagList
                        tags={selectedWorkUnit.deliverableFormat || []}
                        onSave={tags => updateWorkUnitField('deliverableFormat', tags)}
                      />
                    </div>
                    <div>
                      <span className="text-slate-400 text-xs block mb-1">Spec</span>
                      <EditableTextArea
                        value={selectedWorkUnit.spec || ''}
                        onSave={v => updateWorkUnitField('spec', v)}
                      />
                    </div>
                  </div>
                )}

                {/* Tab 2: Execution */}
                {sidePanelTab === 'execution' && (
                  <div className="space-y-4 text-xs">
                    {/* Interview */}
                    <div>
                      <span className="text-slate-400 block mb-1">Screening interview</span>
                      <p className="text-slate-700">{selectedWorkUnit.infoCollectionTemplateId ? `Attached (${selectedWorkUnit.infoCollectionTemplateId.slice(0, 8)})` : 'None'}</p>
                    </div>

                    {/* Milestones */}
                    {selectedWorkUnit.milestoneTemplates?.length > 0 && (
                      <div>
                        <span className="text-slate-400 block mb-1">Milestones</span>
                        {selectedWorkUnit.milestoneTemplates.map((m: any, i: number) => (
                          <p key={m.id} className="text-slate-600 py-0.5">{i + 1}. {m.description}</p>
                        ))}
                      </div>
                    )}

                    {/* Executions */}
                    <div>
                      <span className="text-slate-400 block mb-1">Executions</span>
                      {selectedWorkUnit.executions?.length > 0 ? (
                        selectedWorkUnit.executions.map((e: any) => (
                          <div key={e.id} className="py-2 border-b border-slate-50 last:border-0">
                            <p className="text-slate-700">{e.student?.name || 'Unknown'} — {e.status}</p>
                            {e.deadlineAt && <p className="text-slate-400">deadline: {new Date(e.deadlineAt).toLocaleDateString()}</p>}
                            {e.clockedInAt && <p className="text-slate-400">clocked in: {new Date(e.clockedInAt).toLocaleString()}</p>}
                            {e.milestones?.length > 0 && (
                              <p className="text-slate-400">{e.milestones.filter((m: any) => m.completedAt).length}/{e.milestones.length} milestones</p>
                            )}
                            {e.status === 'submitted' && (
                              <div className="flex gap-3 mt-1.5">
                                <button onClick={() => reviewFromPanel(e.id, 'approved')} className="text-slate-500 hover:text-slate-900">approve</button>
                                <button onClick={() => reviewFromPanel(e.id, 'revision_needed')} className="text-slate-500 hover:text-slate-900">revise</button>
                                <button onClick={() => reviewFromPanel(e.id, 'failed')} className="text-slate-500 hover:text-slate-900">reject</button>
                              </div>
                            )}
                            {e.qualityScore != null && <p className="text-slate-400">quality: {e.qualityScore}%</p>}
                          </div>
                        ))
                      ) : (
                        <p className="text-slate-400">No executions yet</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 3: Financial */}
                {sidePanelTab === 'financial' && (
                  <div className="space-y-4 text-xs">
                    {/* Task financials */}
                    <div>
                      <span className="text-slate-400 block mb-1">Task price</span>
                      <p className="text-slate-700">${(selectedWorkUnit.priceInCents / 100).toFixed(2)}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-1">Escrow</span>
                      {selectedWorkUnit.escrow ? (
                        <div>
                          <p className="text-slate-700">${(selectedWorkUnit.escrow.amountInCents / 100).toFixed(2)} — {selectedWorkUnit.escrow.status}</p>
                          {selectedWorkUnit.escrow.status === 'pending' && (
                            <div className="flex gap-3 mt-1.5">
                              <button onClick={fundEscrowFromPanel} className="text-slate-500 hover:text-slate-900">fund escrow</button>
                              <button onClick={async () => {
                                await fundEscrowFromPanel();
                                await updateWorkUnitField('status', 'active');
                              }} className="text-slate-500 hover:text-slate-900">fund + publish</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-slate-400">No escrow account</p>
                      )}
                    </div>
                    {/* Platform fee */}
                    {selectedWorkUnit.escrow && (
                      <div>
                        <span className="text-slate-400 block mb-1">Platform fee</span>
                        <p className="text-slate-700">${(selectedWorkUnit.escrow.platformFeeInCents / 100).toFixed(2)} ({(selectedWorkUnit.platformFeePercent * 100).toFixed(0)}%)</p>
                        <p className="text-slate-400">Contractor receives: ${(selectedWorkUnit.escrow.netAmountInCents / 100).toFixed(2)}</p>
                      </div>
                    )}
                    {/* Company totals */}
                    {sideData.billing && (
                      <div className="pt-2 border-t border-slate-50">
                        <span className="text-slate-400 block mb-1">Company totals</span>
                        <div className="space-y-0.5">
                          <div className="flex justify-between"><span className="text-slate-500">Active escrow</span><span className="text-slate-700">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">This month</span><span className="text-slate-700">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* No work unit selected — show list */
              <div className="space-y-4">
                {sideData.billing && (
                  <div className="text-xs space-y-1">
                    <span className="text-slate-400">Billing</span>
                    <div className="flex justify-between"><span className="text-slate-500">Escrow</span><span className="text-slate-900">${((sideData.billing.activeEscrowInCents || 0) / 100).toFixed(0)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">This month</span><span className="text-slate-900">${((sideData.billing.monthlySpendInCents || 0) / 100).toFixed(0)}</span></div>
                  </div>
                )}
                <div>
                  <span className="text-xs text-slate-400">Work units</span>
                  {(sideData.workUnits || []).map((wu: any) => (
                    <button
                      key={wu.id}
                      onClick={() => selectWorkUnit(wu.id)}
                      className="w-full text-left py-1.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
                    >
                      <p className="text-xs text-slate-700 truncate">{wu.title}</p>
                      <p className="text-[11px] text-slate-400">{wu.status} · ${(wu.priceInCents / 100).toFixed(0)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Back to list if viewing a work unit */}
          {selectedWorkUnit && (
            <div className="px-4 py-2 border-t border-slate-50">
              <button onClick={() => setSelectedWorkUnit(null)} className="text-xs text-slate-400 hover:text-slate-600">
                ← all work units
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline editable field
function EditableField({ label, value, onSave, type = 'text' }: { label: string; value: string; onSave: (v: string) => void; type?: string }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  function save() { setEditing(false); if (val !== value) onSave(val); }

  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-xs">{label}</span>
      {editing ? (
        <input ref={ref} type={type} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => e.key === 'Enter' && save()}
          className="text-xs text-slate-900 bg-transparent border-0 border-b border-slate-900 focus:ring-0 py-0.5 text-right w-32" />
      ) : (
        <button onClick={() => setEditing(true)} className="text-xs text-slate-700 hover:text-slate-900">
          {value || '—'}
        </button>
      )}
    </div>
  );
}

// Editable tag list
function EditableTagList({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(tags.join(', '));

  useEffect(() => { setVal(tags.join(', ')); }, [tags]);

  function save() {
    setEditing(false);
    const newTags = val.split(',').map(t => t.trim()).filter(Boolean);
    if (JSON.stringify(newTags) !== JSON.stringify(tags)) onSave(newTags);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && save()}
        className="w-full text-xs text-slate-900 bg-transparent border-0 border-b border-slate-900 focus:ring-0 py-0.5"
        placeholder="comma separated"
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="text-xs text-slate-600 hover:text-slate-900 text-left">
      {tags.length > 0 ? tags.join(', ') : '—'}
    </button>
  );
}

// Editable textarea
function EditableTextArea({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);

  useEffect(() => { setVal(value); }, [value]);

  function save() { setEditing(false); if (val !== value) onSave(val); }

  if (editing) {
    return (
      <textarea
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        className="w-full text-xs text-slate-700 bg-transparent border border-slate-200 rounded p-2 focus:ring-0 focus:border-slate-400 resize-none"
        rows={6}
      />
    );
  }

  return (
    <button onClick={() => setEditing(true)} className="text-xs text-slate-600 hover:text-slate-900 text-left whitespace-pre-wrap w-full">
      {value?.slice(0, 300) || '—'}{value?.length > 300 ? '...' : ''}
    </button>
  );
}
