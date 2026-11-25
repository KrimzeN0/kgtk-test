(function () {
  "use strict";

  const STORAGE_KEY = "kgtk_test_errors_v1";
  const AUTO_ADVANCE_MS = 2000;

  const state = {
    currentSessionId: "mdk_01_03",
    activeTab: "session", // "session" | "all" | "errors"
    errorsBySession: loadErrors(),
    allModeOptions: {
      sectionFilter: "all"
    },
    quiz: null,
    timers: {
      autoAdvance: null,
      countdown: null
    }
  };

  // DOM-элементы
  const el = {
    sessionSelect: document.getElementById("sessionSelect"),
    navTabs: Array.from(document.querySelectorAll(".nav-tab")),
    errorsBadge: document.getElementById("errorsBadge"),
    discCode: document.getElementById("discCode"),
    discTitle: document.getElementById("discTitle"),
    discMeta: document.getElementById("discMeta"),
    statTotalCount: document.getElementById("statTotalCount"),
    statErrorsCount: document.getElementById("statErrorsCount"),
    lobbyView: document.getElementById("lobbyView"),
    quizView: document.getElementById("quizView"),
    resultView: document.getElementById("resultView"),
    quizModeLabel: document.getElementById("quizModeLabel"),
    quizProgressText: document.getElementById("quizProgressText"),
    quizProgressFill: document.getElementById("quizProgressFill"),
    quizLiveStats: document.getElementById("quizLiveStats"),
    liveAnswered: document.getElementById("liveAnswered"),
    liveCorrect: document.getElementById("liveCorrect"),
    liveWrong: document.getElementById("liveWrong"),
    quizErrorStats: document.getElementById("quizErrorStats"),
    errRemaining: document.getElementById("errRemaining"),
    errFixed: document.getElementById("errFixed"),
    questionNumberBadge: document.getElementById("questionNumberBadge"),
    questionSectionBadge: document.getElementById("questionSectionBadge"),
    questionTypeHint: document.getElementById("questionTypeHint"),
    questionText: document.getElementById("questionText"),
    optionsForm: document.getElementById("optionsForm"),
    feedbackBox: document.getElementById("feedbackBox"),
    submitAnswerBtn: document.getElementById("submitAnswerBtn"),
    nextQuestionBtn: document.getElementById("nextQuestionBtn"),
    autoAdvanceToggle: document.getElementById("autoAdvanceToggle"),
    finishEarlyBtn: document.getElementById("finishEarlyBtn")
  };

  // Работа с localStorage
  function loadErrors() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      console.warn("Не удалось прочитать ошибки из localStorage:", err);
      return {};
    }
  }

  function saveErrors() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.errorsBySession));
    } catch (err) {
      console.warn("Не удалось сохранить ошибки в localStorage:", err);
    }
  }

  function getSessionErrors(sessionId) {
    const list = state.errorsBySession[sessionId];
    return Array.isArray(list) ? list : [];
  }

  function addError(sessionId, questionId) {
    const list = getSessionErrors(sessionId).slice();
    if (list.indexOf(questionId) === -1) {
      list.push(questionId);
      state.errorsBySession[sessionId] = list;
      saveErrors();
      updateErrorCounters();
    }
  }

  function removeError(sessionId, questionId) {
    const list = getSessionErrors(sessionId);
    const next = list.filter(function (id) { return id !== questionId; });
    if (next.length !== list.length) {
      state.errorsBySession[sessionId] = next;
      saveErrors();
      updateErrorCounters();
    }
  }

  function clearSessionErrors(sessionId) {
    state.errorsBySession[sessionId] = [];
    saveErrors();
    updateErrorCounters();
  }

  function getCurrentSession() {
    return window.TEST_SESSIONS[state.currentSessionId];
  }

  function getSectionMap(session) {
    const map = {};
    session.sections.forEach(function (sec) {
      map[sec.id] = sec;
    });
    return map;
  }

  function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clearQuizTimers() {
    if (state.timers.autoAdvance) {
      clearTimeout(state.timers.autoAdvance);
      state.timers.autoAdvance = null;
    }
    if (state.timers.countdown) {
      clearInterval(state.timers.countdown);
      state.timers.countdown = null;
    }
  }

  // Равномерный подбор 50 вопросов по разделам
  function buildSessionQuestions(session, targetCount) {
    const count = Math.min(targetCount || 50, session.questions.length);
    const pools = {};
    session.sections.forEach(function (sec) {
      pools[sec.id] = [];
    });
    session.questions.forEach(function (q) {
      if (pools[q.sectionId]) {
        pools[q.sectionId].push(q);
      }
    });
    Object.keys(pools).forEach(function (secId) {
      pools[secId] = shuffleArray(pools[secId]);
    });

    const picked = [];
    const sectionIds = session.sections.map(function (s) { return s.id; });

    while (picked.length < count) {
      let addedInRound = false;
      const roundOrder = shuffleArray(sectionIds);
      for (let i = 0; i < roundOrder.length && picked.length < count; i++) {
        const pool = pools[roundOrder[i]];
        if (pool && pool.length > 0) {
          picked.push(pool.pop());
          addedInRound = true;
        }
      }
      if (!addedInRound) break;
    }

    return shuffleArray(picked);
  }

  function buildAllQuestions(session) {
    const filter = state.allModeOptions.sectionFilter;
    let list = session.questions.slice();
    if (filter !== "all") {
      const secId = Number(filter);
      list = list.filter(function (q) { return q.sectionId === secId; });
    }
    return list;
  }

  function buildErrorQuestions(session) {
    const errSet = new Set(getSessionErrors(session.id));
    return session.questions.filter(function (q) {
      return errSet.has(q.id);
    });
  }

  // Перемешиваем порядок вариантов ответа для прохождения без изменения исходной базы
  function prepareRunQuestion(q) {
    const pairs = q.options.map(function (text, idx) {
      return {
        text: text,
        isCorrect: q.correct.indexOf(idx) !== -1
      };
    });
    const shuffled = shuffleArray(pairs);
    const nextOptions = [];
    const nextCorrect = [];
    shuffled.forEach(function (pair, newIdx) {
      nextOptions.push(pair.text);
      if (pair.isCorrect) {
        nextCorrect.push(newIdx);
      }
    });
    return {
      id: q.id,
      sectionId: q.sectionId,
      text: q.text,
      options: nextOptions,
      correct: nextCorrect
    };
  }

  // Оценка (порог 75 — тройка/сдано, ниже 75 — двойка/завал)
  function evaluateGrade(scoreOutOf100) {
    if (scoreOutOf100 < 75) {
      return {
        grade: 2,
        passed: false,
        title: "Оценка 2 (Неудовлетворительно — Сессия не сдана / Завал)",
        shortTitle: "Оценка 2 (Завал)"
      };
    }
    if (scoreOutOf100 < 85) {
      return {
        grade: 3,
        passed: true,
        title: "Оценка 3 (Удовлетворительно — Сессия пройдена)",
        shortTitle: "Оценка 3 (Пройдено)"
      };
    }
    if (scoreOutOf100 < 95) {
      return {
        grade: 4,
        passed: true,
        title: "Оценка 4 (Хорошо — Сессия пройдена)",
        shortTitle: "Оценка 4 (Хорошо)"
      };
    }
    return {
      grade: 5,
      passed: true,
      title: "Оценка 5 (Отлично — Сессия пройдена)",
      shortTitle: "Оценка 5 (Отлично)"
    };
  }

  function formatPercent(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  // Обновление шапки дисциплины и счётчиков ошибок
  function updateHeaderBanner() {
    const session = getCurrentSession();
    el.discCode.textContent = session.code;
    el.discTitle.textContent = session.title;
    el.discMeta.textContent = session.subtitle + " · Разделов в базе: " + session.sections.length;
    el.statTotalCount.textContent = String(session.questions.length);
    updateErrorCounters();
  }

  function updateErrorCounters() {
    const errCount = getSessionErrors(state.currentSessionId).length;
    el.statErrorsCount.textContent = String(errCount);
    el.errorsBadge.textContent = String(errCount);
    if (errCount > 0) {
      el.errorsBadge.classList.add("has-errors");
    } else {
      el.errorsBadge.classList.remove("has-errors");
    }
    if (state.quiz && state.quiz.mode === "errors") {
      el.errRemaining.textContent = String(errCount);
    }
  }

  function updateNavTabs() {
    el.navTabs.forEach(function (tab) {
      if (tab.dataset.tab === state.activeTab) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });
  }

  function showOnlyView(viewName) {
    el.lobbyView.classList.toggle("hidden", viewName !== "lobby");
    el.quizView.classList.toggle("hidden", viewName !== "quiz");
    el.resultView.classList.toggle("hidden", viewName !== "result");
  }

  // Рендер стартового экрана выбранной вкладки
  function renderLobby() {
    clearQuizTimers();
    state.quiz = null;
    updateHeaderBanner();
    updateNavTabs();
    showOnlyView("lobby");

    const session = getCurrentSession();
    const tab = state.activeTab;

    if (tab === "session") {
      const sectionCount = session.sections.length;
      const distributionNote = sectionCount === 4
        ? "В этой базе 4 раздела (в 4-м всего 10 вопросов): берутся все 10 из 4-го раздела и по 13–14 из 1–3 разделов, всего 50 вопросов."
        : "В этой базе " + sectionCount + " разделов: вопросы распределяются равномерно по всем разделам (по 3–4 с каждого), всего 50 вопросов.";

      el.lobbyView.innerHTML =
        '<h2 class="lobby-title">Режим сессии (дифференцированный зачёт)</h2>' +
        '<p class="lobby-desc">Имитация экзаменационной попытки. Итоговый результат и количество ошибок скрыты до завершения всех 50 вопросов.</p>' +
        '<table class="rules-table">' +
          '<tbody>' +
            '<tr><th>Количество вопросов</th><td>50 случайных вопросов вперемешку из всех разделов дисциплины (варианты ответов перемешиваются)</td></tr>' +
            '<tr><th>Распределение по разделам</th><td>' + escapeHtml(distributionNote) + '</td></tr>' +
            '<tr><th>Оценивание</th><td>1 вопрос = 2 балла (максимум 100 баллов)</td></tr>' +
            '<tr><th>Проходной порог</th><td><strong>75 баллов и выше</strong> — оценка 3 и выше (зачёт); ниже 75 — оценка 2 (незачёт)</td></tr>' +
            '<tr><th>Индикация в процессе</th><td>Показывается только номер вопроса. Общий счёт появится только в конце.</td></tr>' +
          '</tbody>' +
        '</table>' +
        '<div class="lobby-actions">' +
          '<button type="button" id="startSessionBtn" class="btn btn-primary">Начать сессию (50 вопросов)</button>' +
        '</div>';

      document.getElementById("startSessionBtn").addEventListener("click", function () {
        startQuiz("session");
      });
      return;
    }

    if (tab === "all") {
      const secOptions = ['<option value="all">Все разделы (' + session.questions.length + ' вопр.)</option>']
        .concat(session.sections.map(function (sec) {
          const count = session.questions.filter(function (q) { return q.sectionId === sec.id; }).length;
          const selected = String(state.allModeOptions.sectionFilter) === String(sec.id) ? " selected" : "";
          return '<option value="' + sec.id + '"' + selected + '>' + escapeHtml(sec.title) + ' (' + count + ')</option>';
        }))
        .join("");

      el.lobbyView.innerHTML =
        '<h2 class="lobby-title">Режим «Все вопросы»</h2>' +
        '<p class="lobby-desc">Полная база вопросов по дисциплине (строго по порядку). Варианты ответов перемешиваются, а сверху отображается счётчик правильных и неправильных ответов.</p>' +
        '<div class="filter-grid">' +
          '<div class="field-group">' +
            '<label class="field-label" for="allSectionSelect">Раздел:</label>' +
            '<select id="allSectionSelect" class="field-select">' + secOptions + '</select>' +
          '</div>' +
        '</div>' +
        '<table class="rules-table">' +
          '<tbody>' +
            '<tr><th>Количество вопросов</th><td id="allFilteredCountCell">' + buildAllQuestions(session).length + ' вопросов</td></tr>' +
            '<tr><th>Порядок вопросов</th><td>По порядку (как в сборнике), варианты ответов вразброс</td></tr>' +
            '<tr><th>Оценивание</th><td>Процент правильных ответов из всех вопросов + примерная оценка (75% = 3, ниже = 2)</td></tr>' +
            '<tr><th>Ошибки</th><td>Каждый неверный ответ автоматически добавляется во вкладку «Мои ошибки»</td></tr>' +
          '</tbody>' +
        '</table>' +
        '<div class="lobby-actions">' +
          '<button type="button" id="startAllBtn" class="btn btn-primary">Начать прохождение</button>' +
        '</div>';

      const secSel = document.getElementById("allSectionSelect");
      const countCell = document.getElementById("allFilteredCountCell");
      const startBtn = document.getElementById("startAllBtn");

      function syncAllOptions() {
        state.allModeOptions.sectionFilter = secSel.value;
        const n = buildAllQuestions(session).length;
        countCell.textContent = n + " вопросов";
        startBtn.disabled = n === 0;
      }

      secSel.addEventListener("change", syncAllOptions);
      startBtn.addEventListener("click", function () {
        startQuiz("all");
      });
      return;
    }

    if (tab === "cheatsheet") {
      renderCheatsheet(session);
      return;
    }

    // Вкладка "Мои ошибки"
    const errQuestions = buildErrorQuestions(session);
    if (errQuestions.length === 0) {
      el.lobbyView.innerHTML =
        '<h2 class="lobby-title">Режим работы над ошибками</h2>' +
        '<p class="lobby-desc">Сюда автоматически попадают все вопросы, в которых была допущена ошибка в режиме сессии или в режиме всех вопросов.</p>' +
        '<div class="empty-errors-box">' +
          '<strong>Ошибок по дисциплине ' + escapeHtml(session.code) + ' сейчас нет</strong>' +
          '<span>Пройдите «Режим сессии» или «Все вопросы» — ошибочные вопросы появятся здесь автоматически.</span>' +
        '</div>';
      return;
    }

    const previewRows = errQuestions.map(function (q) {
      return '<div class="error-preview-row">' +
        '<span class="error-preview-num">№ ' + q.id + '</span>' +
        '<span>' + escapeHtml(q.text) + '</span>' +
      '</div>';
    }).join("");

    el.lobbyView.innerHTML =
      '<h2 class="lobby-title">Режим работы над ошибками</h2>' +
      '<p class="lobby-desc">При правильном ответе вопрос сразу удаляется из списка ошибок. При повторной ошибке — остаётся для следующего раза.</p>' +
      '<table class="rules-table">' +
        '<tbody>' +
          '<tr><th>Накоплено ошибок</th><td><strong>' + errQuestions.length + '</strong> вопр. по дисциплине ' + escapeHtml(session.code) + '</td></tr>' +
          '<tr><th>Условие удаления</th><td>Правильный ответ в этом режиме убирает вопрос из списка ошибок</td></tr>' +
        '</tbody>' +
      '</table>' +
      '<div class="error-preview-list">' + previewRows + '</div>' +
      '<div class="lobby-actions">' +
        '<button type="button" id="startErrorsBtn" class="btn btn-primary">Пройти ошибки (' + errQuestions.length + ')</button>' +
        '<button type="button" id="clearErrorsBtn" class="btn btn-danger-outline">Очистить список ошибок</button>' +
      '</div>';

    document.getElementById("startErrorsBtn").addEventListener("click", function () {
      startQuiz("errors");
    });
    document.getElementById("clearErrorsBtn").addEventListener("click", function () {
      if (window.confirm("Очистить все сохранённые ошибки по дисциплине " + session.code + "?")) {
        clearSessionErrors(session.id);
        renderLobby();
      }
    });
  }

  function renderCheatsheet(session) {
    const sheet = (window.TEST_CHEATSHEETS && window.TEST_CHEATSHEETS[session.id]) || null;
    if (!sheet) {
      el.lobbyView.innerHTML = '<h2 class="lobby-title">Шпаргалка</h2><p class="lobby-desc">Для этой дисциплины шпаргалка пока не добавлена.</p>';
      return;
    }

    el.lobbyView.innerHTML =
      '<div class="cheat-toolbar">' +
        '<div>' +
          '<h2 class="lobby-title" style="margin-bottom:4px;">' + escapeHtml(sheet.title) + '</h2>' +
          '<p class="lobby-desc" style="margin-bottom:0;">' + escapeHtml(sheet.subtitle) + '</p>' +
        '</div>' +
        '<input type="search" id="cheatSearchInput" class="cheat-search" placeholder="Поиск по шпаргалке (ГОСТ, мм, №, слово)..." autocomplete="off">' +
      '</div>' +
      '<div id="cheatBody"></div>';

    const searchInput = document.getElementById("cheatSearchInput");
    const cheatBody = document.getElementById("cheatBody");

    function drawSheet(query) {
      const q = String(query || "").trim().toLowerCase();
      function matchesText(parts) {
        if (!q) return true;
        return parts.join(" ").toLowerCase().indexOf(q) !== -1;
      }

      const algos = sheet.algorithms.filter(function (a) {
        return matchesText([a.name, a.rate, a.rule, a.exceptions]);
      });

      const traps = sheet.traps.filter(function (row) {
        return matchesText(row);
      });

      const tablesHtml = sheet.tables.map(function (tbl) {
        const rows = tbl.rows.filter(function (row) {
          return matchesText(row);
        });
        if (rows.length === 0) return "";
        return (
          '<h3 class="cheat-section-title">' + escapeHtml(tbl.title) + '</h3>' +
          '<table class="cheat-table">' +
            '<thead><tr>' + tbl.headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join("") + '</tr></thead>' +
            '<tbody>' +
              rows.map(function (r) {
                return '<tr>' + r.map(function (cell) { return '<td>' + escapeHtml(cell) + '</td>'; }).join("") + '</tr>';
              }).join("") +
            '</tbody>' +
          '</table>'
        );
      }).join("");

      let html = "";

      if (algos.length > 0) {
        html += '<h3 class="cheat-section-title">Алгоритмы угадывания (статистика по всей базе)</h3>';
        html += '<div class="algo-grid">' + algos.map(function (a) {
          return (
            '<div class="algo-card ' + escapeHtml(a.badge) + '">' +
              '<div class="algo-head">' +
                '<span class="algo-name">' + escapeHtml(a.name) + '</span>' +
                '<span class="algo-rate">' + escapeHtml(a.rate) + '</span>' +
              '</div>' +
              '<div class="algo-rule">' + escapeHtml(a.rule) + '</div>' +
              '<div class="algo-exc"><strong>Важно / исключения:</strong> ' + escapeHtml(a.exceptions) + '</div>' +
            '</div>'
          );
        }).join("") + '</div>';
      }

      if (traps.length > 0) {
        html += '<h3 class="cheat-section-title">' + escapeHtml(sheet.trapsTitle) + '</h3>';
        html += '<table class="cheat-table">' +
          '<thead><tr><th>Вопросы</th><th>Суть вопроса</th><th>Что выбирать по ключу</th></tr></thead>' +
          '<tbody>' +
            traps.map(function (r) {
              return '<tr><td>' + escapeHtml(r[0]) + '</td><td>' + escapeHtml(r[1]) + '</td><td>' + escapeHtml(r[2]) + '</td></tr>';
            }).join("") +
          '</tbody></table>';
      }

      html += tablesHtml;

      if (!html) {
        html = '<div class="cheat-empty-search">Ничего не найдено по запросу «' + escapeHtml(query) + '».</div>';
      }

      cheatBody.innerHTML = html;
    }

    drawSheet("");
    searchInput.addEventListener("input", function () {
      drawSheet(searchInput.value);
    });
  }

  // Запуск тестирования
  function startQuiz(mode) {
    clearQuizTimers();
    const session = getCurrentSession();
    let questions = [];

    if (mode === "session") {
      questions = buildSessionQuestions(session, 50);
    } else if (mode === "all") {
      questions = buildAllQuestions(session);
    } else if (mode === "errors") {
      questions = buildErrorQuestions(session);
    }

    if (questions.length === 0) {
      renderLobby();
      return;
    }

    state.quiz = {
      sessionId: session.id,
      mode: mode,
      questions: questions.map(prepareRunQuestion),
      index: 0,
      selected: [],
      answered: false,
      correctCount: 0,
      wrongCount: 0,
      records: []
    };

    showOnlyView("quiz");
    renderCurrentQuestion();
  }

  function renderCurrentQuestion() {
    clearQuizTimers();
    const quiz = state.quiz;
    if (!quiz) return;

    const session = getCurrentSession();
    const sectionMap = getSectionMap(session);
    const q = quiz.questions[quiz.index];
    const total = quiz.questions.length;
    const isMulti = q.correct.length > 1;
    const inputType = isMulti ? "checkbox" : "radio";
    const controlClass = isMulti ? "is-checkbox" : "is-radio";

    quiz.selected = [];
    quiz.answered = false;

    // Шапка статуса
    if (quiz.mode === "session") {
      el.quizModeLabel.textContent = "Режим сессии";
      el.quizLiveStats.classList.add("hidden");
      el.quizErrorStats.classList.add("hidden");
    } else if (quiz.mode === "all") {
      el.quizModeLabel.textContent = "Все вопросы";
      el.quizLiveStats.classList.remove("hidden");
      el.quizErrorStats.classList.add("hidden");
      el.liveAnswered.textContent = String(quiz.records.length);
      el.liveCorrect.textContent = String(quiz.correctCount);
      el.liveWrong.textContent = String(quiz.wrongCount);
    } else {
      el.quizModeLabel.textContent = "Работа над ошибками";
      el.quizLiveStats.classList.add("hidden");
      el.quizErrorStats.classList.remove("hidden");
      el.errRemaining.textContent = String(getSessionErrors(session.id).length);
      el.errFixed.textContent = String(quiz.correctCount);
    }

    el.quizProgressText.textContent = "Вопрос " + (quiz.index + 1) + " из " + total;
    el.quizProgressFill.style.width = ((quiz.index / total) * 100) + "%";

    // Карточка вопроса
    el.questionNumberBadge.textContent = "№ " + q.id;
    el.questionSectionBadge.textContent = sectionMap[q.sectionId] ? sectionMap[q.sectionId].title : "";
    el.questionTypeHint.textContent = isMulti
      ? "Можно выбрать несколько вариантов"
      : "Один вариант ответа";
    el.questionText.textContent = q.text;

    el.feedbackBox.className = "feedback-box hidden";
    el.feedbackBox.textContent = "";

    el.submitAnswerBtn.disabled = true;
    el.submitAnswerBtn.classList.remove("hidden");
    el.nextQuestionBtn.classList.add("hidden");
    el.nextQuestionBtn.textContent = quiz.index === total - 1 ? "Показать результат" : "Следующий вопрос";

    // Варианты ответа (без буквенной/цифровой нумерации)
    el.optionsForm.innerHTML = q.options.map(function (optText, idx) {
      return (
        '<label class="option-item" data-index="' + idx + '">' +
          '<input class="option-input" type="' + inputType + '" name="quizOption" value="' + idx + '">' +
          '<span class="option-control ' + controlClass + '" aria-hidden="true"></span>' +
          '<span class="option-body">' +
            '<span class="option-text">' + escapeHtml(optText) + '</span>' +
            '<span class="option-tag hidden"></span>' +
          '</span>' +
        '</label>'
      );
    }).join("");

    const optionLabels = Array.from(el.optionsForm.querySelectorAll(".option-item"));
    optionLabels.forEach(function (label) {
      const input = label.querySelector(".option-input");
      input.addEventListener("change", function () {
        if (quiz.answered) return;
        syncSelectionFromInputs();
      });
    });
  }

  function syncSelectionFromInputs() {
    const quiz = state.quiz;
    if (!quiz || quiz.answered) return;
    const inputs = Array.from(el.optionsForm.querySelectorAll(".option-input"));
    const picked = [];
    inputs.forEach(function (inp) {
      const label = inp.closest(".option-item");
      if (inp.checked) {
        picked.push(Number(inp.value));
        label.classList.add("selected");
      } else {
        label.classList.remove("selected");
      }
    });
    picked.sort(function (a, b) { return a - b; });
    quiz.selected = picked;
    el.submitAnswerBtn.disabled = picked.length === 0;
  }

  function submitCurrentAnswer() {
    const quiz = state.quiz;
    if (!quiz || quiz.answered || quiz.selected.length === 0) return;

    quiz.answered = true;
    const q = quiz.questions[quiz.index];
    const correctSorted = q.correct.slice().sort(function (a, b) { return a - b; });
    const selectedSorted = quiz.selected.slice().sort(function (a, b) { return a - b; });
    const isCorrect = arraysEqual(selectedSorted, correctSorted);

    // Блокируем варианты и подсвечиваем
    const optionItems = Array.from(el.optionsForm.querySelectorAll(".option-item"));
    optionItems.forEach(function (item) {
      const idx = Number(item.dataset.index);
      const input = item.querySelector(".option-input");
      const tag = item.querySelector(".option-tag");
      const isRightOpt = correctSorted.indexOf(idx) !== -1;
      const isPickedOpt = selectedSorted.indexOf(idx) !== -1;

      input.disabled = true;
      item.classList.add("disabled");

      if (isRightOpt) {
        item.classList.add("state-correct");
        tag.classList.remove("hidden");
        tag.classList.add("tag-correct");
        tag.textContent = isPickedOpt ? "Верно (ваш выбор)" : "Правильный ответ";
      } else if (isPickedOpt) {
        item.classList.add("state-wrong");
        tag.classList.remove("hidden");
        tag.classList.add("tag-wrong");
        tag.textContent = "Ваш выбор (ошибка)";
      }
    });

    // Сохраняем результат
    quiz.records.push({
      question: q,
      selected: selectedSorted,
      isCorrect: isCorrect
    });

    if (isCorrect) {
      quiz.correctCount += 1;
      if (quiz.mode === "errors") {
        removeError(quiz.sessionId, q.id);
      }
      el.feedbackBox.className = "feedback-box ok";
      el.feedbackBox.textContent = quiz.mode === "errors"
        ? "Правильно! Вопрос удалён из списка ошибок."
        : "Правильно!";
    } else {
      quiz.wrongCount += 1;
      addError(quiz.sessionId, q.id);
      el.feedbackBox.className = "feedback-box bad";
      el.feedbackBox.textContent = quiz.mode === "errors"
        ? "Неправильно. Вопрос остаётся в списке ошибок."
        : "Неправильно. Вопрос добавлен в раздел «Мои ошибки».";
    }

    // Обновление живых счётчиков (строго НЕ показываем в режиме сессии!)
    if (quiz.mode === "all") {
      el.liveAnswered.textContent = String(quiz.records.length);
      el.liveCorrect.textContent = String(quiz.correctCount);
      el.liveWrong.textContent = String(quiz.wrongCount);
    } else if (quiz.mode === "errors") {
      el.errRemaining.textContent = String(getSessionErrors(quiz.sessionId).length);
      el.errFixed.textContent = String(quiz.correctCount);
    }

    const total = quiz.questions.length;
    el.quizProgressFill.style.width = (((quiz.index + 1) / total) * 100) + "%";

    el.submitAnswerBtn.classList.add("hidden");
    el.nextQuestionBtn.classList.remove("hidden");

    scheduleAutoAdvanceIfEnabled();
  }

  function scheduleAutoAdvanceIfEnabled() {
    clearQuizTimers();
    const quiz = state.quiz;
    if (!quiz || !quiz.answered) return;

    const isLast = quiz.index >= quiz.questions.length - 1;
    const baseLabel = isLast ? "Показать результат" : "Следующий вопрос";

    if (!el.autoAdvanceToggle.checked) {
      el.nextQuestionBtn.textContent = baseLabel;
      return;
    }

    let secondsLeft = Math.ceil(AUTO_ADVANCE_MS / 1000);
    el.nextQuestionBtn.textContent = baseLabel + " (" + secondsLeft + " с)";

    state.timers.countdown = setInterval(function () {
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        el.nextQuestionBtn.textContent = baseLabel + " (" + secondsLeft + " с)";
      }
    }, 1000);

    state.timers.autoAdvance = setTimeout(function () {
      goToNextQuestion();
    }, AUTO_ADVANCE_MS);
  }

  function goToNextQuestion() {
    clearQuizTimers();
    const quiz = state.quiz;
    if (!quiz) return;

    if (quiz.index + 1 < quiz.questions.length) {
      quiz.index += 1;
      renderCurrentQuestion();
    } else {
      finishQuiz();
    }
  }

  // Экран результатов
  function finishQuiz() {
    clearQuizTimers();
    const quiz = state.quiz;
    if (!quiz) return;

    const session = getCurrentSession();
    const totalInRun = quiz.questions.length;
    const answeredCount = quiz.records.length;
    const correct = quiz.correctCount;
    const wrongRecords = quiz.records.filter(function (r) { return !r.isCorrect; });

    state.quiz = null;
    showOnlyView("result");

    let bannerHtml = "";
    let summaryBoxesHtml = "";
    let extraButtonsHtml = "";

    if (quiz.mode === "session") {
      // 1 вопрос = 2 балла, от 0 до 100
      const points = correct * 2;
      const evalRes = evaluateGrade(points);
      bannerHtml =
        '<div class="result-banner ' + (evalRes.passed ? "passed" : "failed") + '">' +
          '<div class="result-score-big">' + points + ' из 100 баллов</div>' +
          '<div class="result-grade-line">' + escapeHtml(evalRes.title) + '</div>' +
        '</div>';

      summaryBoxesHtml =
        '<div class="summary-box"><div class="summary-box-label">Набрано баллов</div><div class="summary-box-value">' + points + ' / 100</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Правильных ответов</div><div class="summary-box-value">' + correct + ' из ' + totalInRun + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Ошибок</div><div class="summary-box-value">' + (totalInRun - correct) + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Порог сдачи</div><div class="summary-box-value">75 баллов (3)</div></div>';
    } else if (quiz.mode === "all") {
      const percentAll = totalInRun > 0 ? (correct / totalInRun) * 100 : 0;
      const evalRes = evaluateGrade(percentAll);
      const answeredPercentHtml = answeredCount > 0 && answeredCount < totalInRun
        ? '<div class="summary-box"><div class="summary-box-label">Из отвеченных (' + answeredCount + ')</div><div class="summary-box-value">' + formatPercent((correct / answeredCount) * 100) + '%</div></div>'
        : "";

      bannerHtml =
        '<div class="result-banner ' + (evalRes.passed ? "passed" : "failed") + '">' +
          '<div class="result-score-big">' + formatPercent(percentAll) + '% правильных</div>' +
          '<div class="result-grade-line">Примерная оценка: ' + escapeHtml(evalRes.shortTitle) + ' (ориентир: 75% = 3)</div>' +
        '</div>';

      summaryBoxesHtml =
        '<div class="summary-box"><div class="summary-box-label">Верно из всех</div><div class="summary-box-value">' + correct + ' из ' + totalInRun + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Ошибок</div><div class="summary-box-value">' + wrongRecords.length + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Процент</div><div class="summary-box-value">' + formatPercent(percentAll) + '%</div></div>' +
        answeredPercentHtml;
    } else {
      const remainingErrs = getSessionErrors(session.id).length;
      const allCleared = remainingErrs === 0;
      bannerHtml =
        '<div class="result-banner ' + (allCleared ? "passed" : "neutral") + '">' +
          '<div class="result-score-big">Исправлено ошибок: ' + correct + ' из ' + totalInRun + '</div>' +
          '<div class="result-grade-line">' +
            (allCleared
              ? "Все ошибки по дисциплине отработаны! Список ошибок пуст."
              : "Осталось нерешённых ошибок в базе: " + remainingErrs) +
          '</div>' +
        '</div>';

      summaryBoxesHtml =
        '<div class="summary-box"><div class="summary-box-label">Удалено из ошибок</div><div class="summary-box-value">' + correct + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Ошиблись повторно</div><div class="summary-box-value">' + wrongRecords.length + '</div></div>' +
        '<div class="summary-box"><div class="summary-box-label">Всего осталось ошибок</div><div class="summary-box-value">' + remainingErrs + '</div></div>';
    }

    const totalSavedErrors = getSessionErrors(session.id).length;
    if (quiz.mode !== "errors" && totalSavedErrors > 0) {
      extraButtonsHtml = '<button type="button" id="goToErrorsBtn" class="btn btn-secondary">Отработать ошибки (' + totalSavedErrors + ')</button>';
    }

    let reviewHtml = "";
    if (wrongRecords.length > 0) {
      const itemsHtml = wrongRecords.map(function (rec) {
        const q = rec.question;
        const userAns = rec.selected.map(function (idx) {
          return q.options[idx];
        }).join("; ");
        const rightAns = q.correct.map(function (idx) {
          return q.options[idx];
        }).join("; ");
        return (
          '<div class="review-item">' +
            '<div class="review-q">№ ' + q.id + '. ' + escapeHtml(q.text) + '</div>' +
            '<div class="review-a-wrong">Ваш ответ: ' + escapeHtml(userAns) + '</div>' +
            '<div class="review-a-right">Правильный ответ: ' + escapeHtml(rightAns) + '</div>' +
          '</div>'
        );
      }).join("");

      reviewHtml =
        '<div class="mistakes-review">' +
          '<h3>Ошибки в этой попытке (' + wrongRecords.length + ')</h3>' +
          '<div class="review-list">' + itemsHtml + '</div>' +
        '</div>';
    }

    const retryBtnLabel = quiz.mode === "errors"
      ? "Пройти оставшиеся ошибки (" + totalSavedErrors + ")"
      : "Пройти ещё раз";
    const showRetryBtn = quiz.mode !== "errors" || totalSavedErrors > 0;

    el.resultView.innerHTML =
      bannerHtml +
      '<div class="result-summary-grid">' + summaryBoxesHtml + '</div>' +
      '<div class="lobby-actions">' +
        (showRetryBtn ? '<button type="button" id="retryModeBtn" class="btn btn-primary">' + retryBtnLabel + '</button>' : '') +
        extraButtonsHtml +
        '<button type="button" id="backToLobbyBtn" class="btn btn-outline">В меню режима</button>' +
      '</div>' +
      reviewHtml;

    const retryBtn = document.getElementById("retryModeBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        if (quiz.mode === "errors" && getSessionErrors(session.id).length === 0) {
          renderLobby();
        } else {
          startQuiz(quiz.mode);
        }
      });
    }

    document.getElementById("backToLobbyBtn").addEventListener("click", function () {
      renderLobby();
    });

    const goErrBtn = document.getElementById("goToErrorsBtn");
    if (goErrBtn) {
      goErrBtn.addEventListener("click", function () {
        state.activeTab = "errors";
        updateNavTabs();
        startQuiz("errors");
      });
    }
  }

  function confirmAbortQuizIfNeeded() {
    if (!state.quiz || state.quiz.records.length === 0) {
      return true;
    }
    return window.confirm("Текущий тест ещё не завершён. Прервать попытку?");
  }

  // Обработчики событий
  el.sessionSelect.addEventListener("change", function () {
    if (!confirmAbortQuizIfNeeded()) {
      el.sessionSelect.value = state.currentSessionId;
      return;
    }
    state.currentSessionId = el.sessionSelect.value;
    state.allModeOptions.sectionFilter = "all";
    renderLobby();
  });

  el.navTabs.forEach(function (tabBtn) {
    tabBtn.addEventListener("click", function () {
      const nextTab = tabBtn.dataset.tab;
      if (nextTab === state.activeTab && !state.quiz && el.resultView.classList.contains("hidden")) {
        return;
      }
      if (!confirmAbortQuizIfNeeded()) {
        return;
      }
      state.activeTab = nextTab;
      renderLobby();
    });
  });

  el.submitAnswerBtn.addEventListener("click", submitCurrentAnswer);
  el.nextQuestionBtn.addEventListener("click", goToNextQuestion);

  el.autoAdvanceToggle.addEventListener("change", function () {
    if (state.quiz && state.quiz.answered) {
      scheduleAutoAdvanceIfEnabled();
    }
  });

  el.finishEarlyBtn.addEventListener("click", function () {
    if (!state.quiz) return;
    if (state.quiz.mode === "session" && state.quiz.records.length < state.quiz.questions.length) {
      if (!window.confirm("Завершить сессию досрочно? Неотвеченные вопросы не принесут баллов.")) {
        return;
      }
    }
    finishQuiz();
  });

  // Горячие клавиши: 1-4 выбор варианта, Enter — ответить / далее
  document.addEventListener("keydown", function (e) {
    if (!state.quiz) return;
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (activeTag === "SELECT") return;

    if (!state.quiz.answered && (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4")) {
      const idx = Number(e.key) - 1;
      const inputs = Array.from(el.optionsForm.querySelectorAll(".option-input"));
      if (inputs[idx]) {
        if (inputs[idx].type === "radio") {
          inputs[idx].checked = true;
        } else {
          inputs[idx].checked = !inputs[idx].checked;
        }
        syncSelectionFromInputs();
      }
      return;
    }

    if (e.key === "Enter") {
      if (activeTag === "BUTTON" || activeTag === "LABEL") return;
      if (!state.quiz.answered && state.quiz.selected.length > 0) {
        e.preventDefault();
        submitCurrentAnswer();
      } else if (state.quiz.answered) {
        e.preventDefault();
        goToNextQuestion();
      }
    }
  });

  // Инициализация
  renderLobby();
})();
