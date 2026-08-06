\
(() => {
  "use strict";

  const CONFIG = window.LORO_CONFIG;
  const SHEET_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv&gid=${CONFIG.sheetGid}`;

  let entries = [];
  const state = {
    selected: "all",
    mode: localStorage.getItem("loroMode") || "en-ko",
    quiz: [],
    index: 0,
    score: 0,
    answered: false,
    wrong: [],
    activeDay: null,
    isReview: false,
    reviewSchedule: null
  };

  const $ = (id) => document.getElementById(id);
  const keyOf = (x) => `${x.day}|${x.word}|${x.pos}`;

  function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function normalize(csvText) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];

    const headers = rows[0].map((v) => v.trim());
    const idx = {
      day: headers.indexOf("Day"),
      word: headers.indexOf("영단어"),
      pos: headers.indexOf("품사"),
      meaning: headers.indexOf("뜻"),
      use: headers.indexOf("사용")
    };

    if ([idx.day, idx.word, idx.pos, idx.meaning].some((v) => v < 0)) {
      throw new Error("구글시트 헤더가 올바르지 않습니다.");
    }

    return rows
      .slice(1)
      .map((r) => ({
        day: Number((r[idx.day] || "").trim()),
        word: (r[idx.word] || "").trim(),
        pos: (r[idx.pos] || "").trim(),
        meaning: (r[idx.meaning] || "").trim(),
        use: idx.use >= 0 ? (r[idx.use] || "Y").trim().toUpperCase() : "Y"
      }))
      .filter((x) => x.day && x.word && x.pos && x.meaning && x.use !== "N");
  }

  async function loadEntries() {
    try {
      const response = await fetch(`${SHEET_URL}&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("시트 요청 실패");

      const loaded = normalize(await response.text());
      if (loaded.length < 4) throw new Error("시트 단어 부족");

      entries = loaded;
      $("sheetStatus").textContent = `구글시트와 연결됨 · 총 ${entries.length}개 항목`;
    } catch (error) {
      entries = CONFIG.fallbackEntries;
      $("sheetStatus").textContent =
        `구글시트를 읽지 못해 내장 단어 ${entries.length}개를 사용 중입니다.`;
      console.error(error);
    }

    renderDays();
    renderReviews();
  }

  function renderDays() {
    const counts = {};
    entries.forEach((x) => {
      counts[x.day] = (counts[x.day] || 0) + 1;
    });

    const grid = $("dayGrid");
    grid.innerHTML = "";

    Object.keys(counts)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((day) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-btn";
        button.dataset.day = String(day);
        button.innerHTML =
          `<strong>DAY ${String(day).padStart(2, "0")}</strong><span>${counts[day]}개 항목</span>`;
        button.addEventListener("click", () => selectDay(button));
        grid.appendChild(button);
      });

    const all = document.createElement("button");
    all.type = "button";
    all.className = "day-btn active";
    all.dataset.day = "all";
    all.innerHTML = `<strong>전체 학습</strong><span>${entries.length}개 항목</span>`;
    all.addEventListener("click", () => selectDay(all));
    grid.appendChild(all);
    state.selected = "all";
  }

  function selectDay(button) {
    state.selected = button.dataset.day;
    document.querySelectorAll(".day-btn").forEach((x) => x.classList.remove("active"));
    button.classList.add("active");
  }

  function renderMode() {
    document.querySelectorAll(".mode-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
  }

  function statsData() {
    return JSON.parse(
      localStorage.getItem("loroStatsV3") ||
        '{"plays":0,"answered":0,"correct":0,"reviewDone":0}'
    );
  }

  function renderStats() {
    const s = statsData();
    $("plays").textContent = s.plays;
    $("answeredTotal").textContent = s.answered;
    $("accuracy").textContent = s.answered
      ? `${Math.round((s.correct / s.answered) * 100)}%`
      : "0%";
    $("reviewDone").textContent = s.reviewDone;
  }

  function schedules() {
    return JSON.parse(localStorage.getItem("loroReviewSchedules") || "[]");
  }

  function saveSchedules(value) {
    localStorage.setItem("loroReviewSchedules", JSON.stringify(value));
  }

  function renderReviews() {
    const today = localDateKey();
    const due = schedules().filter((x) => x.date <= today && !x.done);
    const box = $("reviewList");
    box.innerHTML = "";

    if (!due.length) {
      box.innerHTML = '<div class="status">오늘 예약된 복습이 없습니다.</div>';
      return;
    }

    due.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "review-card";
      button.innerHTML =
        `<div><strong>DAY ${String(item.day).padStart(2, "0")}</strong>` +
        `<small>${item.date} 예약</small></div><span>복습 시작 →</span>`;
      button.addEventListener("click", () => {
        state.reviewSchedule = item;
        startQuiz("normal", item.day);
      });
      box.appendChild(button);
    });
  }

  function startQuiz(mode = "normal", reviewDay = null) {
    let pool;
    state.isReview = reviewDay !== null;

    if (mode === "wrong") {
      const saved = JSON.parse(localStorage.getItem("loroWrongV3") || "[]");
      pool = entries.filter((x) => saved.includes(keyOf(x)));
      if (pool.length < 4) {
        alert("오답 항목이 4개 이상 필요합니다.");
        return;
      }
    } else if (reviewDay !== null) {
      pool = entries.filter((x) => x.day === reviewDay);
    } else {
      pool =
        state.selected === "all"
          ? entries
          : entries.filter((x) => String(x.day) === String(state.selected));
    }

    if (pool.length < 4) {
      alert("해당 범위의 단어가 4개 미만입니다.");
      return;
    }

    state.quiz = shuffle(pool);
    state.index = 0;
    state.score = 0;
    state.answered = false;
    state.wrong = [];
    state.activeDay =
      reviewDay !== null
        ? reviewDay
        : state.selected === "all"
          ? null
          : Number(state.selected);

    $("home").classList.add("hidden");
    $("result").classList.add("hidden");
    $("quiz").classList.remove("hidden");
    showQuestion();
  }

  function currentDirection() {
    if (state.mode === "random") {
      return Math.random() < 0.5 ? "en-ko" : "ko-en";
    }
    return state.mode;
  }

  function distractors(question, direction) {
    const samePos = shuffle(
      entries.filter((x) => keyOf(x) !== keyOf(question) && x.pos === question.pos)
    );
    const otherPos = shuffle(
      entries.filter((x) => keyOf(x) !== keyOf(question) && x.pos !== question.pos)
    );

    const values = [];
    for (const item of [...samePos, ...otherPos]) {
      const value = direction === "en-ko" ? item.meaning : item.word;
      const correct = direction === "en-ko" ? question.meaning : question.word;
      if (value !== correct && !values.includes(value)) values.push(value);
      if (values.length === 3) break;
    }
    return values;
  }

  function showQuestion() {
    const question = state.quiz[state.index];
    const direction = currentDirection();
    state.answered = false;

    $("nextBtn").classList.add("hidden");
    $("feedback").textContent = "";
    $("counter").textContent = `${state.index + 1} / ${state.quiz.length}`;
    $("score").textContent = `점수 ${state.score}`;
    $("progress").style.width = `${(state.index / state.quiz.length) * 100}%`;
    $("direction").textContent =
      direction === "en-ko"
        ? "영어를 보고 한국어 뜻을 고르세요"
        : "한국어 뜻을 보고 영어 단어를 고르세요";
    $("prompt").textContent = direction === "en-ko" ? question.word : question.meaning;
    $("pos").textContent = question.pos;

    const correct = direction === "en-ko" ? question.meaning : question.word;
    const choices = shuffle([correct, ...distractors(question, direction)]);

    $("options").innerHTML = "";
    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.textContent = choice;
      button.addEventListener("click", () =>
        checkAnswer(button, choice, question, correct)
      );
      $("options").appendChild(button);
    });
  }

  function checkAnswer(button, choice, question, correct) {
    if (state.answered) return;
    state.answered = true;
    document.querySelectorAll(".option").forEach((x) => (x.disabled = true));

    if (choice === correct) {
      button.classList.add("correct");
      state.score++;
      $("feedback").textContent = "✅ 정답입니다!";
    } else {
      button.classList.add("wrong");
      document.querySelectorAll(".option").forEach((x) => {
        if (x.textContent === correct) x.classList.add("correct");
      });
      $("feedback").textContent = `❌ 정답: ${correct}`;
      state.wrong.push(question);

      const saved = new Set(
        JSON.parse(localStorage.getItem("loroWrongV3") || "[]")
      );
      saved.add(keyOf(question));
      localStorage.setItem("loroWrongV3", JSON.stringify([...saved]));
    }

    $("score").textContent = `점수 ${state.score}`;
    $("nextBtn").classList.remove("hidden");
  }

  function nextQuestion() {
    state.index++;
    if (state.index >= state.quiz.length) finishQuiz();
    else showQuestion();
  }

  function finishQuiz() {
    const s = statsData();
    s.plays++;
    s.answered += state.quiz.length;
    s.correct += state.score;
    if (state.isReview) s.reviewDone++;
    localStorage.setItem("loroStatsV3", JSON.stringify(s));

    if (state.isReview && state.reviewSchedule) {
      const all = schedules();
      const found = all.find((x) => x.id === state.reviewSchedule.id);
      if (found) found.done = true;
      saveSchedules(all);
    }

    $("quiz").classList.add("hidden");
    $("result").classList.remove("hidden");
    $("resultScore").textContent = `${state.score} / ${state.quiz.length}`;
    $("resultText").textContent =
      `정답률 ${Math.round((state.score / state.quiz.length) * 100)}%`;

    $("reviewScheduler").classList.toggle(
      "hidden",
      state.activeDay === null || state.isReview
    );

    $("wrongList").innerHTML = state.wrong.length
      ? state.wrong
          .map(
            (x) =>
              `<div class="wrong-item">` +
              `<div class="wrong-main"><strong>${x.word}</strong><small>${x.pos}</small></div>` +
              `<span>${x.meaning}</span></div>`
          )
          .join("")
      : '<div class="status">모든 항목을 맞혔어요.</div>';

    renderStats();
  }

  function saveReview() {
    if (state.activeDay === null) return;

    const checked = [
      ...document.querySelectorAll("#reviewScheduler input:checked")
    ].map((x) => Number(x.value));

    const all = schedules();
    checked.forEach((days) => {
      const date = addDays(days);
      const duplicate = all.some(
        (x) => x.day === state.activeDay && x.date === date && !x.done
      );
      if (!duplicate) {
        all.push({
          id: `${Date.now()}-${days}-${state.activeDay}`,
          day: state.activeDay,
          date,
          done: false
        });
      }
    });

    saveSchedules(all);
    alert("복습 일정이 저장되었습니다.");
    renderReviews();
  }

  function goHome() {
    $("quiz").classList.add("hidden");
    $("result").classList.add("hidden");
    $("home").classList.remove("hidden");
    renderReviews();
    renderStats();
  }

  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      localStorage.setItem("loroMode", state.mode);
      renderMode();
    });
  });

  $("startBtn").addEventListener("click", () => startQuiz());
  $("wrongBtn").addEventListener("click", () => startQuiz("wrong"));
  $("nextBtn").addEventListener("click", nextQuestion);
  $("homeBtn").addEventListener("click", goHome);
  $("againBtn").addEventListener("click", () => startQuiz());
  $("resultHomeBtn").addEventListener("click", goHome);
  $("saveReviewBtn").addEventListener("click", saveReview);
  $("resetBtn").addEventListener("click", () => {
    if (
      confirm("학습 기록, 오답, 복습 일정을 모두 초기화할까요?")
    ) {
      ["loroStatsV3", "loroWrongV3", "loroReviewSchedules"].forEach((key) =>
        localStorage.removeItem(key)
      );
      renderStats();
      renderReviews();
    }
  });

  renderMode();
  renderStats();
  loadEntries();
})();
