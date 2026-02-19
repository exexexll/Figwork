'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/components/ui/card';
import {
  DollarSign,
  CreditCard,
  FileText,
  TrendingUp,
  AlertCircle,
  Plus,
} from 'lucide-react';
import {
  getCompanyBalance,
  getCompanyInvoices,
  getBudgetPeriods,
  addCompanyFunds,
  Invoice,
  BudgetPeriod,
} from '@/lib/marketplace-api';

export default function BillingPage() {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState<{
    activeEscrowInCents: number;
    pendingEscrowInCents: number;
    monthlySpendInCents: number;
    monthlyFeesInCents: number;
    budgetCapInCents: number | null;
    budgetRemainingInCents: number | null;
  } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fundAmount, setFundAmount] = useState(100);
  const [funding, setFunding] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const [balanceData, invoicesData] = await Promise.all([
        getCompanyBalance(token),
        getCompanyInvoices(token),
      ]);
      setBalance(balanceData);
      setInvoices(invoicesData.invoices);
      setTotalOutstanding(invoicesData.totalOutstandingInCents);
    } catch (err) { console.error('Failed to load billing:', err); }
    finally { setLoading(false); }
  }

  async function handleAddFunds() {
    try {
      setFunding(true);
      const token = await getToken();
      if (!token) return;
      const result = await addCompanyFunds(fundAmount * 100, token);
      window.open(result.checkoutUrl, '_blank');
    } catch (err) { console.error('Failed:', err); }
    finally { setFunding(false); }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="grid grid-cols-4 gap-6">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-border/50 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Billing & Payments</h1>
        <p className="text-text-secondary mt-1">Manage your spending, escrow, and invoices</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        {[
          { icon: DollarSign, label: 'Active Escrow', value: `$${((balance?.activeEscrowInCents || 0) / 100).toFixed(0)}`, color: 'text-primary' },
          { icon: TrendingUp, label: 'This Month', value: `$${((balance?.monthlySpendInCents || 0) / 100).toFixed(0)}`, color: 'text-text-primary' },
          { icon: CreditCard, label: 'Fees This Month', value: `$${((balance?.monthlyFeesInCents || 0) / 100).toFixed(0)}`, color: 'text-text-primary' },
          { icon: AlertCircle, label: 'Outstanding', value: `$${(totalOutstanding / 100).toFixed(0)}`, color: totalOutstanding > 0 ? 'text-red-500' : 'text-green-600' },
        ].map((stat, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--gradient-fig-subtle)' }}
                >
                  <stat.icon className={cn('w-5 h-5', stat.color)} />
                </div>
                <div>
                  <p className={cn('text-2xl font-semibold', stat.color)}>{stat.value}</p>
                  <p className="text-xs text-text-secondary">{stat.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Budget Progress */}
      {balance?.budgetCapInCents != null && (
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-text-primary">Monthly Budget</h2>
              <span className="text-sm text-text-secondary">
                ${((balance.monthlySpendInCents || 0) / 100).toFixed(0)} / ${(balance.budgetCapInCents / 100).toFixed(0)}
              </span>
            </div>
            <div className="h-2.5 bg-border-light rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, ((balance.monthlySpendInCents || 0) / balance.budgetCapInCents) * 100)}%`,
                  background: ((balance.monthlySpendInCents || 0) / balance.budgetCapInCents) > 0.9
                    ? '#f87171'
                    : ((balance.monthlySpendInCents || 0) / balance.budgetCapInCents) > 0.7
                    ? '#fbbf24'
                    : 'var(--gradient-fig)',
                }}
              />
            </div>
            {balance.budgetRemainingInCents != null && (
              <p className="text-sm text-text-secondary mt-2">
                ${(balance.budgetRemainingInCents / 100).toFixed(0)} remaining
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Funds */}
      <Card className="mb-8">
        <CardContent className="p-6">
          <h2 className="font-semibold text-text-primary mb-4">Add Funds</h2>
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <label className="text-sm text-text-secondary">Amount (USD)</label>
              <input
                type="number"
                value={fundAmount}
                onChange={e => setFundAmount(parseInt(e.target.value) || 0)}
                min={10}
                className="input w-32 mt-1"
              />
            </div>
            <div className="flex gap-2">
              {[50, 100, 500, 1000].map(amount => (
                <button
                  key={amount}
                  onClick={() => setFundAmount(amount)}
                  className={cn(
                    'px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    fundAmount === amount
                      ? 'bg-primary-light/20 text-primary-dark border border-primary-light'
                      : 'bg-white/80 border border-border text-text-secondary hover:border-primary-light'
                  )}
                >
                  ${amount}
                </button>
              ))}
            </div>
            <button
              onClick={handleAddFunds}
              disabled={funding || fundAmount < 10}
              className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
            >
              {funding ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Add Funds
                </>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <div className="px-6 py-4 border-b border-border-light">
          <h2 className="font-semibold text-text-primary">Invoices</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="p-8 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <p className="text-text-secondary">No invoices yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border-light">
            {invoices.map(invoice => (
              <div key={invoice.id} className="px-6 py-4 flex items-center justify-between hover:bg-white/50 transition-colors">
                <div>
                  <div className="font-medium text-text-primary">
                    {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 8)}`}
                  </div>
                  <div className="text-sm text-text-secondary mt-0.5">
                    {new Date(invoice.periodStart).toLocaleDateString()} — {new Date(invoice.periodEnd).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-semibold text-text-primary">
                      ${(invoice.totalInCents / 100).toFixed(2)}
                    </div>
                    <div className="text-xs text-text-muted">
                      Fees: ${(invoice.platformFeesInCents / 100).toFixed(2)}
                    </div>
                  </div>
                  <span className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium',
                    invoice.status === 'paid' ? 'bg-green-50 text-green-700' :
                    invoice.status === 'overdue' ? 'bg-red-50 text-red-600' :
                    'bg-amber-50 text-amber-700'
                  )}>
                    {invoice.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
