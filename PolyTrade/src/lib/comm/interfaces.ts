/**
 * Communication Interfaces
 * Defines contracts for listeners and requestors
 */

/**
 * Event listener interface for real-time data streams
 * @template TEvent - Type of events emitted by the listener
 */
export interface IListener<TEvent> {
  /**
   * Subscribe to events
   * @param handler - Callback function to handle events
   * @returns Unsubscribe function
   */
  subscribe(handler: (event: TEvent) => void): () => void;

  /**
   * Disconnect from the data source
   */
  disconnect(): Promise<void>;

  /**
   * Check if listener is currently connected
   */
  isConnected(): boolean;
}

/**
 * Request/response interface for API communication
 * @template TReq - Request type
 * @template TRes - Response type
 */
export interface IRequestor<TReq, TRes> {
  /**
   * Send a request and receive a response
   * @param request - Request object
   * @returns Promise resolving to response
   */
  send(request: TReq): Promise<TRes>;
}

/**
 * Base listener implementation with common functionality
 */
export abstract class BaseListener<TEvent> implements IListener<TEvent> {
  protected handlers: Set<(event: TEvent) => void> = new Set();
  protected connected: boolean = false;

  subscribe(handler: (event: TEvent) => void): () => void {
    this.handlers.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.handlers.delete(handler);
    };
  }

  abstract disconnect(): Promise<void>;

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Emit event to all subscribed handlers
   */
  protected emit(event: TEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }

  /**
   * Get number of active subscribers
   */
  protected getSubscriberCount(): number {
    return this.handlers.size;
  }
}

/**
 * Base requestor implementation with common functionality
 */
export abstract class BaseRequestor<TReq, TRes> implements IRequestor<TReq, TRes> {
  abstract send(request: TReq): Promise<TRes>;
}
