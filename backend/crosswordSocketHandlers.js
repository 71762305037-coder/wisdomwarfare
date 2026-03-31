// ============================================================
// SHARED CROSSWORD SOCKET HANDLERS
// Used by both server.js and crosswordserver.js
// This ensures frontend can connect to either instance
// ============================================================

function attachCrosswordSocketHandlers(io, {
  crosswordSessions,
  crosswordGameStatus,
  crosswordLocks,
  crosswordWaitingPlayers,
  crosswordTimers,
  pool,
  CROSSWORD_GAME_DURATION_MS,
  
  // Helper functions
  emitCrosswordGrid,
  emitCrosswordLeaderboard,
  emitWaitingLeaderboard,
  getCrosswordWaitingLeaderboardRows,
  ensureCrosswordLeaderboardEntry,
  getSolvedWordIdsForUser,
  getOrCreateSolvedUserSet,
  getRemainingCrosswordTimeMs,
  hasPlayableCrosswordSession,
  upsertCrosswordScore,
  getWaitingPlayerMap,
  clearCrosswordTimer,
}) {
  io.on("connection", (socket) => {
    console.log("✅ Crossword socket connected:", socket.id);

    socket.on("joinGame", async ({ game_code, user_id, email, display_name, previously_exited }) => {
      if (game_code) {
        socket.join(game_code);
        socket.data.game_code = game_code;
        socket.data.user_id = user_id;
        socket.data.email = email || null;
        socket.data.display_name = display_name || null;
        socket.data.previously_exited = Boolean(previously_exited);
        console.log(`📊 Socket ${socket.id} (User: ${user_id}) joined crossword game: ${game_code}`);

        if (user_id) {
          getWaitingPlayerMap(game_code).set(String(user_id), {
            user_id,
            email: email || null,
            display_name: display_name || email || null,
          });
        }

        const status = crosswordGameStatus.get(game_code);

        if (!status) {
          emitWaitingLeaderboard(game_code);
          socket.emit("crosswordStatus", {
            started: false,
            completed: false,
            game_code,
            sessionId: null,
            message: "Waiting for teacher to start the crossword",
          });
        } else if (status.completed) {
          crosswordGameStatus.set(game_code, {
            ...status,
            started: false,
            completed: false,
            sessionId: null,
          });

          emitWaitingLeaderboard(game_code);
          socket.emit("crosswordStatus", {
            started: false,
            completed: false,
            game_code,
            sessionId: null,
            remainingTimeMs: CROSSWORD_GAME_DURATION_MS,
            durationMs: CROSSWORD_GAME_DURATION_MS,
            message: "Previous crossword round ended. Waiting for teacher to start a fresh game.",
          });
        } else if (!status.started) {
          emitWaitingLeaderboard(game_code);
          socket.emit("crosswordStatus", {
            started: false,
            completed: false,
            game_code,
            sessionId: null,
            message: "Waiting for teacher to start the crossword",
          });
        } else {
          if (previously_exited) {
            socket.emit("crosswordStatus", {
              started: false,
              completed: false,
              game_code,
              sessionId: null,
              message: "You exited this crossword. Wait for the teacher to start a fresh game.",
            });
            return;
          }

          const session = crosswordSessions.get(status.sessionId);
          if (hasPlayableCrosswordSession(session)) {
            if (user_id) {
              await ensureCrosswordLeaderboardEntry(user_id, status.sessionId);
            }

            socket.join(status.sessionId);

            const leaderboard = await emitCrosswordLeaderboard(game_code, status.sessionId);
            const solvedWordIds = await getSolvedWordIdsForUser(user_id, status.sessionId);
            const solvedUserSet = getOrCreateSolvedUserSet(session, user_id);
            solvedUserSet.clear();
            solvedWordIds.forEach((wordId) => solvedUserSet.add(String(wordId)));
            socket.emit("crosswordStatus", {
              started: true,
              completed: false,
              game_code,
              sessionId: status.sessionId,
              totalWords: session.clues.length,
              startedAt: status.startedAt || null,
              remainingTimeMs: getRemainingCrosswordTimeMs(status),
              durationMs: CROSSWORD_GAME_DURATION_MS,
            });
            emitCrosswordGrid(socket, status.sessionId, session);
            socket.emit("crosswordPersonalState", {
              solvedWordIds,
            });
            socket.emit("leaderboardUpdate", leaderboard);
            socket.emit("crosswordLeaderboardUpdate", leaderboard);
          } else {
            crosswordGameStatus.set(game_code, {
              started: false,
              completed: false,
              sessionId: null,
              winner: null,
              leaderboard: [],
            });
            clearCrosswordTimer(game_code);
            socket.emit("crosswordStatus", {
              started: false,
              completed: false,
              game_code,
              sessionId: null,
              message: "Waiting for teacher to start the crossword",
            });
          }
        }
      }
    });

    socket.on("crosswordJoin", ({ sessionId, game_code, user_id, email }) => {
      if (!sessionId && game_code) {
        sessionId = crosswordGameStatus.get(game_code)?.sessionId;
      }
      if (!sessionId) {
        return;
      }
      socket.join(sessionId);
      socket.data.sessionId = sessionId;
      socket.data.game_code = game_code || socket.data.game_code;
      socket.data.user_id = user_id || socket.data.user_id;
      socket.data.email = email || socket.data.email || null;
      console.log(`📊 Socket ${socket.id} joined crossword session: ${sessionId}`);
    });

    socket.on("crosswordRequestGrid", async ({ sessionId, game_code, user_id }) => {
      try {
        if (!sessionId && game_code) {
          sessionId = crosswordGameStatus.get(game_code)?.sessionId;
        }

        if (!sessionId) {
          socket.emit("crosswordError", { error: "Invalid session" });
          return;
        }

        const session = crosswordSessions.get(sessionId);
        if (!hasPlayableCrosswordSession(session)) {
          socket.emit("crosswordError", { error: "Crossword grid is not available yet" });
          return;
        }

        const resolvedGameCode = game_code || session.gameCode;
        socket.join(sessionId);

        emitCrosswordGrid(socket, sessionId, session);

        const resolvedUserId = user_id || socket.data?.user_id;
        if (resolvedUserId) {
          const solvedWordIds = await getSolvedWordIdsForUser(resolvedUserId, sessionId);
          const solvedUserSet = getOrCreateSolvedUserSet(session, resolvedUserId);
          solvedUserSet.clear();
          solvedWordIds.forEach((wordId) => solvedUserSet.add(String(wordId)));
          socket.emit("crosswordPersonalState", {
            solvedWordIds,
          });
        }

        if (resolvedGameCode) {
          const leaderboard = await emitCrosswordLeaderboard(resolvedGameCode, sessionId);
          socket.emit("leaderboardUpdate", leaderboard);
          socket.emit("crosswordLeaderboardUpdate", leaderboard);
        }
      } catch (error) {
        console.error("crosswordRequestGrid error:", error);
        socket.emit("crosswordError", { error: "Failed to load crossword grid" });
      }
    });

    socket.on("leaveGame", ({ game_code, user_id }) => {
      if (!game_code || !user_id) {
        return;
      }

      const waitingPlayers = crosswordWaitingPlayers.get(game_code);
      if (waitingPlayers && waitingPlayers.delete(String(user_id))) {
        emitWaitingLeaderboard(game_code);
      }
    });

    socket.on("crosswordLockWord", ({ sessionId, game_code, user_id, email, crossword_question_id }) => {
      if (!sessionId && game_code) {
        sessionId = crosswordGameStatus.get(game_code)?.sessionId;
      }
      if (!sessionId) {
        socket.emit("crosswordError", { error: "Invalid session" });
        return;
      }

      if (!socket.data?.user_id || String(socket.data.user_id) !== String(user_id)) {
        socket.emit("crosswordError", { error: "Unauthorized user context" });
        return;
      }

      const sessionLocks = crosswordLocks.get(sessionId) || new Map();
      
      if (sessionLocks.has(user_id)) {
        socket.emit("crosswordError", { 
          error: "You can only work on one word at a time" 
        });
        return;
      }
      
      for (const [uid, cid] of sessionLocks) {
        if (cid === crossword_question_id) {
          socket.emit("crosswordError", { 
            error: "This word is currently being solved by another player" 
          });
          return;
        }
      }
      
      sessionLocks.set(user_id, crossword_question_id);
      crosswordLocks.set(sessionId, sessionLocks);
      socket.data.sessionId = sessionId;
      socket.data.user_id = user_id;
      socket.data.email = email || socket.data.email || null;
      
      io.to(sessionId).emit("wordLocked", {
        wordId: crossword_question_id,
        crossword_question_id,
        user_id,
        user: {
          user_id,
          email: email || socket.data.email || null,
        }
      });
    });

    socket.on("crosswordUnlockWord", ({ sessionId, game_code, user_id, crossword_question_id }) => {
      if (!sessionId && game_code) {
        sessionId = crosswordGameStatus.get(game_code)?.sessionId;
      }

      if (!socket.data?.user_id || String(socket.data.user_id) !== String(user_id)) {
        socket.emit("crosswordError", { error: "Unauthorized user context" });
        return;
      }

      const sessionLocks = crosswordLocks.get(sessionId);
      if (sessionLocks) {
        const releasedWordId = crossword_question_id || sessionLocks.get(user_id);
        sessionLocks.delete(user_id);
        io.to(sessionId).emit("wordUnlocked", { wordId: releasedWordId, user_id });
      }
    });

    socket.on("crosswordSubmit", async ({ sessionId, game_code, user_id, email, word, crossword_question_id }) => {
      try {
        if (!sessionId && game_code) {
          sessionId = crosswordGameStatus.get(game_code)?.sessionId;
        }
        const session = crosswordSessions.get(sessionId);
        if (!session) {
          socket.emit("crosswordError", { error: "Invalid session" });
          return;
        }

        const solvedUserSet = getOrCreateSolvedUserSet(session, user_id);
        if (solvedUserSet.has(String(crossword_question_id))) {
          const sessionLocks = crosswordLocks.get(sessionId) || new Map();
          sessionLocks.delete(user_id);
          io.to(sessionId).emit("wordUnlocked", {
            wordId: crossword_question_id,
            user_id,
          });
          socket.emit("crosswordError", { error: "You already answered this word" });
          return;
        }

        if (!socket.data?.user_id || String(socket.data.user_id) !== String(user_id)) {
          socket.emit("crosswordError", { error: "Unauthorized user context" });
          return;
        }

        const sessionLocks = crosswordLocks.get(sessionId) || new Map();
        const lockedByCurrentUser = sessionLocks.get(user_id);

        if (lockedByCurrentUser && lockedByCurrentUser !== crossword_question_id) {
          socket.emit("crosswordError", {
            error: "You can only work on one word at a time"
          });
          return;
        }

        const competingLock = Array.from(sessionLocks.entries()).find(
          ([lockedUserId, lockedWordId]) =>
            String(lockedUserId) !== String(user_id) &&
            String(lockedWordId) === String(crossword_question_id)
        );

        if (competingLock) {
          socket.emit("crosswordError", {
            error: "This word is currently being solved by another player"
          });
          return;
        }

        if (!lockedByCurrentUser) {
          sessionLocks.set(user_id, crossword_question_id);
          crosswordLocks.set(sessionId, sessionLocks);
        }

        const [[question]] = await pool.query(
          "SELECT answer FROM crossword_questions WHERE id = ?",
          [crossword_question_id]
        );

        if (!question) {
          socket.emit("crosswordError", { error: "Invalid question" });
          return;
        }

        const [existingAnswerRows] = await pool.query(
          `
            SELECT 1
            FROM crossword_answers
            WHERE user_id = ?
              AND crossword_question_id = ?
              AND game_session_id = ?
            LIMIT 1
          `,
          [user_id, crossword_question_id, sessionId]
        );

        if (existingAnswerRows.length > 0) {
          sessionLocks.delete(user_id);
          io.to(sessionId).emit("wordUnlocked", {
            wordId: crossword_question_id,
            user_id,
          });
          socket.emit("crosswordError", { error: "You already answered this word" });
          return;
        }

        const isCorrect = word.trim().toLowerCase() === question.answer.trim().toLowerCase();
        const points = isCorrect ? 5 : 0;

        if (isCorrect) {
          session.solvedWords.add(crossword_question_id);
        }

        const connection = await pool.getConnection();
        try {
          await connection.query(
            `
            INSERT INTO crossword_answers 
              (user_id, crossword_question_id, user_answer, is_correct, points_earned, game_session_id)
            VALUES (?, ?, ?, ?, ?, ?)
            `,
            [user_id, crossword_question_id, word, isCorrect, points, sessionId]
          );
        } finally {
          connection.release();
        }

        await upsertCrosswordScore(user_id, sessionId);
        solvedUserSet.add(String(crossword_question_id));
        const leaderboard = await emitCrosswordLeaderboard(session.gameCode, sessionId);
        const currentPlayer = leaderboard.find((player) => String(player.user_id) === String(user_id));

        sessionLocks.delete(user_id);
        io.to(sessionId).emit("wordUnlocked", {
          wordId: crossword_question_id,
          user_id,
        });

        if (isCorrect) {
          const wordSolvedPayload = {
            wordId: crossword_question_id,
            user: {
              user_id,
              email: email || currentPlayer?.email || socket.data.email || null,
              display_name: currentPlayer?.display_name || null,
            },
            points,
          };
          io.to(session.gameCode).emit("wordSolved", wordSolvedPayload);
          io.to(sessionId).emit("wordSolved", wordSolvedPayload);
        }

        socket.emit("crosswordSubmitResult", {
          success: true,
          correct: isCorrect,
          points
        });
      } catch (err) {
        console.error("crosswordSubmit error:", err);
        socket.emit("crosswordError", { error: "Server error" });
      }
    });

    socket.on("crosswordSolved", data => {
      io.to(data.sessionId).emit("crosswordUpdate", data);
    });

    socket.on("disconnect", () => {
      console.log("❌ Crossword socket disconnected:", socket.id);

      const { sessionId, user_id, game_code } = socket.data || {};
      const locks = sessionId ? crosswordLocks.get(sessionId) : null;
      if (locks && user_id && locks.has(user_id)) {
        const releasedWordId = locks.get(user_id);
        locks.delete(user_id);
        io.to(sessionId).emit("wordUnlocked", {
          wordId: releasedWordId,
          user_id,
        });
      }

      const status = game_code ? crosswordGameStatus.get(game_code) : null;
      if (game_code && user_id && (!status || !status.started)) {
        const waitingPlayers = crosswordWaitingPlayers.get(game_code);
        if (waitingPlayers && waitingPlayers.delete(String(user_id))) {
          emitWaitingLeaderboard(game_code);
        }
      }
    });
  });
}

module.exports = { attachCrosswordSocketHandlers };
