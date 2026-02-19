'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const variantConfig = {
    danger: {
      icon: 'bg-red-100 text-red-600',
      button: 'bg-red-600 hover:bg-red-700 text-white',
    },
    warning: {
      icon: 'bg-amber-100 text-amber-600',
      button: 'bg-amber-600 hover:bg-amber-700 text-white',
    },
    default: {
      icon: 'bg-[#f3f0f8] text-[#a78bfa]',
      button:
        'text-white [background:var(--gradient-fig)] hover:opacity-90',
    },
  }[variant];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 fade-in duration-150">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg text-[#a0a0b0] hover:text-[#1f1f2e] hover:bg-[#f3f0f8] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon */}
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center mb-4',
            variantConfig.icon
          )}
        >
          <AlertTriangle className="w-6 h-6" />
        </div>

        {/* Content */}
        <h3 className="text-lg font-semibold text-[#1f1f2e] mb-2">{title}</h3>
        <p className="text-sm text-[#6b6b80] leading-relaxed mb-6">
          {description}
        </p>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 text-sm font-medium rounded-xl text-[#6b6b80] bg-white border border-[#e8e4f0] hover:border-[#c4b5fd] transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'px-4 py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50',
              variantConfig.button
            )}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
