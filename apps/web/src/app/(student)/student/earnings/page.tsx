'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  ArrowUpRight,
  Zap,
  AlertCircle,
} from 'lucide-react';
import {
  getStudentBalance,
  getStudentPayouts,
  requestInstantPayout,
  Payout,
} from '@/lib/marketplace-api';

export default function EarningsPage() {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState<{
    pendingInCents: number;
    processingInCents: number;
    totalEarnedInCents: number;
    monthlyEarnedInCents: number;
    stripeConnectStatus: string;
    tier: string;
    platformFeePercent: number;
  } | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [balanceData, payoutsData] = await Promise.all([
        getStudentBalance(token),
        getStudentPayouts(token),
      ]);
      setBalance(balanceData);
      setPayouts(Array.isArray(payoutsData) ? payoutsData : []);
    } catch (err) {
      console.error('Failed to load earnings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleInstantPayout() {
    try {
      setRequestingPayout(true);
      const token = await getToken();
      if (!token) return;
      const result = await requestInstantPayout(token);
      setPayoutResult(`$${(result.netAmountInCents / 100).toFixed(2)} payout initiated (${result.payoutCount} tasks)`);
      await loadData();
    } catch (err) {
      setPayoutResult(err instanceof Error ? err.message : 'Payout failed');
    } finally {
      setRequestingPayout(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-40 bg-slate-200 rounded-2xl"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-slate-200 rounded-xl"></div>
            <div className="h-24 bg-slate-200 rounded-xl"></div>
            <div className="h-24 bg-slate-200 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Earnings</h1>
        <p className="text-slate-500 mt-1">Track your income and request payouts</p>
      </div>

      {/* Balance Card */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl p-6 sm:p-8 mb-6 text-white">
        <div className="text-green-100 text-sm mb-1">Available Balance</div>
        <div className="text-4xl font-bold mb-4">
          ${((balance?.pendingInCents || 0) / 100).toFixed(2)}
        </div>
        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <div className="text-green-100 text-xs">Processing</div>
            <div className="font-semibold">${((balance?.processingInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-green-100 text-xs">This Month</div>
            <div className="font-semibold">${((balance?.monthlyEarnedInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-green-100 text-xs">All Time</div>
            <div className="font-semibold">${((balance?.totalEarnedInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-green-100 text-xs">Platform Fee</div>
            <div className="font-semibold">{((balance?.platformFeePercent || 0) * 100).toFixed(0)}%</div>
          </div>
        </div>
        
        {(balance?.pendingInCents || 0) > 100 && balance?.stripeConnectStatus === 'active' && (
          <button
            onClick={handleInstantPayout}
            disabled={requestingPayout}
            className="flex items-center gap-2 px-6 py-3 bg-white text-green-700 rounded-xl font-semibold hover:bg-green-50 disabled:opacity-50 transition-colors"
          >
            {requestingPayout ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-700"></div>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Instant Payout
              </>
            )}
          </button>
        )}

        {balance?.stripeConnectStatus !== 'active' && (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4" />
            Complete Stripe Connect setup to receive payouts
          </div>
        )}
      </div>

      {payoutResult && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center justify-between">
          <p className="text-sm text-blue-700">{payoutResult}</p>
          <button onClick={() => setPayoutResult(null)} className="text-blue-500 hover:text-blue-700">×</button>
        </div>
      )}

      {/* Payout History */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Payout History</h2>
        </div>
        
        {payouts.length === 0 ? (
          <div className="p-8 text-center">
            <DollarSign className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No payouts yet. Complete tasks to earn!</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {payouts.map(payout => (
              <div key={payout.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">
                    ${(payout.amountInCents / 100).toFixed(2)}
                  </div>
                  <div className="text-sm text-slate-500">
                    {new Date(payout.createdAt).toLocaleDateString()}
                    {payout.executions && ` · ${payout.executions.length} task(s)`}
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  payout.status === 'completed' ? 'bg-green-100 text-green-700' :
                  payout.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                  payout.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {payout.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
