import { useEffect, useState } from 'react';
import { wsClient } from './wsClient';

export function useWsConnection() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Initial connection
    wsClient.connect();
    
    // Subscribe to connection status changes
    const unsubscribe = wsClient.onStatusChange((isConnected) => {
      setConnected(isConnected);
    });

    return () => {
      unsubscribe();
      // Don't disconnect on unmount - let it reconnect
    };
  }, []);

  return connected;
}

export function useWsChannel<T>(channel: 'orderbook' | 'positions' | 'orders' | 'marks' | 'health' | 'spot' | 'iv' | 'pricing', callback: (data: T) => void) {
  useEffect(() => {
    const unsubscribe = wsClient.subscribe(channel, callback as (data: unknown) => void);
    return unsubscribe;
  }, [channel, callback]);
}
