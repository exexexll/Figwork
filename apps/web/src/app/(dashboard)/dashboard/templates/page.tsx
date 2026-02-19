'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Plus, FileText, ArrowLeft, Mic, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { getTemplates, deleteTemplate } from '@/lib/api';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import type { Template } from '@/lib/types';

export default function TemplatesPage() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await getTemplates(token);
      setTemplates(res.data || []);
    } catch (error) {
      console.error('Failed to fetch templates:', error);
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
      await deleteTemplate(deleteTarget, token);
      fetchTemplates();
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-border rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Settings
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Interview Templates</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Create reusable screening interviews to attach to work units.
          </p>
        </div>
        <Link
          href="/dashboard/templates/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium text-sm"
          style={{ background: 'var(--gradient-fig)' }}
        >
          <Plus className="w-4 h-4" />
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'var(--gradient-fig-subtle)' }}
            >
              <Mic className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium text-text-primary mb-2">No Templates Yet</h3>
            <p className="text-text-secondary max-w-sm mx-auto mb-4">
              Create an interview template, then attach it to work units that 
              need custom screening before a contractor can start.
            </p>
            <Link
              href="/dashboard/templates/new"
              className="text-sm text-primary font-medium hover:text-primary-dark"
            >
              Create your first template →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map(template => (
            <Card key={template.id} className="hover:shadow-soft-lg transition-shadow">
              <CardContent className="p-0">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/dashboard/templates/${template.id}`}
                    className="flex-1 p-5 hover:bg-white/50 transition-colors"
                  >
                    <h3 className="font-semibold text-text-primary mb-1">{template.name}</h3>
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span>{template._count?.questions ?? 0} questions</span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span>{template._count?.sessions ?? 0} sessions</span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span>{template.timeLimitMinutes || 30} min</span>
                    </div>
                  </Link>
                  <button
                    onClick={() => setDeleteTarget(template.id)}
                    className="p-4 text-text-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Template"
        description="Are you sure you want to delete this interview template? All associated questions and settings will be lost. This action cannot be undone."
        confirmText="Delete Template"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
