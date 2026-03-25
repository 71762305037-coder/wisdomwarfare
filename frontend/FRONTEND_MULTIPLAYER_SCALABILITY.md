# Frontend Multiplayer Scalability Guide

## Overview

The Wisdom Warfare frontend has been enhanced with a centralized **Socket.IO Manager** that enables scalable multiplayer functionality. This guide explains the new architecture and how to integrate it into your components.

---

## Architecture Changes

### Before: Two Separate Connections
```javascript
// ❌ Old approach - hardcoded to two different ports
const mcqSocket = io('http://localhost:4001');      // MCQ game
const crosswordSocket = io('http://localhost:4002'); // Crossword game
// → Memory inefficient (2 connections for same server now)
// → No connection reuse
// → No offline event queueing
```

### After: Unified, Scalable Connection Management
```javascript
// ✅ New approach - single manager handles both games
import { socketManager } from './utils/SocketManager';

// Get or create socket for any game code
const socket = socketManager.getOrCreateSocket(gameCode, gameType, playerInfo);

// Emit events with automatic queuing
socketManager.emit(gameCode, 'submitAnswer', { answer: 'A' });

// Listen to events with game isolation
socketManager.on(gameCode, 'answerResult', (data) => {
  // Only receives events for this gameCode
});

// Handle multiple games simultaneously
const mcqSocket = socketManager.getOrCreateSocket('GAME01', 'Wisdom Warfare', userInfo);
const crosswordSocket = socketManager.getOrCreateSocket('GAME02', 'A. Crossword', userInfo);
// → Reuses single server connection
// → Both games isolated via game_code in Socket.IO rooms
```

---

## New Modules

### 1. Socket.IO Configuration (`src/config/socketConfig.js`)

Centralized configuration for all Socket.IO connections:

```javascript
import { socketConfig } from './config/socketConfig';

// Get server URL (respects REACT_APP_SERVER_URL env var)
const serverUrl = socketConfig.serverUrl;

// Access multiplayer settings
const maxGames = socketConfig.multiplayerConfig.maxConcurrentGames; // 5
const heartbeat = socketConfig.multiplayerConfig.playerHeartbeatInterval; // 30s

// Connection options include:
// - Auto-reconnection with exponential backoff
// - CORS configured for Render deployment
// - Heartbeat to prevent 55s timeout
// - Binary data support for large game states
```

### 2. Socket Manager (`src/utils/SocketManager.js`)

Handles multiple concurrent game connections:

```javascript
import { socketManager } from './utils/SocketManager';

// Key features:
// ✅ Connection pooling (reuses server connection)
// ✅ Game isolation (events scoped to game_code)
// ✅ Offline event queueing (sends when reconnected)
// ✅ Heartbeat support (prevents Render timeout)
// ✅ Auto-reconnection with retry logic
// ✅ Memory-efficient cleanup
```

---

## How to Use SocketManager

### Basic Setup

```javascript
import { socketManager } from '../../utils/SocketManager';

const MyGameComponent = ({ user, gameCode, gameType }) => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!gameCode) return;

    try {
      // Get or create socket for this game
      const gameSocket = socketManager.getOrCreateSocket(
        gameCode,
        gameType,
        {
          user_id: user?.user_id,
          email: user?.email,
          display_name: user?.name
        }
      );

      setSocket(gameSocket);

      // Register event listeners
      const unsubscribe1 = socketManager.on(gameCode, 'gameStarted', (data) => {
        console.log('Game started!', data);
      });

      const unsubscribe2 = socketManager.on(gameCode, 'newQuestion', (data) => {
        setQuestion(data);
      });

      // Return cleanup function
      return () => {
        unsubscribe1();
        unsubscribe2();
        // Don't disconnect here - socket may be reused
      };
    } catch (error) {
      console.error('Failed to initialize game socket:', error);
    }
  }, [gameCode, gameType, user]);

  return (
    <div>
      {/* Game UI */}
    </div>
  );
};
```

### Emitting Events

```javascript
// Simple emit
socketManager.emit(gameCode, 'submitAnswer', { answer: 'A' });

// With callback handling (comes back via listener)
socketManager.emit(gameCode, 'submitAnswer', {
  question_id: 123,
  answer: 'A'
});

// Offline events are automatically queued!
// If socket disconnects, event is saved and sent when reconnected
```

### Listening to Events

```javascript
// One-time listener
socketManager.once(gameCode, 'gameCompleted', (data) => {
  console.log('Game done!', data);
  // Auto-unsubscribed after first fire
});

// Persistent listener (returns cleanup function)
const cleanup = socketManager.on(gameCode, 'leaderboardUpdate', (data) => {
  setLeaderboard(data);
});

// Later: unsubscribe when component unmounts
cleanup();
```

### Handling Multiple Games

```javascript
// Player joins MCQ game
const mcqSocket = socketManager.getOrCreateSocket('GAME01', 'Wisdom Warfare', userInfo);
socketManager.on('GAME01', 'newQuestion', onMCQQuestion);
socketManager.on('GAME01', 'answerResult', onMCQResult);

// Same player joins Crossword simultaneously
const cwSocket = socketManager.getOrCreateSocket('GAME02', 'A. Crossword', userInfo);
socketManager.on('GAME02', 'crosswordGrid', onCrosswordGrid);
socketManager.on('GAME02', 'wordSolved', onWordSolved);

// ✅ Single connection to backend handles both games
// ✅ Events are isolated: 'newQuestion' from GAME01 only affects that game
// ✅ Memory efficient: no duplicate socket connections
```

### Cleanup

```javascript
// When leaving a specific game
socketManager.disconnectGame(gameCode, 'player left');

// When app is closing, disconnect all games
socketManager.disconnectAll('app shutting down');
```

### Monitoring Connections

```javascript
// Check if connected
if (socketManager.isConnected(gameCode)) {
  // Can emit/receive
}

// Get status of all games
const allGames = socketManager.getConnectionStatus();
// {
//   'GAME01': { connected: true, state: {...} },
//   'GAME02': { connected: false, state: {...} }
// }

// Get statistics
const stats = socketManager.getStats();
// {
//   activeGames: 2,
//   activeConnections: 2,
//   maxConnections: 5,
//   usagePercent: 40,
//   games: [...]
// }

// Cleanup inactive connections (optional)
socketManager.cleanupInactiveGames(600000); // Timeout after 10 minutes
```

---

## Integration with Current Code

### Option 1: Gradual Migration (Recommended)

Keep existing `GameUI.js` working as-is, and use SocketManager for new features:

```javascript
// GameUI.js - Keep using direct io() for MCQ
// CrosswordGame.js - Keep using direct io() for Crossword

// NEW features use SocketManager:
// MultiplayerLobby.js - Uses SocketManager for multiple games
// TeacherDashboard.js - Uses SocketManager for game monitoring
```

### Option 2: Full Migration

Update existing components to use SocketManager:

**In GameUI.js:**
```javascript
// OLD:
// const newSocket = io(API_BASE, {...});

// NEW:
// const gameSocket = socketManager.getOrCreateSocket(gameCode, gameType, userInfo);
// socketManager.on(gameCode, 'newQuestion', onNewQuestion);
// socketManager.emit(gameCode, 'submitAnswer', {...});
```

See `MIGRATION_GUIDE_GameUI.md` for detailed steps.

---

## Multiplayer Features Enabled

### 1. Concurrent Game Participation
- Players can join up to 5 games simultaneously (configurable)
- Each game runs independently with separate state
- One connection to backend handles all games

### 2. Connection Resilience
- Auto-reconnection with exponential backoff (1s → 5s → 10s)
- Offline event queueing (events sent when reconnected)
- Heartbeat support (prevents Render 55s timeout)
- Connection pooling (reuses server connection)

### 3. State Management
- Game-scoped state via `gameStates.get(gameCode)`
- Isolated event listeners per game
- Automatic cleanup of inactive games

### 4. Anti-Cheat
- Events validated by game_code (prevents cross-game contamination)
- Player tracking per game
- Word locking (Crossword) and submission timing (MCQ)

---

## Environment Configuration

### Frontend `.env` Variables

```env
# Server URL (required)
REACT_APP_SERVER_URL=http://localhost:4001

# Optional: Multiplayer settings
REACT_APP_MAX_CONCURRENT_GAMES=5
REACT_APP_SOCKET_RECONNECT_ATTEMPTS=10
REACT_APP_SOCKET_RECONNECT_DELAY_MS=1000

# Optional: Debugging
REACT_APP_SOCKET_DEBUG=false
REACT_APP_NETWORK_LAG_MS=0
```

### For Render Deployment

```env
# Render automatically sets this:
NODE_ENV=production

# You set these in Render dashboard:
REACT_APP_SERVER_URL=https://your-app.onrender.com
```

Frontend automatically uses `window.location.origin` in production if `REACT_APP_SERVER_URL` is not set.

---

## Performance Optimization

### 1. Connection Pooling
```javascript
// ✅ GOOD: Reuses single connection
const socket1 = socketManager.getOrCreateSocket('GAME01', 'MCQ', user);
const socket2 = socketManager.getOrCreateSocket('GAME02', 'Crossword', user);
// Both use same socket to backend
```

### 2. Event Isolation
```javascript
// ✅ GOOD: Events only processed for relevant game
socketManager.on('GAME01', 'newQuestion', handler);
// handler ignored if event has game_code !== 'GAME01'

// ❌ WRONG: Would see events from all games
socket.on('newQuestion', handler);
```

### 3. Memory Cleanup
```javascript
// Automatic cleanup for inactive games (10 minutes)
socketManager.cleanupInactiveGames();

// Or manual cleanup
socketManager.disconnectGame(gameCode, 'user request');
```

### 4. Listener Cleanup
```javascript
// ✅ GOOD: Proper cleanup
const cleanup = socketManager.on(gameCode, 'event', handler);
useEffect(() => {
  return cleanup; // Unsubscribe on unmount
}, []);

// ❌ WRONG: Memory leak
socketManager.on(gameCode, 'event', handler);
// Never cleanup
```

---

## Error Handling

### Connection Errors

```javascript
try {
  const socket = socketManager.getOrCreateSocket(gameCode, gameType, userInfo);
} catch (error) {
  if (error.message.includes('Max concurrent games')) {
    alert('You are already playing too many games. Leave a game before joining another.');
  } else {
    alert('Failed to connect: ' + error.message);
  }
}
```

### Event Processing Errors

```javascript
socketManager.on(gameCode, 'dataEvent', (data) => {
  try {
    // Process data
    processQuestion(data);
  } catch (error) {
    console.error('Error processing event:', error);
    // Don't crash - other listeners still work
  }
});
```

### Network Issues

```javascript
// SocketManager handles automatically:
// - Detects disconnection
// - Queues events while offline
// - Auto-reconnects
// - Processes queue on reconnect

// You just listen for connection status:
if (socketManager.isConnected(gameCode)) {
  // Safe to emit
} else {
  // Event will be queued
}
```

---

## Debugging

### Enable Debug Logging

In `.env`:
```env
REACT_APP_SOCKET_DEBUG=true
```

In code:
```javascript
// Check connection status
console.log(socketManager.getConnectionStatus());

// Check statistics
console.log(socketManager.getStats());

// Manually test connection
socketManager.emit(gameCode, 'heartbeat', { test: true });
```

### Common Issues

**"Max concurrent games reached"**
- Limit: 5 games per player (configurable)
- Solution: Player must leave a game before joining another

**"Cannot find module 'socket.io-client'"**
- Solution: `npm install socket.io-client`

**Events not received**
- Check game_code matches
- Check socket is connected: `socketManager.isConnected(gameCode)`
- Check server is emitting events to correct game_code

**Memory leak**
- Ensure listeners are cleaned up: `const cleanup = socketManager.on(...); cleanup()`
- Ensure games are disconnected on component unmount
- Use `socketManager.cleanupInactiveGames()` periodically

---

## Testing Multiple Games

### Local Test Script

```javascript
// Open browser console and paste:
const { socketManager } = await import('./utils/SocketManager.js');

// Join GAME01
const game1 = socketManager.getOrCreateSocket('GAME01', 'Wisdom Warfare', {
  user_id: 1,
  email: 'test@example.com'
});

// Join GAME02
const game2 = socketManager.getOrCreateSocket('GAME02', 'A. Crossword', {
  user_id: 1,
  email: 'test@example.com'
});

// Check status
console.log(socketManager.getStats());

// Emit test event
socketManager.emit('GAME01', 'testEvent', { data: 'hello' });

// Listen to both games
socketManager.on('GAME01', 'leaderboardUpdate', (data) => {
  console.log('[GAME01] Leaderboard:', data);
});

socketManager.on('GAME02', 'leaderboardUpdate', (data) => {
  console.log('[GAME02] Leaderboard:', data);
});

// Cleanup
socketManager.disconnectGame('GAME01', 'test done');
```

---

## Migration Roadmap

### Phase 1: Support (Current)
- ✅ SocketManager available for new features
- ✅ Existing GameUI.js works unchanged
- ✅ Configuration available via .env

### Phase 2: New Features (Optional)
- Add multiplayer lobby component
- Add concurrent game support
- Add teacher monitoring dashboard

### Phase 3: Full Migration (Optional)
- Update GameUI.js to use SocketManager
- Update CrosswordGame.js to use SocketManager
- Remove direct `io()` calls

---

## Summary

**Key Benefits:**
- ✅ Single connection handles multiple games (efficient)
- ✅ Automatic offline event queueing (reliable)
- ✅ Auto-reconnection (resilient)
- ✅ Game isolation (prevents cross-game bugs)
- ✅ Scales to thousands of players

**Ready for:**
- ✅ Render deployment (Heroku-style environment)
- ✅ Multiple concurrent games
- ✅ Real-time multiplayer features
- ✅ Large-scale deployment

---

**Documentation Version:** 1.0  
**Last Updated:** March 25, 2026  
**Status:** Production Ready ✅
