/**
 * Marketplace WebSocket Client
 * 
 * Connects to the /marketplace namespace for real-time events:
 * - Task status changes (assigned, started, submitted, approved, revision, failed)
 * - POW requests and results
 * - Payout status changes
 * - Deadline warnings and coaching messages
 * - Milestone completions
 */

import { io, Socket } from 'socket.io-client';

// Event constants matching backend
export const MARKETPLACE_EVENTS = {
  POW_REQUEST: 'marketplace:pow:request',
  POW_SUBMITTED: 'marketplace:pow:submitted',
  POW_VERIFIED: 'marketplace:pow:verified',
  POW_FAILED: 'marketplace:pow:failed',

  TASK_ASSIGNED: 'marketplace:task:assigned',
  TASK_STARTED: 'marketplace:task:started',
  TASK_SUBMITTED: 'marketplace:task:submitted',
  TASK_APPROVED: 'marketplace:task:approved',
  TASK_REVISION: 'marketplace:task:revision',
  TASK_FAILED: 'marketplace:task:failed',

  MILESTONE_COMPLETED: 'marketplace:milestone:completed',

  PAYOUT_PENDING: 'marketplace:payout:pending',
  PAYOUT_PROCESSING: 'marketplace:payout:processing',
  PAYOUT_COMPLETED: 'marketplace:payout:completed',

  WARNING_DEADLINE: 'marketplace:warning:deadline',
  WARNING_INACTIVITY: 'marketplace:warning:inactivity',
  WARNING_POW: 'marketplace:warning:pow',

  COACHING_MESSAGE: 'marketplace:coaching:message',
} as const;

export type MarketplaceEventType = typeof MARKETPLACE_EVENTS[keyof typeof MARKETPLACE_EVENTS];

export interface MarketplaceNotification {
  id: string;
  event: MarketplaceEventType;
  data: Record<string, any>;
  timestamp: number;
  read: boolean;
}

type EventHandler = (data: any) => void;

class MarketplaceSocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private notifications: MarketplaceNotification[] = [];
  private notificationListeners: Set<(notifications: MarketplaceNotification[]) => void> = new Set();
  private maxNotifications = 50;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  connect(params: {
    userType: 'student' | 'company';
    userId: string;
    studentId?: string;
    companyId?: string;
  }): void {
    if (this.socket?.connected) {
      console.log('[Marketplace WS] Already connected');
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    this.socket = io(`${apiUrl}/marketplace`, {
      transports: ['websocket'],
      auth: {
        userType: params.userType,
        userId: params.userId,
        studentId: params.studentId,
        companyId: params.companyId,
      },
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    this.socket.on('connect', () => {
      console.log('[Marketplace WS] Connected');
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[Marketplace WS] Disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[Marketplace WS] Connection error:', error);
      this.reconnectAttempts++;
    });

    this.socket.on('error', (data: { message: string }) => {
      console.error('[Marketplace WS] Server error:', data.message);
    });

    this.socket.on('subscribed', (data: { executionId: string }) => {
      console.log(`[Marketplace WS] Subscribed to execution ${data.executionId}`);
    });

    // Register all marketplace event handlers
    this.registerEventForwarding();
  }

  private registerEventForwarding(): void {
    if (!this.socket) return;

    const allEvents = Object.values(MARKETPLACE_EVENTS);

    for (const event of allEvents) {
      this.socket.on(event, (data: any) => {
        // Add to notifications feed
        this.addNotification(event as MarketplaceEventType, data);

        // Forward to registered listeners
        const handlers = this.listeners.get(event);
        if (handlers) {
          handlers.forEach(handler => handler(data));
        }

        // Also fire 'any' listeners
        const anyHandlers = this.listeners.get('*');
        if (anyHandlers) {
          anyHandlers.forEach(handler => handler({ event, data }));
        }
      });
    }
  }

  private addNotification(event: MarketplaceEventType, data: any): void {
    const notification: MarketplaceNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      event,
      data,
      timestamp: Date.now(),
      read: false,
    };

    this.notifications.unshift(notification);

    // Trim to max
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(0, this.maxNotifications);
    }

    // Notify all notification listeners
    this.notificationListeners.forEach(listener => {
      listener([...this.notifications]);
    });
  }

  // ====================
  // PUBLIC API
  // ====================

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler);
    };
  }

  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  subscribeExecution(executionId: string): void {
    this.socket?.emit('subscribe:execution', executionId);
  }

  unsubscribeExecution(executionId: string): void {
    this.socket?.emit('unsubscribe:execution', executionId);
  }

  onNotifications(handler: (notifications: MarketplaceNotification[]) => void): () => void {
    this.notificationListeners.add(handler);
    // Send current notifications immediately
    handler([...this.notifications]);
    return () => {
      this.notificationListeners.delete(handler);
    };
  }

  markRead(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
      this.notificationListeners.forEach(listener => {
        listener([...this.notifications]);
      });
    }
  }

  markAllRead(): void {
    this.notifications.forEach(n => (n.read = true));
    this.notificationListeners.forEach(listener => {
      listener([...this.notifications]);
    });
  }

  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }

  getNotifications(): MarketplaceNotification[] {
    return [...this.notifications];
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.listeners.clear();
    this.notificationListeners.clear();
  }
}

// Singleton instance
export const marketplaceSocket = new MarketplaceSocketClient();

// ====================
// REACT HOOKS
// ====================

import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Hook to connect to marketplace WebSocket
 */
export function useMarketplaceSocket(params: {
  userType: 'student' | 'company';
  userId: string;
  studentId?: string;
  companyId?: string;
  enabled?: boolean;
}) {
  const { userType, userId, studentId, companyId, enabled = true } = params;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !userId) return;

    marketplaceSocket.connect({ userType, userId, studentId, companyId });

    const unsubConnect = marketplaceSocket.on('connect' as any, () => setConnected(true));
    const unsubDisconnect = marketplaceSocket.on('disconnect' as any, () => setConnected(false));

    setConnected(marketplaceSocket.isConnected());

    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, [userType, userId, studentId, companyId, enabled]);

  return { connected, socket: marketplaceSocket };
}

/**
 * Hook to listen to marketplace events
 */
export function useMarketplaceEvent(
  event: MarketplaceEventType | '*',
  handler: EventHandler,
  deps: any[] = []
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrappedHandler = (data: any) => handlerRef.current(data);
    const unsub = marketplaceSocket.on(event, wrappedHandler);
    return unsub;
  }, [event, ...deps]);
}

/**
 * Hook to get real-time notifications
 */
export function useMarketplaceNotifications() {
  const [notifications, setNotifications] = useState<MarketplaceNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const unsub = marketplaceSocket.onNotifications((notifs) => {
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => !n.read).length);
    });
    return unsub;
  }, []);

  const markRead = useCallback((id: string) => {
    marketplaceSocket.markRead(id);
  }, []);

  const markAllRead = useCallback(() => {
    marketplaceSocket.markAllRead();
  }, []);

  return { notifications, unreadCount, markRead, markAllRead };
}

/**
 * Format marketplace event to human-readable notification
 */
export function formatEventMessage(event: MarketplaceEventType, data: any): {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
} {
  switch (event) {
    case MARKETPLACE_EVENTS.TASK_ASSIGNED:
      return { title: 'Task Assigned', message: 'A new task has been assigned', type: 'info' };
    case MARKETPLACE_EVENTS.TASK_STARTED:
      return { title: 'Task Started', message: 'Student has started working', type: 'info' };
    case MARKETPLACE_EVENTS.TASK_SUBMITTED:
      return { title: 'Work Submitted', message: 'A task submission is ready for review', type: 'info' };
    case MARKETPLACE_EVENTS.TASK_APPROVED:
      return { title: 'Task Approved', message: 'Your work has been approved!', type: 'success' };
    case MARKETPLACE_EVENTS.TASK_REVISION:
      return { title: 'Revision Needed', message: 'Your submission needs revisions', type: 'warning' };
    case MARKETPLACE_EVENTS.TASK_FAILED:
      return { title: 'Task Failed', message: 'The task has been marked as failed', type: 'error' };
    case MARKETPLACE_EVENTS.POW_REQUEST:
      return { title: 'POW Required', message: `Submit proof of work within ${data.timeoutMinutes || 10} minutes`, type: 'warning' };
    case MARKETPLACE_EVENTS.POW_VERIFIED:
      return { title: 'POW Verified', message: 'Your proof of work was verified', type: 'success' };
    case MARKETPLACE_EVENTS.POW_FAILED:
      return { title: 'POW Failed', message: data.message || 'Proof of work verification failed', type: 'error' };
    case MARKETPLACE_EVENTS.PAYOUT_COMPLETED:
      return { title: 'Payout Sent', message: `$${((data.amountInCents || 0) / 100).toFixed(2)} has been deposited`, type: 'success' };
    case MARKETPLACE_EVENTS.WARNING_DEADLINE:
      return { title: 'Deadline Warning', message: data.message || 'Deadline approaching', type: 'warning' };
    case MARKETPLACE_EVENTS.WARNING_INACTIVITY:
      return { title: 'Inactivity Alert', message: data.message || 'No recent activity detected', type: 'warning' };
    case MARKETPLACE_EVENTS.COACHING_MESSAGE:
      return { title: 'Coaching Tip', message: data.message || 'New coaching recommendation', type: 'info' };
    default:
      return { title: 'Update', message: 'New marketplace update', type: 'info' };
  }
}
