'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import {
  User,
  Search,
  Filter,
  ChevronRight,
  Star,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Award,
} from 'lucide-react';

interface Student {
  id: string;
  clerkId: string;
  name: string;
  email: string;
  tier: string;
  totalExp: number;
  tasksCompleted: number;
  avgQualityScore: number;
  onTimeRate: number;
  revisionRate: number;
  recentFailures: number;
  kycStatus: string;
  taxStatus: string;
  contractStatus: string;
}

interface StudentDetail extends Student {
  uploadedFiles: Array<{ id: string; filename: string; fileType: string }>;
  executions: Array<{
    id: string;
    status: string;
    workUnit: { title: string; category: string };
  }>;
  payouts: Array<{ id: string; amountInCents: number; status: string }>;
  disputes: Array<{ id: string; status: string; reason: string }>;
  coachingAnalysis?: {
    needsCoaching: boolean;
    recommendations: Array<{
      trigger: string;
      severity: string;
      title: string;
      message: string;
    }>;
  };
  warnings?: Array<{
    type: string;
    level: string;
    message: string;
  }>;
}

export default function AdminStudentsPage() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState(searchParams.get('tier') || '');
  const [kycFilter, setKycFilter] = useState(searchParams.get('kycStatus') || '');
  const [tierChangeModal, setTierChangeModal] = useState<{
    studentId: string;
    currentTier: string;
  } | null>(null);
  const [tierChangeForm, setTierChangeForm] = useState({ tier: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, [tierFilter, kycFilter]);

  async function fetchStudents() {
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tierFilter) params.set('tier', tierFilter);
      if (kycFilter) params.set('kycStatus', kycFilter);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/students?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } catch (error) {
      console.error('Failed to fetch students:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudentDetail(id: string) {
    setLoadingDetail(true);
    try {
      const token = await getToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/students/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedStudent(data.student);
      }
    } catch (error) {
      console.error('Failed to fetch student detail:', error);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleTierChange(e: React.FormEvent) {
    e.preventDefault();
    if (!tierChangeModal || !tierChangeForm.tier || !tierChangeForm.reason) return;

    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/admin/students/${tierChangeModal.studentId}/tier`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tierChangeForm),
        }
      );

      if (res.ok) {
        setTierChangeModal(null);
        setTierChangeForm({ tier: '', reason: '' });
        fetchStudents();
        if (selectedStudent?.id === tierChangeModal.studentId) {
          fetchStudentDetail(tierChangeModal.studentId);
        }
      }
    } catch (error) {
      console.error('Failed to change tier:', error);
    } finally {
      setSubmitting(false);
    }
  }

  function getTierBadgeColor(tier: string) {
    switch (tier) {
      case 'elite':
        return 'bg-violet-100 text-violet-700 border-violet-200';
      case 'pro':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  }

  function getKYCBadgeColor(status: string) {
    switch (status) {
      case 'verified':
        return 'bg-green-100 text-green-700';
      case 'pending':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-red-100 text-red-700';
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border rounded w-1/4" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-border/50 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Students</h1>
          <p className="text-text-secondary mt-1">
            Manage student profiles, tiers, and performance
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchStudents()}
            placeholder="Search by name or email..."
            className="input w-full pl-10"
          />
        </div>
        <select
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value)}
          className="input"
        >
          <option value="">All Tiers</option>
          <option value="novice">Novice</option>
          <option value="pro">Pro</option>
          <option value="elite">Elite</option>
        </select>
        <select
          value={kycFilter}
          onChange={e => setKycFilter(e.target.value)}
          className="input"
        >
          <option value="">All KYC</option>
          <option value="verified">Verified</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Students Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-border-light">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                Student
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                Tier
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                Stats
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                KYC
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-text-secondary uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {students.map(student => (
              <tr key={student.id} className="hover:bg-gray-50/50">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-light/20 flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{student.name}</p>
                      <p className="text-sm text-text-secondary">{student.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${getTierBadgeColor(
                      student.tier
                    )}`}
                  >
                    {student.tier}
                  </span>
                  <p className="text-xs text-text-secondary mt-1">{student.totalExp} EXP</p>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-amber-500" />
                      <span>{Math.round(student.avgQualityScore * 100)}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <span>{Math.round(student.onTimeRate * 100)}%</span>
                    </div>
                    <span className="text-text-secondary">{student.tasksCompleted} tasks</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${getKYCBadgeColor(
                      student.kycStatus
                    )}`}
                  >
                    {student.kycStatus}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => fetchStudentDetail(student.id)}
                    className="text-primary hover:text-primary-dark text-sm font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {students.length === 0 && (
          <div className="p-12 text-center">
            <User className="w-12 h-12 mx-auto mb-4 text-text-secondary opacity-50" />
            <p className="text-text-secondary">No students found matching your criteria</p>
          </div>
        )}
      </div>

      {/* Student Detail Modal */}
      {selectedStudent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-border-light flex items-center justify-between">
              <h2 className="text-xl font-semibold text-text-primary">
                {selectedStudent.name}
              </h2>
              <button
                onClick={() => setSelectedStudent(null)}
                className="text-text-secondary hover:text-text-primary"
              >
                ✕
              </button>
            </div>

            {loadingDetail ? (
              <div className="p-12 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto" />
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Award className="w-6 h-6 mx-auto mb-2 text-primary" />
                    <p className="text-2xl font-semibold capitalize">{selectedStudent.tier}</p>
                    <p className="text-xs text-text-secondary">{selectedStudent.totalExp} EXP</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Star className="w-6 h-6 mx-auto mb-2 text-amber-500" />
                    <p className="text-2xl font-semibold">
                      {Math.round(selectedStudent.avgQualityScore * 100)}%
                    </p>
                    <p className="text-xs text-text-secondary">Quality Score</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Clock className="w-6 h-6 mx-auto mb-2 text-blue-500" />
                    <p className="text-2xl font-semibold">
                      {Math.round(selectedStudent.onTimeRate * 100)}%
                    </p>
                    <p className="text-xs text-text-secondary">On-Time Rate</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-500" />
                    <p className="text-2xl font-semibold">{selectedStudent.tasksCompleted}</p>
                    <p className="text-xs text-text-secondary">Tasks Completed</p>
                  </div>
                </div>

                {/* Warnings */}
                {selectedStudent.warnings && selectedStudent.warnings.length > 0 && (
                  <div className="p-4 bg-amber-50 rounded-lg">
                    <h3 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Active Warnings
                    </h3>
                    <ul className="space-y-2">
                      {selectedStudent.warnings.map((w, i) => (
                        <li key={i} className="text-sm text-amber-700">
                          <span className="font-medium">[{w.level}]</span> {w.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Coaching */}
                {selectedStudent.coachingAnalysis?.needsCoaching && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="font-medium text-blue-800 mb-2">Coaching Recommendations</h3>
                    <ul className="space-y-2">
                      {selectedStudent.coachingAnalysis.recommendations.map((r, i) => (
                        <li key={i} className="text-sm text-blue-700">
                          <span className="font-medium">{r.title}:</span> {r.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      setTierChangeModal({
                        studentId: selectedStudent.id,
                        currentTier: selectedStudent.tier,
                      })
                    }
                    className="btn-primary px-4 py-2"
                  >
                    Change Tier
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tier Change Modal */}
      {tierChangeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="p-6 border-b border-border-light">
              <h2 className="text-xl font-semibold text-text-primary">Change Student Tier</h2>
            </div>
            <form onSubmit={handleTierChange} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Current Tier: <span className="capitalize">{tierChangeModal.currentTier}</span>
                </label>
                <select
                  value={tierChangeForm.tier}
                  onChange={e => setTierChangeForm({ ...tierChangeForm, tier: e.target.value })}
                  className="input w-full"
                  required
                >
                  <option value="">Select New Tier</option>
                  <option value="novice">Novice</option>
                  <option value="pro">Pro</option>
                  <option value="elite">Elite</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Reason *
                </label>
                <textarea
                  value={tierChangeForm.reason}
                  onChange={e => setTierChangeForm({ ...tierChangeForm, reason: e.target.value })}
                  className="input w-full h-24 resize-none"
                  placeholder="Explain the reason for tier change..."
                  required
                />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting || !tierChangeForm.tier || !tierChangeForm.reason}
                  className="btn-primary px-6 py-2 disabled:opacity-50"
                >
                  {submitting ? 'Updating...' : 'Update Tier'}
                </button>
                <button
                  type="button"
                  onClick={() => setTierChangeModal(null)}
                  className="px-4 py-2 text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
