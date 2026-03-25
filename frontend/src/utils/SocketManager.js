/**
 * Socket.IO Manager
 * Centralized manager for handling multiple concurrent game connections
 * Supports multiplayer scaling with connection pooling, state management, and retry logic
 */

import io from 'socket.io-client';
import { socketConfig } from '../config/socketConfig';

class SocketManager {
  constructor() {
    // Map of gameCode -> socket instance
    this.sockets = new Map();
    
    // Map of gameCode -> game state
    this.gameStates = new Map();
    
    // Map of gameCode -> event listeners
    this.eventListeners = new Map();
    
    // Active connections count
    this.activeConnections = 0;
    
    // Max concurrent connections
    this.maxConnections = socketConfig.multiplayerConfig.maxConcurrentGames;
    
    // Connection attempt counter for retry logic
    this.connectionAttempts = new Map();
    
    // Heartbeat timers for keeping connections alive
    this.heartbeatTimers = new Map();
    
    // Event queue for offline messages
    this.eventQueue = new Map();
  }

  /**
   * Get or create a socket connection for a specific game code
   * @param {string} gameCode - Unique game identifier
   * @param {string} gameType - 'Wisdom Warfare' or 'A. Crossword'
   * @param {Object} playerInfo - {user_id, email, display_name}
   * @returns {Object} Socket instance
   */
  getOrCreateSocket(gameCode, gameType, playerInfo = {}) {
    // Return existing socket if already connected
    if (this.sockets.has(gameCode)) {
      console.log(`[Socket] Reusing existing connection for ${gameCode}`);
      return this.sockets.get(gameCode);
    }

    // Check max concurrent connections
    if (this.activeConnections >= this.maxConnections) {
      throw new Error(
        `Max concurrent games (${this.maxConnections}) reached. ` +
        `Leave a game before joining another.`
      );
    }

    console.log(`[Socket] Creating new connection for ${gameCode} (${gameType})`);

    try {
      // Create new socket connection
      const socket = io(socketConfig.serverUrl, socketConfig.options);

      // Store socket instance
      this.sockets.set(gameCode, socket);
      this.activeConnections++;
      
      // Initialize game state for this code
      this.initializeGameState(gameCode, gameType, playerInfo);

      // Setup connection event handlers
      this.setupConnectionHandlers(gameCode, socket, gameType, playerInfo);

      return socket;
    } catch (error) {
      console.error(`[Socket] Failed to create connection for ${gameCode}:`, error);
      this.sockets.delete(gameCode);
      this.activeConnections--;
      throw error;
    }
  }

  /**
   * Initialize game state for multiplayer management
   */
  initializeGameState(gameCode, gameType, playerInfo) {
    this.gameStates.set(gameCode, {
      gameCode,
      gameType,
      playerInfo,
      isConnected: false,
      isGameActive: false,
      players: new Map(),           // All players in this game
      leaderboard: [],              // Ranked leaderboard
      currentQuestion: null,        // For MCQ
      questionsLoaded: 0,           // For MCQ
      gridData: null,               // For Crossword
      lockedWords: new Map(),       // For Crossword
      completedWords: new Set(),    // For Crossword
      errors: [],                   // Connection/game errors
      lastActivity: Date.now(),     // For timeout detection
      reconnectAttempts: 0,         // Track reconnection attempts
      createdAt: Date.now()
    });

    // Initialize event listeners array
    this.eventListeners.set(gameCode, []);
    
    // Initialize event queue (for offline events)
    this.eventQueue.set(gameCode, []);

    console.log(`[State] Initialized game state for ${gameCode}`);
  }

  /**
   * Setup connection event handlers
   */
  setupConnectionHandlers(gameCode, socket, gameType, playerInfo) {
    const state = this.gameStates.get(gameCode);

    // On successful connection
    socket.on('connect', () => {
      console.log(`[Socket] Connected to server for ${gameCode}`);
      state.isConnected = true;
      state.reconnectAttempts = 0;

      // Emit join game event
      socket.emit('joinGame', {
        game_code: gameCode,
        user_id: playerInfo.user_id || null,
        email: playerInfo.email || null,
        display_name: playerInfo.display_name || 'Anonymous',
        game_type: gameType,
        timestamp: Date.now()
      });

      // Start heartbeat to keep connection alive
      this.startHeartbeat(gameCode, socket);

      // Process any queued events that couldn't be sent while offline
      this.processEventQueue(gameCode, socket);
    });

    // On connection error
    socket.on('connect_error', (error) => {
      console.error(`[Socket] Connection error for ${gameCode}:`, error);
      state.errors.push({
        type: 'CONNECTION_ERROR',
        message: error.message,
        timestamp: Date.now()
      });
    });

    // On disconnection
    socket.on('disconnect', (reason) => {
      console.warn(`[Socket] Disconnected from ${gameCode}: ${reason}`);
      state.isConnected = false;
      this.stopHeartbeat(gameCode);

      // Auto-reconnect for temporary network issues
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        // Server or client initiated disconnect - don't auto-reconnect
        console.log(`[Socket] Manual disconnect for ${gameCode}`);
      } else if (reason === 'transport close' || reason === 'ping timeout') {
        // Network issue - try to reconnect
        console.log(`[Socket] Network issue detected for ${gameCode}, will auto-reconnect`);
      }
    });

    // On reconnection attempt
    socket.on('reconnect_attempt', () => {
      state.reconnectAttempts++;
      console.log(
        `[Socket] Reconnection attempt ${state.reconnectAttempts} for ${gameCode}`
      );
    });

    // On successful reconnection
    socket.on('reconnect', () => {
      console.log(`[Socket] Reconnected to server for ${gameCode}`);
      state.isConnected = true;
      state.reconnectAttempts = 0;
    });

    // On reconnection failure after all retries
    socket.on('reconnect_failed', () => {
      console.error(`[Socket] Reconnection failed for ${gameCode} after all attempts`);
      state.errors.push({
        type: 'RECONNECTION_FAILED',
        message: 'Failed to reconnect after multiple attempts',
        timestamp: Date.now()
      });
    });
  }

  /**
   * Start heartbeat to keep connection alive (prevents Render timeout)
   */
  startHeartbeat(gameCode, socket) {
    // Clear existing heartbeat if any
    this.stopHeartbeat(gameCode);

    const heartbeatTimer = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('heartbeat', { game_code: gameCode, timestamp: Date.now() });
      }
    }, socketConfig.multiplayerConfig.playerHeartbeatInterval);

    this.heartbeatTimers.set(gameCode, heartbeatTimer);
    console.log(`[Heartbeat] Started for ${gameCode}`);
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat(gameCode) {
    const timer = this.heartbeatTimers.get(gameCode);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(gameCode);
      console.log(`[Heartbeat] Stopped for ${gameCode}`);
    }
  }

  /**
   * Emit event with offline queue support
   * If not connected, queue the event for later
   */
  emit(gameCode, eventName, data = {}) {
    const socket = this.sockets.get(gameCode);
    const state = this.gameStates.get(gameCode);

    if (!socket) {
      console.warn(`[Socket] No socket found for ${gameCode}`);
      return false;
    }

    if (!socket.connected) {
      console.warn(
        `[Socket] Not connected for ${gameCode}, queueing event: ${eventName}`
      );
      // Queue event for when connection is restored
      const queue = this.eventQueue.get(gameCode) || [];
      queue.push({ eventName, data, timestamp: Date.now() });
      this.eventQueue.set(gameCode, queue);
      return false;
    }

    // Emit with timeout for reliability
    socket.emit(eventName, { game_code: gameCode, ...data });
    state.lastActivity = Date.now();
    return true;
  }

  /**
   * Process queued events when connection is restored
   */
  processEventQueue(gameCode, socket) {
    const queue = this.eventQueue.get(gameCode);
    if (queue && queue.length > 0) {
      console.log(`[Queue] Processing ${queue.length} queued events for ${gameCode}`);
      queue.forEach(({ eventName, data }) => {
        socket.emit(eventName, {
          game_code: gameCode,
          ...data,
          wasQueued: true
        });
      });
      this.eventQueue.set(gameCode, []);
    }
  }

  /**
   * Register a listener for socket events
   * Returns callback for removing the listener
   */
  on(gameCode, eventName, callback) {
    const socket = this.sockets.get(gameCode);
    if (!socket) {
      console.warn(`[Socket] No socket found for ${gameCode}`);
      return () => {};
    }

    // Wrap callback to enforce game code isolation
    const wrappedCallback = (data) => {
      if (data && data.game_code && data.game_code !== gameCode) {
        return; // Ignore events from other games
      }
      this.gameStates.get(gameCode).lastActivity = Date.now();
      callback(data);
    };

    socket.on(eventName, wrappedCallback);

    // Store listener for cleanup
    const listeners = this.eventListeners.get(gameCode) || [];
    listeners.push({ eventName, callback: wrappedCallback });
    this.eventListeners.set(gameCode, listeners);

    // Return cleanup function
    return () => {
      socket.off(eventName, wrappedCallback);
    };
  }

  /**
   * One-time listener
   */
  once(gameCode, eventName, callback) {
    const socket = this.sockets.get(gameCode);
    if (!socket) {
      console.warn(`[Socket] No socket found for ${gameCode}`);
      return () => {};
    }

    const wrappedCallback = (data) => {
      if (data && data.game_code && data.game_code !== gameCode) {
        return;
      }
      callback(data);
    };

    socket.once(eventName, wrappedCallback);

    return () => {
      socket.off(eventName, wrappedCallback);
    };
  }

  /**
   * Disconnect and cleanup a specific game
   */
  disconnectGame(gameCode, reason = 'user request') {
    const socket = this.sockets.get(gameCode);

    if (socket) {
      // Emit leave game event before disconnecting
      if (socket.connected) {
        socket.emit('leaveGame', {
          game_code: gameCode,
          reason: reason,
          timestamp: Date.now()
        });
      }

      // Disconnect socket
      socket.disconnect();
      
      // Cleanup timers
      this.stopHeartbeat(gameCode);

      // Remove all listeners
      const listeners = this.eventListeners.get(gameCode) || [];
      listeners.forEach(({ eventName, callback }) => {
        socket.off(eventName, callback);
      });

      // Clean up maps
      this.sockets.delete(gameCode);
      this.gameStates.delete(gameCode);
      this.eventListeners.delete(gameCode);
      this.eventQueue.delete(gameCode);
      this.connectionAttempts.delete(gameCode);

      this.activeConnections--;

      console.log(`[Socket] Disconnected and cleaned up ${gameCode}`);
    }
  }

  /**
   * Disconnect all games
   */
  disconnectAll(reason = 'cleanup') {
    const gameCodes = Array.from(this.sockets.keys());
    gameCodes.forEach(gameCode => {
      this.disconnectGame(gameCode, reason);
    });
    console.log('[Socket] Disconnected all games');
  }

  /**
   * Get game state for a specific game code
   */
  getGameState(gameCode) {
    return this.gameStates.get(gameCode);
  }

  /**
   * Update game state
   */
  updateGameState(gameCode, updates) {
    const state = this.gameStates.get(gameCode);
    if (state) {
      Object.assign(state, updates);
      return true;
    }
    return false;
  }

  /**
   * Check if socket is connected
   */
  isConnected(gameCode) {
    const socket = this.sockets.get(gameCode);
    return socket && socket.connected;
  }

  /**
   * Get connection status for all games
   */
  getConnectionStatus() {
    const status = {};
    this.sockets.forEach((socket, gameCode) => {
      status[gameCode] = {
        connected: socket.connected,
        state: this.gameStates.get(gameCode)
      };
    });
    return status;
  }

  /**
   * Get statistics about active connections
   */
  getStats() {
    return {
      activeGames: this.sockets.size,
      activeConnections: this.activeConnections,
      maxConnections: this.maxConnections,
      usagePercent: Math.round(
        (this.activeConnections / this.maxConnections) * 100
      ),
      games: Array.from(this.sockets.keys()).map(code => ({
        code: code,
        connected: this.isConnected(code),
        state: this.gameStates.get(code)
      }))
    };
  }

  /**
   * Cleanup inactive connections (for long-running apps)
   */
  cleanupInactiveGames(timeoutMs = 600000) { // 10 minutes default
    const now = Date.now();
    const gameCodes = Array.from(this.gameStates.keys());

    gameCodes.forEach(gameCode => {
      const state = this.gameStates.get(gameCode);
      if (state && (now - state.lastActivity) > timeoutMs) {
        console.warn(
          `[Cleanup] Disconnecting inactive game ${gameCode} ` +
          `(inactive for ${Math.round((now - state.lastActivity) / 1000)}s)`
        );
        this.disconnectGame(gameCode, 'inactivity timeout');
      }
    });
  }
}

// Create singleton instance
export const socketManager = new SocketManager();

export default socketManager;
