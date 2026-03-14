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
  getStripeConnectUrl,
  getStripeConnectLoginUrl,
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
  const [openingConnect, setOpeningConnect] = useState(false);
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

  async function handleConnect() {
    try {
      setOpeningConnect(true);
      const token = await getToken();
      if (!token) return;
      if (balance?.stripeConnectStatus === 'active') {
        const result = await getStripeConnectLoginUrl(token);
        window.open(result.url, '_blank');
      } else {
        const result = await getStripeConnectUrl(token);
        window.open(result.url, '_blank');
      }
    } catch (err) {
      setPayoutResult(err instanceof Error ? err.message : 'Unable to open Stripe Connect');
    } finally {
      setOpeningConnect(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-40 bg-[#f5f5f8] rounded-2xl"></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="h-24 bg-[#f5f5f8] rounded-xl"></div>
            <div className="h-24 bg-[#f5f5f8] rounded-xl"></div>
            <div className="h-24 bg-[#f5f5f8] rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1f1f2e]">Earnings</h1>
        <p className="text-[#6b6b80] mt-1">Track your income and request payouts</p>
      </div>

      {/* Balance Card */}
      <div className="bg-[#a2a3fc] rounded-2xl p-6 sm:p-8 mb-6 text-white">
        <div className="text-white/70 text-sm mb-1">Available Balance</div>
        <div className="text-4xl font-bold mb-4">
          ${((balance?.pendingInCents || 0) / 100).toFixed(2)}
        </div>
        <div className="flex flex-wrap gap-4 mb-6">
          <div>
            <div className="text-white/70 text-xs">Processing</div>
            <div className="font-semibold">${((balance?.processingInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-white/70 text-xs">This Month</div>
            <div className="font-semibold">${((balance?.monthlyEarnedInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-white/70 text-xs">All Time</div>
            <div className="font-semibold">${((balance?.totalEarnedInCents || 0) / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="text-white/70 text-xs">Platform Fee</div>
            <div className="font-semibold">{((balance?.platformFeePercent || 0) * 100).toFixed(0)}%</div>
          </div>
        </div>
        
        {(balance?.pendingInCents || 0) > 100 && balance?.stripeConnectStatus === 'active' && (
          <button
            onClick={handleInstantPayout}
            disabled={requestingPayout}
            className="flex items-center gap-2 px-6 py-3 bg-white text-[#a2a3fc] rounded-xl font-semibold hover:bg-[#f0f0ff] disabled:opacity-50 transition-colors"
          >
            {requestingPayout ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#a2a3fc]"></div>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                Instant Payout
              </>
            )}
          </button>
        )}

        {balance?.stripeConnectStatus !== 'active' ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/15 rounded-lg text-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Complete Stripe Connect setup to receive payouts
            </div>
            <button
              onClick={handleConnect}
              disabled={openingConnect}
              className="px-3 py-1.5 rounded-lg bg-white text-[#a2a3fc] font-medium hover:bg-[#f0f0ff] disabled:opacity-60 transition-colors"
            >
              {openingConnect ? 'Opening...' : 'Set up'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white/15 rounded-lg text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Stripe Connect is active
            </div>
            <button
              onClick={handleConnect}
              disabled={openingConnect}
              className="px-3 py-1.5 rounded-lg bg-white text-[#a2a3fc] font-medium hover:bg-[#f0f0ff] disabled:opacity-60 transition-colors"
            >
              {openingConnect ? 'Opening...' : 'Open Dashboard'}
            </button>
          </div>
        )}
      </div>

      {payoutResult && (
        <div className="bg-[#f0f0ff] border border-[#e0e0f0] rounded-xl p-4 mb-6 flex items-center justify-between">
          <p className="text-sm text-[#6b6b80]">{payoutResult}</p>
          <button onClick={() => setPayoutResult(null)} className="text-[#a0a0b0] hover:text-[#1f1f2e]">×</button>
        </div>
      )}

      {/* Payout History */}
      <div className="bg-white rounded-xl border border-[#f0f0f5] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#f0f0f5]">
          <h2 className="font-semibold text-[#1f1f2e]">Payout History</h2>
        </div>
        
        {payouts.length === 0 ? (
          <div className="p-8 text-center">
            <DollarSign className="w-10 h-10 text-[#e0e0e8] mx-auto mb-3" />
            <p className="text-[#6b6b80]">No payouts yet. Complete tasks to earn!</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f5]">
            {payouts.map(payout => (
              <div key={payout.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-[#1f1f2e]">
                    ${(payout.amountInCents / 100).toFixed(2)}
                  </div>
                  <div className="text-sm text-[#6b6b80]">
                    {new Date(payout.createdAt).toLocaleDateString()}
                    {payout.executions && ` · ${payout.executions.length} task(s)`}
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  payout.status === 'completed' ? 'bg-[#f0f0ff] text-[#a2a3fc]' :
                  payout.status === 'processing' ? 'bg-[#f0f0ff] text-[#7b7cee]' :
                  payout.status === 'pending' ? 'bg-[#f5f5f5] text-[#6b6b80]' :
                  'bg-[#f5f5f5] text-[#6b6b80]'
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
