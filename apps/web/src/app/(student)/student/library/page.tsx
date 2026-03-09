'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  FileText,
  Upload,
  Trash2,
  FolderOpen,
  Search,
  File,
  Image as ImageIcon,
  FileSpreadsheet,
} from 'lucide-react';
import {
  getStudentFiles,
  deleteStudentFile,
  uploadStudentFile,
  StudentFile,
} from '@/lib/marketplace-api';

const ACCENT = '#a2a3fc';

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'resume', label: 'Resume' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'certificate', label: 'Certs' },
  { value: 'other', label: 'Other' },
];

function fileIcon(fileType: string) {
  if (fileType.startsWith('image/')) return ImageIcon;
  if (fileType.includes('spreadsheet') || fileType.includes('csv'))
    return FileSpreadsheet;
  if (fileType.includes('pdf')) return FileText;
  return File;
}

export default function LibraryPage() {
  const { getToken } = useAuth();
  const [files, setFiles] = useState<StudentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const data = await getStudentFiles(token);
      setFiles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load files:', err);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  /* Map browser MIME type → short extension the backend expects */
  function mimeToExt(mime: string, filename: string): string {
    const extFromName = filename.split('.').pop()?.toLowerCase() || '';
    const ALLOWED = ['pdf', 'docx', 'doc', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'zip'];
    if (ALLOWED.includes(extFromName)) return extFromName;
    // Fallback from MIME
    const map: Record<string, string> = {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'text/plain': 'txt',
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'application/zip': 'zip',
      'application/vnd.ms-excel': 'doc',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'docx',
      'text/csv': 'txt',
    };
    return map[mime] || extFromName || 'txt';
  }

  async function handleUpload(selectedFiles: FileList | null) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    try {
      setUploading(true);
      const token = await getToken();
      if (!token) return;
      for (const file of Array.from(selectedFiles)) {
        const category = file.name.toLowerCase().includes('resume')
          ? 'resume'
          : file.name.toLowerCase().includes('cert')
          ? 'certificate'
          : 'portfolio';
        const fileType = mimeToExt(file.type, file.name);
        await uploadStudentFile(
          { filename: file.name, fileType, category },
          token
        );
      }
      await loadFiles();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: string) {
    try {
      setDeletingId(fileId);
      const token = await getToken();
      if (!token) return;
      await deleteStudentFile(fileId, token);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = files.filter((f) => {
    if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        f.filename.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-5 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-[#1f1f2e]">Library</h1>
        <p className="text-xs sm:text-sm text-[#a0a0b0] mt-1">
          Upload and organize your files to help the AI understand your skills and experience.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-5 sm:p-8 text-center mb-5 sm:mb-8 transition-colors cursor-pointer ${
          uploading
            ? 'border-[#a2a3fc] bg-[#f8f8ff]'
            : 'border-[#e0e0e8] hover:border-[#a2a3fc] hover:bg-[#fafaff]'
        }`}
        onClick={() => {
          if (!uploading) document.getElementById('library-file-upload')?.click();
        }}
      >
        <Upload
          className="w-7 h-7 sm:w-8 sm:h-8 mx-auto mb-2 sm:mb-3"
          style={{ color: ACCENT }}
        />
        {uploading ? (
          <p className="text-xs sm:text-sm text-[#6b6b80]">Uploading...</p>
        ) : (
          <>
            <p className="text-xs sm:text-sm text-[#1f1f2e]">
              Drop files here or{' '}
              <span className="font-medium" style={{ color: ACCENT }}>
                browse
              </span>
            </p>
            <p className="text-[10px] sm:text-xs text-[#a0a0b0] mt-1">
              Resume, portfolio, certificates — PDF, DOC, images
            </p>
          </>
        )}
        <input
          id="library-file-upload"
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Search + Category filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 mb-4 sm:mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0a0b0]" />
          <input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-[#f0f0f5] bg-white text-sm text-[#1f1f2e] placeholder:text-[#a0a0b0] focus:outline-none focus:border-[#a2a3fc] transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5 bg-[#f5f5ff] rounded-lg p-0.5 overflow-x-auto flex-shrink-0">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategoryFilter(cat.value)}
              className={`px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                categoryFilter === cat.value
                  ? 'bg-white text-[#1f1f2e] shadow-sm'
                  : 'text-[#a0a0b0] hover:text-[#6b6b80]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* File list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 sm:h-16 bg-[#f5f5ff] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#f0f0f5] p-8 sm:p-12 text-center">
          <FolderOpen className="w-10 h-10 sm:w-12 sm:h-12 text-[#e0e0e8] mx-auto mb-3" />
          <p className="text-[#6b6b80] text-xs sm:text-sm">
            {files.length === 0
              ? 'No files uploaded yet'
              : 'No files match your search'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#f0f0f5] divide-y divide-[#f0f0f5]">
          {filtered.map((file) => {
            const Icon = fileIcon(file.fileType);
            return (
              <div
                key={file.id}
                className="flex items-center justify-between px-3 sm:px-5 py-3 sm:py-4 hover:bg-[#fafafe] transition-colors gap-2"
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center bg-[#f5f5ff] flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" style={{ color: ACCENT }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-medium text-[#1f1f2e] truncate">
                      {file.filename}
                    </div>
                    <div className="text-[10px] sm:text-xs text-[#a0a0b0]">
                      {file.category} · {new Date(file.uploadedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  {file.cloudinaryUrl && (
                    <a
                      href={file.cloudinaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] sm:text-xs font-medium hover:opacity-80"
                      style={{ color: ACCENT }}
                    >
                      View
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(file.id)}
                    disabled={deletingId === file.id}
                    className="p-1 sm:p-1.5 text-[#a0a0b0] hover:text-[#1f1f2e] transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* File count */}
      {!loading && files.length > 0 && (
        <p className="text-[10px] sm:text-xs text-[#a0a0b0] mt-3 sm:mt-4 text-right">
          {filtered.length} of {files.length} file{files.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
