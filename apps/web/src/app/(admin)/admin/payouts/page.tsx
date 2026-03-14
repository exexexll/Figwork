'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { DollarSign, RefreshCw, Send, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AdminPayout {
  id: string;
  amountInCents: number;
  status: string;
  createdAt: string;
  processedAt: string | null;
  failureReason: string | null;
  student: { id: string; name: string | null; email: string | null; stripeConnectStatus: string };
  executions: Array<{ id: string; workUnit: { title: string } }>;
}

export default function AdminPayoutsPage() {
  const { getToken } = useAuth();
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => { loadData(); }, [filter]);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const qs = filter ? `?status=${filter}` : '';
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/payments/admin/payouts${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPayouts(data.payouts || []);
      }
    } catch (e) {
      console.error('Failed to load payouts', e);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(payoutId: string, action: 'send' | 'cancel' | 'retry') {
    try {
      setBusyId(`${action}:${payoutId}`);
      const token = await getToken();
      if (!token) return;
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/payments/admin/payouts/${payoutId}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadData();
    } catch (e) {
      console.error(`Failed to ${action} payout`, e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Payouts</h1>
          <p className="text-text-secondary mt-1">Review, send, cancel, and retry student payouts</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => setFilter(e.target.value)} className="input">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={loadData} className="px-3 py-2 rounded-lg border border-border-light hover:bg-white/60 transition-colors">
            <RefreshCw className="w-4 h-4 text-text-secondary" />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Payout Queue</h2>
          <span className="text-sm text-gray-500">{payouts.length} payouts</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-gray-500">Loading…</div>
        ) : payouts.length === 0 ? (
          <div className="p-10 text-center text-gray-500">No payouts found</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {payouts.map((p) => (
              <div key={p.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{p.student.name || p.student.email || 'Student'}</p>
                      <p className="text-sm text-gray-500 truncate">
                        ${(p.amountInCents / 100).toFixed(2)} · {p.executions.length} execution{p.executions.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  {p.executions[0]?.workUnit?.title && (
                    <p className="text-xs text-gray-400 mt-2 truncate">{p.executions[0].workUnit.title}</p>
                  )}
                  {p.failureReason && <p className="text-xs text-red-500 mt-1">{p.failureReason}</p>}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium',
                      p.status === 'completed' && 'bg-green-50 text-green-700',
                      p.status === 'pending' && 'bg-amber-50 text-amber-700',
                      p.status === 'processing' && 'bg-blue-50 text-blue-700',
                      p.status === 'failed' && 'bg-red-50 text-red-600'
                    )}
                  >
                    {p.status}
                  </span>
                  {(p.status === 'pending' || p.status === 'processing') && (
                    <>
                      <button
                        onClick={() => runAction(p.id, 'send')}
                        disabled={busyId === `send:${p.id}`}
                        className="px-3 py-1.5 text-xs rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      >
                        <span className="inline-flex items-center gap-1"><Send className="w-3.5 h-3.5" /> Send</span>
                      </button>
                      <button
                        onClick={() => runAction(p.id, 'cancel')}
                        disabled={busyId === `cancel:${p.id}`}
                        className="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                      >
                        <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5" /> Cancel</span>
                      </button>
                    </>
                  )}
                  {p.status === 'failed' && (
                    <button
                      onClick={() => runAction(p.id, 'retry')}
                      disabled={busyId === `retry:${p.id}`}
                      className="px-3 py-1.5 text-xs rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
