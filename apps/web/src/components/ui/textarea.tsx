import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[100px] w-full rounded-md border border-border bg-white/80 px-4 py-3 text-sm text-text-primary placeholder:text-text-muted',
          'focus:outline-none focus:border-primary-light focus:ring-2 focus:ring-primary-light/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-all duration-200 resize-none',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
