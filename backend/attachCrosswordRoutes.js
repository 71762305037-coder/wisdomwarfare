// ============================================================
// ATTACH CROSSWORD ROUTES
// Attaches all crossword API routes to an Express app
// This module is shared between server.js and crosswordserver.js
// ============================================================

const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { generateCrosswordGrid } = require("./crosswordGrid");

function attachCrosswordRoutes(
  app,
  {
    pool,
    crosswordSessions,
    crosswordGameStatus,
    crosswordWaitingPlayers,
    crosswordTimers,
    CROSSWORD_GAME_DURATION_MS,
    // Helpers
    generateCrosswordSessionId,
    generateShortGameCode,
    normalizeCrosswordQuestions,
    emitCrosswordGrid,
    emitCrosswordLeaderboard,
    emitWaitingLeaderboard,
    getCrosswordWaitingLeaderboardRows,
    getCrosswordLeaderboardRows,
    getCrosswordAggregateLeaderboardRows,
    ensureCrosswordLeaderboardEntry,
    getSolvedWordIdsForUser,
    getOrCreateSolvedUserSet,
    getRemainingCrosswordTimeMs,
    hasPlayableCrosswordSession,
    getWaitingPlayerMap,
    clearCrosswordTimer,
    finalizeCrosswordGame,
    getDateFilter,
    io,
  }
) {
  // ----- Multer -----
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadsDir = path.join(__dirname, "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
      if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
        cb(null, true);
      } else {
        cb(new Error("Only CSV files are allowed"));
      }
    },
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  // ==========================================
  // ----- CROSSWORD API ROUTES -----
  // ==========================================

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

  app.get("/crossword/grid/:game_code", async (req, res) => {
    try {
      const { game_code } = req.params;
      const status = crosswordGameStatus.get(game_code);

      if (!status?.started || !status?.sessionId) {
        return res.status(404).json({
          success: false,
          error: "No active crossword session for this game code",
        });
      }

      const session = crosswordSessions.get(status.sessionId);
      if (!hasPlayableCrosswordSession(session)) {
        return res.status(404).json({
          success: false,
          error: "Active crossword grid not available",
        });
      }

      const clues = Array.isArray(session.clues) ? session.clues : [];
      const acrossClues = clues.filter(
        (clue) => clue.direction === "across" || clue.direction === "horizontal"
      );
      const downClues = clues.filter(
        (clue) => clue.direction === "down" || clue.direction === "vertical"
      );

      res.json({
        success: true,
        sessionId: status.sessionId,
        game_code,
        startedAt: status.startedAt || null,
        endsAt: status.endsAt || null,
        durationMs: status.durationMs || CROSSWORD_GAME_DURATION_MS,
        remainingTimeMs: getRemainingCrosswordTimeMs(status),
        grid: session.grid,
        clues,
        acrossClues,
        downClues,
        cellNumbers: session.cellNumbers || {},
      });
    } catch (err) {
      console.error("GET /crossword/grid/:game_code error:", err);
      res.status(500).json({ success: false, error: "Failed to load crossword grid" });
    }
  });

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

  app.post("/crossword/create-game", async (req, res) => {
    const { teacher_id, game_name } = req.body;

    if (!teacher_id) {
      return res.status(400).json({ error: "teacher_id required" });
    }

    try {
      // Generate unique game code
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

      // Create new game
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

  app.post("/crossword/start-game", async (req, res) => {
    const { game_code } = req.body;
    
    if (!game_code) {
      return res.status(400).json({ error: "game_code required" });
    }

    try {
      const previousStatus = crosswordGameStatus.get(game_code);
      if (previousStatus?.sessionId) {
        crosswordSessions.delete(previousStatus.sessionId);
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
        finalizeCrosswordGame(game_code, { sessionId, reason: "timeout" }).catch((error) => {
          console.error("Crossword timer completion error:", error);
        });
      }, CROSSWORD_GAME_DURATION_MS);
      crosswordTimers.set(game_code, timerHandle);

      const waitingPlayers = Array.from(getWaitingPlayerMap(game_code).values());
      for (const player of waitingPlayers) {
        if (player?.user_id) {
          await ensureCrosswordLeaderboardEntry(player.user_id, sessionId);
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
      const leaderboard = await emitCrosswordLeaderboard(game_code, sessionId);

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

      // Check for duplicate answer
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

      // Get correct answer
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

      // Insert answer history
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

      // Update score table
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

      // Broadcast to socket room if in teacher game mode
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

  app.get(["/crossword/leaderboard", "/leaderboard/crossword"], async (req, res) => {
    try {
      const limit = parseInt(req.query.limit || "50", 10);
      const requestedSessionId = req.query.sessionId || null;
      const requestedGameCode = req.query.game_code || null;

      if (requestedSessionId) {
        const rows = await getCrosswordLeaderboardRows(limit, requestedSessionId);
        return res.json(rows);
      }

      if (requestedGameCode) {
        const status = crosswordGameStatus.get(requestedGameCode);
        if (status?.sessionId && (status.started || status.completed)) {
          const rows = await getCrosswordLeaderboardRows(limit, status.sessionId);
          return res.json(rows);
        }

        return res.json(getCrosswordWaitingLeaderboardRows(requestedGameCode));
      }

      const rows = await getCrosswordAggregateLeaderboardRows(limit);
      res.json(rows);
    } catch (err) {
      console.error("GET /crossword/leaderboard error:", err);
      res.status(500).json([]);
    }
  });

  app.get("/crossword/student/:student_id/performance", async (req, res) => {
    try {
      const { student_id } = req.params;
      
      // Get last game session ID for this student
      const [[lastSession]] = await pool.query(
        `SELECT game_session_id FROM crossword_scores WHERE user_id = ? ORDER BY last_updated DESC LIMIT 1`,
        [student_id]
      );

      let accuracy = 0;
      if (lastSession?.game_session_id) {
        const [[lastSessionAccuracy]] = await pool.query(
          `
          SELECT ROUND((SUM(correct_answers) * 100.0 / SUM(attempts)), 2) as accuracy
          FROM crossword_scores
          WHERE user_id = ? AND game_session_id = ?
          `,
          [student_id, lastSession.game_session_id]
        );
        accuracy = Number(lastSessionAccuracy?.accuracy || 0);
      }

      const [[stats]] = await pool.query(
        `
        SELECT
          COALESCE(SUM(score), 0) AS score,
          COALESCE(COUNT(DISTINCT game_session_id), 0) AS attempts,
          COALESCE(SUM(correct_answers), 0) AS correct_answers
        FROM crossword_scores
        WHERE user_id = ?
        `,
        [student_id]
      );

      res.json({
        score: Number(stats?.score || 0),
        attempts: Number(stats?.attempts || 0),
        correct_answers: Number(stats?.correct_answers || 0),
        accuracy: accuracy,
      });
    } catch (err) {
      console.error("GET /crossword/student/:student_id/performance error:", err);
      res.status(500).json({ error: "Failed to fetch crossword performance" });
    }
  });

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
        "SELECT COALESCE(AVG(accuracy), 0) AS avg FROM crossword_scores WHERE last_updated >= ?",
        [thirtyDaysAgo]
      );
      const [[prevAcc]] = await pool.query(
        "SELECT COALESCE(AVG(accuracy), 0) AS avg FROM crossword_scores WHERE last_updated BETWEEN ? AND ?",
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
      res.status(500).send("CSV generation failed");
    }
  });

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

module.exports = { attachCrosswordRoutes };
