/**
 * Socket.IO Configuration Module
 * Centralized configuration for all Socket.IO connections
 * Supports both development and production environments
 */

/**
 * Get the server URL from environment or defaults to localhost
 * Uses REACT_APP_SERVER_URL or falls back to REACT_APP_API_BASE or localhost:4001
 * Note: Both quiz and crossword run on the same server, so server URL = API base
 */
const getServerUrl = () => {
  // In production (Render), use the environment variable or window origin
  if (process.env.NODE_ENV === 'production') {
    return (
      process.env.REACT_APP_SERVER_URL ||
      process.env.REACT_APP_API_BASE ||
      window.location.origin
    );
  }
  // In development, use environment variable or default to localhost
  return (
    process.env.REACT_APP_SERVER_URL ||
    process.env.REACT_APP_API_BASE ||
    'http://localhost:4001'
  );
};

/**
 * Socket.IO connection options
 * Optimized for multiplayer games and Render deployment
 */
const socketOptions = {
  // Allow both websocket and polling for better compatibility
  transports: ['websocket', 'polling'],
  
  // Auto-reconnection settings for multiplayer resilience
  reconnection: true,
  reconnectionAttempts: 10,              // Try up to 10 times
  reconnectionDelay: 1000,               // Start with 1 second
  reconnectionDelayMax: 5000,            // Max delay 5 seconds
  randomizationFactor: 0.5,              // Add randomness to prevent thundering herd
  
  // Connection timeout
  connectTimeout: 10000,                 // 10 seconds to connect
  
  // Multiplayer game-specific options
  forceNew: false,                       // Reuse existing connections
  autoConnect: true,                     // Auto-connect on initialization
  
  // CORS settings for unified server (single port for both quiz and crossword)
  cors: {
    origin: [
      'http://localhost:3000',           // Local frontend
      'http://localhost:4001',           // Local backend (unified)
      process.env.REACT_APP_DOMAIN || '*'  // Production domain
    ],
    methods: ['GET', 'POST'],
    credentials: true,
    transports: ['websocket', 'polling']
  },
  
  // Optional: Add delay between messages for rate limiting
  autoUnref: false,                      // Keep process alive
  
  // Enable binary data for large game states
  withCredentials: true                  // Send cookies with requests
};

/**
 * Socket.IO Event Timeout
 * Games may have different timeout requirements
 */
const EVENT_TIMEOUT = 30000;              // 30 seconds for game events

/**
 * Game Type Constants
 * Used for socket event identification
 */
const GAME_TYPES = {
  MCQ: 'Wisdom Warfare',
  CROSSWORD: 'A. Crossword'
};

/**
 * Socket.IO Retry Configuration
 * For handling connection failures gracefully
 */
const retryConfig = {
  maxAttempts: 5,
  delayMs: 2000,
  backoffMultiplier: 1.5,
  maxDelayMs: 10000
};

/**
 * Multiplayer Configuration
 * Settings for scaling to multiple simultaneous games
 */
const multiplayerConfig = {
  maxConcurrentGames: 5,                 // Max game codes user can play simultaneously
  maxPlayersPerGame: 200,                // Max players in single game
  playerHeartbeatInterval: 30000,        // Send heartbeat every 30s to keep alive
  playerTimeoutInterval: 60000,          // Remove player if no activity for 60s
  leaderboardUpdateFrequency: 2000,      // Update leaderboard every 2s
  gameCacheExpiryMs: 3600000             // Cache game data for 1 hour
};

/**
 * Create a socket configuration for a specific game
 * @param {string} gameType - 'Wisdom Warfare' or 'A. Crossword'
 * @returns {Object} Socket configuration object
 */
export const createSocketConfig = (gameType = 'Wisdom Warfare') => {
  return {
    url: getServerUrl(),
    options: socketOptions,
    gameType: gameType,
    timeout: EVENT_TIMEOUT,
    ...multiplayerConfig
  };
};

/**
 * Export all configuration
 */
export const socketConfig = {
  serverUrl: getServerUrl(),
  options: socketOptions,
  gameTypes: GAME_TYPES,
  eventTimeout: EVENT_TIMEOUT,
  retryConfig: retryConfig,
  multiplayerConfig: multiplayerConfig,
  
  /**
   * Validate server URL is accessible
   */
  isValidUrl: () => {
    try {
      new URL(getServerUrl());
      return true;
    } catch (error) {
      console.error('Invalid server URL:', error);
      return false;
    }
  },
  
  /**
   * Get full connection string
   */
  getConnectionString: () => {
    return `${getServerUrl()} (${process.env.NODE_ENV} mode)`;
  }
};

export default socketConfig;
