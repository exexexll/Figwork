/**
 * Robust file upload utility with retry logic
 * Handles network failures and provides progress callbacks
 */

interface UploadOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (progress: number) => void;
  onRetry?: (attempt: number, error: Error) => void;
  signal?: AbortSignal;
}

interface UploadResult {
  success: boolean;
  url?: string;
  publicId?: string;
  error?: string;
}

const DEFAULT_OPTIONS: Required<Omit<UploadOptions, 'onProgress' | 'onRetry' | 'signal'>> = {
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * Upload a file to Cloudinary with retry logic
 */
export async function uploadToCloudinary(
  file: Blob,
  filename: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const { maxRetries, retryDelayMs } = { ...DEFAULT_OPTIONS, ...options };
  const { onProgress, onRetry, signal } = options;

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = 'figwork_uploads'; // Unsigned preset

  if (!cloudName) {
    return { success: false, error: 'Cloudinary not configured' };
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Check if aborted
      if (signal?.aborted) {
        return { success: false, error: 'Upload cancelled' };
      }

      const formData = new FormData();
      formData.append('file', file, filename);
      formData.append('upload_preset', uploadPreset);
      formData.append('resource_type', 'auto');

      const response = await uploadWithProgress(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        formData,
        onProgress,
        signal
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      return {
        success: true,
        url: data.secure_url,
        publicId: data.public_id,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if aborted
      if (signal?.aborted || lastError.name === 'AbortError') {
        return { success: false, error: 'Upload cancelled' };
      }

      // Don't retry on client errors (4xx)
      if (lastError.message.includes('400') || lastError.message.includes('401') || 
          lastError.message.includes('403')) {
        return { success: false, error: lastError.message };
      }

      // Notify about retry
      if (attempt < maxRetries) {
        onRetry?.(attempt, lastError);
        console.warn(`Upload attempt ${attempt} failed, retrying in ${retryDelayMs}ms...`, lastError);

        // Exponential backoff
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return { 
    success: false, 
    error: lastError?.message || 'Upload failed after all retries' 
  };
}

/**
 * Fetch with progress tracking
 */
async function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<Response> {
  // If no progress callback, use regular fetch
  if (!onProgress) {
    return fetch(url, {
      method: 'POST',
      body: formData,
      signal,
    });
  }

  // Use XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        onProgress(progress);
      }
    });

    xhr.addEventListener('load', () => {
      const response = new Response(xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: new Headers({
          'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json',
        }),
      });
      resolve(response);
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    xhr.open('POST', url);
    xhr.send(formData);
  });
}

/**
 * Upload audio recording with retry
 */
export async function uploadAudioRecording(
  audioBlob: Blob,
  sessionToken: string,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const filename = `audio_${sessionToken}_${Date.now()}.webm`;
  
  const result = await uploadToCloudinary(audioBlob, filename, {
    ...options,
    maxRetries: options.maxRetries ?? 5, // More retries for audio
    retryDelayMs: options.retryDelayMs ?? 2000,
  });

  if (result.success && result.url) {
    // Register audio URL with backend
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/interview/${sessionToken}/audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl: result.url,
          publicId: result.publicId,
        }),
      });

      if (!response.ok) {
        console.error('Failed to register audio URL with backend');
        // Continue anyway - audio is uploaded
      }
    } catch (error) {
      console.error('Error registering audio URL:', error);
    }
  }

  return result;
}

/**
 * Check if upload should be retried (for external use)
 */
export function shouldRetryUpload(error: Error): boolean {
  // Retry on network errors or 5xx server errors
  if (error.message.includes('Network error') ||
      error.message.includes('500') ||
      error.message.includes('502') ||
      error.message.includes('503') ||
      error.message.includes('504') ||
      error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Create a queue for sequential uploads with retry
 */
export class UploadQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  add(uploadFn: () => Promise<void>): void {
    this.queue.push(uploadFn);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const uploadFn = this.queue.shift()!;
      try {
        await uploadFn();
      } catch (error) {
        console.error('Upload queue item failed:', error);
      }
    }

    this.processing = false;
  }

  get size(): number {
    return this.queue.length;
  }
}
