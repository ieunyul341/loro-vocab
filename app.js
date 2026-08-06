(() => {
  "use strict";

  const CONFIG = window.LORO_CONFIG;
  if (!CONFIG) {
    document.body.innerHTML = "<p style='padding:24px'>config.js를 불러오지 못했습니다.</p>";
    throw new Error("Missing LORO_CONFIG");
  }

  const SHEET_URL =
    `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv&gid=${CONFIG.sheetGid}`;

  const $ = (id) => document.getElementById(id);
  const keyOf = (x) => `${x.day}|${x.word}|${x.pos}`;

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
    reviewSchedule: null,
    lastPoolType: "normal",
    viewerItems: [],
    viewerIndex: 0
  };

  function shuffle(items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return localDateKey(d);
  }

  function startOfWeek(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
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
      throw new Error("시트 헤더는 Day / 영단어 / 품사 / 뜻 / 사용이어야 합니다.");
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
      if (!response.ok) throw new Error(`시트 요청 실패: ${response.status}`);

      const loaded = normalize(await response.text());
      if (loaded.length < 4) throw new Error("시트에 사용 가능한 단어가 4개 미만입니다.");

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
    renderWeekly();
  }

  function renderDays() {
    const counts = {};
    for (const item of entries) counts[item.day] = (counts[item.day] || 0) + 1;

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
          `<strong>DAY ${String(day).padStart(2, "0")}</strong>` +
          `<span>${counts[day]}개 항목</span>`;
        button.addEventListener("click", () => selectDay(button));
        grid.appendChild(button);
      });

    const all = document.createElement("button");
    all.type = "button";
    all.className = "day-btn active";
    all.dataset.day = "all";
    all.innerHTML =
      `<strong>전체 학습</strong><span>${entries.length}개 항목</span>`;
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

  function getStats() {
    return JSON.parse(
      localStorage.getItem("loroStatsV40") ||
        '{"plays":0,"answered":0,"correct":0,"reviewDone":0}'
    );
  }

  function renderStats() {
    const s = getStats();
    $("plays").textContent = s.plays;
    $("answeredTotal").textContent = s.answered;
    $("accuracy").textContent = s.answered
      ? `${Math.round((s.correct / s.answered) * 100)}%`
      : "0%";
    $("reviewDone").textContent = s.reviewDone;
  }

  function getSchedules() {
    return JSON.parse(localStorage.getItem("loroReviewSchedulesV40") || "[]");
  }

  function saveSchedules(value) {
    localStorage.setItem("loroReviewSchedulesV40", JSON.stringify(value));
  }

  function getHistory() {
    return JSON.parse(localStorage.getItem("loroHistoryV40") || "[]");
  }

  function saveHistory(value) {
    localStorage.setItem("loroHistoryV40", JSON.stringify(value));
  }

  function addHistory(record) {
    const history = getHistory();
    history.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: localDateKey(),
      timestamp: Date.now(),
      ...record
    });
    saveHistory(history);
    renderWeekly();
  }

  function renderReviews() {
    const today = localDateKey();
    const due = getSchedules().filter((x) => x.date <= today && !x.done);
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
        startQuiz("review", item.day);
      });
      box.appendChild(button);
    });
  }

  function renderWeekly() {
    const history = getHistory();
    const start = startOfWeek();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    const weekItems = history.filter((x) => {
      const t = new Date(x.timestamp);
      return t >= start && t < end;
    });

    const grouped = {};
    for (const item of weekItems) {
      grouped[item.date] ||= [];
      grouped[item.date].push(item);
    }

    const box = $("weeklyList");
    box.innerHTML = "";

    const dates = Object.keys(grouped).sort().reverse();
    if (!dates.length) {
      box.innerHTML = '<div class="status">이번 주 학습 기록이 없습니다.</div>';
      return;
    }

    for (const date of dates) {
      const items = grouped[date];
      const quizItems = items.filter((x) => x.type === "quiz" || x.type === "review");
      const viewItems = items.filter((x) => x.type === "view");
      const days = [...new Set(items.map((x) => x.day).filter((x) => x !== null))]
        .sort((a, b) => a - b)
        .map((d) => `DAY ${String(d).padStart(2, "0")}`);

      const answered = quizItems.reduce((sum, x) => sum + (x.total || 0), 0);
      const correct = quizItems.reduce((sum, x) => sum + (x.correct || 0), 0);
      const rate = answered ? `${Math.round((correct / answered) * 100)}%` : "-";
      const summary = [
        viewItems.length ? `보기 ${viewItems.length}회` : "",
        quizItems.length ? `퀴즈 ${quizItems.length}회` : ""
      ].filter(Boolean).join(" · ");

      const row = document.createElement("div");
      row.className = "weekly-item";
      row.innerHTML =
        `<strong>${date}</strong>` +
        `<div class="weekly-days">${days.join(", ") || "전체 학습"}<br>${summary}</div>` +
        `<div class="weekly-rate">${rate}</div>`;
      box.appendChild(row);
    }
  }

  function selectedPool() {
    return state.selected === "all"
      ? entries
      : entries.filter((x) => String(x.day) === String(state.selected));
  }

  function openViewer() {
    const pool = selectedPool();
    if (!pool.length) {
      alert("볼 단어가 없습니다.");
      return;
    }

    state.viewerItems = pool;
    state.viewerIndex = 0;
    state.activeDay = state.selected === "all" ? null : Number(state.selected);

    $("home").classList.add("hidden");
    $("quiz").classList.add("hidden");
    $("result").classList.add("hidden");
    $("viewer").classList.remove("hidden");

    addHistory({
      type: "view",
      day: state.activeDay,
      count: pool.length
    });

    renderViewer();
  }

  function renderViewer() {
    const item = state.viewerItems[state.viewerIndex];
    $("viewerCounter").textContent =
      `${state.viewerIndex + 1} / ${state.viewerItems.length}`;
    $("viewerDay").textContent =
      state.activeDay === null ? "전체 단어" : `DAY ${String(state.activeDay).padStart(2, "0")}`;
    $("viewerWord").textContent = item.word;
    $("viewerPos").textContent = item.pos;
    $("viewerMeaning").textContent = item.meaning;
    $("prevCardBtn").disabled = state.viewerIndex === 0;
    $("nextCardBtn").textContent =
      state.viewerIndex === state.viewerItems.length - 1 ? "처음으로" : "다음 →";
  }

  function moveViewer(delta) {
    if (delta < 0 && state.viewerIndex > 0) {
      state.viewerIndex--;
    } else if (delta > 0) {
      if (state.viewerIndex === state.viewerItems.length - 1) {
        state.viewerIndex = 0;
      } else {
        state.viewerIndex++;
      }
    }
    renderViewer();
  }

  function choosePool(poolType, reviewDay = null) {
    if (poolType === "wrong") {
      const saved = JSON.parse(localStorage.getItem("loroWrongV40") || "[]");
      return entries.filter((x) => saved.includes(keyOf(x)));
    }

    if (poolType === "review" && reviewDay !== null) {
      return entries.filter((x) => x.day === reviewDay);
    }

    return selectedPool();
  }

  function startQuiz(poolType = "normal", reviewDay = null) {
    const pool = choosePool(poolType, reviewDay);

    if (poolType === "wrong" && pool.length < 4) {
      alert("오답 항목이 4개 이상 필요합니다.");
      return;
    }

    if (pool.length < 4) {
      alert("해당 범위의 단어가 4개 미만입니다.");
      return;
    }

    state.lastPoolType = poolType;
    state.isReview = poolType === "review";
    state.quiz = shuffle(pool);
    state.index = 0;
    state.score = 0;
    state.answered = false;
    state.wrong = [];
    state.activeDay =
      poolType === "review"
        ? reviewDay
        : state.selected === "all"
          ? null
          : Number(state.selected);

    $("home").classList.add("hidden");
    $("viewer").classList.add("hidden");
    $("result").classList.add("hidden");
    $("quiz").classList.remove("hidden");
    showQuestion();
  }

  function currentDirection() {
    return state.mode === "random"
      ? Math.random() < 0.5
        ? "en-ko"
        : "ko-en"
      : state.mode;
  }

  function getDistractors(question, direction) {
    const samePos = shuffle(
      entries.filter((x) => keyOf(x) !== keyOf(question) && x.pos === question.pos)
    );
    const otherPos = shuffle(
      entries.filter((x) => keyOf(x) !== keyOf(question) && x.pos !== question.pos)
    );

    const out = [];
    const correct = direction === "en-ko" ? question.meaning : question.word;

    for (const item of [...samePos, ...otherPos]) {
      const value = direction === "en-ko" ? item.meaning : item.word;
      if (value !== correct && !out.includes(value)) out.push(value);
      if (out.length === 3) break;
    }

    return out;
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
    const choices = shuffle([correct, ...getDistractors(question, direction)]);

    $("options").innerHTML = "";
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.textContent = choice;
      button.addEventListener("click", () =>
        checkAnswer(button, choice, question, correct)
      );
      $("options").appendChild(button);
    }
  }

  function checkAnswer(button, choice, question, correct) {
    if (state.answered) return;
    state.answered = true;

    document.querySelectorAll(".option").forEach((x) => {
      x.disabled = true;
    });

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
        JSON.parse(localStorage.getItem("loroWrongV40") || "[]")
      );
      saved.add(keyOf(question));
      localStorage.setItem("loroWrongV40", JSON.stringify([...saved]));
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
    const s = getStats();
    s.plays++;
    s.answered += state.quiz.length;
    s.correct += state.score;
    if (state.isReview) s.reviewDone++;
    localStorage.setItem("loroStatsV40", JSON.stringify(s));

    if (state.isReview && state.reviewSchedule) {
      const all = getSchedules();
      const found = all.find((x) => x.id === state.reviewSchedule.id);
      if (found) found.done = true;
      saveSchedules(all);
    }

    addHistory({
      type: state.isReview ? "review" : "quiz",
      day: state.activeDay,
      total: state.quiz.length,
      correct: state.score,
      mode: state.mode
    });

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

    if (!checked.length) {
      alert("복습 날짜를 하나 이상 선택해주세요.");
      return;
    }

    const all = getSchedules();

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
    $("viewer").classList.add("hidden");
    $("result").classList.add("hidden");
    $("home").classList.remove("hidden");
    renderReviews();
    renderWeekly();
    renderStats();
  }

  document.querySelectorAll(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      localStorage.setItem("loroMode", state.mode);
      renderMode();
    });
  });

  $("viewBtn").addEventListener("click", openViewer);
  $("viewerHomeBtn").addEventListener("click", goHome);
  $("prevCardBtn").addEventListener("click", () => moveViewer(-1));
  $("nextCardBtn").addEventListener("click", () => moveViewer(1));
  $("viewerQuizBtn").addEventListener("click", () => startQuiz("normal"));

  $("startBtn").addEventListener("click", () => startQuiz("normal"));
  $("wrongBtn").addEventListener("click", () => startQuiz("wrong"));
  $("nextBtn").addEventListener("click", nextQuestion);
  $("quitBtn").addEventListener("click", goHome);
  $("againBtn").addEventListener("click", () => {
    const reviewDay = state.isReview ? state.activeDay : null;
    startQuiz(state.lastPoolType, reviewDay);
  });
  $("resultHomeBtn").addEventListener("click", goHome);
  $("saveReviewBtn").addEventListener("click", saveReview);

  $("resetBtn").addEventListener("click", () => {
    if (confirm("학습 기록, 오답, 복습 일정, Weekly 기록을 모두 초기화할까요?")) {
      [
        "loroStatsV40",
        "loroWrongV40",
        "loroReviewSchedulesV40",
        "loroHistoryV40"
      ].forEach((key) => localStorage.removeItem(key));

      renderStats();
      renderReviews();
      renderWeekly();
    }
  });

  renderMode();
  renderStats();
  loadEntries();
})();
