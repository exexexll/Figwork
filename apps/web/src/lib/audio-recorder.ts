const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || '';

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.chunks = [];

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.mediaRecorder.start(1000); // Chunk every second
  }

  stop(): Blob {
    this.mediaRecorder?.stop();
    return new Blob(this.chunks, { type: 'audio/webm' });
  }

  pause() {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resume() {
    if (this.mediaRecorder?.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  get isPaused(): boolean {
    return this.mediaRecorder?.state === 'paused';
  }

  async uploadToCloudinary(
    blob: Blob,
    sessionId: string
  ): Promise<{ url: string; publicId: string }> {
    if (!CLOUDINARY_CLOUD_NAME) {
      throw new Error('Cloudinary not configured');
    }

    const publicId = `figwork/interviews/${sessionId}`;
    const formData = new FormData();
    formData.append('file', blob);
    // Use unsigned upload with preset configured in Cloudinary dashboard
    formData.append('upload_preset', 'Figwork_interviews');
    formData.append('public_id', publicId);

    let response: Response;
    let data: { secure_url?: string; public_id?: string; error?: { message?: string } };
    
    try {
      response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
        { method: 'POST', body: formData }
      );
      data = await response.json();
    } catch (networkError) {
      console.error('Cloudinary network error:', networkError);
      throw new Error('Network error during audio upload');
    }

    if (!response.ok || !data.secure_url) {
      console.error('Cloudinary upload error:', data);
      throw new Error(`Failed to upload audio: ${data?.error?.message || response.statusText}`);
    }

    return {
      url: data.secure_url,
      publicId: data.public_id || publicId,
    };
  }
}
