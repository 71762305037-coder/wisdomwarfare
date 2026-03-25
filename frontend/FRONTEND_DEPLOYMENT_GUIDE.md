# Frontend Setup & Deployment Guide

## Quick Start

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment Variables

```bash
# Copy template
cp .env.example .env

# Edit .env with your values
nano .env  # or use your favorite editor
```

### .env Configuration

```env
# Local Development
REACT_APP_SERVER_URL=http://localhost:4001
NODE_ENV=development
PORT=3000

# Render Production (auto-set by Render)
# REACT_APP_SERVER_URL=https://your-app.onrender.com
# NODE_ENV=production
```

### 3. Start Development Server

```bash
npm start
```

→ Opens http://localhost:3000

### 4. Build for Production

```bash
npm run build
```

→ Creates `build/` folder ready for deployment

---

## Local Development

### Backend Must Be Running

```bash
# In separate terminal
cd backend
npm install
npm start
```

→ Backend on http://localhost:4001  
→ Frontend on http://localhost:3000

### Test Socket.IO Connection

Open browser console and paste:

```javascript
const { socketManager } = await import('./utils/SocketManager.js');
const socket = socketManager.getOrCreateSocket('TEST_CODE', 'Wisdom Warfare', {
  user_id: 1,
  email: 'test@test.com'
});
console.log('Connected:', socketManager.isConnected('TEST_CODE'));
console.log('Stats:', socketManager.getStats());
```

Expected output:
```
Connected: true
Stats: {
  activeGames: 1,
  activeConnections: 1,
  maxConnections: 5,
  usagePercent: 20,
  ...
}
```

---

## Render Deployment

### Prerequisites
- Frontend code pushed to GitHub
- GitHub account connected to Render
- Backend already deployed to Render

### Step 1: Connect Frontend Repository

1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Select your GitHub repository
4. Choose the `frontend` directory as root directory

### Step 2: Configure Settings

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

**Environment Region:**
Choose closest to your users (e.g., Oregon, Frankfurt)

### Step 3: Set Environment Variables

In Render dashboard → Environment:

```
REACT_APP_SERVER_URL=https://your-backend-app.onrender.com
NODE_ENV=production
```

**Important:** 
- Use your actual backend URL from Render
- Leave default `PORT=3000` (Render assigns its own)

### Step 4: Deploy

1. Click "Create Web Service"
2. Wait for build to complete (3-5 minutes)
3. Check "Logs" tab for errors
4. Copy your app URL: `https://your-app.onrender.com`

### Step 5: Verify Deployment

```bash
# Test health check
curl https://your-app.onrender.com/

# Test socket connection (from browser console)
```

---

## Docker Deployment

### Dockerfile

```dockerfile
# Build stage
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime stage
FROM node:18-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/build ./build
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - REACT_APP_SERVER_URL=http://backend:4001
    depends_on:
      - backend
    networks:
      - wisdom-warfare

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "4001:4001"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - BREVO_API_KEY=${BREVO_API_KEY}
      - NODE_ENV=production
    networks:
      - wisdom-warfare

networks:
  wisdom-warfare:
    driver: bridge
```

### Build & Run

```bash
docker-compose up -d
```

→ Frontend: http://localhost:3000  
→ Backend: http://localhost:4001

---

## Architecture

### Single Unified Frontend

```
┌─────────────────────────────────────────┐
│        React Frontend (Port 3000)       │
├─────────────────────────────────────────┤
│                                         │
│  GameUI.js          CrosswordGame.js    │
│  (MCQ Component)    (Crossword)         │
│  |                  |                   │
│  └─→ SocketManager ←─┘                  │
│      (Connection Pool)                  │
│      |                                  │
│      └─→ Socket.IO Client               │
│          (Heartbeat, Reconnect)         │
│          |                              │
└──────────|──────────────────────────────┘
           |
           ↓
┌──────────────────────────────────────────┐
│    Backend Server (Port 4001)            │
│    ✅ Single Port                        │
│    ✅ Both Games                         │
│    ✅ One Socket.IO Instance             │
│    ✅ Shared Database Pool               │
└──────────────────────────────────────────┘
```

### Key Features

- ✅ **Single Server Connection:** Frontend uses one Socket.IO connection to backend
- ✅ **Game Isolation:** Events scoped by game_code to prevent cross-game contamination
- ✅ **Offline Support:** Events queued while offline, sent on reconnection
- ✅ **Heartbeat:** Sends keep-alive signal every 30s (prevents Render timeout)
- ✅ **Auto-Reconnect:** Exponential backoff: 1s → 5s → 10s delays
- ✅ **Multi-Game:** Players can join up to 5 games simultaneously

---

## Troubleshooting

### Frontend won't connect to backend

**Symptom:** "Cannot GET /" or connection refused

**Solution:**
1. Check backend is running: `curl http://localhost:4001/`
2. Check REACT_APP_SERVER_URL in .env
3. Check CORS in backend `server.js` (should be `'*'` for local dev)

### Socket.IO connection fails

**Symptom:** Console errors like "WebSocket connection failed"

**Solution:**
1. Verify backend Socket.IO is running
2. Check browser console for specific error
3. Test: `curl http://localhost:4001/socket.io/`

### Games not loading

**Symptom:** Blank page or "Game loading..." forever

**Solution:**
1. Check network tab in DevTools
2. Verify REST API calls work: `/game/code/{code}`
3. Check backend database connection
4. Check game code is valid

### Memory leak warnings

**Symptom:** DevTools warnings about memory leaks

**Solution:**
1. Ensure all event listeners are cleaned up
2. Use returned cleanup function from `socketManager.on()`
3. Call `socketManager.disconnectGame()` when leaving

### Render deployment fails

**Symptom:** Build errors or blank page on Render

**Solution:**
1. Check build command: must include `npm run build`
2. Check environment variables are set in Render dashboard
3. Check logs for specific error: Render → Logs tab
4. Verify backend URL is correct and accessible

---

## Performance Tips

### 1. Optimize Bundle Size

```bash
npm run build -- --analyze
```

### 2. Enable Caching

Add to `public/.htaccess`:
```
<FilesMatch "\.(js|css)$">
  Header set Cache-Control "public, max-age=31536000"
</FilesMatch>
```

### 3. Use Code Splitting

```javascript
// Lazy load game components
const GameUI = lazy(() => import('./components/GameUI/GameUI'));
const CrosswordGame = lazy(() => import('./components/GameUI/CrosswordGame'));
```

### 4. Compress Assets

Render automatically gzips static files.

---

## Security

### Don't Expose Secrets

✅ **Correct:**
```javascript
// Environment variable (not visible in build)
const serverUrl = process.env.REACT_APP_SERVER_URL;
```

❌ **Wrong:**
```javascript
// Hardcoded (visible to everyone)
const API_KEY = 'sk-123456789';
```

### HTTPS in Production

- ✅ Render uses HTTPS by default
- ✅ Choose secure region
- ✅ Enable "Redirect HTTP to HTTPS" in Render settings

### Content Security Policy

Add to `public/index.html`:
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self' 'unsafe-inline';">
```

---

## Monitoring

### Check Frontend Health

```bash
# Uptime
curl -I https://your-app.onrender.com/

# Assets load correctly
curl https://your-app.onrender.com/static/js/main.*.js | head -100

# Socket.IO endpoint
wscat -c "ws://localhost:3000/socket.io/socket.io.js"
```

### Browser DevTools

Open DevTools → Network tab:
- ✅ All JS/CSS files loaded
- ✅ Socket.IO connects successfully
- ✅ Game API calls return 200

---

## Common Questions

**Q: Can I deploy frontend to different host than backend?**
A: Yes! Set `REACT_APP_SERVER_URL` to backend URL (different domain okay)

**Q: How many players can one frontend serve?**
A: Browser limit ~5-10 concurrent games (configurable), each game supports 200 players

**Q: Do I need to deploy both frontend and backend?**
A: Yes, both needed. Frontend connects to backend via Socket.IO.

**Q: Can I run multiple frontend instances?**
A: Yes! Each frontend instance connects to same backend. Backend handles scaling.

**Q: How do I rollback to previous version?**
A: Render stores deployments. Go to Render dashboard → Deployments → Redeploy previous

---

## Next Steps

1. ✅ Configure `.env` with server URL
2. ✅ Test locally: `npm start`
3. ✅ Push to GitHub
4. ✅ Deploy to Render: "New Web Service"
5. ✅ Set environment variables
6. ✅ Test on live URL
7. ✅ Monitor logs for errors

---

**Documentation Version:** 1.0  
**Last Updated:** March 25, 2026  
**Status:** Production Ready ✅
