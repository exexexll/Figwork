'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { ArrowLeft, X, Loader2, Trash2, Plus, Pencil, Check, Calendar, ChevronDown } from 'lucide-react';
import { getWorkUnits, updateWorkUnit, createWorkUnit, deleteWorkUnit, type WorkUnitDetailed, type PublishConditions, type CreateWorkUnitInput } from '@/lib/marketplace-api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface WFGroup { id: string; name: string; color: string; workUnits: WUNode[]; nodePositions?: Record<string, { x: number; y: number }>; }
interface ExecInfo { id: string; status: string; student: { name: string }; clockedInAt?: string; submittedAt?: string; completedAt?: string; deadlineAt?: string; qualityScore?: number; payoutStatus?: string; statusUpdate?: string | null; milestones: Array<{ id: string; description: string; completedAt?: string | null }>; powLogs: Array<{ id: string; status: string; statusUpdate?: string | null; workPhotoUrl?: string | null; requestedAt: string }>; }
interface WUNode { id: string; title: string; status: string; priceInCents: number; deadlineHours: number; complexityScore: number; publishConditions?: any; scheduledPublishAt?: string | null; executions?: ExecInfo[]; }
interface Connection { from: string; to: string; condition: 'published' | 'completed' | 'failed'; shareContext: 'none' | 'summary' | 'full'; onFailure?: 'publish' | 'cancel' | 'notify'; }
interface Pos { x: number; y: number; }

const NODE_W = 200, NODE_H = 88;
const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function autoLayout(nodes: WUNode[], conns: Connection[]): Record<string, Pos> {
  if (!nodes.length) return {};
  const pos: Record<string, Pos> = {};
  
  // Build dependency graph
  const inDeps = new Map<string, string[]>(); // what each node depends on
  const outDeps = new Map<string, string[]>(); // what depends on each node
  const nodeIds = new Set(nodes.map(n => n.id));
  nodes.forEach(n => { inDeps.set(n.id, []); outDeps.set(n.id, []); });
  for (const c of conns) {
    if (nodeIds.has(c.from) && nodeIds.has(c.to)) {
      inDeps.get(c.to)!.push(c.from);
      outDeps.get(c.from)!.push(c.to);
    }
  }

  // Assign layers using longest-path layering (better for branched graphs)
  const layerMap = new Map<string, number>();
  const placed = new Set<string>();

  // Topological sort + longest path from roots
  function assignLayer(id: string, visited = new Set<string>()): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const deps = inDeps.get(id) || [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map(d => assignLayer(d, visited) + 1));
    layerMap.set(id, layer);
    return layer;
  }
  nodes.forEach(n => assignLayer(n.id));

  // Group nodes by layer
  const layers: string[][] = [];
  Array.from(layerMap.entries()).forEach(([id, layer]) => {
    while (layers.length <= layer) layers.push([]);
    layers[layer].push(id);
  });
  // Add any unplaced nodes to layer 0
  for (const n of nodes) {
    if (!layerMap.has(n.id)) {
      if (!layers.length) layers.push([]);
      layers[0].push(n.id);
    }
  }

  // Layout: center each layer horizontally, spread vertically
  const COL_GAP = NODE_W + 60;  // horizontal gap between parallel nodes
  const ROW_GAP = NODE_H + 80;  // vertical gap between layers
  const maxLayerWidth = Math.max(...layers.map(l => l.length));

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const layerWidth = layer.length * COL_GAP;
    const totalWidth = maxLayerWidth * COL_GAP;
    const offsetX = (totalWidth - layerWidth) / 2; // center the layer
    
    for (let ni = 0; ni < layer.length; ni++) {
      pos[layer[ni]] = {
        x: 30 + offsetX + ni * COL_GAP,
        y: 30 + li * ROW_GAP,
      };
    }
  }

  return pos;
}

function extractConns(wus: WUNode[]): Connection[] {
  const conns: Connection[] = []; const ids = new Set(wus.map(w => w.id));
  for (const wu of wus) {
    const c = wu.publishConditions as PublishConditions | null;
    if (!c?.dependencies) continue;
    for (const d of c.dependencies) if (ids.has(d.workUnitId))
      conns.push({ from: d.workUnitId, to: wu.id, condition: d.condition || 'completed', shareContext: d.shareContext || 'none', onFailure: d.condition === 'failed' ? d.onFailure : undefined });
  }
  return conns;
}

function path(from: Pos, to: Pos): { d: string; lx: number; ly: number } {
  const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H, x2 = to.x + NODE_W / 2, y2 = to.y;
  const dy = y2 - y1, dx = x2 - x1, P = 6;
  if (dy > 20) { const cp = Math.max(30, Math.min(dy * .4, 80)); return { d: `M${x1} ${y1}C${x1} ${y1 + cp},${x2} ${y2 - cp},${x2} ${y2 - P}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 }; }
  if (dy < -20) { const o = 50 + Math.abs(dx) * .15, s = dx >= 0 ? 1 : -1, mx = x1 + s * o; return { d: `M${x1} ${y1}C${x1} ${y1 + 40},${mx} ${y1 + 40},${mx} ${(y1 + y2) / 2}S${x2} ${y2 - 40},${x2} ${y2 - P}`, lx: mx, ly: (y1 + y2) / 2 }; }
  const cp = Math.max(50, Math.abs(dx) * .4); return { d: `M${x1} ${y1}C${x1} ${y1 + cp},${x2} ${y2 - cp},${x2} ${y2 - P}`, lx: (x1 + x2) / 2, ly: Math.min(y1, y2) + Math.abs(dy) / 2 + cp * .4 };
}

export default function WorkflowPage() {
  const { getToken } = useAuth();
  const [groups, setGroups] = useState<WFGroup[]>([]);
  const [allWUs, setAllWUs] = useState<WUNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gid, setGid] = useState<string | null>(null); // active group
  const [sel, setSel] = useState<string | null>(null); // selected node
  const [selC, setSelC] = useState<string | null>(null); // selected connection key
  const [drag, setDrag] = useState<string | null>(null);
  const [dragO, setDragO] = useState<Pos>({ x: 0, y: 0 });
  const [drawF, setDrawF] = useState<string | null>(null);
  const [drawM, setDrawM] = useState<Pos>({ x: 0, y: 0 });
  const [pos, setPos] = useState<Record<string, Pos>>({});
  const [conns, setConns] = useState<Connection[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rname, setRname] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  function toNode(w: any): WUNode { return { id: w.id, title: w.title, status: w.status, priceInCents: w.priceInCents || 0, deadlineHours: w.deadlineHours || 24, complexityScore: w.complexityScore || 1, publishConditions: w.publishConditions, scheduledPublishAt: w.scheduledPublishAt, executions: w.executions || [] }; }

  const g = groups.find(x => x.id === gid);
  const nodes: WUNode[] = g?.workUnits || [];
  const wuMap = new Map(nodes.map(n => [n.id, n]));
  const selWU = sel ? wuMap.get(sel) : null;
  const selConn = selC ? conns.find(c => `${c.from}:${c.to}` === selC) : null;
  const pv = Object.values(pos);
  const cw = Math.max(700, ...(pv.length ? pv.map(p => p.x + NODE_W + 60) : [700]));
  const ch = Math.max(400, ...(pv.length ? pv.map(p => p.y + NODE_H + 80) : [400]));
  // Available WUs = all WUs not already in this group
  const groupWUIds = new Set(nodes.map(n => n.id));
  const available = allWUs.filter(w => !groupWUIds.has(w.id));

  // ── Load ──
  async function load() {
    try {
      setLoading(true);
      const t = await getToken(); if (!t) return;
      const [wus, grps] = await Promise.all([
        getWorkUnits(t),
        fetch(`${API_URL}/api/workflow-groups`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      const sg: WFGroup[] = (grps || []).map((x: any) => ({ ...x, workUnits: (x.workUnits || []).map(toNode) }));
      setGroups(sg);
      setAllWUs((wus || []).map(toNode));
      if (sg.length && !gid) setGid(sg[0].id);
    } catch (e: any) { setError(e?.message || 'Load failed'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Rebuild on group switch
  useEffect(() => {
    const ns = g?.workUnits || [];
    const cs = extractConns(ns); setConns(cs);
    const saved = (g?.nodePositions || {}) as Record<string, Pos>;
    const auto = autoLayout(ns, cs);
    const m: Record<string, Pos> = {};
    ns.forEach(n => { m[n.id] = saved[n.id] || auto[n.id] || { x: 30, y: 30 }; });
    setPos(m); setSel(null); setSelC(null);
  }, [gid, groups]);

  // ── API ──
  async function savePos(p: Record<string, Pos>) { if (!gid) return; const t = await getToken(); if (!t) return; fetch(`${API_URL}/api/workflow-groups/${gid}`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ nodePositions: p }) }).catch(() => {}); }
  async function saveConn(wuId: string, cs: Connection[]) { setSaving(true); try { const t = await getToken(); if (!t) return; const wc = cs.filter(c => c.to === wuId); const pc: PublishConditions | null = wc.length ? { logic: 'AND', dependencies: wc.map(c => ({ workUnitId: c.from, condition: c.condition, shareContext: c.shareContext, ...(c.condition === 'failed' ? { onFailure: c.onFailure || 'notify' } : {}) })) } : null; await updateWorkUnit(wuId, { publishConditions: pc }, t); } catch (e: any) { setError(e?.message || 'Save failed'); } finally { setSaving(false); } }
  async function updWU(id: string, f: string, v: any) { setSaving(true); try { const t = await getToken(); if (!t) return; await updateWorkUnit(id, { [f]: v } as any, t); await load(); } catch (e: any) { setError(e?.message || 'Failed'); } finally { setSaving(false); } }
  async function delWU(id: string) { if (!confirm('Delete this task?')) return; setSaving(true); try { const t = await getToken(); if (!t) return; await deleteWorkUnit(id, t); setSel(null); await load(); } catch (e: any) { setError(e?.message || 'Failed'); } finally { setSaving(false); } }
  async function createWU(title: string) { if (!title.trim() || !gid) return; setSaving(true); try { const t = await getToken(); if (!t) return; const d: CreateWorkUnitInput = { title: title.trim(), spec: 'To be defined', category: 'general', priceInCents: 1000, deadlineHours: 48, acceptanceCriteria: [{ criterion: 'Meets requirements', required: true }], deliverableFormat: [] }; const c = await createWorkUnit(d, t); await fetch(`${API_URL}/api/workflow-groups/${gid}/assign`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ addWorkUnitIds: [c.id] }) }); await load(); } catch (e: any) { setError(e?.message || 'Failed'); } finally { setSaving(false); } }
  async function addExisting(wuId: string) { if (!gid) return; const t = await getToken(); if (!t) return; await fetch(`${API_URL}/api/workflow-groups/${gid}/assign`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ addWorkUnitIds: [wuId] }) }); setAddOpen(false); await load(); }
  async function removeWU(wuId: string) { if (!gid) return; const t = await getToken(); if (!t) return; await fetch(`${API_URL}/api/workflow-groups/${gid}/assign`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ removeWorkUnitIds: [wuId] }) }); setSel(null); await load(); }
  async function newGroup() { const t = await getToken(); if (!t) return; const r = await fetch(`${API_URL}/api/workflow-groups`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Space ${groups.length + 1}`, color: COLORS[groups.length % COLORS.length] }) }); if (r.ok) { const ng = await r.json(); setGroups(p => [...p, { ...ng, workUnits: [] }]); setGid(ng.id); } }
  async function delGroup(id: string) { if (!confirm('Delete this space?')) return; const t = await getToken(); if (!t) return; await fetch(`${API_URL}/api/workflow-groups/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }); if (gid === id) setGid(groups.find(x => x.id !== id)?.id || null); await load(); }
  async function renameGroup(id: string, name: string) { if (!name.trim()) return; const t = await getToken(); if (!t) return; await fetch(`${API_URL}/api/workflow-groups/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }); setGroups(p => p.map(x => x.id === id ? { ...x, name: name.trim() } : x)); setRenaming(null); }

  // ── Mouse ──
  const onDown = useCallback((e: React.MouseEvent, id: string) => { if ((e.target as HTMLElement).closest('button')) return; e.preventDefault(); const r = ref.current?.getBoundingClientRect(); if (!r) return; const p = pos[id]; if (!p) return; setDragO({ x: e.clientX - r.left - p.x, y: e.clientY - r.top - p.y }); setDrag(id); setSel(id); setSelC(null); }, [pos]);
  const onMv = useCallback((e: React.MouseEvent) => { const r = ref.current?.getBoundingClientRect(); if (!r) return; const mx = e.clientX - r.left, my = e.clientY - r.top; if (drag) setPos(p => ({ ...p, [drag]: { x: Math.max(0, mx - dragO.x), y: Math.max(0, my - dragO.y) } })); if (drawF) setDrawM({ x: mx, y: my }); }, [drag, dragO, drawF]);
  const onUp = useCallback((e: React.MouseEvent) => { if (drag) savePos(pos); if (drawF) { const r = ref.current?.getBoundingClientRect(); if (r) { const mx = e.clientX - r.left, my = e.clientY - r.top; for (const n of nodes) { const p = pos[n.id]; if (!p || n.id === drawF) continue; if (mx >= p.x && mx <= p.x + NODE_W && my >= p.y && my <= p.y + NODE_H) { if (!conns.some(c => c.from === drawF && c.to === n.id)) { const nc = [...conns, { from: drawF, to: n.id, condition: 'completed' as const, shareContext: 'summary' as const }]; setConns(nc); saveConn(n.id, nc); } break; } } } setDrawF(null); } setDrag(null); }, [drag, drawF, nodes, pos, conns]);
  function dC(f: string, t: string) { const u = conns.filter(c => !(c.from === f && c.to === t)); setConns(u); setSelC(null); saveConn(t, u); }
  function uC(f: string, t: string, k: string, v: string) { const u = conns.map(c => { if (c.from !== f || c.to !== t) return c; const n: any = { ...c, [k]: v }; if (k === 'condition' && v === 'failed' && !n.onFailure) n.onFailure = 'notify'; if (k === 'condition' && v !== 'failed') delete n.onFailure; return n; }); setConns(u); saveConn(t, u); }

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>;

  // ── No groups yet ──
  if (!groups.length) return (
    <div className="h-screen flex flex-col items-center justify-center bg-white">
      <p className="text-slate-500 mb-4">Create your first workflow space</p>
      <button onClick={newGroup} className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg">Create Space</button>
      <Link href="/dashboard/workunits" className="text-xs text-slate-400 mt-3">Back to Work Units</Link>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Tab bar */}
      <div className="flex items-center border-b border-slate-200 flex-shrink-0 px-2">
        <Link href="/dashboard/workunits" className="px-3 py-2.5 text-slate-400 hover:text-slate-600"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="flex items-center flex-1 overflow-x-auto gap-0.5">
          {groups.map(x => (
            <div key={x.id} className={`group/tab flex items-center gap-1 px-3 py-2.5 text-xs cursor-pointer border-b-2 transition-colors whitespace-nowrap ${gid === x.id ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {renaming === x.id ? (
                <input
                  value={rname}
                  onChange={e => setRname(e.target.value)}
                  onBlur={() => renameGroup(x.id, rname)}
                  onKeyDown={e => { if (e.key === 'Enter') renameGroup(x.id, rname); if (e.key === 'Escape') setRenaming(null); }}
                  autoFocus
                  className="bg-transparent border-b border-slate-300 outline-none text-xs font-medium min-w-[60px] max-w-[180px] py-0"
                  style={{ width: `${Math.max(60, rname.length * 7)}px` }}
                />
              ) : (
                <>
                  <span onClick={() => setGid(x.id)} className="font-medium" onDoubleClick={() => { setRenaming(x.id); setRname(x.name); }}>{x.name}</span>
                  {gid === x.id && (
                    <button onClick={() => { setRenaming(x.id); setRname(x.name); }} className="text-slate-300 hover:text-slate-500 opacity-0 group-hover/tab:opacity-100 transition-opacity" title="Rename"><Pencil className="w-2.5 h-2.5" /></button>
                  )}
                </>
              )}
              {gid === x.id && renaming !== x.id && (
                <button onClick={() => delGroup(x.id)} className="text-slate-300 hover:text-slate-500 opacity-0 group-hover/tab:opacity-100 transition-opacity" title="Delete"><X className="w-3 h-3" /></button>
              )}
            </div>
          ))}
          <button onClick={newGroup} className="px-2.5 py-2.5 text-slate-400 hover:text-slate-600" title="New space"><Plus className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex items-center gap-2 px-2">
          {saving && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
          {/* Add task dropdown */}
          {gid && (
            <div className="relative">
              <button onClick={() => setAddOpen(!addOpen)} className="text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5 border border-slate-200 rounded-md flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add <ChevronDown className="w-3 h-3" />
              </button>
              {addOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto">
                  {/* Create new */}
                  <div className="p-2 border-b border-slate-100">
                    <form onSubmit={e => { e.preventDefault(); const inp = (e.target as HTMLFormElement).querySelector('input') as HTMLInputElement; createWU(inp.value); inp.value = ''; setAddOpen(false); }} className="flex gap-1">
                      <input placeholder="New task title..." className="flex-1 text-xs px-2 py-1.5 border border-slate-200 rounded bg-white" />
                      <button type="submit" className="px-2 py-1.5 bg-slate-800 text-white text-xs rounded">Create</button>
                    </form>
                  </div>
                  {/* Existing tasks */}
                  {available.length > 0 ? (
                    <div className="py-1">
                      <p className="px-3 py-1 text-[10px] text-slate-400 uppercase">Existing tasks</p>
                      {available.map(w => (
                        <button key={w.id} onClick={() => addExisting(w.id)} className="w-full text-left px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 flex items-center justify-between">
                          <span className="truncate">{w.title}</span>
                          <span className="text-[10px] text-slate-300 capitalize ml-2 flex-shrink-0">{w.status}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-xs text-slate-400">All tasks are in groups</p>
                  )}
                </div>
              )}
            </div>
          )}
          <button onClick={() => setPos(autoLayout(nodes, conns))} className="text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5 border border-slate-200 rounded-md">Layout</button>
        </div>
      </div>

      {/* Close dropdown on outside click */}
      {addOpen && <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />}

      {error && <div className="px-4 py-1 bg-red-50 text-xs text-red-600 flex items-center gap-2">{error}<button onClick={() => setError(null)} className="ml-auto">×</button></div>}

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-slate-50/30">
          <div ref={ref} className="relative select-none" style={{ width: cw, height: ch, minWidth: '100%', minHeight: '100%' }} onMouseMove={onMv} onMouseUp={onUp} onMouseLeave={onUp} onClick={e => { if (e.target === e.currentTarget) { setSel(null); setSelC(null); } }}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ width: cw, height: ch }}>
              <defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r=".4" fill="#d4d4d8" /></pattern></defs>
              <rect width="100%" height="100%" fill="url(#g)" />
            </svg>
            <svg className="absolute inset-0 pointer-events-none" style={{ width: cw, height: ch, overflow: 'visible' }}>
              <defs>
                <marker id="a" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0L10 3.5L0 7Z" fill="#94a3b8" /></marker>
                <marker id="as" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0 0L10 3.5L0 7Z" fill="#1e293b" /></marker>
              </defs>
              {conns.map(c => { const fp = pos[c.from], tp = pos[c.to]; if (!fp || !tp) return null; const k = `${c.from}:${c.to}`; const s = selC === k; const { d, lx, ly } = path(fp, tp); const tw = c.condition.length * 5.5 + 12; return (
                <g key={k}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer" onClick={() => { setSelC(k); setSel(null); }} />
                  <path d={d} fill="none" stroke={s ? '#1e293b' : '#94a3b8'} strokeWidth={s ? 2 : 1.5} strokeDasharray={c.condition === 'failed' ? '6 4' : 'none'} markerEnd={s ? 'url(#as)' : 'url(#a)'} strokeLinecap="round" />
                  <rect x={lx - tw / 2} y={ly - 9} width={tw} height={18} rx={9} fill="white" stroke={s ? '#94a3b8' : '#e2e8f0'} strokeWidth={1} className="pointer-events-none" />
                  <text x={lx} y={ly + 3} textAnchor="middle" className="pointer-events-none" style={{ fontSize: '9px', fill: s ? '#1e293b' : '#64748b', fontWeight: 500 }}>{c.condition}</text>
                </g>
              ); })}
              {drawF && pos[drawF] && (() => { const fx = pos[drawF].x + NODE_W / 2, fy = pos[drawF].y + NODE_H, cp = Math.max(30, Math.abs(drawM.y - fy) * .4); return <path d={`M${fx} ${fy}C${fx} ${fy + cp},${drawM.x} ${drawM.y - cp},${drawM.x} ${drawM.y}`} fill="none" stroke="#64748b" strokeWidth={1.5} strokeDasharray="6 4" strokeLinecap="round" />; })()}
            </svg>
            {nodes.map(wu => { const p = pos[wu.id]; if (!p) return null; const s = sel === wu.id; const dc = conns.filter(c => c.to === wu.id).length; const exec = wu.executions?.[0]; return (
              <div key={wu.id} className={`absolute rounded-lg border bg-white cursor-grab active:cursor-grabbing transition-shadow ${s ? 'border-slate-400 shadow-md' : 'border-slate-200 hover:border-slate-300 shadow-sm'}`} style={{ left: p.x, top: p.y, width: NODE_W }} onMouseDown={e => onDown(e, wu.id)}>
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-1 mb-0.5"><p className="text-[11px] font-medium text-slate-800 truncate flex-1">{wu.title}</p><span className="text-[9px] text-slate-400 capitalize flex-shrink-0">{wu.status}</span></div>
                  <div className="flex items-center gap-2 text-[9px] text-slate-400"><span>${(wu.priceInCents / 100).toFixed(0)}</span><span>{wu.deadlineHours}h</span>{dc > 0 && <span>{dc} dep</span>}</div>
                  {exec && (
                    <div className="mt-1 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-slate-500 truncate">{exec.student?.name}</span>
                        <span className="text-slate-400 capitalize">{exec.status.replace(/_/g, ' ')}</span>
                      </div>
                      {exec.statusUpdate && <p className="text-[8px] text-slate-400 truncate mt-0.5">{exec.statusUpdate}</p>}
                    </div>
                  )}
                </div>
                <button className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border border-slate-300 hover:bg-slate-50 flex items-center justify-center" onMouseDown={e => { e.stopPropagation(); e.preventDefault(); setDrawF(wu.id); const r = ref.current?.getBoundingClientRect(); if (r) setDrawM({ x: e.clientX - r.left, y: e.clientY - r.top }); }}><Plus className="w-2 h-2 text-slate-400" /></button>
              </div>
            ); })}
            {!nodes.length && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-slate-400">Empty space — click <span className="font-medium">+ Add</span> to add tasks</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-60 border-l border-slate-200 bg-white flex-shrink-0 overflow-y-auto text-xs">
          {selWU ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800 truncate">{selWU.title}</h3><button onClick={() => setSel(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button></div>
              <div className="space-y-1">{[['Status', selWU.status], ['Price', `$${(selWU.priceInCents / 100).toFixed(0)}`], ['Deadline', `${selWU.deadlineHours}h`], ['Complexity', `${selWU.complexityScore}/5`]].map(([l, v]) => <div key={l} className="flex justify-between py-0.5"><span className="text-slate-400">{l}</span><span className="text-slate-700 capitalize">{v}</span></div>)}</div>
              <div className="pt-2 border-t border-slate-100">
                <label className="text-[10px] text-slate-400 uppercase tracking-wider font-medium flex items-center gap-1 mb-1"><Calendar className="w-3 h-3" /> Scheduled</label>
                <input type="datetime-local" value={selWU.scheduledPublishAt ? new Date(selWU.scheduledPublishAt).toISOString().slice(0, 16) : ''} onChange={e => updWU(selWU.id, 'scheduledPublishAt', e.target.value || null)} className="w-full px-2 py-1.5 border border-slate-100 rounded text-[11px] bg-white" min={new Date().toISOString().slice(0, 16)} />
                {selWU.scheduledPublishAt && <button onClick={() => updWU(selWU.id, 'scheduledPublishAt', null)} className="text-[10px] text-slate-400 hover:text-slate-600 mt-1">Clear</button>}
              </div>
              {(() => { const inc = conns.filter(c => c.to === selWU.id); if (!inc.length) return null; return (
                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Dependencies</span>
                  {inc.map(c => { const fw = wuMap.get(c.from); return (
                    <div key={c.from} className="mt-1.5 p-2 border border-slate-100 rounded space-y-1">
                      <div className="flex items-center justify-between"><span className="text-slate-700 truncate">{fw?.title || '…'}</span><button onClick={() => dC(c.from, c.to)} className="text-slate-300 hover:text-slate-500"><Trash2 className="w-3 h-3" /></button></div>
                      <select value={c.condition} onChange={e => uC(c.from, c.to, 'condition', e.target.value)} className="w-full px-1.5 py-1 border border-slate-100 rounded text-[10px] bg-white"><option value="completed">Completed</option><option value="published">Published</option><option value="failed">Failed</option></select>
                      <select value={c.shareContext} onChange={e => uC(c.from, c.to, 'shareContext', e.target.value)} className="w-full px-1.5 py-1 border border-slate-100 rounded text-[10px] bg-white"><option value="none">No sharing</option><option value="summary">Summary</option><option value="full">Full context</option></select>
                      {c.condition === 'failed' && <select value={c.onFailure || 'notify'} onChange={e => uC(c.from, c.to, 'onFailure', e.target.value)} className="w-full px-1.5 py-1 border border-slate-100 rounded text-[10px] bg-white"><option value="publish">Publish</option><option value="cancel">Cancel</option><option value="notify">Notify</option></select>}
                    </div>
                  ); })}
                </div>
              ); })()}
              {/* Contractor progress */}
              {(() => {
                const exec = selWU.executions?.[0];
                if (!exec) return null;
                const ms = exec.milestones || [];
                const completedMs = ms.filter(m => m.completedAt);
                return (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">Contractor</span>
                    <div className="space-y-1">
                      <div className="flex justify-between py-0.5"><span className="text-slate-400">Name</span><span className="text-slate-700">{exec.student?.name}</span></div>
                      <div className="flex justify-between py-0.5"><span className="text-slate-400">Stage</span><span className="text-slate-700 capitalize">{exec.status.replace(/_/g, ' ')}</span></div>
                      {exec.qualityScore != null && <div className="flex justify-between py-0.5"><span className="text-slate-400">Quality</span><span className="text-slate-700">{Math.round(exec.qualityScore * 100)}%</span></div>}
                    </div>
                    {exec.statusUpdate && (
                      <div className="p-2 bg-slate-50 rounded text-[10px] text-slate-600">
                        <span className="text-slate-400 block mb-0.5">Latest update</span>
                        {exec.statusUpdate}
                      </div>
                    )}
                    {ms.length > 0 && (
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">Milestones {completedMs.length}/{ms.length}</span>
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden mb-1">
                          <div className="h-full bg-slate-400 rounded-full transition-all" style={{ width: `${ms.length ? (completedMs.length / ms.length) * 100 : 0}%` }} />
                        </div>
                        {ms.map((m: any) => (
                          <div key={m.id} className="flex items-center gap-1.5 text-[10px] py-0.5">
                            <span className="text-slate-400">{m.completedAt ? '✓' : '○'}</span>
                            <span className={m.completedAt ? 'text-slate-600' : 'text-slate-400'}>{m.description}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {exec.powLogs?.length > 0 && (
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">Recent check-ins</span>
                        {exec.powLogs.map((l: any) => (
                          <div key={l.id} className="text-[10px] py-0.5 flex items-start gap-1.5">
                            <span className="text-slate-400 flex-shrink-0">{l.status === 'submitted' || l.status === 'verified' ? '✓' : '○'}</span>
                            <div className="min-w-0">
                              {l.statusUpdate && <span className="text-slate-600 block truncate">{l.statusUpdate}</span>}
                              {l.workPhotoUrl && <a href={l.workPhotoUrl} target="_blank" rel="noopener" className="text-slate-400 underline">Photo</a>}
                              {!l.statusUpdate && !l.workPhotoUrl && <span className="text-slate-400">{l.status}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <Link href={`/dashboard/workunits/${selWU.id}`} className="block text-center text-slate-500 hover:text-slate-700 py-1.5 border border-slate-200 rounded">Open Detail</Link>
                <button onClick={() => removeWU(selWU.id)} className="w-full text-center text-slate-400 hover:text-slate-600 py-1.5 border border-slate-200 rounded">Remove from Space</button>
                {selWU.status === 'draft' && <button onClick={() => delWU(selWU.id)} className="w-full text-center text-slate-400 hover:text-slate-600 py-1.5 border border-slate-200 rounded">Delete Task</button>}
              </div>
            </div>
          ) : selConn ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">Connection</h3><button onClick={() => setSelC(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button></div>
              <div className="space-y-1"><div className="py-0.5"><span className="text-slate-400">From</span> <span className="text-slate-700 ml-1">{wuMap.get(selConn.from)?.title || '…'}</span></div><div className="py-0.5"><span className="text-slate-400">To</span> <span className="text-slate-700 ml-1">{wuMap.get(selConn.to)?.title || '…'}</span></div></div>
              <div className="space-y-1.5">
                <div><label className="text-[10px] text-slate-400 block mb-0.5">Condition</label><select value={selConn.condition} onChange={e => uC(selConn.from, selConn.to, 'condition', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"><option value="completed">Completed</option><option value="published">Published</option><option value="failed">Failed</option></select></div>
                <div><label className="text-[10px] text-slate-400 block mb-0.5">Sharing</label><select value={selConn.shareContext} onChange={e => uC(selConn.from, selConn.to, 'shareContext', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"><option value="none">None</option><option value="summary">Summary</option><option value="full">Full context</option></select></div>
                {selConn.condition === 'failed' && <div><label className="text-[10px] text-slate-400 block mb-0.5">On Failure</label><select value={selConn.onFailure || 'notify'} onChange={e => uC(selConn.from, selConn.to, 'onFailure', e.target.value)} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-white"><option value="publish">Publish</option><option value="cancel">Cancel</option><option value="notify">Notify</option></select></div>}
              </div>
              <button onClick={() => dC(selConn.from, selConn.to)} className="w-full text-slate-400 hover:text-slate-600 py-1.5 border border-slate-200 rounded">Remove</button>
            </div>
          ) : (
            <div className="p-4 text-slate-400 space-y-2">
              <p className="text-xs">Click a task or connection to edit.</p>
              <p className="text-xs">Drag the + handle to connect tasks.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
