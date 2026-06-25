'use strict';

/* ============================================================
   Constants
   ============================================================ */
const REST_URL = 'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,region,flags';
const FALLBACK_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
const QUESTIONS_PER_ROUND = 10;
const ADVANCE_DELAY_MS = 1500;
const BEST_SCORE_KEY = 'quiz_best_score';

const FLAG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 40'%3E%3Crect width='60' height='40' fill='%23374151'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-size='20' fill='%236b7280'%3E%F0%9F%8F%B3%3C/text%3E%3C/svg%3E";
const LETTERS = ['A', 'B', 'C', 'D'];

/* ============================================================
   Quiz State
   ============================================================ */
const QuizState = {
  allCountries: [],
  pool: [],
  roundQuestions: [],
  currentIndex: 0,
  score: 0,
  answered: false,
  continent: 'all',
  difficulty: 'easy',
};

/* ============================================================
   Utility
   ============================================================ */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getFlagUrl(cca2, size = 320) {
  if (!cca2) return FLAG_PLACEHOLDER;
  return `https://flagcdn.com/w${size}/${cca2.toLowerCase()}.png`;
}

function getBestScore() {
  const key = `${BEST_SCORE_KEY}_${QuizState.continent}_${QuizState.difficulty}`;
  return parseInt(localStorage.getItem(key) || '0', 10);
}

function saveBestScore(score) {
  const key = `${BEST_SCORE_KEY}_${QuizState.continent}_${QuizState.difficulty}`;
  const prev = getBestScore();
  if (score > prev) localStorage.setItem(key, String(score));
}

/* ============================================================
   Data Loading
   ============================================================ */
async function loadCountries() {
  showScreen('loading');
  try {
    let countries = await fetchCountries();
    // Filter to countries that have a cca2 code and are not Antarctic
    QuizState.allCountries = countries.filter(c => c.cca2 && c.region !== 'Antarctic');
    showScreen('start');
    initBestScore();
  } catch (err) {
    document.querySelector('.quiz-loading p').textContent = 'Failed to load data. Refresh the page.';
  }
}

async function fetchCountries() {
  try {
    const r = await fetch(REST_URL);
    if (!r.ok) throw new Error('status ' + r.status);
    const data = await r.json();
    if (!Array.isArray(data) || data.length < 100) throw new Error('bad data');
    return data;
  } catch {
    const r = await fetch(FALLBACK_URL);
    if (!r.ok) throw new Error('fallback failed');
    return r.json();
  }
}

/* ============================================================
   Screen Management
   ============================================================ */
function showScreen(name) {
  document.getElementById('quiz-loading').style.display  = name === 'loading' ? 'flex' : 'none';
  document.getElementById('quiz-start').classList.toggle('hidden', name !== 'start');
  document.getElementById('quiz-active').classList.toggle('hidden', name !== 'active');
  document.getElementById('quiz-results').classList.toggle('hidden', name !== 'results');
}

/* ============================================================
   Start Screen
   ============================================================ */
function initBestScore() {
  const best = getBestScore();
  const el = document.getElementById('best-score-display');
  if (best > 0) {
    document.getElementById('best-score-value').textContent = `${best} / ${QUESTIONS_PER_ROUND}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

document.getElementById('quiz-continent').addEventListener('change', (e) => {
  QuizState.continent = e.target.value;
  initBestScore();
});

document.getElementById('quiz-difficulty').addEventListener('change', (e) => {
  QuizState.difficulty = e.target.value;
  initBestScore();
});

document.getElementById('btn-start-quiz').addEventListener('click', startQuiz);
document.getElementById('btn-retry').addEventListener('click', startQuiz);

/* ============================================================
   Quiz Round Setup
   ============================================================ */
function buildPool() {
  const continent = QuizState.continent;
  QuizState.pool = QuizState.allCountries.filter(c => {
    if (continent === 'all') return true;
    return c.region === continent;
  });

  if (QuizState.pool.length < 4) {
    // Not enough for this continent — fall back to all
    QuizState.pool = [...QuizState.allCountries];
  }
}

function startQuiz() {
  QuizState.continent = document.getElementById('quiz-continent').value;
  QuizState.difficulty = document.getElementById('quiz-difficulty').value;
  buildPool();

  // Pick QUESTIONS_PER_ROUND unique countries
  const shuffled = shuffle(QuizState.pool);
  QuizState.roundQuestions = shuffled.slice(0, QUESTIONS_PER_ROUND);
  QuizState.currentIndex = 0;
  QuizState.score = 0;
  QuizState.answered = false;

  showScreen('active');
  updateProgress();
  renderQuestion();
}

/* ============================================================
   Question Rendering
   ============================================================ */
function generateOptions(correct) {
  // For "easy", try wrong options from same region; for "hard", use whole pool
  const usePool = QuizState.difficulty === 'hard'
    ? QuizState.allCountries
    : (QuizState.pool.filter(c => c.cca2 !== correct.cca2 && c.region === correct.region).length >= 3
        ? QuizState.pool
        : QuizState.allCountries);

  const wrongPool = usePool.filter(c => c.cca2 !== correct.cca2);
  const wrongs = shuffle(wrongPool).slice(0, 3);
  return shuffle([correct, ...wrongs]);
}

function renderQuestion() {
  const correct = QuizState.roundQuestions[QuizState.currentIndex];
  const options = generateOptions(correct);

  // Show skeleton while flag loads
  const flagImg = document.getElementById('quiz-flag-img');
  const skeleton = document.getElementById('flag-skeleton');
  skeleton.classList.add('active');
  flagImg.style.display = 'block';
  flagImg.style.opacity = '0';

  const flagUrl = getFlagUrl(correct.cca2, 320);
  flagImg.onload = () => {
    flagImg.style.opacity = '1';
    skeleton.classList.remove('active');
  };
  flagImg.onerror = () => {
    flagImg.src = FLAG_PLACEHOLDER;
    flagImg.style.opacity = '1';
    skeleton.classList.remove('active');
  };
  flagImg.src = flagUrl;

  // Render option buttons
  const container = document.getElementById('answer-options');
  container.dataset.correct = correct.cca2;
  container.innerHTML = options.map((c, i) => `
    <button class="option-btn"
            data-cca2="${c.cca2}"
            aria-label="Option ${LETTERS[i]}: ${c.name?.common || c.cca2}">
      <span class="option-letter">${LETTERS[i]}</span>
      <span class="option-name">${c.name?.common || c.cca2}</span>
    </button>
  `).join('');

  QuizState.answered = false;

  // Attach click handlers to each button
  container.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', handleAnswer);
  });

  updateProgress();
}

/* ============================================================
   Answer Handling
   ============================================================ */
function handleAnswer(event) {
  if (QuizState.answered) return;
  QuizState.answered = true;

  const chosen = event.currentTarget.dataset.cca2;
  const container = document.getElementById('answer-options');
  const correct = container.dataset.correct;
  const isCorrect = chosen === correct;

  // Disable all buttons and apply visual states
  container.querySelectorAll('.option-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.cca2 === correct) {
      btn.classList.add('correct');
    } else if (btn.dataset.cca2 === chosen && !isCorrect) {
      btn.classList.add('wrong');
    } else {
      btn.classList.add('reveal');
    }
  });

  if (isCorrect) {
    QuizState.score++;
    updateScoreDisplay();
    fireConfetti(false);
  }

  setTimeout(advanceQuestion, ADVANCE_DELAY_MS);
}

function updateScoreDisplay() {
  document.getElementById('quiz-score').textContent = QuizState.score;
}

function advanceQuestion() {
  QuizState.currentIndex++;
  if (QuizState.currentIndex < QuizState.roundQuestions.length) {
    renderQuestion();
  } else {
    showResults();
  }
}

/* ============================================================
   Progress
   ============================================================ */
function updateProgress() {
  const idx = QuizState.currentIndex;
  const total = QuizState.roundQuestions.length;

  document.getElementById('quiz-question-num').textContent =
    `Question ${idx + 1} / ${total}`;

  const pct = (idx / total) * 100;
  document.getElementById('quiz-progress-fill').style.width = pct + '%';
}

/* ============================================================
   Results
   ============================================================ */
function showResults() {
  const score = QuizState.score;
  const total = QuizState.roundQuestions.length;

  saveBestScore(score);

  // Choose message based on score
  let emoji, title, subtitle;
  if (score === total) {
    emoji = '🏆'; title = 'Perfect Score!'; subtitle = 'You know every flag — incredible!';
    fireConfetti(true);
  } else if (score >= 8) {
    emoji = '🎓'; title = 'Great Knowledge!'; subtitle = 'Almost perfect — one more round?';
  } else if (score >= 5) {
    emoji = '🌍'; title = 'Not Bad!'; subtitle = 'You\'re getting better!';
  } else if (score >= 3) {
    emoji = '🌱'; title = 'Keep Learning!'; subtitle = 'Practice makes perfect!';
  } else {
    emoji = '😅'; title = 'Keep Practicing!'; subtitle = 'Every expert was once a beginner!';
  }

  document.getElementById('results-emoji').textContent = emoji;
  document.getElementById('results-title').textContent = title;
  document.getElementById('results-subtitle').textContent = subtitle;
  document.getElementById('results-score-num').textContent = score;

  // Color ring based on score ratio
  const ring = document.getElementById('score-ring-fill');
  const circumference = 314.16;
  const pct = score / total;
  ring.style.strokeDashoffset = String(circumference * (1 - pct));
  ring.style.stroke = pct >= 0.8 ? '#22c55e' : pct >= 0.5 ? '#3b82f6' : '#ef4444';

  showScreen('results');

  // Re-init best score display for next start
  initBestScore();
}

/* ============================================================
   Confetti
   ============================================================ */
function fireConfetti(big) {
  if (typeof confetti === 'undefined') return;
  if (big) {
    confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 }, colors: ['#3b82f6','#6366f1','#f59e0b','#22c55e','#ec4899'] });
    setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.1, y: 0.7 }, angle: 60 }), 300);
    setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.9, y: 0.7 }, angle: 120 }), 300);
  } else {
    confetti({ particleCount: 55, spread: 55, origin: { y: 0.75 }, scalar: 0.85 });
  }
}

/* ============================================================
   Bootstrap
   ============================================================ */
document.getElementById('quiz-loading').style.display = 'flex';
document.addEventListener('DOMContentLoaded', loadCountries);
