'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';
import {
  marketplaceSocket,
  formatEventMessage,
  MarketplaceEventType,
} from '@/lib/marketplace-socket';

/**
 * Renders nothing — just listens to marketplace WebSocket events
 * and fires toast notifications for important ones.
 * Mount this inside a layout that has <ToastProvider> as an ancestor.
 */
export function RealtimeToasts() {
  const { toast } = useToast();

  useEffect(() => {
    const unsub = marketplaceSocket.on('*', ({ event, data }: { event: MarketplaceEventType; data: any }) => {
      const formatted = formatEventMessage(event, data);
      toast({
        title: formatted.title,
        message: formatted.message,
        type: formatted.type,
        duration: formatted.type === 'error' ? 8000 : 5000,
      });
    });

    return unsub;
  }, [toast]);

  return null;
}
