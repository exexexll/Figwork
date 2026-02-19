'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/components/ui/card';
import {
  Plus,
  Search,
  Clock,
  DollarSign,
  CheckCircle,
  Users,
  ChevronRight,
  Pause,
  Play,
  Trash2,
  FileText,
} from 'lucide-react';
import { getWorkUnits, deleteWorkUnit, updateWorkUnit, WorkUnitDetailed } from '@/lib/marketplace-api';
import { ConfirmModal } from '@/components/ui/confirm-modal';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-border-light text-text-secondary' },
  active: { label: 'Active', className: 'bg-green-50 text-green-700' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-700' },
  completed: { label: 'Completed', className: 'bg-primary-light/20 text-primary-dark' },
  cancelled: { label: 'Cancelled', className: 'bg-red-50 text-red-600' },
};

export default function WorkUnitsPage() {
  const { getToken } = useAuth();
  const [workUnits, setWorkUnits] = useState<WorkUnitDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadWorkUnits(); }, []);

  async function loadWorkUnits() {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      setWorkUnits(await getWorkUnits(token));
    } catch (err) {
      console.error('Failed to load work units:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      const token = await getToken();
      if (!token) return;
      await deleteWorkUnit(deleteTarget, token);
      setWorkUnits(prev => prev.filter(wu => wu.id !== deleteTarget));
    } catch (err) { console.error('Delete failed:', err); } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleTogglePause(wu: WorkUnitDetailed) {
    try {
      const token = await getToken();
      if (!token) return;
      await updateWorkUnit(wu.id, { status: wu.status === 'active' ? 'paused' : 'active' }, token);
      await loadWorkUnits();
    } catch (err) { console.error('Status update failed:', err); }
  }

  const statuses = ['all', 'draft', 'active', 'paused', 'completed'];
  const filtered = workUnits.filter(wu => {
    const matchesSearch = !search || wu.title.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || wu.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalEscrow = workUnits.reduce((sum, wu) => sum + (wu.escrow?.amountInCents || 0), 0);
  const activeCount = workUnits.filter(wu => wu.status === 'active').length;

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Work Units</h1>
          <p className="text-text-secondary mt-1">Create and manage tasks for student contractors</p>
        </div>
        <Link
          href="/dashboard/workunits/new"
          className="inline-flex items-center gap-2 btn-primary text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Work Unit
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        {[
          { icon: FileText, label: 'Total', value: workUnits.length, color: 'text-primary' },
          { icon: CheckCircle, label: 'Active', value: activeCount, color: 'text-green-600' },
          { icon: DollarSign, label: 'In Escrow', value: `$${(totalEscrow / 100).toFixed(0)}`, color: 'text-text-primary' },
          { icon: Users, label: 'Executions', value: workUnits.reduce((s, wu) => s + (wu._count?.executions || 0), 0), color: 'text-text-primary' },
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search work units..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex gap-2">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all duration-200',
                statusFilter === s
                  ? 'bg-primary-light/20 text-primary-dark'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/60'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Work Units List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse h-28 bg-border/50 rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--gradient-fig-subtle)' }}
          >
            <FileText className="w-7 h-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary">No work units found</h3>
          <p className="text-text-secondary mt-1">Create your first work unit to get started</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map(wu => {
            const badge = STATUS_BADGE[wu.status] || STATUS_BADGE.draft;
            return (
              <Card key={wu.id} className="hover:shadow-soft-lg transition-all duration-300 group">
                <div
                  className="h-1 opacity-0 group-hover:opacity-60 transition-opacity rounded-t-lg"
                  style={{ background: 'var(--gradient-fig)' }}
                />
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Link
                          href={`/dashboard/workunits/${wu.id}`}
                          className="font-semibold text-text-primary hover:text-primary-dark transition-colors truncate"
                        >
                          {wu.title}
                        </Link>
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', badge.className)}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-sm text-text-secondary line-clamp-1 mb-3">{wu.spec}</p>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5" />
                          ${(wu.priceInCents / 100).toFixed(0)}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {wu.deadlineHours}h
                        </span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span>{wu.category}</span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <span>{wu._count?.executions || 0} exec.</span>
                        {wu.escrow && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-border" />
                            <span className={wu.escrow.status === 'funded' ? 'text-green-600' : 'text-amber-600'}>
                              Escrow: {wu.escrow.status}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(wu.status === 'active' || wu.status === 'paused') && (
                        <button
                          onClick={() => handleTogglePause(wu)}
                          className="btn-secondary !px-3 !py-2"
                          title={wu.status === 'active' ? 'Pause' : 'Resume'}
                        >
                          {wu.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </button>
                      )}
                      {wu.status === 'draft' && (wu._count?.executions || 0) === 0 && (
                        <button
                          onClick={() => setDeleteTarget(wu.id)}
                          className="btn-secondary !px-3 !py-2 hover:!border-red-200 hover:!text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <Link
                        href={`/dashboard/workunits/${wu.id}`}
                        className="btn-secondary !px-4 !py-2 inline-flex items-center gap-1 text-sm"
                      >
                        Manage
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Work Unit"
        description="Are you sure you want to delete this work unit? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
