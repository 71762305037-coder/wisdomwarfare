# Frontend Migration Guide: GameUI.js & CrosswordGame.js

## Overview

This guide shows how to migrate existing game components to use the new **SocketManager** for improved scalability and reliability.

**Status:** Optional migration  
**Current State:** GameUI.js and CrosswordGame.js work fine with direct `io()` calls  
**Future State:** Use SocketManager for better multi-game support and offline resilience

---

## Why Migrate?

### Current Limitations
```javascript
// ❌ Current: Direct io() call
const socket = io('http://localhost:4001', {...});

// Problems:
// - No offline event queueing
// - No connection pooling (each component creates new connection)
// - No game isolation enforcement (must manually validate game_code)
// - Manual reconnection logic needed
```

### Benefits of SocketManager
```javascript
// ✅ New: Centralized manager
const socket = socketManager.getOrCreateSocket(gameCode, gameType, userInfo);

// Benefits:
// - Automatic offline event queueing
// - Connection pooling (reuse single connection)
// - Automatic game_code isolation
// - Built-in auto-reconnection with heartbeat
// - Support for multiple concurrent games
```

---

## Migration Steps

### Step 1: Update Imports

**GameUI.js - BEFORE:**
```javascript
import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:4001';
```

**GameUI.js - AFTER:**
```javascript
import { socketManager } from '../../utils/SocketManager';
import { socketConfig } from '../../config/socketConfig';

// For REST API calls (if needed)
const API_BASE = process.env.REACT_APP_SERVER_URL || 'http://localhost:4001';
```

### Step 2: Initialize Socket

**BEFORE:**
```javascript
useEffect(() => {
  const newSocket = io(API_BASE, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  socketRef.current = newSocket;
  setSocket(newSocket);

  // ... register listeners
}, [gameCode]);
```

**AFTER:**
```javascript
useEffect(() => {
  if (!gameCode) return;

  try {
    // Get or create socket (SocketManager handles pooling)
    const gameSocket = socketManager.getOrCreateSocket(
      gameCode,
      gameType,
      {
        user_id: user?.user_id || user?.uid,
        email: user?.email,
        display_name: user?.name || 'Player'
      }
    );

    socketRef.current = gameSocket;
    setSocket(gameSocket);

    // Register listeners (shown below)
    registerListeners(gameCode);

    // Cleanup
    return () => {
      // Don't disconnect here - socket may be reused
      // SocketManager handles cleanup
    };
  } catch (error) {
    console.error('Failed to initialize socket:', error);
    if (error.message.includes('Max concurrent games')) {
      alert('You are playing too many games. Leave another game first.');
    }
  }
}, [gameCode, gameType, user]);
```

### Step 3: Register Event Listeners

**BEFORE:**
```javascript
const onConnect = () => {
  console.log('Connected');
  setConnected(true);
  newSocket.emit('joinGame', {
    game_code: gameCode,
    user_id: user?.user_id,
    // ...
  });
};

const onNewQuestion = (question) => {
  if (question.game_code !== gameCode) return; // Manual validation
  setCurrentQuestion(question);
};

// Register
newSocket.on('connect', onConnect);
newSocket.on('newQuestion', onNewQuestion);

// Cleanup
return () => {
  newSocket.off('connect', onConnect);
  newSocket.off('newQuestion', onNewQuestion);
};
```

**AFTER:**
```javascript
const registerListeners = (code) => {
  const unsubscribers = [];

  // Connect event
  unsubscribers.push(
    socketManager.on(code, 'connect', () => {
      console.log('Connected');
      setConnected(true);
      socketManager.emit(code, 'joinGame', {
        user_id: user?.user_id,
        email: user?.email,
        // ... Note: game_code added automatically
      });
    })
  );

  // New question event
  // ✅ SocketManager validates game_code automatically
  unsubscribers.push(
    socketManager.on(code, 'newQuestion', (question) => {
      setCurrentQuestion(question);
    })
  );

  // Answer result event
  unsubscribers.push(
    socketManager.on(code, 'answerResult', (data) => {
      setResult(data);
    })
  );

  // Leaderboard update
  unsubscribers.push(
    socketManager.on(code, 'leaderboardUpdate', (data) => {
      setLeaderboard(data);
    })
  );

  // Game completed
  unsubscribers.push(
    socketManager.on(code, 'gameCompleted', (data) => {
      setGameCompleted(true);
      setFinalResults(data);
    })
  );

  // Return cleanup function
  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
};

// In useEffect return:
return () => {
  const cleanup = registerListeners(gameCode);
  cleanup();
};
```

### Step 4: Emit Events

**BEFORE:**
```javascript
// Emit with direct socket reference
const handleAnswerSubmit = (answer) => {
  socket?.emit('submitAnswer', {
    game_code: gameCode,
    question_id: currentQuestion.id,
    answer: answer
  });
};
```

**AFTER:**
```javascript
// Emit via SocketManager
const handleAnswerSubmit = (answer) => {
  const emitted = socketManager.emit(gameCode, 'submitAnswer', {
    question_id: currentQuestion.id,
    answer: answer
    // ✅ game_code added automatically
  });

  // Check if successfully emitted (offline returns false)
  if (!emitted) {
    console.log('Event queued - will send when reconnected');
  }
};
```

### Step 5: Cleanup on Disconnect

**BEFORE:**
```javascript
const onDisconnect = () => {
  socketRef.current?.disconnect();
  setConnected(false);
};

const handleLeaveGame = () => {
  socket?.emit('leaveGame', { game_code: gameCode });
  socket?.disconnect();
  navigate('/game');
};
```

**AFTER:**
```javascript
const handleLeaveGame = () => {
  socketManager.emit(gameCode, 'leaveGame', {
    // ✅ game_code added automatically
  });
  
  // Disconnect this game (don't reuse socket)
  socketManager.disconnectGame(gameCode, 'user left game');
  
  navigate('/game');
};

// In cleanup (useEffect return):
socketManager.disconnectGame(gameCode, 'component unmounted');
```

---

## CrosswordGame.js Migration

Similar to GameUI.js, but with crossword-specific events:

**BEFORE:**
```javascript
const socket = io(API_BASE, {...});
socket.emit('crosswordLockWord', {game_code, word_id, direction});
socket.on('wordLocked', (data) => {...});
socket.on('wordSolved', (data) => {...});
```

**AFTER:**
```javascript
const socket = socketManager.getOrCreateSocket(gameCode, 'A. Crossword', userInfo);
socketManager.emit(gameCode, 'crosswordLockWord', {word_id, direction});
socketManager.on(gameCode, 'wordLocked', (data) => {...});
socketManager.on(gameCode, 'wordSolved', (data) => {...});
```

---

## Offline Event Support

One of the major benefits of SocketManager is automatic offline event queueing:

```javascript
// Network is down
const isConnected = socketManager.isConnected(gameCode);
// false

// But emit still works (event is queued)
socketManager.emit(gameCode, 'submitAnswer', {answer: 'A'});
// Returns false (offline), but event is queued

// Network comes back
// SocketManager automatically sends queued event
// Component never needs to know about it
```

---

## Connection Status Monitoring

**BEFORE:**
```javascript
// Manual status tracking
const [connected, setConnected] = useState(false);

socket.on('connect', () => setConnected(true));
socket.on('disconnect', () => setConnected(false));
```

**AFTER:**
```javascript
// Use SocketManager status
{
  socketManager.isConnected(gameCode) ? (
    <span>✅ Connected</span>
  ) : (
    <span>⚠️ Reconnecting...</span>
  )
}

// Or watch all games
const stats = socketManager.getStats();
console.log(`${stats.activeGames} games active`);
```

---

## Error Recovery

**BEFORE:**
```javascript
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  // Manual reconnect logic needed
  setTimeout(() => socket.connect(), 1000);
});
```

**AFTER:**
```javascript
// ✅ SocketManager handles all reconnection logic automatically
// No manual intervention needed
// - Exponential backoff: 1s → 5s → 10s
// - Up to 10 reconnection attempts
// - Heartbeat every 30s (prevents timeout)
// - Queued events sent automatically

// Optional: Just log errors
socketManager.on(gameCode, 'connect_error', (error) => {
  console.error('Connection error:', error);
  // SocketManager will auto-reconnect
});
```

---

## Testing the Migration

### 1. Test Local Connection

```bash
npm start
# Navigate to game page
# Check console for SocketManager logs
```

### 2. Test Offline Mode

```javascript
// In browser console:
const { socketManager } = await import('./utils/SocketManager.js');

// Open DevTools Network tab → disconnect
// Emit an event
socketManager.emit('GAME_CODE', 'testEvent', {data: 'test'});
// Console: "Not connected for GAME_CODE, queueing event: testEvent"

// Reconnect network
// Event should be sent automatically
// Server logs should show event received
```

### 3. Test Multiple Games

```javascript
// Simulate two players in different games
const game1 = socketManager.getOrCreateSocket('GAME01', 'Wisdom Warfare', {user_id: 1});
const game2 = socketManager.getOrCreateSocket('GAME02', 'A. Crossword', {user_id: 1});

// Emit to each game
socketManager.emit('GAME01', 'submitAnswer', {answer: 'A'});
socketManager.emit('GAME02', 'wordSolved', {word_id: 5});

// Check stats
console.log(socketManager.getStats());
```

---

## Rollback Plan

If migration causes issues, you can rollback:

```javascript
// Keep calling the direct io() for specific games
const socket = io(API_BASE, {...});

// While using SocketManager for others
const socket2 = socketManager.getOrCreateSocket(code2, type2, user);

// Both can coexist during transition
```

---

## Gradual Migration Strategy

1. **Phase 1 (Week 1):** Deploy SocketManager code, use for new components only
2. **Phase 2 (Week 2):** Internal testing with SocketManager, direct `io()` still used
3. **Phase 3 (Week 3):** Migrate one component (e.g., SpectatorView)
4. **Phase 4 (Week 4):** Monitor for issues, then migrate GameUI.js
5. **Phase 5 (Week 5):** Migrate CrosswordGame.js, remove direct `io()` usage

---

## Monitoring During Migration

Add logging to track issues:

```javascript
// Before migration
console.log('[OLD] Using direct io() connection');

// After migration
console.log('[NEW] Using SocketManager');
console.log('Connected:', socketManager.isConnected(gameCode));
console.log('Stats:', socketManager.getStats());

// Log event emissions
const origEmit = socketManager.emit;
socketManager.emit = function(gameCode, eventName, data) {
  console.log(`[EMIT] ${gameCode}.${eventName}`, data);
  return origEmit.call(this, gameCode, eventName, data);
};
```

---

## Performance Impact

### Before Migration
- Memory: 2 socket connections per 2-game player
- Reconnect: Manual handling
- Offline events: Lost

### After Migration
- Memory: 1 socket connection per player (50% reduction)
- Reconnect: Automatic with exponential backoff
- Offline events: Automatically queued and sent

---

## FAQ

**Q: Will this break existing functionality?**
A: No, SocketManager is compatible with existing event structures. Just need to remove manual `game_code` validation.

**Q: Can I run both approaches simultaneously?**
A: Yes, during transition you can use direct `io()` for some components and `SocketManager` for others.

**Q: How do I know if migration worked?**
A: Open DevTools > Console, should see `[Socket]` and `[Emit]` logs from SocketManager.

**Q: What about authentication?**
A: `socketManager.getOrCreateSocket()` registers joinGame with all provided userInfo automatically.

---

## Summary

**Benefits:**
✅ Single connection (efficient)  
✅ Offline event queuing (reliable)  
✅ Auto-reconnection (resilient)  
✅ Game isolation (safe)  
✅ Multi-game support (scalable)

**Timeline:**
- Recommended: Gradual migration over 5 weeks
- Current: GameUI.js works fine without changes
- Future: Migrate when ready for multi-game features

---

**Documentation Version:** 1.0  
**Last Updated:** March 25, 2026  
**Status:** Optional Migration Path ✅
