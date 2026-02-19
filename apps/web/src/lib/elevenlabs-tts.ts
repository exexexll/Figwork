/**
 * ElevenLabs Text-to-Speech Client - Ultra Low Latency
 * 
 * Optimized for <100ms time-to-first-audio:
 * - eleven_flash_v2_5 model (~75ms API latency)
 * - PCM streaming (no MP3 decode overhead)
 * - Pre-warmed AudioContext
 * - Chunked streaming playback
 * 
 * https://elevenlabs.io/docs/overview/intro
 */

// ElevenLabs voice IDs
const ELEVENLABS_VOICES: Record<string, string> = {
  alloy: 'pNInz6obpgDQGcFmaJgB', // Adam
  echo: 'EXAVITQu4vr4xnSDxMaL',  // Bella
  fable: 'ErXwobaYiN019PkySvjV', // Antoni
  onyx: 'VR6AewLTigWG4xSOukaG', // Arnold
  nova: 'ThT5KcBeYPX3keUQqHPh', // Dorothy
  shimmer: 'AZnzlk1XvdvUeBnXmlld', // Domi
};

// Flash model for ultra-low latency
const MODEL = 'eleven_flash_v2_5';

// PCM format for zero decode latency
const OUTPUT_FORMAT = 'pcm_24000'; // 24kHz PCM

interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
}

export class ElevenLabsTTSClient {
  private apiKey: string;
  private voiceId: string;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;
  private abortController: AbortController | null = null;
  private animationFrame: number | null = null;
  private scheduledTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private lastSourceEndedResolve: (() => void) | null = null;
  private streamComplete = false;

  // Callbacks
  onSpeakingStart: (() => void) | null = null;
  onSpeakingEnd: (() => void) | null = null;
  onAudioLevel: ((level: number) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey;
    this.voiceId = ELEVENLABS_VOICES[config.voiceId] || config.voiceId;
    // Pre-warm audio context
    this.initAudioContext();
  }

  private async initAudioContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      // Use native sample rate for lowest latency
      this.audioContext = new AudioContext({ 
        sampleRate: 24000,
        latencyHint: 'interactive' // Request lowest latency
      });
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128; // Smaller = faster
      this.analyser.smoothingTimeConstant = 0.3;
      
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    }
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    return this.audioContext;
  }

  private lastAudioLevel = 0;
  private smoothedLevel = 0;
  
  private startAudioLevelMonitoring(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const updateLevel = () => {
      if (!this.isPlaying || !this.analyser) {
        // Smooth fade out instead of instant drop
        this.smoothedLevel *= 0.85;
        if (this.smoothedLevel < 0.01) {
          this.smoothedLevel = 0;
          this.onAudioLevel?.(0);
          return;
        }
        this.onAudioLevel?.(this.smoothedLevel);
        this.animationFrame = requestAnimationFrame(updateLevel);
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);
      // Weighted average for speech frequencies (85-255 Hz range in our 64 bins)
      let sum = 0;
      for (let i = 2; i < 20; i++) {
        sum += dataArray[i];
      }
      const rawLevel = (sum / 18) / 255;
      
      // Smooth the level changes - faster attack, slower decay
      if (rawLevel > this.smoothedLevel) {
        // Fast attack for responsiveness
        this.smoothedLevel = this.smoothedLevel * 0.3 + rawLevel * 0.7;
      } else {
        // Slower decay for pauses in speech
        this.smoothedLevel = this.smoothedLevel * 0.85 + rawLevel * 0.15;
      }
      
      this.lastAudioLevel = rawLevel;
      this.onAudioLevel?.(this.smoothedLevel);
      
      this.animationFrame = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }

  private stopAudioLevelMonitoring(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.onAudioLevel?.(0);
  }

  /**
   * Stream TTS with ultra-low latency
   * Uses chunked streaming - audio plays as it arrives
   */
  async speak(text: string): Promise<void> {
    if (!text.trim()) return;

    const startTime = performance.now();
    this.streamComplete = false;
    
    try {
      const audioContext = await this.initAudioContext();
      this.abortController = new AbortController();
      
      console.log('[TTS] Starting stream for:', text.slice(0, 40) + '...');

      // ElevenLabs streaming endpoint with PCM output
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?output_format=${OUTPUT_FORMAT}&optimize_streaming_latency=4`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: MODEL,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0,
              use_speaker_boost: true,
            },
          }),
          signal: this.abortController.signal,
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('[TTS] API error:', response.status, error);
        this.onError?.(`TTS error: ${response.status}`);
        return;
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Start playback state
      this.isPlaying = true;
      this.scheduledTime = audioContext.currentTime;
      this.onSpeakingStart?.();
      this.startAudioLevelMonitoring();

      const reader = response.body.getReader();
      let isFirstChunk = true;
      let buffer = new Uint8Array(0);
      // OPTIMIZED: Smaller chunks for faster first audio (100ms = 2400 samples at 24kHz)
      const FIRST_CHUNK_SIZE = 2400; // 100ms - ultra fast start
      const NORMAL_CHUNK_SIZE = 4800; // 200ms - smoother playback after first chunk
      let chunkSize = FIRST_CHUNK_SIZE;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        // Append new data to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // Process complete chunks - smaller first chunk for faster start
        while (buffer.length >= chunkSize) {
          const chunk = buffer.slice(0, chunkSize);
          buffer = buffer.slice(chunkSize);
          
          if (isFirstChunk) {
            const ttfb = performance.now() - startTime;
            console.log(`[TTS] Time to first audio: ${ttfb.toFixed(0)}ms ${ttfb > 100 ? '⚠️' : '✓'}`);
            isFirstChunk = false;
            // Switch to larger chunks for smoother playback
            chunkSize = NORMAL_CHUNK_SIZE;
          }

          await this.playPCMChunk(audioContext, chunk);
        }
      }

      // Play remaining buffer
      if (buffer.length > 0) {
        await this.playPCMChunk(audioContext, buffer);
      }

      // Mark stream as complete
      this.streamComplete = true;
      
      // If sources are still playing, wait for them to actually finish
      if (this.sources.length > 0) {
        console.log(`[TTS] Stream complete, waiting for ${this.sources.length} audio sources to finish`);
        await new Promise<void>(resolve => {
          this.lastSourceEndedResolve = resolve;
          
          // Fallback timeout in case onended doesn't fire (shouldn't happen but safety)
          const scheduledDuration = Math.max(0, (this.scheduledTime - audioContext.currentTime) * 1000);
          setTimeout(() => {
            if (this.lastSourceEndedResolve) {
              console.log('[TTS] Fallback timeout - finishing playback');
              this.lastSourceEndedResolve();
              this.lastSourceEndedResolve = null;
            }
          }, scheduledDuration + 500); // Add 500ms buffer for safety
        });
      }

      console.log('[TTS] All audio finished playing');
      this.finishPlayback();
      
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log('[TTS] Playback aborted');
      } else {
        console.error('[TTS] Error:', error);
        this.onError?.(error instanceof Error ? error.message : 'TTS failed');
      }
      this.streamComplete = true;
      this.finishPlayback();
    }
  }

  /**
   * Convert PCM bytes to AudioBuffer and schedule playback
   */
  private async playPCMChunk(audioContext: AudioContext, pcmData: Uint8Array): Promise<void> {
    if (!this.gainNode) return;

    // Convert PCM16 to Float32 (ElevenLabs sends signed 16-bit PCM)
    const samples = pcmData.length / 2;
    const audioBuffer = audioContext.createBuffer(1, samples, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
    for (let i = 0; i < samples; i++) {
      // Read signed 16-bit little-endian, normalize to [-1, 1]
      const sample = dataView.getInt16(i * 2, true);
      channelData[i] = sample / 32768;
    }

    // Schedule playback
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);
    
    // Track sources for cleanup
    this.sources.push(source);
    source.onended = () => {
      const idx = this.sources.indexOf(source);
      if (idx > -1) this.sources.splice(idx, 1);
      
      // If stream is complete and no more sources, we're truly done
      if (this.streamComplete && this.sources.length === 0 && this.lastSourceEndedResolve) {
        this.lastSourceEndedResolve();
        this.lastSourceEndedResolve = null;
      }
    };

    // Schedule at the right time (gapless playback)
    const startAt = Math.max(audioContext.currentTime, this.scheduledTime);
    source.start(startAt);
    this.scheduledTime = startAt + audioBuffer.duration;
  }

  private finishPlayback(): void {
    this.isPlaying = false;
    this.stopAudioLevelMonitoring();
    this.abortController = null;
    this.onSpeakingEnd?.();
  }

  stop(): void {
    // Abort any in-flight request
    this.abortController?.abort();
    this.abortController = null;
    
    // Stop all scheduled sources
    this.sources.forEach(source => {
      try { source.stop(); } catch {}
    });
    this.sources = [];
    
    // Resolve any waiting promise
    if (this.lastSourceEndedResolve) {
      this.lastSourceEndedResolve();
      this.lastSourceEndedResolve = null;
    }
    
    this.streamComplete = true;
    this.finishPlayback();
  }

  setVoice(voiceId: string): void {
    this.voiceId = ELEVENLABS_VOICES[voiceId] || voiceId;
  }

  get speaking(): boolean {
    return this.isPlaying;
  }

  destroy(): void {
    this.stop();
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    this.audioContext = null;
    this.analyser = null;
    this.gainNode = null;
  }
}

// Factory function
export function createTTSClient(voiceId: string, apiKey?: string): ElevenLabsTTSClient | null {
  const key = apiKey || process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
  
  if (!key) {
    console.warn('[TTS] No ElevenLabs API key. Voice output disabled.');
    return null;
  }

  console.log(`[TTS] Creating client with voice: ${voiceId} -> ${ELEVENLABS_VOICES[voiceId] || voiceId}`);

  return new ElevenLabsTTSClient({
    apiKey: key,
    voiceId, // Constructor handles mapping
  });
}
