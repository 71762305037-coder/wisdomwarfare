/**
 * Crossword Routes Module
 * Handles all crossword-specific API endpoints
 * 
 * Usage: initializeCrosswordRoutes(app, io, pool, upload)
 */

const fs = require("fs");
const csv = require("csv-parser");
const { generateCrosswordGrid } = require("../crosswordGrid");

// Constants
const CROSSWORD_GAME_DURATION_MS = 6 * 60 * 1000;

// ==========================================
// ----- CROSSWORD GAME STATE -----
// ==========================================

const crosswordSessions = new Map(); // sessionId -> { grid, clues, solvedWords, solvedUsers, gameCode, startTime }
const crosswordGameStatus = new Map(); // game_code -> { started, completed, sessionId, winner, leaderboard }
const crosswordLocks = new Map(); // sessionId -> Map(user_id -> crossword_question_id)
const crosswordWaitingPlayers = new Map(); // game_code -> Map(user_id -> { user_id, email, display_name })
const crosswordTimers = new Map(); // game_code -> setTimeout handle

// ==========================================
// ----- CROSSWORD HELPERS -----
// ==========================================

function generateShortGameCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function clearCrosswordTimer(gameCode) {
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

function getWaitingPlayerMap(gameCode) {
  if (!crosswordWaitingPlayers.has(gameCode)) {
    crosswordWaitingPlayers.set(gameCode, new Map());
  }
  return crosswordWaitingPlayers.get(gameCode);
}

function getCrosswordWaitingLeaderboardRows(gameCode) {
  return Array.from(getWaitingPlayerMap(gameCode).values())
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

function emitWaitingLeaderboard(gameCode, io) {
  const leaderboard = getCrosswordWaitingLeaderboardRows(gameCode);
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
        CASE
          WHEN COALESCE(SUM(s.attempts), 0) > 0 THEN ROUND((SUM(s.correct_answers) * 100.0 / SUM(s.attempts)), 2)
          ELSE 0
        END AS accuracy
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
        (user_id, game_session_id, score, attempts, correct_answers, accuracy)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [userId, sessionId, stats.score, stats.attempts, stats.correct_answers, stats.accuracy]
  );

  return stats;
}

async function emitCrosswordLeaderboard(gameCode, sessionId, io, pool) {
  const leaderboard = await getCrosswordLeaderboardRows(50, sessionId, pool);
  io.to(gameCode).emit("leaderboardUpdate", leaderboard);
  io.to(gameCode).emit("crosswordLeaderboardUpdate", leaderboard);

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

async function finalizeCrosswordGame(gameCode, options = {}, io, pool) {
  const { sessionId = null, reason = "completed" } = options;
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
    leaderboard = getCrosswordWaitingLeaderboardRows(gameCode);
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
  clearCrosswordTimer(gameCode);

  const completionMessage =
    reason === "timeout"
      ? "Time is up! Crossword game completed"
      : "Crossword game completed";

  io.to(gameCode).emit("leaderboardUpdate", leaderboard);
  io.to(gameCode).emit("crosswordLeaderboardUpdate", leaderboard);

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

  if (winner) {
    io.to(gameCode).emit("crosswordWinner", winner);
  }

  io.to(gameCode).emit("gameCompleted", {
    gameType: "A. Crossword",
    leaderboard,
    winner,
    reason,
    startedAt: currentStatus.startedAt || null,
  });

  return updatedStatus;
}

// ==========================================
// ----- INITIALIZE CROSSWORD ROUTES -----
// ==========================================

function initializeCrosswordRoutes(app, io, pool, upload) {
  // Health check
  app.get("/crossword", (req, res) => {
    res.json({
      message: "Crossword Game Backend Running! 🧩",
      status: "healthy",
      activeSessions: crosswordSessions.size,
    });
  });

  // Get game status
  app.get("/crossword/game-status/:game_code", async (req, res) => {
    try {
      const { game_code } = req.params;
      const status = crosswordGameStatus.get(game_code);

      if (!status) {
        return res.json({
          success: true,
          started: false,
          completed: false,
          sessionId: null,
        });
      }

      if (status.completed) {
        return res.json({
          success: true,
          started: false,
          completed: true,
          sessionId: status.sessionId || null,
          winner: status.winner || null,
          leaderboard: Array.isArray(status.leaderboard) ? status.leaderboard : [],
          remainingTimeMs: 0,
          durationMs: CROSSWORD_GAME_DURATION_MS,
          message: "Crossword game completed",
        });
      }

      if (!status.started) {
        return res.json({
          success: true,
          started: false,
          completed: false,
          sessionId: null,
        });
      }

      const session = crosswordSessions.get(status.sessionId);

      if (!hasPlayableCrosswordSession(session)) {
        crosswordGameStatus.set(game_code, {
          ...status,
          started: false,
          completed: false,
          sessionId: null,
        });
        clearCrosswordTimer(game_code);

        return res.json({
          success: true,
          started: false,
          completed: false,
          sessionId: null,
        });
      }

      return res.json({
        success: true,
        started: true,
        completed: false,
        sessionId: status.sessionId,
        totalWords: session?.clues?.length || 0,
        remainingTimeMs: getRemainingCrosswordTimeMs(status),
        durationMs: CROSSWORD_GAME_DURATION_MS,
      });
    } catch (err) {
      console.error("GET /crossword/game-status/:game_code error:", err);
      res.status(500).json({ success: false, started: false, completed: false, sessionId: null });
    }
  });

  // Get all crossword questions
  app.get("/crossword/questions", async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT id, question, answer, difficulty
        FROM crossword_questions
        ORDER BY 
          CASE difficulty
            WHEN 'Easy' THEN 1
            WHEN 'Medium' THEN 2
            WHEN 'Hard' THEN 3
          END,
          id
      `);

      res.json({
        success: true,
        questions: rows,
      });
    } catch (err) {
      console.error("GET /crossword/questions error:", err);
      res.status(500).json({
        success: false,
        questions: [],
      });
    }
  });

  // Create a single crossword question
  app.post("/crossword/questions", async (req, res) => {
    const { question, answer, difficulty = "Medium" } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        error: "Question and answer are required",
      });
    }

    try {
      const [result] = await pool.query(
        `
        INSERT INTO crossword_questions (question, answer, difficulty)
        VALUES (?, ?, ?)
        `,
        [question.trim(), answer.trim(), difficulty]
      );

      res.json({
        success: true,
        id: result.insertId,
      });
    } catch (err) {
      console.error("POST /crossword/questions error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // Update crossword question
  app.put("/crossword/questions/:id", async (req, res) => {
    const { id } = req.params;
    const { question, answer, difficulty = "Medium" } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: "Question and answer are required" });
    }

    try {
      const [result] = await pool.query(
        `
        UPDATE crossword_questions
        SET question = ?, answer = ?, difficulty = ?
        WHERE id = ?
        `,
        [question.trim(), answer.trim(), difficulty, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Crossword question not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Update crossword error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete crossword question
  app.delete("/crossword/questions/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const [result] = await pool.query(
        "DELETE FROM crossword_questions WHERE id = ?",
        [id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Crossword question not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Delete crossword error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Upload crossword questions from CSV
  app.post("/crossword/questions/upload", upload.single("file"), async (req, res) => {
    const connection = await pool.getConnection();
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const rows = [];
      let inserted = 0;
      const errors = [];

      await connection.beginTransaction();

      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => rows.push(data))
          .on("end", resolve)
          .on("error", reject);
      });

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const question = r.question || r.Question;
        const answer = r.answer || r.Answer;
        const difficulty = r.difficulty || "Medium";

        if (!question || !answer) {
          errors.push(`Row ${i + 1}: Missing question or answer`);
          continue;
        }

        await connection.query(
          `
          INSERT INTO crossword_questions (question, answer, difficulty)
          VALUES (?, ?, ?)
          `,
          [question.trim(), answer.trim(), difficulty]
        );

        inserted++;
      }

      await connection.commit();
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        inserted,
        total: rows.length,
        errors,
      });
    } catch (err) {
      await connection.rollback();
      console.error("Upload crossword CSV error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      connection.release();
    }
  });

  // Create new crossword game
  app.post("/crossword/create-game", async (req, res) => {
    const { teacher_id, game_name } = req.body;

    if (!teacher_id) {
      return res.status(400).json({ error: "teacher_id required" });
    }

    try {
      let game_code = generateShortGameCode();
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        const [[existing]] = await pool.query(
          "SELECT id FROM teacher_games WHERE game_code = ?",
          [game_code]
        );
        if (!existing) {
          isUnique = true;
        } else {
          game_code = generateShortGameCode();
          attempts++;
        }
      }

      if (!isUnique) {
        return res.status(500).json({ error: "Failed to generate unique game code" });
      }

      const normalizedGameName =
        typeof game_name === "string" && game_name.trim()
          ? game_name.trim()
          : "A. Crossword";

      const [result] = await pool.query(
        "INSERT INTO teacher_games (teacher_id, game_name, game_code) VALUES (?, ?, ?)",
        [teacher_id, normalizedGameName, game_code]
      );

      crosswordGameStatus.set(game_code, {
        started: false,
        completed: false,
        sessionId: null,
        winner: null,
        leaderboard: [],
        createdAt: Date.now(),
      });

      res.json({
        success: true,
        game: {
          id: result.insertId,
          teacher_id,
          game_name: normalizedGameName,
          game_code,
        },
        game_code,
        game_id: result.insertId,
        message: `Game code: ${game_code}`
      });
    } catch (err) {
      console.error("Create game error:", err);
      res.status(500).json({ error: "Failed to create game" });
    }
  });

  // Start crossword game
  app.post("/crossword/start-game", async (req, res) => {
    const { game_code } = req.body;
    
    if (!game_code) {
      return res.status(400).json({ error: "game_code required" });
    }

    try {
      const previousStatus = crosswordGameStatus.get(game_code);
      if (previousStatus?.sessionId) {
        crosswordSessions.delete(previousStatus.sessionId);
        crosswordLocks.delete(previousStatus.sessionId);
      }
      clearCrosswordTimer(game_code);

      const [[game]] = await pool.query(
        "SELECT * FROM teacher_games WHERE game_code = ?",
        [game_code]
      );

      if (!game) {
        return res.status(404).json({ error: "Invalid crossword code" });
      }

      const [questionRows] = await pool.query(
        "SELECT id, question, answer, difficulty FROM crossword_questions"
      );

      const questions = normalizeCrosswordQuestions(questionRows);

      const shuffledQuestions = [...questions];
      for (let i = shuffledQuestions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledQuestions[i], shuffledQuestions[j]] = [shuffledQuestions[j], shuffledQuestions[i]];
      }

      const selectedQuestions = shuffledQuestions.slice(0, Math.min(shuffledQuestions.length, 15));

      if (selectedQuestions.length === 0) {
        return res.status(400).json({ error: "No crossword questions" });
      }

      const crossword = generateCrosswordGrid(selectedQuestions);

      if (
        !crossword?.success ||
        !Array.isArray(crossword.grid) ||
        crossword.grid.length === 0 ||
        !crossword.clues ||
        ((!Array.isArray(crossword.clues) || crossword.clues.length === 0) &&
          (!Array.isArray(crossword.clues?.across) || crossword.clues.across.length === 0) &&
          (!Array.isArray(crossword.clues?.down) || crossword.clues.down.length === 0))
      ) {
        return res.status(500).json({ error: "Failed to generate a valid crossword grid" });
      }

      const flattenedClues = Array.isArray(crossword.clues)
        ? crossword.clues
        : [
            ...(Array.isArray(crossword.clues?.across) ? crossword.clues.across : []),
            ...(Array.isArray(crossword.clues?.down) ? crossword.clues.down : []),
          ];

      const sessionId = `CW_${Date.now()}_${game_code}`;
      const startedAt = Date.now();
      const endsAt = startedAt + CROSSWORD_GAME_DURATION_MS;

      crosswordSessions.set(sessionId, {
        grid: crossword.grid,
        clues: flattenedClues,
        cellNumbers: crossword.cellNumbers || {},
        solvedWords: new Set(),
        solvedUsers: new Map(),
        gameCode: game_code,
        startTime: startedAt
      });

      crosswordGameStatus.set(game_code, {
        started: true,
        completed: false,
        sessionId,
        winner: null,
        leaderboard: [],
        startedAt,
        endsAt,
        durationMs: CROSSWORD_GAME_DURATION_MS,
      });

      const timerHandle = setTimeout(() => {
        finalizeCrosswordGame(game_code, { sessionId, reason: "timeout" }, io, pool).catch((error) => {
          console.error("Crossword timer completion error:", error);
        });
      }, CROSSWORD_GAME_DURATION_MS);
      crosswordTimers.set(game_code, timerHandle);

      const waitingPlayers = Array.from(getWaitingPlayerMap(game_code).values());
      for (const player of waitingPlayers) {
        if (player?.user_id) {
          await ensureCrosswordLeaderboardEntry(player.user_id, sessionId, pool);
        }
      }

      io.to(game_code).emit("gameStarted", {
        gameType: "A. Crossword",
        game_code,
        sessionId,
        totalWords: flattenedClues.length,
        startedAt,
        endsAt,
        durationMs: CROSSWORD_GAME_DURATION_MS,
        remainingTimeMs: CROSSWORD_GAME_DURATION_MS,
      });

      emitCrosswordGrid(io.to(game_code), sessionId, crosswordSessions.get(sessionId));
      const leaderboard = await emitCrosswordLeaderboard(game_code, sessionId, io, pool);

      io.to(game_code).emit("crosswordStatus", {
        started: true,
        completed: false,
        game_code,
        sessionId,
        totalWords: flattenedClues.length,
        startedAt,
        endsAt,
        durationMs: CROSSWORD_GAME_DURATION_MS,
        remainingTimeMs: CROSSWORD_GAME_DURATION_MS,
      });

      res.json({
        success: true,
        sessionId,
        gridSize: crossword.grid.length,
        totalWords: flattenedClues.length,
        durationMs: CROSSWORD_GAME_DURATION_MS,
        remainingTimeMs: CROSSWORD_GAME_DURATION_MS,
      });
    } catch (err) {
      console.error("Crossword start error:", err);
      res.status(500).json({ error: "Failed to start crossword game" });
    }
  });

  // Submit crossword answer
  app.post("/crossword/submit-answer", async (req, res) => {
    const {
      user_id,
      crossword_question_id,
      user_answer,
      game_session_id,
    } = req.body;

    if (!user_id || !crossword_question_id || !game_session_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [exists] = await connection.query(
        `
        SELECT 1 FROM crossword_answers
        WHERE user_id = ?
          AND crossword_question_id = ?
          AND game_session_id = ?
        `,
        [user_id, crossword_question_id, game_session_id]
      );

      if (exists.length > 0) {
        await connection.rollback();
        return res.json({
          success: false,
          error: "Already answered",
        });
      }

      const [[q]] = await connection.query(
        `SELECT answer FROM crossword_questions WHERE id = ?`,
        [crossword_question_id]
      );

      const isCorrect =
        q &&
        user_answer &&
        q.answer.trim().toLowerCase() === user_answer.trim().toLowerCase();

      const session = crosswordSessions.get(game_session_id);
      const points = isCorrect ? 5 : 0;

      if (isCorrect && session) {
        session.solvedWords.add(crossword_question_id);
      }

      await connection.query(
        `
        INSERT INTO crossword_answers
          (user_id, crossword_question_id, user_answer, is_correct, points_earned, game_session_id)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          user_id,
          crossword_question_id,
          user_answer,
          isCorrect,
          points,
          game_session_id,
        ]
      );

      await connection.query(
        `
        INSERT INTO crossword_scores
          (user_id, game_name, score, attempts, correct_answers, accuracy, game_session_id)
        VALUES (?, 'A. Crossword', ?, 1, ?, 100, ?)
        ON DUPLICATE KEY UPDATE
          score = score + VALUES(score),
          attempts = attempts + 1,
          correct_answers = correct_answers + VALUES(correct_answers),
          accuracy = ROUND(
            ((correct_answers + VALUES(correct_answers)) / (attempts + 1)) * 100,
            1
          ),
          last_updated = CURRENT_TIMESTAMP
        `,
        [
          user_id,
          points,
          isCorrect ? 1 : 0,
          game_session_id,
        ]
      );

      await connection.commit();

      if (session) {
        io.to(session.gameCode).emit("wordSolved", {
          wordId: crossword_question_id,
          user: { user_id },
          points
        });
      }

      res.json({
        success: true,
        correct: isCorrect,
        points,
      });
    } catch (err) {
      await connection.rollback();
      console.error("POST /crossword/submit-answer error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    } finally {
      connection.release();
    }
  });

  // Get crossword leaderboard
  app.get(["/crossword/leaderboard", "/leaderboard/crossword"], async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || "50", 10);
      const requestedSessionId = req.query.sessionId || null;
      const requestedGameCode = req.query.game_code || null;

      if (requestedSessionId) {
        const rows = await getCrosswordLeaderboardRows(limit, requestedSessionId, pool);
        return res.json(rows);
      }

      if (requestedGameCode) {
        const status = crosswordGameStatus.get(requestedGameCode);
        if (status?.sessionId && (status.started || status.completed)) {
          const rows = await getCrosswordLeaderboardRows(limit, status.sessionId, pool);
          return res.json(rows);
        }

        return res.json(getCrosswordWaitingLeaderboardRows(requestedGameCode));
      }

      const rows = await getCrosswordAggregateLeaderboardRows(limit, pool);
      res.json(rows);
    } catch (err) {
      console.error("GET /crossword/leaderboard error:", err);
      res.status(500).json([]);
    }
  });

  // Get student crossword performance
  app.get("/crossword/student/:student_id/performance", async (req, res) => {
    try {
      const { student_id } = req.params;
      const [[stats]] = await pool.query(
        `
        SELECT
          COALESCE(SUM(score), 0) AS score,
          COALESCE(COUNT(DISTINCT game_session_id), 0) AS attempts,
          COALESCE(SUM(correct_answers), 0) AS correct_answers,
          CASE
            WHEN SUM(attempts) > 0 THEN ROUND((SUM(correct_answers) * 100.0 / SUM(attempts)), 2)
            ELSE 0
          END AS accuracy
        FROM crossword_scores
        WHERE user_id = ?
        `,
        [student_id]
      );

      res.json({
        score: Number(stats?.score || 0),
        attempts: Number(stats?.attempts || 0),
        correct_answers: Number(stats?.correct_answers || 0),
        accuracy: Number(stats?.accuracy || 0),
      });
    } catch (err) {
      console.error("GET /crossword/student/:student_id/performance error:", err);
      res.status(500).json({ error: "Failed to fetch crossword performance" });
    }
  });

  // Get crossword analytics overview
  app.get("/crossword/analytics/overview", async (req, res) => {
    try {
      const { timeRange = "week" } = req.query;
      const dateFilter = getDateFilter(timeRange);
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const [[answers]] = await pool.query(
        "SELECT COUNT(*) AS total FROM crossword_answers WHERE answered_at >= ?",
        [dateFilter]
      );
      const [[games]] = await pool.query(
        "SELECT COUNT(DISTINCT game_session_id) AS total FROM crossword_answers WHERE answered_at >= ?",
        [dateFilter]
      );
      const [[accuracy]] = await pool.query(
        "SELECT COALESCE(AVG(accuracy), 0) AS avg FROM crossword_scores WHERE last_updated >= ?",
        [dateFilter]
      );
      const [[currentAnswers]] = await pool.query(
        "SELECT COUNT(*) AS count FROM crossword_answers WHERE answered_at >= ?",
        [thirtyDaysAgo]
      );
      const [[prevAnswers]] = await pool.query(
        "SELECT COUNT(*) AS count FROM crossword_answers WHERE answered_at BETWEEN ? AND ?",
        [sixtyDaysAgo, thirtyDaysAgo]
      );
      const [[currentGames]] = await pool.query(
        "SELECT COUNT(DISTINCT game_session_id) AS count FROM crossword_answers WHERE answered_at >= ?",
        [thirtyDaysAgo]
      );
      const [[prevGames]] = await pool.query(
        "SELECT COUNT(DISTINCT game_session_id) AS count FROM crossword_answers WHERE answered_at BETWEEN ? AND ?",
        [sixtyDaysAgo, thirtyDaysAgo]
      );
      const [[currentAcc]] = await pool.query(
        "SELECT COALESCE(AVG(accuracy), 0) AS avg FROM crossword_scores WHERE last_updated >= ? AND accuracy > 0",
        [thirtyDaysAgo]
      );
      const [[prevAcc]] = await pool.query(
        "SELECT COALESCE(AVG(accuracy), 0) AS avg FROM crossword_scores WHERE last_updated BETWEEN ? AND ? AND accuracy > 0",
        [sixtyDaysAgo, thirtyDaysAgo]
      );

      const calculateChange = (current, previous) => {
        if (!previous) return 0;
        return Number((((current - previous) / previous) * 100).toFixed(1));
      };

      res.json({
        overview: {
          totalQuestionsAnswered: Number(answers?.total || 0),
          avgAccuracy: Number(accuracy?.avg || 0),
          totalGamesPlayed: Number(games?.total || 0),
          prevPeriodComparison: {
            questions: calculateChange(Number(currentAnswers?.count || 0), Number(prevAnswers?.count || 0)),
            accuracy: calculateChange(Number(currentAcc?.avg || 0), Number(prevAcc?.avg || 0)),
            games: calculateChange(Number(currentGames?.count || 0), Number(prevGames?.count || 0)),
          },
        },
      });
    } catch (err) {
      console.error("GET /crossword/analytics/overview error:", err);
      res.status(500).json({ error: "Failed to fetch crossword analytics overview" });
    }
  });

  // Get crossword student breakdown
  app.get("/crossword/analytics/students-breakdown", async (req, res) => {
    try {
      const [rows] = await pool.query(
        `
        SELECT
          u.user_id AS id,
          u.user_id,
          COALESCE(u.display_name, u.email, 'Unknown') AS name,
          u.email,
          COALESCE(SUM(cs.score), 0) AS crosswordScore,
          COALESCE(COUNT(DISTINCT cs.game_session_id), 0) AS crosswordGames,
          COALESCE(SUM(cs.correct_answers), 0) AS crosswordCorrect,
          CASE
            WHEN SUM(cs.attempts) > 0 THEN ROUND((SUM(cs.correct_answers) * 100.0 / SUM(cs.attempts)), 2)
            ELSE 0
          END AS crosswordAccuracy
        FROM users u
        LEFT JOIN crossword_scores cs ON u.user_id = cs.user_id
        WHERE u.role = 'student'
        GROUP BY u.user_id, u.display_name, u.email
        ORDER BY crosswordScore DESC, crosswordAccuracy DESC
        `
      );

      res.json(rows);
    } catch (err) {
      console.error("GET /crossword/analytics/students-breakdown error:", err);
      res.status(500).json({ error: "Failed to fetch crossword student breakdown" });
    }
  });

  // Download crossword results as CSV
  app.get("/crossword/download-results", async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          u.display_name,
          u.email,
          s.score,
          s.attempts,
          s.correct_answers,
          s.accuracy,
          s.game_session_id
        FROM crossword_scores s
        JOIN users u ON u.user_id = s.user_id
        ORDER BY s.score DESC
      `);

      const header =
        "Rank,Name,Email,Score,Attempts,Correct,Accuracy,Session\n";

      const body = rows
        .map(
          (r, i) =>
            `${i + 1},"${r.display_name || "Anonymous"}","${r.email}",${
              r.score
            },${r.attempts},${r.correct_answers},${r.accuracy},"${
              r.game_session_id
            }"`
        )
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=crossword-results.csv"
      );

      res.send(header + body);
    } catch (err) {
      console.error("GET /crossword/download-results error:", err);
      res.send("CSV generation failed");
    }
  });

  // Check crossword winner
  app.get("/crossword/check-winner/:sessionId", async (req, res) => {
    const session = crosswordSessions.get(req.params.sessionId);
    if (!session) return res.json(null);

    const [rows] = await pool.query(
      `
      SELECT user_id, COUNT(DISTINCT crossword_question_id) as solved
      FROM crossword_answers
      WHERE game_session_id=?
      GROUP BY user_id
      ORDER BY solved DESC, MIN(answered_at)
      LIMIT 1
      `,
      [req.params.sessionId]
    );

    res.json(rows[0] || null);
  });

  // Generate crossword grid
  app.get("/crossword/generate", async (req, res) => {
    const count = parseInt(req.query.count) || 15;
    const size = parseInt(req.query.size) || 15;

    try {
      const [questionRows] = await pool.query(
        "SELECT id, question, answer, difficulty FROM crossword_questions LIMIT ?",
        [count]
      );

      const questions = normalizeCrosswordQuestions(questionRows);

      if (questions.length === 0) {
        return res.status(400).json({ error: "No crossword questions available" });
      }

      const result = generateCrosswordGrid(questions, size);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error("Generate crossword error:", err);
      res.status(500).json({ error: err.message });
    }
  });
}

// ==========================================
// ----- EXPORTS -----
// ==========================================

module.exports = {
  initializeCrosswordRoutes,
  crosswordSessions,
  crosswordGameStatus,
  crosswordLocks,
  crosswordWaitingPlayers,
  crosswordTimers,
  getWaitingPlayerMap,
  emitWaitingLeaderboard,
  finalizeCrosswordGame,
  emitCrosswordLeaderboard,
  getRemainingCrosswordTimeMs,
  hasPlayableCrosswordSession,
  getSolvedWordIdsForUser,
  getOrCreateSolvedUserSet,
  ensureCrosswordLeaderboardEntry,
  emitCrosswordGrid,
  getCrosswordWaitingLeaderboardRows,
  upsertCrosswordScore,
};
