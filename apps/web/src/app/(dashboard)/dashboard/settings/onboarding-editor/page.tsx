'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import {
  ArrowLeft,
  Eye,
  Save,
  Plus,
  Trash2,
  GripVertical,
  Type,
  Image,
  CheckSquare,
  AlertCircle,
  Upload,
  MoveUp,
  MoveDown,
  Palette,
  Sparkles,
  FileText,
} from 'lucide-react';

// Block types for the page editor
type BlockType = 'hero' | 'text' | 'image' | 'checklist' | 'cta' | 'divider';

interface PageBlock {
  id: string;
  type: BlockType;
  content: Record<string, any>;
}

interface OnboardingPageData {
  companyName: string;
  logoUrl: string;
  accentColor: string;
  blocks: PageBlock[];
}

const ACCENT_COLORS = [
  { name: 'Figwork Purple', value: '#a78bfa' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Orange', value: '#f59e0b' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Slate', value: '#64748b' },
];

const PRESET_BLOCKS: Array<{ type: BlockType; label: string; icon: any; defaultContent: Record<string, any> }> = [
  {
    type: 'hero',
    label: 'Hero Banner',
    icon: Sparkles,
    defaultContent: {
      heading: 'Welcome to Our Team',
      subheading: 'We\'re excited to work with you. Here\'s what you need to know.',
    },
  },
  {
    type: 'text',
    label: 'Text Block',
    icon: Type,
    defaultContent: {
      heading: '',
      body: 'Add your content here...',
    },
  },
  {
    type: 'image',
    label: 'Image',
    icon: Image,
    defaultContent: {
      url: '',
      alt: 'Image',
      caption: '',
    },
  },
  {
    type: 'checklist',
    label: 'Checklist',
    icon: CheckSquare,
    defaultContent: {
      heading: 'Before You Start',
      items: ['Read the task description carefully', 'Check deliverable format requirements', 'Note the deadline'],
    },
  },
  {
    type: 'cta',
    label: 'Call to Action',
    icon: AlertCircle,
    defaultContent: {
      heading: 'Ready to Begin?',
      body: 'Make sure you\'ve reviewed everything above before accepting the task.',
      buttonText: 'I\'m Ready',
    },
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: FileText,
    defaultContent: {},
  },
];

const DEFAULT_BLOCKS: PageBlock[] = [
  {
    id: 'default-hero',
    type: 'hero',
    content: {
      heading: 'Welcome to {companyName}',
      subheading: 'Thanks for joining us as a contractor. Review the info below before getting started.',
    },
  },
  {
    id: 'default-text',
    type: 'text',
    content: {
      heading: 'About Us',
      body: 'Tell contractors about your company, what you do, and what kind of work they\'ll be doing.',
    },
  },
  {
    id: 'default-checklist',
    type: 'checklist',
    content: {
      heading: 'What We Expect',
      items: [
        'Deliver work on time',
        'Follow the acceptance criteria exactly',
        'Respond to POW check-ins within 10 minutes',
        'Ask questions if anything is unclear',
      ],
    },
  },
];

function generateId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function OnboardingEditorPage() {
  const { getToken } = useAuth();
  const [pageData, setPageData] = useState<OnboardingPageData>({
    companyName: '',
    logoUrl: '',
    accentColor: '#a78bfa',
    blocks: DEFAULT_BLOCKS,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const [editingBlock, setEditingBlock] = useState<string | null>(null);

  // Get workUnitId from URL params
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const workUnitId = searchParams?.get('workUnitId') || null;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const token = await getToken();
      if (!token) return;
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${API_URL}/api/companies/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const profile = await res.json();
        setPageData(prev => ({
          ...prev,
          companyName: profile.companyName || '',
          logoUrl: profile.website ? `https://logo.clearbit.com/${profile.website.replace(/https?:\/\//, '')}` : '',
        }));
        // Load saved onboarding page data
        if (profile.address && typeof profile.address === 'object') {
          // Try per-work-unit first, then fall back to global
          const addr = profile.address as any;
          let saved = null;
          if (workUnitId && addr.onboardingPages?.[workUnitId]?.blocks) {
            saved = addr.onboardingPages[workUnitId];
          } else if (addr.onboardingPage?.blocks) {
            saved = addr.onboardingPage;
          }
          if (saved?.blocks?.length > 0) {
            setPageData(prev => ({ ...prev, ...saved }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to load:', err);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const token = await getToken();
      if (!token) { alert('Not authenticated'); setSaving(false); return; }
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${API_URL}/api/companies/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert(`Failed to load profile: ${res.status}`); setSaving(false); return; }
      const profile = await res.json();
      const existingAddress = (typeof profile.address === 'object' && profile.address) || {};

      const pageContent = {
        accentColor: pageData.accentColor,
        logoUrl: pageData.logoUrl,
        blocks: pageData.blocks,
      };

      const updatedAddress = { ...existingAddress };

      if (workUnitId) {
        // Save per work unit
        const pages = updatedAddress.onboardingPages || {};
        pages[workUnitId] = { ...pages[workUnitId], ...pageContent };
        updatedAddress.onboardingPages = pages;
      } else {
        // Save as global default
        updatedAddress.onboardingPage = pageContent;
      }

      const saveRes = await fetch(`${API_URL}/api/companies/me`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: updatedAddress }),
      });
      if (!saveRes.ok) { alert(`Save failed: ${saveRes.status}`); setSaving(false); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      alert(`Error: ${err?.message || 'Unknown'}`);
      console.error('Save error:', err);
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  function addBlock(preset: typeof PRESET_BLOCKS[0]) {
    const newBlock: PageBlock = {
      id: generateId(),
      type: preset.type,
      content: { ...preset.defaultContent },
    };
    setPageData(prev => ({ ...prev, blocks: [...prev.blocks, newBlock] }));
    setEditingBlock(newBlock.id);
  }

  function removeBlock(id: string) {
    setPageData(prev => ({ ...prev, blocks: prev.blocks.filter(b => b.id !== id) }));
    if (editingBlock === id) setEditingBlock(null);
  }

  function moveBlock(id: string, direction: 'up' | 'down') {
    setPageData(prev => {
      const blocks = [...prev.blocks];
      const idx = blocks.findIndex(b => b.id === id);
      if (direction === 'up' && idx > 0) {
        [blocks[idx - 1], blocks[idx]] = [blocks[idx], blocks[idx - 1]];
      } else if (direction === 'down' && idx < blocks.length - 1) {
        [blocks[idx + 1], blocks[idx]] = [blocks[idx], blocks[idx + 1]];
      }
      return { ...prev, blocks };
    });
  }

  function updateBlockContent(id: string, key: string, value: any) {
    setPageData(prev => ({
      ...prev,
      blocks: prev.blocks.map(b =>
        b.id === id ? { ...b, content: { ...b.content, [key]: value } } : b
      ),
    }));
  }

  // Preview mode
  if (preview) {
    return (
      <div className="min-h-screen bg-[#faf8fc]">
        <div className="sticky top-0 z-50 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Preview Mode</span>
          <button
            onClick={() => setPreview(false)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200"
          >
            Exit Preview
          </button>
        </div>
        <PreviewRenderer pageData={pageData} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-3"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Settings
          </Link>
          <h1 className="text-2xl font-semibold text-text-primary">Onboarding Page Editor</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Customize what contractors see before starting your tasks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPreview(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#e8e4f0] text-sm font-medium text-text-secondary hover:text-text-primary hover:border-[#c4b5fd]"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--gradient-fig)' }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Page'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Block Palette */}
        <div className="col-span-1 space-y-4">
          {/* Accent Color */}
          <div className="bg-white rounded-xl border border-[#e8e4f0] p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Accent Color
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {ACCENT_COLORS.map(color => (
                <button
                  key={color.value}
                  onClick={() => setPageData(prev => ({ ...prev, accentColor: color.value }))}
                  className={`w-full aspect-square rounded-lg border-2 transition-all ${
                    pageData.accentColor === color.value ? 'border-slate-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Logo */}
          <div className="bg-white rounded-xl border border-[#e8e4f0] p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Image className="w-4 h-4" />
              Company Logo
            </h3>
            <input
              type="url"
              value={pageData.logoUrl}
              onChange={e => setPageData(prev => ({ ...prev, logoUrl: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
              placeholder="https://example.com/logo.png"
            />
            {pageData.logoUrl && (
              <div className="mt-2 p-2 bg-slate-50 rounded-lg">
                <img src={pageData.logoUrl} alt="Logo" className="h-10 object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
              </div>
            )}
          </div>

          {/* Add Blocks */}
          <div className="bg-white rounded-xl border border-[#e8e4f0] p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Block
            </h3>
            <div className="space-y-2">
              {PRESET_BLOCKS.map(preset => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.type}
                    onClick={() => addBlock(preset)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#e8e4f0] hover:border-[#c4b5fd] hover:bg-[#faf8fc] transition-all text-left"
                  >
                    <Icon className="w-4 h-4 text-[#a78bfa]" />
                    <span className="text-sm text-text-primary">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Page Builder */}
        <div className="col-span-2">
          {pageData.blocks.length === 0 ? (
            <div className="bg-white rounded-xl border-2 border-dashed border-[#e8e4f0] p-12 text-center">
              <Plus className="w-10 h-10 text-[#c4b5fd] mx-auto mb-3" />
              <p className="text-text-secondary text-sm">
                Add blocks from the left panel to build your onboarding page.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pageData.blocks.map((block, idx) => (
                <div
                  key={block.id}
                  className={`bg-white rounded-xl border transition-all ${
                    editingBlock === block.id ? 'border-[#a78bfa] shadow-md' : 'border-[#e8e4f0]'
                  }`}
                >
                  {/* Block Header */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-[#f3f0f8]">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-slate-300" />
                      <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                        {block.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => moveBlock(block.id, 'up')} disabled={idx === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                        <MoveUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => moveBlock(block.id, 'down')} disabled={idx === pageData.blocks.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30">
                        <MoveDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingBlock(editingBlock === block.id ? null : block.id)}
                        className="p-1 text-slate-400 hover:text-[#a78bfa]"
                      >
                        <Type className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeBlock(block.id)} className="p-1 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Block Content Editor */}
                  <div className="p-4">
                    {editingBlock === block.id ? (
                      <BlockEditor block={block} onChange={updateBlockContent} accentColor={pageData.accentColor} />
                    ) : (
                      <BlockPreviewInline block={block} accentColor={pageData.accentColor} companyName={pageData.companyName} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Block editor for editing content
function BlockEditor({ block, onChange, accentColor }: { block: PageBlock; onChange: (id: string, key: string, value: any) => void; accentColor: string }) {
  switch (block.type) {
    case 'hero':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Heading</label>
            <input
              type="text"
              value={block.content.heading}
              onChange={e => onChange(block.id, 'heading', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
              placeholder="Welcome heading..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Subheading</label>
            <textarea
              value={block.content.subheading}
              onChange={e => onChange(block.id, 'subheading', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
              placeholder="Brief description..."
            />
          </div>
        </div>
      );

    case 'text':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Heading (optional)</label>
            <input
              type="text"
              value={block.content.heading || ''}
              onChange={e => onChange(block.id, 'heading', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Body</label>
            <textarea
              value={block.content.body}
              onChange={e => onChange(block.id, 'body', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm resize-none h-32 focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Image URL</label>
            <input
              type="url"
              value={block.content.url || ''}
              onChange={e => onChange(block.id, 'url', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Caption (optional)</label>
            <input
              type="text"
              value={block.content.caption || ''}
              onChange={e => onChange(block.id, 'caption', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
          {block.content.url && (
            <img src={block.content.url} alt="" className="w-full rounded-lg max-h-40 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
          )}
        </div>
      );

    case 'checklist':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Heading</label>
            <input
              type="text"
              value={block.content.heading || ''}
              onChange={e => onChange(block.id, 'heading', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Items (one per line)</label>
            <textarea
              value={(block.content.items || []).join('\n')}
              onChange={e => onChange(block.id, 'items', e.target.value.split('\n').filter(Boolean))}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm resize-none h-28 focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
              placeholder="Item 1&#10;Item 2&#10;Item 3"
            />
          </div>
        </div>
      );

    case 'cta':
      return (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Heading</label>
            <input
              type="text"
              value={block.content.heading || ''}
              onChange={e => onChange(block.id, 'heading', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Body</label>
            <textarea
              value={block.content.body || ''}
              onChange={e => onChange(block.id, 'body', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm resize-none h-16 focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Button Text</label>
            <input
              type="text"
              value={block.content.buttonText || ''}
              onChange={e => onChange(block.id, 'buttonText', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#e8e4f0] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4b5fd]/40"
            />
          </div>
        </div>
      );

    case 'divider':
      return <div className="text-xs text-text-secondary text-center py-2">— Horizontal divider —</div>;

    default:
      return null;
  }
}

// Inline preview for blocks (non-edit mode)
function BlockPreviewInline({ block, accentColor, companyName }: { block: PageBlock; accentColor: string; companyName: string }) {
  const resolve = (s: string) => s?.replace('{companyName}', companyName || 'Your Company') || '';

  switch (block.type) {
    case 'hero':
      return (
        <div className="text-center py-2">
          <h2 className="text-lg font-bold text-text-primary">{resolve(block.content.heading)}</h2>
          <p className="text-sm text-text-secondary mt-1">{resolve(block.content.subheading)}</p>
        </div>
      );
    case 'text':
      return (
        <div>
          {block.content.heading && <h3 className="font-semibold text-text-primary text-sm mb-1">{block.content.heading}</h3>}
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{block.content.body}</p>
        </div>
      );
    case 'image':
      return block.content.url ? (
        <div>
          <img src={block.content.url} alt="" className="w-full rounded-lg max-h-32 object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
          {block.content.caption && <p className="text-xs text-text-secondary mt-1 text-center">{block.content.caption}</p>}
        </div>
      ) : (
        <div className="py-6 text-center border-2 border-dashed border-[#e8e4f0] rounded-lg">
          <Image className="w-6 h-6 text-slate-300 mx-auto" />
          <p className="text-xs text-slate-400 mt-1">No image set</p>
        </div>
      );
    case 'checklist':
      return (
        <div>
          {block.content.heading && <h3 className="font-semibold text-text-primary text-sm mb-2">{block.content.heading}</h3>}
          <ul className="space-y-1">
            {(block.content.items || []).map((item: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckSquare className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: accentColor }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'cta':
      return (
        <div className="text-center py-2 px-4 rounded-lg" style={{ backgroundColor: `${accentColor}10` }}>
          <h3 className="font-semibold text-text-primary text-sm">{block.content.heading}</h3>
          <p className="text-xs text-text-secondary mt-1">{block.content.body}</p>
          <div className="mt-2 inline-block px-4 py-1.5 rounded-lg text-white text-xs font-medium" style={{ backgroundColor: accentColor }}>
            {block.content.buttonText || 'Continue'}
          </div>
        </div>
      );
    case 'divider':
      return <hr className="border-[#e8e4f0]" />;
    default:
      return null;
  }
}

// Full preview renderer
function PreviewRenderer({ pageData }: { pageData: OnboardingPageData }) {
  const resolve = (s: string) => s?.replace('{companyName}', pageData.companyName || 'Your Company') || '';

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Logo */}
      {pageData.logoUrl && (
        <div className="text-center mb-8">
          <img src={pageData.logoUrl} alt="Logo" className="h-12 mx-auto" onError={e => (e.currentTarget.style.display = 'none')} />
        </div>
      )}

      {/* Blocks */}
      <div className="space-y-8">
        {pageData.blocks.map(block => (
          <div key={block.id}>
            {block.type === 'hero' && (
              <div className="text-center py-8">
                <h1 className="text-3xl font-bold text-[#1f1f2e] mb-3">{resolve(block.content.heading)}</h1>
                <p className="text-lg text-[#6b6b80]">{resolve(block.content.subheading)}</p>
              </div>
            )}

            {block.type === 'text' && (
              <div className="bg-white rounded-xl p-6 border border-[#e8e4f0]">
                {block.content.heading && <h2 className="text-xl font-semibold text-[#1f1f2e] mb-3">{block.content.heading}</h2>}
                <p className="text-[#6b6b80] leading-relaxed whitespace-pre-wrap">{block.content.body}</p>
              </div>
            )}

            {block.type === 'image' && block.content.url && (
              <div className="rounded-xl overflow-hidden">
                <img src={block.content.url} alt={block.content.alt} className="w-full" />
                {block.content.caption && <p className="text-sm text-[#a0a0b0] text-center mt-2">{block.content.caption}</p>}
              </div>
            )}

            {block.type === 'checklist' && (
              <div className="bg-white rounded-xl p-6 border border-[#e8e4f0]">
                {block.content.heading && <h2 className="text-xl font-semibold text-[#1f1f2e] mb-4">{block.content.heading}</h2>}
                <ul className="space-y-3">
                  {(block.content.items || []).map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-3 text-[#6b6b80]">
                      <CheckSquare className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: pageData.accentColor }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {block.type === 'cta' && (
              <div className="rounded-xl p-8 text-center" style={{ backgroundColor: pageData.accentColor }}>
                <h2 className="text-2xl font-bold text-white mb-2">{block.content.heading}</h2>
                <p className="text-white/70 mb-4">{block.content.body}</p>
                <button className="px-6 py-3 rounded-lg bg-white text-[#1f1f2e] font-semibold">
                  {block.content.buttonText || 'Continue'}
                </button>
              </div>
            )}

            {block.type === 'divider' && <hr className="border-[#e8e4f0]" />}
          </div>
        ))}
      </div>
    </div>
  );
}
