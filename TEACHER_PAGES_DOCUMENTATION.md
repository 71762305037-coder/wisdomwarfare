# Teacher Pages Documentation

## Overview
This document explains all teacher-related pages and utilities in the Wisdom Warfare application. Teachers can manage games, create/upload questions, and view student analytics.

---

## 📑 Index of Teacher Pages

1. **TeacherLogin.jsx** - Teacher Authentication
2. **TeacherGameManagementPage.jsx** - Game Management Hub (Main Interface)
3. **crosswordteacher.js** - Crossword Utilities & Modals
4. **TeacherAnalyticsDashboard.jsx** - Student Performance Analytics

---

## 1. TeacherLogin.jsx

### Purpose
Handles teacher authentication/login to the system.

### Location
`frontend/src/TeacherLogin.jsx`

### Key Features
- **Login Form** with three fields:
  - Username (text input)
  - Email ID (email input)
  - Password (password input)
  
- **Styling**: Red/rose theme with neon effects
  - Background: Gradient (red-950 to rose-950)
  - UI: Dark gray (opacity 80%) with backdrop blur
  - Accents: Red/rose colors
  
### Component Structure
```jsx
function TeacherLogin({ onLogin }) {
  - Form submission handler
  - Validates all three fields before submission
  - Calls onLogin(username, email, password)
  - If validation fails, shows alert
}
```

### Props
- `onLogin`: Callback function that receives (username, email, password)

### Flow
```
Teacher enters credentials
  ↓
Form validation
  ↓
onLogin callback triggered
  ↓
Authentication handled by parent component
```

---

## 2. TeacherGameManagementPage.jsx

### Purpose
**Main teacher interface** for managing all game types (MCQ, Crossword) and viewing analytics.

### Location
`frontend/src/TeacherGameManagementPage.jsx`

### Key Responsibilities

#### A. Student Management
- **UploadStudentsSection()**: Upload student list via CSV
  - CSV format: email, display_name, role
  - Handles bulk student registration
  - Shows success/error feedback

#### B. MCQ (Multiple Choice Questions) Game Management
- **AddOrEditMCQModal()**: Add/edit individual MCQ questions
  - Fields: Question text, options A-B-C-D, correct answer, difficulty, topic
  - Supports both Create and Edit modes
  
- **Manage MCQ Questions**:
  - View all questions
  - Edit existing questions
  - Delete questions
  - Upload questions via CSV

- **MCQ Game Controls**:
  - Generate unique game code
  - Start/Stop MCQ games
  - Configure game settings

#### C. Crossword Game Management
- **AddOrEditCrosswordModal()** (from crosswordteacher.js):
  - Add/edit crossword clues
  - Fields: Clue (question), Answer
  
- **Manage Crossword Questions**:
  - View all crossword questions
  - Edit existing questions
  - Delete questions
  - Upload questions via CSV
  
- **Crossword Game Controls**:
  - Generate unique game code
  - Start crossword game
  - Monitor live leaderboard
  - End game session

#### D. Student Management & Analytics
- **TopPlayersModal()**: Display global leaderboard
  - Rank with medal emoji (🥇🥈🥉)
  - Student name, email, total score
  - Sortable by score
  
- **View Student Analytics**:
  - Access TeacherAnalyticsDashboard
  - Track student performance
  - Time-range filtering (week, month, etc.)
  - Individual student drill-down

#### E. Game Results & Export
- **Download Results**: Export player scores to CSV
- **View Leaderboard**: Real-time leaderboard updates
- **Game History**: Track all game sessions

### Component Structure

```jsx
// Main Component
function TeacherGameManagementPage() {
  const [teacherId] = useState(...);
  const [gameCode, setGameCode] = useState("");
  const [socket, setSocket] = useState(null);
  const [games, setGames] = useState({});
  
  // MCQ state
  const [mcqQuestions, setMcqQuestions] = useState([]);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [uploadingMCQ, setUploadingMCQ] = useState(false);
  
  // Crossword state
  const [crosswordQuestions, setCrosswordQuestions] = useState([]);
  const [editingCrossword, setEditingCrossword] = useState(null);
  
  // UI state
  const [gameStarted, setGameStarted] = useState(false);
  const [players, setPlayers] = useState([]);
  const [showTopPlayers, setShowTopPlayers] = useState(false);
  
  // Functions...
}

// Sub-Components
- TopPlayersModal()
- UploadStudentsSection()
- EditQuestionModal() [MCQ]
- [Crossword modals from crosswordteacher.js]
```

### Key Functions

#### Game Code Generation
```javascript
generateGameCode = () => {
  // Generates 6-character alphanumeric code
  // Format: Uppercase letters + numbers
  // Used for both MCQ and Crossword games
}
```

#### MCQ Game Management
```javascript
startMCQGame = async () => {
  // Calls backend API: POST /quiz/start-game
  // Sends: number of questions, game code
  // Returns: game session ID
}

handleMCQQuestionSave = async (question) => {
  // POST /quiz/questions (create)
  // PUT /quiz/questions/{id} (update)
}

deleteMCQQuestion = async (id) => {
  // DELETE /quiz/questions/{id}
}

uploadMCQQuestions = async (file) => {
  // POST /quiz/questions/upload
  // Expects CSV format
}
```

#### Crossword Game Management
```javascript
startCrosswordGame = async () => {
  // Calls: crosswordteacher.startCrosswordGame(gameCode)
  // Sends: game code
  // Triggers socket broadcast to students
  // Returns: grid, words, clues
}

handleCrosswordQuestionSave = async (clue, answer) => {
  // Uses: crosswordteacher.AddOrEditCrosswordModal
  // POST /crossword/questions (create)
  // PUT /crossword/questions/{id} (update)
}

deleteCrosswordQuestion = async (id) => {
  // Uses: crosswordteacher.deleteCrosswordQuestion(id)
  // DELETE /crossword/questions/{id}
}

uploadCrosswordQuestions = async (file) => {
  // Uses: UploadCrosswordQsModal from crosswordteacher.js
  // POST /crossword/questions/upload
  // CSV format: question, answer, difficulty
}
```

#### Analytics & Results
```javascript
handleViewAnalytics = () => {
  // Navigate to TeacherAnalyticsDashboard
  // Passes teacherId as prop
}

downloadResults = async () => {
  // Uses: crosswordteacher.downloadCrosswordResults()
  // Downloads CSV file with all game results
}

fetchLeaderboard = async () => {
  // Uses: crosswordteacher.fetchCrosswordRanks()
  // Fetches top players for modal display
}
```

#### Socket.IO Event Handlers
```javascript
socket.on('connect', () => {
  // Confirm connection to game server
})

socket.on('crosswordLeaderboard', (data) => {
  // Receive live score updates
  // Update players state
  // Refresh UI in real-time
})

socket.on('gameEnded', (data) => {
  // Game session ended
  // Stop receiving score updates
  // Allow teacher to start new game
})
```

### Data Flow: Starting a Crossword Game

```
Teacher clicks "Start Crossword Game"
  ↓
generateGameCode() → Creates code (e.g., "ABC123")
  ↓
startCrosswordGame(gameCode)
  ↓
POST /crossword/start-game (backend)
  ↓
Backend:
  1. Validates game code exists
  2. Fetches questions from DB
  3. Calls generateCrosswordGrid()
  4. Creates 15x15 grid
  5. Stores grid in memory
  ↓
Socket broadcast: "crosswordGameStarted"
  ↓
Frontend receives grid, displays in GameUI.js
  ↓
All connected students receive grid
  ↓
Teachers sees live leaderboard via socket events
```

### API Endpoints Used

#### MCQ Endpoints
- `POST /quiz/start-game` - Start MCQ game
- `GET /quiz/questions` - Get all MCQ questions
- `POST /quiz/questions` - Create question
- `PUT /quiz/questions/{id}` - Update question
- `DELETE /quiz/questions/{id}` - Delete question
- `POST /quiz/questions/upload` - Upload CSV

#### Crossword Endpoints
- `POST /crossword/start-game` - Start crossword game
- `GET /crossword/questions` - Get all crossword questions
- `POST /crossword/questions` - Create crossword clue
- `PUT /crossword/questions/{id}` - Update crossword clue
- `DELETE /crossword/questions/{id}` - Delete crossword clue
- `POST /crossword/questions/upload` - Upload CSV
- `GET /crossword/leaderboard` - Get crossword rankings
- `GET /crossword/download-results` - Download results CSV

#### Student Management
- `POST /students/upload` - Upload student list CSV

---

## 3. crosswordteacher.js

### Purpose
**Utility library** for all crossword-related operations in the teacher interface.

### Location
`frontend/src/crosswordteacher.js`

### Exports (Functions & Components)

#### Export 1: AddOrEditCrosswordModal Component

**Purpose**: Modal for adding or editing crossword questions

**Props**:
- `onClose`: Function to close modal
- `onSaved`: Callback after successful save
- `initialData`: Optional - question object for edit mode (null = add mode)

**Modal Fields**:
- Textarea: Question / Clue
- Input: Answer (single word)
- Buttons: Cancel, Save

**API Calls**:
```javascript
// ADD MODE (POST)
POST /crossword/questions
Body: { question, answer }
Response: Success message

// EDIT MODE (PUT)
PUT /crossword/questions/{id}
Body: { question, answer }
Response: Success message
```

**Validation**:
- Both question and answer must be filled
- Shows alert if validation fails
- Prevents submission while loading

---

#### Export 2: UploadCrosswordQsModal Component

**Purpose**: Modal for bulk uploading crossword questions via CSV

**Props**:
- `onClose`: Function to close modal
- `onInserted`: Callback after successful upload

**File Format**:
```csv
question,answer,difficulty
What is the capital of France?,Paris,Easy
A large body of water,Ocean,Medium
```

**Flow**:
1. User selects CSV file
2. File sent to backend
3. Backend parses CSV
4. Questions inserted into database
5. Success message shows count

**API Call**:
```javascript
POST /crossword/questions/upload
Headers: multipart/form-data
Body: { file }
Response: { inserted: number, error?: string[] }
```

---

#### Export 3: ViewCrosswordQuestionsModal Component

**Purpose**: Display all crossword questions with edit/delete controls

**Props**:
- `questions`: Array of question objects
- `onClose`: Function to close modal
- `onEdit`: Callback when edit button clicked
- `onDelete`: Callback when delete button clicked

**Question Structure**:
```javascript
{
  id/question_id: number,
  question: string,
  answer: string,
  difficulty?: string,
  _id?: string  // Alternative ID field
}
```

**UI Features**:
- Question count badge
- List of all questions with answers highlighted in green
- Edit button (✏) for each question
- Delete button (🗑) for each question
- Index numbering (1, 2, 3...)
- Empty state if no questions

---

#### Export 4: startCrosswordGame Function

**Purpose**: Initiates a crossword game session on backend

**Signature**:
```javascript
export async function startCrosswordGame(gameCode)
```

**Parameters**:
- `gameCode`: String - The game code created by teacher

**Process**:
1. Validates game code exists
2. Sends POST to `/crossword/start-game`
3. Backend generates 15x15 grid
4. Backend fetches questions from DB
5. Backend broadcasts to all students via Socket.IO

**Return Value**:
```javascript
{
  success: boolean,
  grid: Array<Array<string>>,      // 15x15 grid
  words: Array<object>,             // Placed words with positions
  totalWords: number,
  gridSize: number,
  sessionId?: string,
  error?: string
}
```

**Error Handling**:
- Throws error if game code invalid
- Throws error if no questions in database
- Throws error if grid generation fails
- Console logs for debugging

---

#### Export 5: fetchCrosswordQuestions Function

**Purpose**: Retrieve all crossword questions from database

**Signature**:
```javascript
export async function fetchCrosswordQuestions()
```

**Parameters**: None

**Return Value**:
```javascript
Array<{
  id: number,
  question: string,
  answer: string,
  difficulty?: string,
  _id?: string
}>

// Returns empty array [] if error
```

**API Call**:
```javascript
GET /crossword/questions
Response format (accepts both):
  - Direct array: [{...}, {...}]
  - Object with questions key: { questions: [{...}] }
```

---

#### Export 6: deleteCrosswordQuestion Function

**Purpose**: Delete a crossword question

**Signature**:
```javascript
export async function deleteCrosswordQuestion(id)
```

**Parameters**:
- `id`: String | Number - Question/Clue ID

**Validation**:
- Checks if ID is provided
- Shows alert if ID missing
- Prevents deletion without ID

**API Call**:
```javascript
DELETE /crossword/questions/{id}
Returns: 200 OK on success
```

**Return Value**:
```javascript
boolean - true if successful, false if failed
```

**Error Handling**:
- Catches network errors
- Shows user-friendly alert
- Logs error to console

---

#### Export 7: fetchCrosswordRanks Function

**Purpose**: Get crossword leaderboard/rankings

**Signature**:
```javascript
export async function fetchCrosswordRanks()
```

**Parameters**: None

**Return Value**:
```javascript
Array<{
  user_id: string,
  display_name: string,
  email: string,
  total_score: number,
  accuracy?: number,
  attempts?: number
}>

// Returns empty array [] if error
```

**API Call**:
```javascript
GET /crossword/leaderboard
Response: Array or object with rankings
```

---

#### Export 8: downloadCrosswordResults Function

**Purpose**: Download all crossword game results as CSV file

**Signature**:
```javascript
export async function downloadCrosswordResults()
```

**Parameters**: None

**Process**:
1. Fetch CSV blob from backend
2. Create temporary download URL
3. Trigger browser download
4. Clean up resources

**API Call**:
```javascript
GET /crossword/download-results
Response: CSV file blob
```

**Download Behavior**:
- Creates `<a>` element
- Sets href to blob URL
- Sets download filename: "crossword-results.csv"
- Triggers click()
- Cleans up blob URL
- Removes temporary element

**Return Value**:
```javascript
boolean - true if successful, false if failed
```

**CSV Format** (example):
```csv
student_name,email,score,accuracy,time_taken,questions_answered
John Doe,john@school.com,85,92%,5m30s,12/15
Jane Smith,jane@school.com,92,98%,4m20s,15/15
```

---

### Integration with TeacherGameManagementPage

The functions in `crosswordteacher.js` are imported and used within `TeacherGameManagementPage.jsx`:

```javascript
import {
  AddOrEditCrosswordModal,
  UploadCrosswordQsModal,
  ViewCrosswordQuestionsModal,
  fetchCrosswordQuestions,
  deleteCrosswordQuestion,
  fetchCrosswordRanks,
  downloadCrosswordResults,
  startCrosswordGame
} from "./crosswordteacher";
```

**Usage Example**:
```javascript
// Show modal to add crossword question
<AddOrEditCrosswordModal 
  onClose={() => setShowAddCrosswordModal(false)}
  onSaved={() => fetchCrosswordQuestions()}
/>

// Fetch and display all questions
const questions = await fetchCrosswordQuestions();
setCrosswordQuestions(questions);

// Start the game
const result = await startCrosswordGame(gameCode);
if (result.success) {
  setGameStarted(true);
  // Listen for leaderboard updates via socket
}

// Delete a question
const success = await deleteCrosswordQuestion(questionId);
if (success) {
  refetchQuestions();
}
```

---

## 4. TeacherAnalyticsDashboard.jsx

### Purpose
**Advanced analytics dashboard** for teachers to monitor student performance, progress, and game statistics.

### Location
`frontend/src/components/TeacherAnalyticsDashboard/TeacherAnalyticsDashboard.jsx`

### Key Features

#### A. Overview Metrics
- **Total Students**: Count of registered students
- **Total Questions Answered**: Aggregate across all students and games
- **Participation Rate**: Percentage of students who played
- **Average Score**: Mean score across all attempts

#### B. Time Range Filtering
- **Options**: Week, Month, All Time
- **Purpose**: Analyze performance trends over different periods
- **Impact**: All charts update based on selected time range

#### C. Performance Visualization
- **Bar Charts**: Score distribution, questions answered
- **Pie Charts**: Game type breakdown (MCQ vs Crossword)
- **Line Charts**: Performance trends over time
- **Radar Charts**: Multi-dimensional analysis
- **Composed Charts**: Combined metrics view

#### D. Student Detail View
- **Drill-down Analytics**: Click on student to see details
- **Individual Performance**:
  - Total score
  - Accuracy percentage
  - Questions answered
  - Average time per question
  - Game breakdown (MCQ vs Crossword)

#### E. Question Analysis
- **Question-Level Stats**:
  - Total answers received
  - Correct answers count
  - Incorrect answers count
  - Success rate by difficulty
  - Student comparison for each question

#### F. Performance Brackets
- **Student Segmentation**:
  - High performers (top quartile)
  - Good performers (2nd quartile)
  - Average performers (3rd quartile)
  - Below average (bottom quartile)
  - View all students in each bracket

#### G. Auto-Refresh Feature
- **Real-time Updates**: Toggle auto-refresh on/off
- **Refresh Interval**: Configurable (default: every 30 seconds)
- **Live Monitoring**: See scores update as students play

### Component Structure

```jsx
const TeacherAnalyticsDashboard = ({ teacherId, onLogout }) => {
  // State for analytics data
  const [overview, setOverview] = useState({
    totalStudents,
    totalQuestionsAnswered,
    participationRate,
    averageScore,
    topicBreakdown: [],
    difficultyBreakdown: []
  });
  
  // State for time range
  const [timeRange, setTimeRange] = useState('week');
  
  // State for student drill-down
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentDetailModal, setStudentDetailModal] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState([]);
  
  // State for question analysis
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [questionDetailModal, setQuestionDetailModal] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState([]);
  
  // State for performance brackets
  const [selectedPerformanceBracket, setSelectedPerformanceBracket] = useState(null);
  const [performanceBracketModal, setPerformanceBracketModal] = useState(false);
  const [bracketStudents, setBracketStudents] = useState([]);
  
  // Auto-refresh feature
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Functions and effects...
}
```

### Key Functions

#### Fetch Analytics Overview
```javascript
fetchAnalytics = async () => {
  // GET /analytics/overview
  // GET /analytics/students
  // GET /analytics/questions
  // GET /analytics/performance
  
  // Returns aggregated data for all charts
}
```

#### Fetch Student Details
```javascript
fetchStudentDetails = async (studentId) => {
  // GET /analytics/student/{studentId}
  // Returns:
  //   - All answered questions
  //   - Answers (correct/incorrect)
  //   - Time taken
  //   - Game performance breakdown
}
```

#### Fetch Question Analysis
```javascript
fetchQuestionAnalysis = async (questionId) => {
  // GET /analytics/question/{questionId}
  // Returns:
  //   - All student answers to this question
  //   - Correct vs incorrect count
  //   - Students who got it right
  //   - Students who got it wrong
}
```

#### Performance Bracket Calculation
```javascript
getPerformanceBracket = (score, allScores) => {
  // Quartile calculation
  // Bottom 25% = Below Average
  // 25-50% = Average
  // 50-75% = Good
  // Top 25% = High Performer
  
  return {
    bracket: string,
    percentile: number,
    color: string
  }
}
```

#### Auto-Refresh Logic
```javascript
useEffect(() => {
  if (!autoRefresh) return;
  
  const interval = setInterval(() => {
    fetchAnalytics();
  }, 30000);  // Every 30 seconds
  
  return () => clearInterval(interval);
}, [autoRefresh]);
```

### Data Structure

#### Overview Data
```javascript
{
  totalStudents: 45,
  totalQuestionsAnswered: 1250,
  participationRate: 87.5,
  averageScore: 78.3,
  topicBreakdown: [
    { topic: 'Science', count: 300, percentage: 24 },
    { topic: 'History', count: 280, percentage: 22 },
    { topic: 'Geography', count: 270, percentage: 21 }
  ],
  difficultyBreakdown: [
    { difficulty: 'Easy', count: 400, correctRate: 92 },
    { difficulty: 'Medium', count: 500, correctRate: 75 },
    { difficulty: 'Hard', count: 350, correctRate: 52 }
  ]
}
```

#### Student Performance Data
```javascript
{
  student_id: 1,
  display_name: 'John Doe',
  email: 'john@school.com',
  totalScore: 450,
  accuracy: 82.5,
  questionsAnswered: 35,
  averageTimePerQuestion: 45,  // seconds
  gameBreakdown: {
    mcq: { attempts: 20, score: 280 },
    crossword: { attempts: 15, score: 170 }
  }
}
```

### Charts and Visualizations

#### 1. Bar Chart - Score Distribution
- X-axis: Score ranges (0-20, 20-40, 40-60, etc.)
- Y-axis: Number of students
- Shows distribution of scores across student population

#### 2. Pie Chart - Game Type Breakdown
- MCQ: Percentage of attempts
- Crossword: Percentage of attempts
- Shows student preference/engagement by game type

#### 3. Line Chart - Performance Trend
- X-axis: Time (by day/week)
- Y-axis: Average score
- Shows improving/declining trend over selected time range

#### 4. Radar Chart - Multi-dimensional Analysis
- Dimensions: Accuracy, Speed, Consistency, Participation
- Shows well-rounded vs specialized student performance

#### 5. Composed Chart - Questions by Difficulty
- Easy/Medium/Hard question count
- Success rate overlay

### Modals

#### 1. Student Detail Modal
- Shows all questions answered by student
- Correct/incorrect indicators
- Time taken for each question
- Export button for individual student report
- Close button

#### 2. Question Analysis Modal
- Shows all students who answered this question
- Student names, emails, answers
- Correct/incorrect indicators
- Difficulty level
- Topic

#### 3. Performance Bracket Modal
- Lists all students in selected performance bracket
- Sortable by score, accuracy, etc.
- Individual student drill-down
- Bracket statistics

### API Endpoints

```
GET /analytics/overview
GET /analytics/students
GET /analytics/questions
GET /analytics/student/{studentId}
GET /analytics/question/{questionId}
GET /analytics/performance
GET /analytics/export
```

### Integration Points

#### With TeacherGameManagementPage
```javascript
// In TeacherGameManagementPage:
import TeacherAnalyticsDashboard from './components/TeacherAnalyticsDashboard/TeacherAnalyticsDashboard';

// Navigate to dashboard
<button onClick={() => navigate('/teacher-analytics', 
  { state: { teacherId } })}>
  View Analytics
</button>
```

---

## 🔗 Complete Teacher Workflow

```
1. AUTHENTICATION
   TeacherLogin.jsx
   ↓
   Teacher enters credentials

2. MAIN INTERFACE
   TeacherGameManagementPage.jsx
   ↓
   ├─ Create/Upload MCQ Questions
   ├─ Create/Upload Crossword Questions
   ├─ Upload Students
   ├─ Start Game (MCQ or Crossword)
   └─ View Results

3. CROSSWORD OPERATIONS (uses crosswordteacher.js)
   ├─ AddOrEditCrosswordModal
   ├─ UploadCrosswordQsModal
   ├─ ViewCrosswordQuestionsModal
   ├─ startCrosswordGame()
   ├─ deleteCrosswordQuestion()
   ├─ fetchCrosswordRanks()
   └─ downloadCrosswordResults()

4. ANALYTICS & REPORTING
   TeacherAnalyticsDashboard.jsx
   ├─ View overview metrics
   ├─ Filter by time range
   ├─ Drill into student performance
   ├─ Analyze question-level stats
   ├─ View performance brackets
   └─ Generate reports
```

---

## 📊 Summary Table

| Page | Purpose | Key Functions | Game Types |
|------|---------|---------------|-----------|
| **TeacherLogin.jsx** | Authentication | Form validation, Login | N/A |
| **TeacherGameManagementPage.jsx** | Game Management Hub | Code generation, Game start/stop, Upload questions | MCQ, Crossword |
| **crosswordteacher.js** | Crossword Utilities | Grid generation, Q&A management, Results download | Crossword only |
| **TeacherAnalyticsDashboard.jsx** | Analytics & Reporting | Performance metrics, Trends, Student drill-down | Both |

---

## 🎯 Quick Start for Teachers

### To Start Teaching:
1. **Login**: Open TeacherLogin page, enter credentials
2. **Setup Questions**: Go to TeacherGameManagementPage
   - Add questions manually OR upload CSV
3. **Create Game**: Get game code
4. **Start Game**: Click "Start Game" button
5. **Monitor**: See live leaderboard
6. **Analyze**: View TeacherAnalyticsDashboard for detailed insights

### Environment Variables
```
REACT_APP_API_BASE = "http://localhost:4001" (development)
REACT_APP_API_BASE = "https://wisdomwarfare.onrender.com" (production)
```

---

## 🔧 File Locations Reference

- TeacherLogin: `frontend/src/TeacherLogin.jsx`
- TeacherGameManagementPage: `frontend/src/TeacherGameManagementPage.jsx`
- crosswordteacher.js: `frontend/src/crosswordteacher.js`
- TeacherAnalyticsDashboard: `frontend/src/components/TeacherAnalyticsDashboard/TeacherAnalyticsDashboard.jsx`
- Documentation: `ARCHITECTURE_DIAGRAMS.md`, `CROSSWORD_ARCHITECTURE_DIAGRAM.md`, `CROSSWORDGENERATE_USAGE.md`
