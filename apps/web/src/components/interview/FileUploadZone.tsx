'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { X, FileText, Check, Upload, Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getUploadUrl, registerCandidateFile } from '@/lib/api';
import { toast } from 'sonner';
import type { CandidateFile } from '@/lib/types';

interface FileUploadZoneProps {
  sessionToken: string;
  maxFiles: number;
  maxFileSizeMb: number;
  allowedFileTypes: string[];
  uploadedFiles: CandidateFile[];
  onFileUploaded: (file: CandidateFile) => void;
  onClose?: () => void;
  inline?: boolean; // If true, renders inline instead of as a modal
}

export function FileUploadZone({
  sessionToken,
  maxFiles,
  maxFileSizeMb,
  allowedFileTypes,
  uploadedFiles,
  onFileUploaded,
  onClose,
  inline = false,
}: FileUploadZoneProps) {
  const [uploading, setUploading] = useState(false);

  const handleDrop = async (acceptedFiles: File[]) => {
    if (uploadedFiles.length >= maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed`);
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    // Validate size
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      toast.error(`File must be under ${maxFileSizeMb}MB`);
      return;
    }

    // Validate type
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowedFileTypes.includes(ext)) {
      toast.error(`Only ${allowedFileTypes.join(', ')} files allowed`);
      return;
    }

    setUploading(true);

    try {
      // Get upload URL from backend
      const uploadUrlRes = await getUploadUrl(sessionToken);
      
      if (!uploadUrlRes.success || !uploadUrlRes.data) {
        throw new Error('Failed to get upload URL');
      }
      
      const uploadParams = uploadUrlRes.data;

      // Upload to Cloudinary (unsigned upload with preset)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('public_id', uploadParams.publicId);
      formData.append('upload_preset', uploadParams.uploadPreset);

      let uploadResponse: Response;
      let result: { secure_url?: string; public_id?: string; error?: { message?: string } };
      
      try {
        uploadResponse = await fetch(uploadParams.uploadUrl, {
          method: 'POST',
          body: formData,
        });
        result = await uploadResponse.json();
      } catch (networkError) {
        console.error('Cloudinary network error:', networkError);
        throw new Error('Network error during upload');
      }

      if (!uploadResponse.ok || !result.secure_url) {
        console.error('Cloudinary upload error:', result);
        throw new Error(result?.error?.message || 'Upload to storage failed');
      }

      // Register file with backend using actual public_id from Cloudinary
      const registerRes = await registerCandidateFile(sessionToken, {
        filename: file.name,
        fileType: ext,
        fileSizeBytes: file.size,
        cloudinaryPublicId: result.public_id || uploadParams.publicId,
        cloudinaryUrl: result.secure_url,
      });

      if (!registerRes.success || !registerRes.data) {
        throw new Error('Failed to register file');
      }

      onFileUploaded(registerRes.data);
      toast.success('File uploaded successfully');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // Build accept object dynamically based on allowedFileTypes
  const acceptConfig: Record<string, string[]> = {};
  if (allowedFileTypes.includes('pdf')) {
    acceptConfig['application/pdf'] = ['.pdf'];
  }
  if (allowedFileTypes.includes('docx')) {
    acceptConfig['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] = ['.docx'];
  }
  if (allowedFileTypes.includes('txt')) {
    acceptConfig['text/plain'] = ['.txt'];
  }
  if (allowedFileTypes.includes('md')) {
    acceptConfig['text/markdown'] = ['.md'];
    acceptConfig['text/x-markdown'] = ['.md']; // Alternative MIME type
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    disabled: uploading || uploadedFiles.length >= maxFiles,
    accept: Object.keys(acceptConfig).length > 0 ? acceptConfig : undefined,
    maxFiles: 1,
    // Allow any file and validate manually (more reliable)
    validator: (file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      if (!allowedFileTypes.includes(ext)) {
        return {
          code: 'file-invalid-type',
          message: `Only ${allowedFileTypes.join(', ')} files allowed`,
        };
      }
      return null;
    },
  });

  const content = (
    <>
      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2 mb-4">
          {uploadedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 px-4 py-3 bg-[#faf8fc] rounded-xl"
            >
              <FileText className="w-4 h-4 text-[#a78bfa]" />
              <span className="text-sm text-[#1f1f2e] truncate flex-1">{file.filename}</span>
              <Check className="w-4 h-4 text-[#34d399]" />
            </div>
          ))}
        </div>
      )}

      {/* Dropzone */}
      {uploadedFiles.length < maxFiles && (
        <div
          {...getRootProps()}
          className={cn(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300',
            isDragActive
              ? 'border-[#a78bfa] bg-[#c4b5fd]/10'
              : 'border-[#e8e4f0] hover:border-[#c4b5fd]',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 text-[#a78bfa] animate-spin" />
              <span className="text-sm text-[#6b6b80]">Uploading...</span>
            </div>
          ) : (
            <>
              <div
                className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center"
                style={{ background: 'var(--gradient-fig-subtle)' }}
              >
                <Upload className="w-5 h-5 text-[#a78bfa]" />
              </div>
              <p className="text-sm text-[#1f1f2e]">Drop file here or click to browse</p>
              <p className="text-xs text-[#a0a0b0] mt-1">
                {allowedFileTypes.map((t) => `.${t}`).join(', ')} • Max {maxFileSizeMb}MB
              </p>
            </>
          )}
        </div>
      )}

      {uploadedFiles.length >= maxFiles && (
        <p className="text-xs text-[#a0a0b0] text-center">Maximum {maxFiles} files uploaded</p>
      )}
    </>
  );

  // Inline mode - just render the content directly
  if (inline) {
    return <div className="w-full max-w-md">{content}</div>;
  }

  // Modal mode - render as floating overlay
  return (
    <div className="fixed bottom-32 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-50">
      <div
        className="bg-white/90 backdrop-blur-sm rounded-[20px] p-5 animate-in slide-in-from-bottom-4 duration-300"
        style={{
          boxShadow: '0 8px 32px rgba(167, 139, 250, 0.15)',
          border: '1px solid rgba(232, 228, 240, 0.8)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold text-[#1f1f2e]">Share documents</h4>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#f3f0f8] rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-[#a0a0b0]" />
            </button>
          )}
        </div>
        {content}
      </div>
    </div>
  );
}
