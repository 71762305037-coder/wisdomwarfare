// ============================================================
// CROSSWORD HELPER FUNCTIONS
// Shared utilities for crossword game logic
// ============================================================

function generateCrosswordSessionId() {
  return `crossword_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 8)}`;
}

function generateShortGameCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function clearCrosswordTimer(gameCode, crosswordTimers) {
  const existingTimer = crosswordTimers.get(gameCode);
  if (existingTimer) {
    clearTimeout(existingTimer);
    crosswordTimers.delete(gameCode);
  }
}

function getRemainingCrosswordTimeMs(status) {
  if (!status?.endsAt || !status?.started || status?.completed) {
    return 0;
  }

  return Math.max(0, status.endsAt - Date.now());
}

function hasPlayableCrosswordSession(session) {
  return Boolean(
    session &&
      Array.isArray(session.grid) &&
      session.grid.length > 0 &&
      session.grid.some(
        (row) => Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && cell !== "#")
      ) &&
      Array.isArray(session.clues) &&
      session.clues.length > 0
  );
}

function normalizeCrosswordQuestions(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const normalizedAnswer = String(row?.answer || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .trim();

      return {
        id: row?.id,
        question: row?.question,
        answer: normalizedAnswer,
        difficulty: row?.difficulty || "Medium",
        length: normalizedAnswer.length,
      };
    })
    .filter((row) => row.id && row.question && row.answer && row.length > 0);
}

function getDateFilter(timeRange = "week") {
  const now = new Date();
  if (timeRange === "month") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  if (timeRange === "all") {
    return new Date("1970-01-01");
  }
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function emitCrosswordGrid(target, sessionId, session) {
  if (!session) {
    return;
  }

  const clues = Array.isArray(session.clues) ? session.clues : [];
  const acrossClues = clues.filter(
    (clue) => clue.direction === "across" || clue.direction === "horizontal"
  );
  const downClues = clues.filter(
    (clue) => clue.direction === "down" || clue.direction === "vertical"
  );

  target.emit("crosswordGrid", {
    sessionId,
    grid: session.grid,
    clues,
    acrossClues,
    downClues,
    cellNumbers: session.cellNumbers || {},
  });
}

function getWaitingPlayerMap(gameCode, crosswordWaitingPlayers) {
  if (!crosswordWaitingPlayers.has(gameCode)) {
    crosswordWaitingPlayers.set(gameCode, new Map());
  }

  return crosswordWaitingPlayers.get(gameCode);
}

function getCrosswordWaitingLeaderboardRows(gameCode, crosswordWaitingPlayers) {
  return Array.from(getWaitingPlayerMap(gameCode, crosswordWaitingPlayers).values())
    .map((player) => ({
      user_id: player.user_id,
      email: player.email || null,
      display_name: player.display_name || player.email || `Player ${player.user_id}`,
      score: 0,
      total_score: 0,
      attempts: 0,
      questions_answered: 0,
      correct_answers: 0,
      accuracy: 0,
      game_session_id: null,
    }))
    .sort((left, right) => String(left.display_name).localeCompare(String(right.display_name)));
}

function emitWaitingLeaderboard(gameCode, io, crosswordWaitingPlayers) {
  const leaderboard = getCrosswordWaitingLeaderboardRows(gameCode, crosswordWaitingPlayers);
  console.log(`📊 [EMIT_WAITING_LB] Emitting waiting leaderboard for ${gameCode} with ${leaderboard.length} players:`, leaderboard);
  io.to(gameCode).emit("leaderboardUpdate", leaderboard);
  io.to(gameCode).emit("crosswordLeaderboardUpdate", leaderboard);
  return leaderboard;
}

async function getCrosswordLeaderboardRows(limit = 50, sessionId = null, pool) {
  const params = [];
  const whereClauses = ["u.role = 'student'"];

  if (sessionId) {
    whereClauses.push("s.game_session_id = ?");
    params.push(sessionId);
  }

  params.push(limit);

  const [rows] = await pool.query(
    `
      SELECT
        u.user_id,
        u.email,
        u.display_name,
        s.score,
        s.score AS total_score,
        s.attempts,
        s.attempts AS questions_answered,
        s.correct_answers,
        s.accuracy,
        s.game_session_id,
        s.last_updated
      FROM crossword_scores s
      JOIN users u ON u.user_id = s.user_id
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY s.score DESC, s.accuracy DESC, s.last_updated ASC
      LIMIT ?
    `,
    params
  );

  return rows;
}

async function getCrosswordAggregateLeaderboardRows(limit = 50, pool) {
  const [rows] = await pool.query(
    `
      SELECT
        u.user_id,
        u.email,
        u.display_name,
        COALESCE(SUM(s.score), 0) AS score,
        COALESCE(SUM(s.score), 0) AS total_score,
        COALESCE(COUNT(DISTINCT s.game_session_id), 0) AS attempts,
        COALESCE(COUNT(DISTINCT s.game_session_id), 0) AS games_played,
        COALESCE(SUM(s.correct_answers), 0) AS correct_answers,
        COALESCE(
          (SELECT 
            ROUND((SUM(correct_answers) * 100.0 / SUM(attempts)), 2)
            FROM crossword_scores cs2
            WHERE cs2.user_id = u.user_id AND cs2.game_session_id = (
              SELECT game_session_id FROM crossword_scores WHERE user_id = u.user_id ORDER BY last_updated DESC LIMIT 1
            )),
          0
        ) AS accuracy
      FROM users u
      LEFT JOIN crossword_scores s ON s.user_id = u.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.email, u.display_name
      ORDER BY total_score DESC, accuracy DESC, games_played DESC, u.display_name ASC
      LIMIT ?
    `,
    [limit]
  );

  return rows;
}

async function ensureCrosswordLeaderboardEntry(userId, sessionId, pool) {
  await pool.query(
    `
      INSERT INTO crossword_scores
        (user_id, game_name, score, attempts, correct_answers, accuracy, game_session_id)
      VALUES (?, 'A. Crossword', 0, 0, 0, 0, ?)
      ON DUPLICATE KEY UPDATE
        game_name = VALUES(game_name)
    `,
    [userId, sessionId]
  );
}

async function upsertCrosswordScore(userId, sessionId, pool) {
  const [scoreRows] = await pool.query(
    `
      SELECT
        COALESCE(SUM(points_earned), 0) AS score,
        COUNT(*) AS attempts,
        COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_answers,
        CASE
          WHEN COUNT(*) > 0 THEN ROUND((SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)), 2)
          ELSE 0
        END AS accuracy
      FROM crossword_answers
      WHERE user_id = ? AND game_session_id = ?
    `,
    [userId, sessionId]
  );

  const stats = scoreRows[0] || {
    score: 0,
    attempts: 0,
    correct_answers: 0,
    accuracy: 0,
  };

  await pool.query(
    "DELETE FROM crossword_scores WHERE user_id = ? AND game_session_id = ?",
    [userId, sessionId]
  );

  await pool.query(
    `
      INSERT INTO crossword_scores
        (user_id, game_name, game_session_id, score, attempts, correct_answers, accuracy)
      VALUES (?, 'A. Crossword', ?, ?, ?, ?, ?)
    `,
    [userId, sessionId, stats.score, stats.attempts, stats.correct_answers, stats.accuracy]
  );

  return stats;
}

async function emitCrosswordLeaderboard(gameCode, sessionId, io, crosswordGameStatus, pool) {
  const leaderboard = await getCrosswordLeaderboardRows(50, sessionId, pool);
  
  console.log(`📊 [EMIT_LEADERBOARD] Broadcasting leaderboard for game_code=${gameCode}, sessionId=${sessionId}, players=${leaderboard.length}`);
  console.log(`📊 [EMIT_LEADERBOARD] Leaderboard data:`, leaderboard);
  
  // ✅ CRITICAL: Emit to BOTH game_code and sessionId rooms for sync consistency
  io.to(gameCode).emit("leaderboardUpdate", leaderboard);
  io.to(gameCode).emit("crosswordLeaderboardUpdate", leaderboard);
  io.to(sessionId).emit("leaderboardUpdate", leaderboard);
  io.to(sessionId).emit("crosswordLeaderboardUpdate", leaderboard);

  const status = crosswordGameStatus.get(gameCode);
  if (status) {
    crosswordGameStatus.set(gameCode, {
      ...status,
      leaderboard,
      lastUpdatedAt: Date.now(),
    });
  }

  return leaderboard;
}

async function getSolvedWordIdsForUser(userId, sessionId, pool) {
  if (!userId || !sessionId) {
    return [];
  }

  const [rows] = await pool.query(
    `
      SELECT DISTINCT crossword_question_id
      FROM crossword_answers
      WHERE user_id = ?
        AND game_session_id = ?
        AND is_correct = 1
    `,
    [userId, sessionId]
  );

  return rows.map((row) => row.crossword_question_id);
}

function getOrCreateSolvedUserSet(session, userId) {
  if (!session?.solvedUsers) {
    session.solvedUsers = new Map();
  }

  const normalizedUserId = String(userId);
  if (!session.solvedUsers.has(normalizedUserId)) {
    session.solvedUsers.set(normalizedUserId, new Set());
  }

  return session.solvedUsers.get(normalizedUserId);
}

async function finalizeCrosswordGame(gameCode, options = {}, deps) {
  const {
    sessionId = null,
    reason = "completed"
  } = options;

  const {
    crosswordGameStatus,
    crosswordSessions,
    crosswordTimers,
    crosswordWaitingPlayers,
    io,
    pool,
    CROSSWORD_GAME_DURATION_MS,
    getCrosswordLeaderboardRows,
    getCrosswordWaitingLeaderboardRows,
    clearCrosswordTimer,
  } = deps;

  const currentStatus = crosswordGameStatus.get(gameCode);

  if (!currentStatus) {
    return null;
  }

  if (currentStatus.completed) {
    return currentStatus;
  }

  const resolvedSessionId = sessionId || currentStatus.sessionId || null;
  let leaderboard = [];

  if (resolvedSessionId) {
    leaderboard = await getCrosswordLeaderboardRows(50, resolvedSessionId, pool);
  }

  if (!leaderboard.length) {
    leaderboard = getCrosswordWaitingLeaderboardRows(gameCode, crosswordWaitingPlayers);
  }

  const winner = leaderboard[0] || null;
  const completedAt = Date.now();

  const updatedStatus = {
    ...currentStatus,
    started: false,
    completed: true,
    sessionId: resolvedSessionId,
    winner,
    leaderboard,
    completedAt,
    completedReason: reason,
    lastUpdatedAt: completedAt,
    endsAt: completedAt,
  };

  crosswordGameStatus.set(gameCode, updatedStatus);
  clearCrosswordTimer(gameCode, crosswordTimers);

  const completionMessage =
    reason === "timeout"
      ? "Time is up! Crossword game completed"
      : "Crossword game completed";

  // ✅ CRITICAL: Emit to BOTH rooms for sync consistency
  io.to(gameCode).emit("leaderboardUpdate", leaderboard);
  io.to(gameCode).emit("crosswordLeaderboardUpdate", leaderboard);
  if (resolvedSessionId) {
    io.to(resolvedSessionId).emit("leaderboardUpdate", leaderboard);
    io.to(resolvedSessionId).emit("crosswordLeaderboardUpdate", leaderboard);
  }

  io.to(gameCode).emit("crosswordStatus", {
    started: false,
    completed: true,
    game_code: gameCode,
    sessionId: resolvedSessionId,
    winner,
    leaderboard,
    message: completionMessage,
    remainingTimeMs: 0,
    durationMs: CROSSWORD_GAME_DURATION_MS,
  });
  if (resolvedSessionId) {
    io.to(resolvedSessionId).emit("crosswordStatus", {
      started: false,
      completed: true,
      game_code: gameCode,
      sessionId: resolvedSessionId,
      winner,
      leaderboard,
      message: completionMessage,
      remainingTimeMs: 0,
      durationMs: CROSSWORD_GAME_DURATION_MS,
    });
  }

  if (winner) {
    io.to(gameCode).emit("crosswordWinner", winner);
    if (resolvedSessionId) {
      io.to(resolvedSessionId).emit("crosswordWinner", winner);
    }
  }

  io.to(gameCode).emit("gameCompleted", {
    gameType: "A. Crossword",
    leaderboard,
    winner,
    reason,
    startedAt: currentStatus.startedAt || null,
  });
  if (resolvedSessionId) {
    io.to(resolvedSessionId).emit("gameCompleted", {
      gameType: "A. Crossword",
      leaderboard,
      winner,
      reason,
      startedAt: currentStatus.startedAt || null,
    });
  }

  return updatedStatus;
}

module.exports = {
  generateCrosswordSessionId,
  generateShortGameCode,
  clearCrosswordTimer,
  getRemainingCrosswordTimeMs,
  hasPlayableCrosswordSession,
  normalizeCrosswordQuestions,
  getDateFilter,
  emitCrosswordGrid,
  getWaitingPlayerMap,
  getCrosswordWaitingLeaderboardRows,
  emitWaitingLeaderboard,
  getCrosswordLeaderboardRows,
  getCrosswordAggregateLeaderboardRows,
  ensureCrosswordLeaderboardEntry,
  upsertCrosswordScore,
  emitCrosswordLeaderboard,
  getSolvedWordIdsForUser,
  getOrCreateSolvedUserSet,
  finalizeCrosswordGame,
};
