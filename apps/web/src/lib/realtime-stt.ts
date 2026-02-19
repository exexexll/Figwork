import { VAD_CONFIG } from '@figwork/shared';

type TranscriptCallback = (text: string, isFinal: boolean) => void;
type SpeechEventCallback = () => void;
type ConnectionCallback = (connected: boolean) => void;
type ErrorCallback = (error: string) => void;

// OpenAI Realtime API transcription - whisper-1 runs on latest Whisper v3 turbo infrastructure
const TRANSCRIPTION_MODEL = 'whisper-1';

export class RealtimeSTTClient {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private rawAudioStream: MediaStream | null = null; // For visualizer
  private processedAudioStream: MediaStream | null = null; // For STT (noise filtered)
  private audioContext: AudioContext | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private onTranscript: TranscriptCallback | null = null;
  private onSpeechStart: SpeechEventCallback | null = null;
  private onSpeechStop: SpeechEventCallback | null = null;
  private isConnected = false;
  private isMuted = false;
  private onConnectionChange: ConnectionCallback | null = null;
  private onError: ErrorCallback | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private totalReconnectAttempts = 0; // Track total across session (never reset)
  private maxTotalReconnects = 10; // Hard limit for entire session
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private ephemeralToken: string | null = null;
  private isIntentionalClose = false; // Flag to prevent reconnect on intentional close

  // Prewarm connection before interview starts (latency optimization)
  async prewarm(): Promise<MediaStream> {
    try {
      // Request mic permission with aggressive noise suppression from browser
      this.rawAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000, // OpenAI Realtime expects 24kHz
          channelCount: 1, // Mono for cleaner signal
        },
      });
    } catch (err) {
      const error = err as Error;
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied. Please allow microphone access and try again.');
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('No microphone found. Please connect a microphone and try again.');
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('Microphone is in use by another application. Please close other apps using the microphone.');
      } else {
        throw new Error(`Microphone error: ${error.message}`);
      }
    }
    
    // Apply additional audio processing for noise reduction (for STT)
    await this.setupAudioProcessing();
    
    // Return raw stream for visualizer
    return this.rawAudioStream;
  }
  
  // Setup lightweight audio processing for minimal latency
  // Note: Heavy filtering adds latency - we use browser's built-in noise suppression instead
  private async setupAudioProcessing(): Promise<void> {
    if (!this.rawAudioStream) return;
    
    try {
      // Use interactive latency hint for lowest delay
      this.audioContext = new AudioContext({ 
        sampleRate: 24000,
        latencyHint: 'interactive' // Request lowest possible latency
      });
      
      const source = this.audioContext.createMediaStreamSource(this.rawAudioStream);
      
      // Minimal processing: just a gentle high-pass to remove DC offset and rumble
      // Heavy processing adds latency - browser's noiseSuppression handles most noise
      this.noiseFilter = this.audioContext.createBiquadFilter();
      this.noiseFilter.type = 'highpass';
      this.noiseFilter.frequency.value = 80; // Cut below 80Hz only
      this.noiseFilter.Q.value = 0.5; // Gentle slope
      
      // Light compression for consistent levels (fast attack/release)
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.001; // 1ms attack - instant
      compressor.release.value = 0.05; // 50ms release - fast
      
      // Minimal chain: source -> highpass -> compressor -> destination
      source.connect(this.noiseFilter);
      this.noiseFilter.connect(compressor);
      
      const destination = this.audioContext.createMediaStreamDestination();
      compressor.connect(destination);
      
      this.processedAudioStream = destination.stream;
      console.log('[STT] Lightweight audio processing initialized');
    } catch (err) {
      console.warn('Audio processing setup failed, using raw stream:', err);
      this.processedAudioStream = this.rawAudioStream;
    }
  }

  async connect(
    ephemeralToken: string,
    callbacks: {
      onTranscript: TranscriptCallback;
      onSpeechStart?: SpeechEventCallback;
      onSpeechStop?: SpeechEventCallback;
      onConnectionChange?: ConnectionCallback;
      onError?: ErrorCallback;
    }
  ): Promise<void> {
    this.ephemeralToken = ephemeralToken;
    this.onTranscript = callbacks.onTranscript;
    this.onSpeechStart = callbacks.onSpeechStart || null;
    this.onSpeechStop = callbacks.onSpeechStop || null;
    this.onConnectionChange = callbacks.onConnectionChange || null;
    this.onError = callbacks.onError || null;

    // Ensure we have audio streams
    if (!this.rawAudioStream) {
      await this.prewarm();
    }
    
    // Use processed stream for STT (has noise filtering)
    const sttStream = this.processedAudioStream || this.rawAudioStream;
    if (!sttStream) {
      throw new Error('No audio stream available');
    }

    // Create peer connection
    this.pc = new RTCPeerConnection({
      iceServers: [], // No TURN needed for OpenAI direct connection
    });

    // Add processed audio track for STT
    sttStream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, sttStream);
    });

    // Create data channel for receiving transcripts
    this.dataChannel = this.pc.createDataChannel('oai-events');
    this.dataChannel.onopen = () => {
      console.log('[STT] Data channel open');
      this.isConnected = true;
      // DON'T reset reconnectAttempts here - only reset after proven stability
      this.onConnectionChange?.(true);
      
      // Configure session for ULTRA-FAST transcription (<100ms feel)
      // Key: Very short silence duration = frequent transcript updates
      this.sendEvent({
        type: 'session.update',
        session: {
          modalities: ['text'], // Text output only - no TTS
          input_audio_transcription: {
            model: TRANSCRIPTION_MODEL,
          },
          turn_detection: {
            type: 'server_vad',
            threshold: VAD_CONFIG.THRESHOLD,      // 0.5 - more responsive
            prefix_padding_ms: VAD_CONFIG.PREFIX_PADDING_MS, // 200ms - balance
            silence_duration_ms: VAD_CONFIG.SILENCE_DURATION_MS, // 200ms - ultra fast
            create_response: false,               // Don't auto-generate AI response
          },
        },
      });
      
      console.log(`[STT] Session configured: VAD ${VAD_CONFIG.THRESHOLD}, silence ${VAD_CONFIG.SILENCE_DURATION_MS}ms, prefix ${VAD_CONFIG.PREFIX_PADDING_MS}ms`);
      
      // Start keep-alive to prevent timeout during TTS playback
      this.startKeepAlive();
    };
    
    this.dataChannel.onclose = () => {
      console.log('[STT] Data channel closed, intentional:', this.isIntentionalClose);
      this.isConnected = false;
      this.onConnectionChange?.(false);
      
      // Don't reconnect if this was an intentional close (during cleanup/disconnect)
      if (this.isIntentionalClose) {
        return;
      }
      
      // Check all limits before attempting reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts && 
          this.totalReconnectAttempts < this.maxTotalReconnects && 
          this.ephemeralToken) {
        this.reconnectAttempts++;
        this.totalReconnectAttempts++;
        console.log(`[STT] Will attempt reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} (total: ${this.totalReconnectAttempts})`);
        this.onError?.(`Voice connection lost. Reconnecting...`);
        setTimeout(() => {
          this.reconnect();
        }, 1000 * this.reconnectAttempts);
      } else {
        console.log('[STT] Reconnect limit reached, giving up');
        this.onError?.('Voice connection lost. Please refresh the page.');
      }
    };
    
    this.dataChannel.onerror = (event) => {
      console.error('Data channel error:', event);
      this.onError?.('Voice recognition error occurred');
    };
    
    this.dataChannel.onmessage = this.handleMessage.bind(this);
    
    // Monitor peer connection state
    this.pc.onconnectionstatechange = () => {
      console.log('PeerConnection state:', this.pc?.connectionState);
      if (this.pc?.connectionState === 'failed' || this.pc?.connectionState === 'disconnected') {
        this.onConnectionChange?.(false);
      }
    };

    // Create SDP offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Connect to OpenAI Realtime API
    let response: Response;
    try {
      response = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ephemeralToken}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );
    } catch (fetchError) {
      throw new Error('Network error connecting to voice service. Please check your internet connection.');
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Voice service authentication failed. Please refresh the page and try again.');
      } else if (response.status === 403) {
        throw new Error('Voice service access denied. API key may not have Realtime API access.');
      } else if (response.status === 429) {
        throw new Error('Voice service rate limited. Please wait a moment and try again.');
      } else if (response.status >= 500) {
        throw new Error('Voice service temporarily unavailable. Please try again in a few moments.');
      } else {
        throw new Error(`Voice service error (${response.status}). Please refresh and try again.`);
      }
    }

    const answerSdp = await response.text();
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  private sendEvent(event: object) {
    if (this.dataChannel?.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(event));
    }
  }

  private handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      
      // Log key events for debugging
      if (data.type?.includes('transcription') || data.type?.includes('speech')) {
        console.log('[STT]', data.type, data.transcript?.slice(0, 50) || '');
      }

      switch (data.type) {
        // ============================================
        // INPUT TRANSCRIPTION (What user says)
        // NOTE: Realtime API does NOT stream input transcription deltas!
        // We only get final transcripts when speech segment ends.
        // ============================================
        
        // Final transcript for a speech segment (this is the MAIN transcription event)
        case 'conversation.item.input_audio_transcription.completed':
          if (data.transcript) {
            console.log('[STT] Segment complete:', data.transcript);
            // Send as "final" so it gets accumulated
            this.onTranscript?.(data.transcript, true);
          }
          break;
        
        // Transcription failed for some reason
        case 'conversation.item.input_audio_transcription.failed':
          console.warn('[STT] Transcription failed:', data.error);
          break;

        // ============================================
        // SPEECH DETECTION (for UI feedback)
        // These fire IMMEDIATELY - use for visual feedback
        // ============================================
        
        // Speech started - show visual feedback INSTANTLY
        case 'input_audio_buffer.speech_started':
          console.log('[STT] Speech detected');
          this.onSpeechStart?.();
          // Also send empty partial to indicate "listening"
          this.onTranscript?.('', false);
          break;

        // Speech ended - transcript coming soon
        case 'input_audio_buffer.speech_stopped':
          console.log('[STT] Speech ended, awaiting transcript...');
          this.onSpeechStop?.();
          break;
        
        // Audio buffer committed (after speech_stopped)
        case 'input_audio_buffer.committed':
          console.log('[STT] Audio committed for transcription');
          break;

        // ============================================
        // RESPONSE TRANSCRIPTION (AI speaking - not used here)
        // ============================================
        case 'response.audio_transcript.delta':
        case 'response.audio_transcript.done':
          // Ignore - we're not using TTS
          break;

        // ============================================
        // SESSION & ERROR EVENTS
        // ============================================
        case 'session.created':
          console.log('[STT] Session created');
          break;
          
        case 'session.updated':
          console.log('[STT] Session configured');
          break;

        case 'error':
          console.error('[STT] API Error:', data.error);
          this.onError?.(data.error?.message || 'Transcription error');
          break;
          
        default:
          // Log other events for debugging
          if (data.type) {
            console.debug('[STT] Event:', data.type);
          }
      }
    } catch (error) {
      console.error('[STT] Parse error:', error);
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    // Send a ping every 25 seconds to keep connection alive (OpenAI timeout is 30s)
    this.keepAliveInterval = setInterval(() => {
      if (this.dataChannel?.readyState === 'open') {
        try {
          // Send an actual event to keep the connection alive
          this.sendEvent({
            type: 'input_audio_buffer.clear', // Harmless no-op that keeps connection alive
          });
        } catch (e) {
          console.warn('[STT] Keep-alive failed:', e);
        }
      }
    }, 25000);
  }
  
  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  mute() {
    this.isMuted = true;
    console.log('[STT] Muting audio tracks');
    // Mute both streams
    this.rawAudioStream?.getAudioTracks().forEach((track) => (track.enabled = false));
    this.processedAudioStream?.getAudioTracks().forEach((track) => (track.enabled = false));
  }

  unmute() {
    this.isMuted = false;
    console.log('[STT] Unmuting audio tracks');
    
    // Simply unmute the tracks - let onclose handler deal with reconnection if needed
    this.rawAudioStream?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    this.processedAudioStream?.getAudioTracks().forEach((track) => (track.enabled = true));
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /**
   * Attempt to reconnect to the STT service
   */
  private async reconnect(): Promise<void> {
    // Simple guards
    if (!this.ephemeralToken) {
      console.log('[STT] No ephemeral token, cannot reconnect');
      return;
    }
    
    if (this.isConnected && this.dataChannel?.readyState === 'open') {
      console.log('[STT] Already connected, skipping reconnect');
      return;
    }
    
    if (this.totalReconnectAttempts >= this.maxTotalReconnects) {
      console.log('[STT] Total reconnect limit reached');
      return;
    }

    console.log('[STT] Attempting reconnection...');

    // Preserve callbacks and streams
    const callbacks = {
      onTranscript: this.onTranscript!,
      onSpeechStart: this.onSpeechStart || undefined,
      onSpeechStop: this.onSpeechStop || undefined,
      onConnectionChange: this.onConnectionChange || undefined,
      onError: this.onError || undefined,
    };
    const rawStream = this.rawAudioStream;
    const processedStream = this.processedAudioStream;

    // Mark as intentional close so onclose doesn't trigger another reconnect
    this.isIntentionalClose = true;
    
    // Clean up old connection
    this.stopKeepAlive();
    try { this.dataChannel?.close(); } catch (e) { /* ignore */ }
    try { this.pc?.close(); } catch (e) { /* ignore */ }
    
    this.pc = null;
    this.dataChannel = null;
    this.isConnected = false;
    this.rawAudioStream = rawStream;
    this.processedAudioStream = processedStream;

    // Small delay then reconnect
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Reset flag before attempting new connection
    this.isIntentionalClose = false;

    try {
      await this.connect(this.ephemeralToken, callbacks);
      console.log('[STT] Reconnection successful');
      this.reconnectAttempts = 0; // Reset consecutive counter on success
      this.onError?.(''); // Clear error
    } catch (error) {
      console.error('[STT] Reconnection failed:', error);
      // onclose will handle retry if needed
    }
  }

  disconnect() {
    console.log('[STT] Disconnecting...');
    this.isIntentionalClose = true; // Prevent reconnection
    this.stopKeepAlive();
    
    try { this.dataChannel?.close(); } catch (e) { /* ignore */ }
    try { this.pc?.close(); } catch (e) { /* ignore */ }
    
    // Stop all tracks
    this.rawAudioStream?.getTracks().forEach((track) => track.stop());
    this.processedAudioStream?.getTracks().forEach((track) => track.stop());
    
    // Clean up audio processing context
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.noiseFilter = null;
    
    this.isConnected = false;
    this.rawAudioStream = null;
    this.processedAudioStream = null;
    this.pc = null;
    this.dataChannel = null;
    this.ephemeralToken = null; // Clear token to prevent any future reconnects
    this.onConnectionChange?.(false);
  }

  get connected(): boolean {
    return this.isConnected;
  }

  // Return raw stream for visualizer (unprocessed for real-time display)
  get stream(): MediaStream | null {
    return this.rawAudioStream;
  }
}
