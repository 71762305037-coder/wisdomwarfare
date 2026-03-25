#!/bin/bash
# Start unified backend server (quiz + crossword on same port)

echo "🚀 Starting unified backend server on port $PORT (default 4001)..."
echo "   This server handles both quiz and crossword games"
node server.js
