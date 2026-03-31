# Render Deployment Configuration for Crossword Leaderboard

## Issue
In production on Render, the frontend cannot connect to port 4002 (crosswordserver.js) because Render only exposes the main service port ($PORT, typically 3000). The crossword Socket.IO handlers are only available on port 4002, so when the frontend connects to the main server, it doesn't have access to crossword events.

## Current Setup
- **Frontend**: Tries to connect based on NODE_ENV
  - Dev: `http://localhost:4002` (crosswordserver.js direct)
  - Prod: `https://wisdomwarfare.onrender.com` (server.js main server)
  
- **Backend**: 
  - `server.js` runs on $PORT (exposed to internet)
  - `crosswordserver.js` runs on port 4002 (internal only, not exposed)

## Solution for Render (Choose One)

### Option A: Merge Crossword into Main Server (Recommended)
Move all crossword logic from `crosswordserver.js` into `server.js`. This is the cleanest solution for cloud deployment.

**Steps:**
1. Copy crossword-related code from `crosswordserver.js` to `server.js`
2. Register crossword Socket.IO handlers in `server.js`'s io instance
3. Remove the separate `crosswordserver.js` spawn from startup
4. Update `package.json` start script

### Option B: Use Internal Socket.IO Proxy
Keep both servers but have `server.js` proxy Socket.IO events to `crosswordserver.js` via internal networking.

The file `backend/crosswordSocketHandlers.js` has been created to support this approach.

**Implementation:**
1. In `server.js`, import and call `attachCrosswordSocketHandlers` in the io.on("connection") handler
2. Provide all required helper functions from the database pool
3. Both sockets connect to the same io instance

### Option C: Run Single Service
Modify Render deployment to only run `server.js` with integrated crossword support (same as Option A).

## Files Prepared
- `backend/crosswordSocketHandlers.js` - Shared socket handler function (reusable for both servers)
- `frontend/src/components/GameUI/CrosswordGame.js` - Updated to connect correctly to `https://wisdomwarfare.onrender.com` in production

## Testing Locally (Dev)
- Frontend connects to `http://localhost:4002` (crosswordserver.js)
- Crossword leaderboard should sync properly
- Logs show `[LEADERBOARD]` messages in console

## Recommendation
**Implement Option A** (merge crosswordserver into server.js) for the cleanest production setup. This eliminates port conflicts and ensures all Socket.IO handlers are available on a single server.
