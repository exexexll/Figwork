'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import {
  useMarketplaceNotifications,
  formatEventMessage,
  MarketplaceNotification,
  MarketplaceEventType,
} from '@/lib/marketplace-socket';

export function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useMarketplaceNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function getTimeAgo(timestamp: number) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  function getTypeColor(type: 'info' | 'success' | 'warning' | 'error') {
    switch (type) {
      case 'success': return 'bg-green-500';
      case 'warning': return 'bg-amber-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-blue-500';
    }
  }

  return (
    <div className="relative" ref={ref}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-white/60 transition-colors"
      >
        <Bell className="w-5 h-5 text-text-secondary" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-lg border border-border-light overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
            <h3 className="font-semibold text-text-primary text-sm">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-text-secondary text-sm">
                No notifications yet
              </div>
            ) : (
              notifications.slice(0, 20).map(notification => {
                const formatted = formatEventMessage(
                  notification.event as MarketplaceEventType,
                  notification.data
                );
                return (
                  <div
                    key={notification.id}
                    onClick={() => markRead(notification.id)}
                    className={`px-4 py-3 border-b border-border-light last:border-0 cursor-pointer hover:bg-gray-50 transition-colors ${
                      !notification.read ? 'bg-primary-light/5' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${getTypeColor(formatted.type)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary">{formatted.title}</p>
                        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{formatted.message}</p>
                        <p className="text-[10px] text-text-secondary mt-1">{getTimeAgo(notification.timestamp)}</p>
                      </div>
                      {!notification.read && (
                        <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
