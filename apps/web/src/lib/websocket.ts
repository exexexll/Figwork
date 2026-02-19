import { io, Socket } from 'socket.io-client';
import { WS_CLIENT_EVENTS, WS_SERVER_EVENTS } from '@figwork/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Reconnection state tracking
interface ReconnectionState {
  lastQuestionIndex: number;
  lastAiMessage: string;
  pendingTranscript: string;
}

export class InterviewWebSocket {
  private socket: Socket | null = null;
  private messageQueue: Array<{ event: string; data: any }> = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private sessionToken: string | null = null;
  private reconnectionState: ReconnectionState = {
    lastQuestionIndex: 0,
    lastAiMessage: '',
    pendingTranscript: '',
  };
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastPongTime = 0;

  // Event handlers
  onSessionStarted: ((data: { sessionId: string; currentQuestionIndex: number; totalQuestions: number; timeLimitMinutes?: number }) => void) | null = null;
  onAiMessageStart: (() => void) | null = null;
  onAiMessageToken: ((token: string) => void) | null = null;
  onAiMessageEnd: ((message: string) => void) | null = null;
  onQuestionAdvanced: ((index: number, total: number) => void) | null = null;
  onInterviewEnded: (() => void) | null = null;
  onFileReady: ((data: { fileId: string; filename: string }) => void) | null = null;
  onError: ((error: string) => void) | null = null;
  onConnectionChange: ((connected: boolean) => void) | null = null;
  onReconnecting: ((attempt: number) => void) | null = null;
  onTimeWarning: ((remainingMs: number) => void) | null = null;
  onTimeExpired: (() => void) | null = null;
  onStateRestored: ((state: ReconnectionState) => void) | null = null;

  async connect(sessionToken: string): Promise<void> {
    this.sessionToken = sessionToken;
    
    return new Promise((resolve, reject) => {
      this.socket = io(API_URL, {
        auth: { sessionToken },
        transports: ['websocket'], // Skip polling for lower latency
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 500,      // OPTIMIZED: Faster reconnection
        reconnectionDelayMax: 5000,  // OPTIMIZED: Reduced max delay
        timeout: 10000,              // OPTIMIZED: Faster timeout
        // Enable connection state recovery
        query: {
          sessionToken,
        },
        // OPTIMIZED: Enable perMessageDeflate for smaller payloads
        perMessageDeflate: false, // Disable - faster without compression for small messages
      });

      let isFirstConnect = true;

      this.socket.on('connect', () => {
        console.log(`WebSocket ${isFirstConnect ? 'connected' : 'reconnected'}`);
        this.reconnectAttempts = 0;
        this.lastPongTime = Date.now();
        this.onConnectionChange?.(true);

        // Start heartbeat monitoring
        this.startHeartbeat();

        // Flush queued messages
        if (this.messageQueue.length > 0) {
          console.log(`Flushing ${this.messageQueue.length} queued messages`);
          this.messageQueue.forEach(({ event, data }) => {
            this.socket?.emit(event, data);
          });
          this.messageQueue = [];
        }

        // On reconnect (not first connect), restore state
        if (!isFirstConnect) {
          console.log('Restoring state after reconnect');
          this.onStateRestored?.(this.reconnectionState);
        }

        isFirstConnect = false;
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        console.error('WebSocket connection error:', error.message);
        this.onConnectionChange?.(false);
        
        // Only reject on first connection attempt
        if (isFirstConnect && this.reconnectAttempts === 0) {
          reject(error);
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('WebSocket disconnected:', reason);
        this.onConnectionChange?.(false);
        this.stopHeartbeat();
        
        // Handle specific disconnect reasons
        if (reason === 'io server disconnect') {
          // Server disconnected us intentionally (session ended/expired)
          this.onError?.('Session ended by server');
        } else if (reason === 'transport close' || reason === 'ping timeout') {
          // Network issue, will auto-reconnect
          this.onError?.('Connection lost. Reconnecting...');
        } else if (reason === 'transport error') {
          this.onError?.('Network error. Attempting to reconnect...');
        }
      });

      this.socket.io.on('reconnect_attempt', (attempt) => {
        this.reconnectAttempts = attempt;
        this.onReconnecting?.(attempt);
        console.log(`Reconnection attempt ${attempt}/${this.maxReconnectAttempts}`);
      });

      this.socket.io.on('reconnect', (attempt) => {
        console.log(`WebSocket reconnected after ${attempt} attempts`);
        this.onConnectionChange?.(true);
        this.onError?.(''); // Clear error
      });

      this.socket.io.on('reconnect_failed', () => {
        console.error('WebSocket reconnection failed after max attempts');
        this.onError?.('Unable to reconnect. Please refresh the page.');
      });

      // Handle pong for heartbeat
      this.socket.on('pong', () => {
        this.lastPongTime = Date.now();
      });

      // Session started
      this.socket.on(WS_SERVER_EVENTS.SESSION_STARTED, (data) => {
        this.reconnectionState.lastQuestionIndex = data.currentQuestionIndex;
        this.onSessionStarted?.(data);
      });

      // AI message streaming
      this.socket.on(WS_SERVER_EVENTS.AI_MESSAGE_START, () => {
        this.onAiMessageStart?.();
      });

      this.socket.on(WS_SERVER_EVENTS.AI_MESSAGE_TOKEN, (token: string) => {
        this.onAiMessageToken?.(token);
      });

      this.socket.on(WS_SERVER_EVENTS.AI_MESSAGE_END, (message: string) => {
        this.reconnectionState.lastAiMessage = message;
        this.onAiMessageEnd?.(message);
      });

      // Question advanced
      this.socket.on(WS_SERVER_EVENTS.QUESTION_ADVANCED, ({ index, total }) => {
        this.reconnectionState.lastQuestionIndex = index;
        this.onQuestionAdvanced?.(index, total);
      });

      // Interview ended
      this.socket.on(WS_SERVER_EVENTS.INTERVIEW_ENDED, () => {
        this.stopHeartbeat();
        this.onInterviewEnded?.();
      });

      // File ready
      this.socket.on(WS_SERVER_EVENTS.FILE_READY, (data) => {
        this.onFileReady?.(data);
      });

      // Time warning (5 minutes remaining)
      this.socket.on(WS_SERVER_EVENTS.TIME_WARNING, ({ remainingMs }) => {
        this.onTimeWarning?.(remainingMs);
      });

      // Time expired
      this.socket.on(WS_SERVER_EVENTS.TIME_EXPIRED, () => {
        this.stopHeartbeat();
        this.onTimeExpired?.();
      });

      // Error
      this.socket.on(WS_SERVER_EVENTS.ERROR, ({ message }) => {
        this.onError?.(message);
      });
    });
  }

  // Start heartbeat to detect connection issues early
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected) {
        // Send a ping to keep connection alive
        this.socket.emit('ping');
        
        // Check if we haven't received a pong in too long (60s tolerance)
        if (this.lastPongTime > 0 && Date.now() - this.lastPongTime > 60000) {
          console.warn('Heartbeat timeout (60s), connection may be stale');
          // Don't disconnect immediately, just log - Socket.IO handles reconnection
        }
      }
    }, 15000); // Check every 15 seconds instead of 10
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // Save pending transcript for recovery on reconnect
  savePendingTranscript(transcript: string) {
    this.reconnectionState.pendingTranscript = transcript;
  }

  // Get current reconnection state
  getReconnectionState(): ReconnectionState {
    return { ...this.reconnectionState };
  }

  // Send final transcript to backend (natural completion)
  sendTranscript(transcript: string, isAddition: boolean = false) {
    this.emit(WS_CLIENT_EVENTS.CANDIDATE_TRANSCRIPT_FINAL, {
      transcript,
      timestamp: Date.now(),
      isAddition,
    });
  }

  // Sync partial transcript for display
  sendPartialTranscript(partial: string) {
    this.emit(WS_CLIENT_EVENTS.CANDIDATE_TRANSCRIPT_PARTIAL, { partial });
  }

  // User interrupted (clicked X) - send partial transcript as final
  sendInterrupt(partialTranscript: string) {
    this.emit(WS_CLIENT_EVENTS.CANDIDATE_INTERRUPT, {
      transcript: partialTranscript,
      timestamp: Date.now(),
      wasInterrupted: true,
    });
  }

  // Notify mic muted state
  sendMicMuted(muted: boolean) {
    this.emit(WS_CLIENT_EVENTS.MIC_MUTED, { muted });
  }

  // End interview
  endInterview() {
    this.emit(WS_CLIENT_EVENTS.END_INTERVIEW, {});
  }

  private emit(event: string, data: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      // Queue for when connection is restored
      this.messageQueue.push({ event, data });
    }
  }

  disconnect() {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
    this.messageQueue = [];
    this.reconnectionState = {
      lastQuestionIndex: 0,
      lastAiMessage: '',
      pendingTranscript: '',
    };
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}
