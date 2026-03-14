'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { MessageSquare, Search, Clock, User, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface MessageThread {
  executionId: string;
  workUnitTitle: string;
  contractorName: string;
  contractorId: string;
  lastMessage: {
    content: string;
    senderType: string;
    createdAt: string;
  };
  unreadCount: number;
  executionStatus: string;
}

export default function MessagesInboxPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadThreads();
  }, []);

  async function loadThreads() {
    try {
      const token = await getToken();
      if (!token) return;
      setLoading(true);

      // Get all active executions for this company
      const execRes = await fetch(`${API_URL}/api/agent/list_all_executions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });

      if (!execRes.ok) {
        throw new Error('Failed to load executions');
      }

      const execData = await execRes.json();
      const executions = execData.executions || [];

      // Load message threads for each execution
      const threadPromises = executions
        .filter((e: any) => !['cancelled', 'failed', 'approved'].includes(e.status))
        .map(async (exec: any) => {
          try {
            const msgRes = await fetch(`${API_URL}/api/executions/${exec.id}/messages`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (msgRes.ok) {
              const msgData = await msgRes.json();
              const messages = msgData.messages || [];
              if (messages.length === 0) return null;

              const lastMsg = messages[messages.length - 1];
              return {
                executionId: exec.id,
                workUnitTitle: exec.workUnit?.title || 'Unknown Task',
                contractorName: exec.student?.name || 'Contractor',
                contractorId: exec.studentId,
                lastMessage: {
                  content: lastMsg.content.slice(0, 100),
                  senderType: lastMsg.senderType,
                  createdAt: lastMsg.createdAt,
                },
                unreadCount: msgData.unreadCount || 0,
                executionStatus: exec.status,
              };
            }
          } catch {}
          return null;
        });

      const results = await Promise.all(threadPromises);
      setThreads(results.filter((t): t is MessageThread => t !== null));
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setLoading(false);
    }
  }

  const filteredThreads = threads.filter(t =>
    t.workUnitTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.contractorName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedThreads = [...filteredThreads].sort((a, b) => {
    const aTime = new Date(a.lastMessage.createdAt).getTime();
    const bTime = new Date(b.lastMessage.createdAt).getTime();
    return bTime - aTime;
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-violet-600" />
          Messages
        </h1>
        <p className="text-sm text-slate-600 mt-1">All conversations with contractors</p>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by task or contractor name..."
          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
        />
      </div>

      {/* Threads List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
        </div>
      ) : sortedThreads.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No messages yet</p>
          <p className="text-sm text-slate-400 mt-1">Start a conversation from a work unit's Messages tab</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedThreads.map(thread => (
            <button
              key={thread.executionId}
              onClick={() => {
                // Navigate to work unit detail and open messages tab
                router.push(`/dashboard?wu=${thread.executionId}&tab=messages`);
              }}
              className={cn(
                'w-full text-left p-4 bg-white rounded-xl border transition-all hover:border-violet-300 hover:shadow-sm',
                thread.unreadCount > 0 ? 'border-violet-200 bg-violet-50/30' : 'border-slate-200'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-slate-900 truncate">{thread.workUnitTitle}</h3>
                    {thread.unreadCount > 0 && (
                      <span className="px-2 py-0.5 bg-violet-500 text-white text-xs font-medium rounded-full">
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <User className="w-3 h-3" />
                    <span>{thread.contractorName}</span>
                    <span>·</span>
                    <span className="capitalize">{thread.executionStatus}</span>
                  </div>
                  <p className="text-sm text-slate-600 truncate">
                    {thread.lastMessage.senderType === 'company' && <span className="font-medium">You: </span>}
                    {thread.lastMessage.content}
                    {thread.lastMessage.content.length >= 100 && '...'}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(thread.lastMessage.createdAt).toLocaleDateString()}</span>
                  </div>
                  {thread.lastMessage.senderType !== 'company' && thread.unreadCount === 0 && (
                    <CheckCircle2 className="w-4 h-4 text-green-500 ml-auto" />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
