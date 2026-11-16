(function () {
  'use strict';

  const P = window.QuizParser;
  let storage = null;
  try { storage = window.localStorage; } catch (e) { /* 使えない環境 */ }
  const store = window.QuizStore.createStore(storage);

  const $ = id => document.getElementById(id);
  const PREFS_KEY = 'ouyoQuiz.prefs';
  let mode = 'choice';
  let session = null; // { items: [q], index, results: [{q, ok}], answered }

  // ---------- 共通 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function historyMarks(key, max) {
    const h = store.historyOf(key).slice(-(max || 10));
    return h.map(x => `<span class="${x[1] ? 'mk ok' : 'mk ng'}">${x[1] ? '○' : '×'}</span>`).join('');
  }

  function rateText(st) {
    if (!st.attempts) return '未回答';
    return `${st.correct}/${st.attempts}（${Math.round(st.rate * 100)}%）`;
  }

  function fmtDate(t) {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ---------- 画面切り替え ----------
  const VIEWS = ['home', 'quiz', 'result', 'list', 'settings'];
  function show(view) {
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('tabbar').hidden = view === 'quiz';
    if (view === 'home') renderHome();
    if (view === 'list') renderList();
    if (view === 'settings') renderSettings();
    $('toast').hidden = true;
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('#tabbar button').forEach(b => {
    b.addEventListener('click', () => show(b.dataset.view));
  });

  // ---------- ホーム ----------
  function fillCategorySelect(sel, keep) {
    const cur = keep ? sel.value : '';
    const cats = store.categories();
    sel.innerHTML = '<option value="">すべての分野</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}（${store.allQuestions().filter(q => q.category === c).length}）</option>`).join('');
    if (cats.includes(cur)) sel.value = cur;
  }

  function renderHome() {
    const qs = store.allQuestions();
    let answered = 0, attempts = 0, correct = 0;
    qs.forEach(q => {
      const st = store.statsOf(q.key);
      if (st.attempts) answered++;
      attempts += st.attempts; correct += st.correct;
    });
    $('home-stats').innerHTML = `
      <div><b>${qs.length}</b><span>登録問題</span></div>
      <div><b>${answered}</b><span>回答済み</span></div>
      <div><b>${attempts ? Math.round(correct / attempts * 100) + '%' : '-'}</b><span>正答率</span></div>`;
    fillCategorySelect($('opt-category'), true);
    $('setup-card').classList.toggle('disabled', qs.length === 0);
    updateSetupHint();
  }

  function selectQuestions() {
    const cat = $('opt-category').value;
    const target = $('opt-target').value;
    let qs = store.allQuestions().filter(q => !cat || q.category === cat);
    qs = qs.filter(q => {
      const st = store.statsOf(q.key);
      if (target === 'unanswered') return st.attempts === 0;
      if (target === 'wrong') return st.last && !st.last[1];
      if (target === 'weak') return st.attempts > 0 && st.rate < 0.8;
      return true;
    });
    return qs;
  }

  function updateSetupHint() {
    const n = store.count;
    if (!n) { $('setup-hint').textContent = 'まずは下の「問題ファイルを取り込む」から問題を登録してください。'; return; }
    $('setup-hint').textContent = `条件に合う問題：${selectQuestions().length}問`;
    savePrefs();
  }

  ['opt-category', 'opt-target', 'opt-order', 'opt-count'].forEach(id => $(id).addEventListener('change', updateSetupHint));
  document.querySelectorAll('#opt-mode button').forEach(b => {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      document.querySelectorAll('#opt-mode button').forEach(x => x.classList.toggle('on', x === b));
      savePrefs();
    });
  });

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        category: $('opt-category').value, target: $('opt-target').value,
        order: $('opt-order').value, count: $('opt-count').value, mode,
      }));
    } catch (e) { /* 無視 */ }
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!p) return;
      fillCategorySelect($('opt-category'));
      if (p.category) $('opt-category').value = p.category;
      ['target', 'order', 'count'].forEach(k => { if (p[k]) $('opt-' + k).value = p[k]; });
      if (p.mode) {
        mode = p.mode;
        document.querySelectorAll('#opt-mode button').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
      }
    } catch (e) { /* 無視 */ }
  }

  // ---------- 取り込み ----------
  $('file-input').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const lines = [];
    let total = { added: 0, updated: 0, unchanged: 0 };
    for (const f of files) {
      try {
        const text = await f.text();
        const { records, invalid } = P.parseQuestionFile(f.name, text);
        const r = store.upsertQuestions(records);
        total.added += r.added; total.updated += r.updated; total.unchanged += r.unchanged;
        lines.push(`<li><b>${esc(f.name)}</b>：新規 ${r.added} / 更新 ${r.updated} / 重複 ${r.unchanged}${invalid ? ` / 読み飛ばし ${invalid}` : ''}</li>`);
      } catch (err) {
        lines.push(`<li class="err"><b>${esc(f.name)}</b>：読み込めませんでした（${esc(err.message)}）</li>`);
      }
    }
    const box = $('import-result');
    box.hidden = false;
    box.innerHTML = `<ul>${lines.join('')}</ul>`;
    toast(`${total.added}問を追加しました（重複 ${total.unchanged}問はスキップ）`);
    renderHome();
  });

  // ---------- クイズ ----------
  function orderQuestions(qs, order) {
    if (order === 'sequential') return qs;
    if (order === 'random') return shuffle(qs);
    // 苦手優先：最近5回の正答率が低いもの → 未回答 → 得意 の順。同順位はランダム
    return shuffle(qs).map(q => {
      const st = store.statsOf(q.key);
      const score = st.attempts === 0 ? 0.5 : st.recentRate;
      return { q, score };
    }).sort((a, b) => a.score - b.score).map(x => x.q);
  }

  function startQuiz(items) {
    if (!items.length) { toast('条件に合う問題がありません'); return; }
    session = { items, index: 0, results: [] };
    show('quiz');
    renderQuestion();
  }

  $('btn-start').addEventListener('click', () => {
    let qs = orderQuestions(selectQuestions(), $('opt-order').value);
    const n = Number($('opt-count').value);
    if (n > 0) qs = qs.slice(0, n);
    startQuiz(qs);
  });

  function buildChoices(q) {
    const correctNorm = P.normalize(q.answer);
    const others = store.allQuestions().filter(x => x.key !== q.key && P.normalize(x.answer) !== correctNorm);
    const same = shuffle(others.filter(x => x.category === q.category));
    const diff = shuffle(others.filter(x => x.category !== q.category));
    const picked = [];
    const seen = new Set([correctNorm]);
    for (const x of same.concat(diff)) {
      const n = P.normalize(x.answer);
      if (seen.has(n)) continue;
      seen.add(n); picked.push(x.answer);
      if (picked.length === 3) break;
    }
    if (picked.length < 3) return null; // 選択肢が作れないときは暗記カードにする
    return shuffle([q.answer].concat(picked));
  }

  function renderQuestion() {
    const q = session.items[session.index];
    session.answered = false;
    const total = session.items.length;
    $('quiz-count').textContent = `${session.index + 1} / ${total}`;
    $('quiz-bar').style.width = `${(session.index / total) * 100}%`;
    $('q-category').textContent = q.category;
    const st = store.statsOf(q.key);
    $('q-history-mini').textContent = st.attempts ? `これまで ${rateText(st)}` : 'はじめての問題';
    $('q-text').textContent = q.question;
    $('q-feedback').hidden = true;
    $('q-selfjudge').hidden = true;
    $('btn-next').hidden = true;

    const choices = mode === 'choice' ? buildChoices(q) : null;
    const box = $('q-choices');
    box.innerHTML = '';
    if (choices) {
      $('q-cardmode').hidden = true;
      choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'choice';
        b.innerHTML = `<span class="no">${'ABCD'[i]}</span><span>${esc(c)}</span>`;
        b.addEventListener('click', () => answerChoice(b, c === q.answer));
        b.dataset.correct = c === q.answer ? '1' : '';
        box.appendChild(b);
      });
    } else {
      $('q-cardmode').hidden = false;
    }
  }

  function answerChoice(btn, ok) {
    if (session.answered) return;
    document.querySelectorAll('#q-choices .choice').forEach(b => {
      b.disabled = true;
      if (b.dataset.correct) b.classList.add('correct');
    });
    if (!ok) btn.classList.add('wrong');
    finishAnswer(ok);
  }

  $('btn-reveal').addEventListener('click', () => {
    $('q-cardmode').hidden = true;
    showFeedback(null);
    $('q-selfjudge').hidden = false;
  });
  $('btn-judge-ok').addEventListener('click', () => finishAnswer(true));
  $('btn-judge-ng').addEventListener('click', () => finishAnswer(false));

  function finishAnswer(ok) {
    if (session.answered) return;
    session.answered = true;
    const q = session.items[session.index];
    store.record(q.key, ok);
    session.results.push({ q, ok });
    $('q-selfjudge').hidden = true;
    showFeedback(ok);
    $('btn-next').hidden = false;
    $('btn-next').textContent = session.index + 1 < session.items.length ? '次へ' : '結果を見る';
    if (navigator.vibrate && !ok) navigator.vibrate(60);
  }

  function showFeedback(ok) {
    const q = session.items[session.index];
    const fb = $('q-feedback');
    fb.hidden = false;
    fb.classList.toggle('is-ok', ok === true);
    fb.classList.toggle('is-ng', ok === false);
    $('q-verdict').textContent = ok === true ? '○ 正解！' : ok === false ? '× 不正解' : '答え合わせ';
    $('q-answer').textContent = q.answer;
    $('q-explanation').textContent = q.explanation || '';
    $('q-explanation').hidden = !q.explanation;
    $('q-source').textContent = q.source ? `出典：${q.source}` : '';
    if (ok !== null) {
      const st = store.statsOf(q.key);
      $('q-history').innerHTML = `<span class="muted">この問題の履歴</span> ${historyMarks(q.key, 12)} <span class="muted">${rateText(st)}</span>`;
    } else {
      $('q-history').innerHTML = '';
    }
    setTimeout(() => fb.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  $('btn-next').addEventListener('click', () => {
    session.index++;
    if (session.index < session.items.length) { renderQuestion(); window.scrollTo(0, 0); }
    else showResult();
  });

  $('btn-quit').addEventListener('click', () => {
    if (session && session.results.length) showResult();
    else show('home');
  });

  // ---------- 結果 ----------
  function showResult() {
    const res = session.results;
    const ok = res.filter(r => r.ok).length;
    show('result');
    $('result-summary').innerHTML = `
      <div class="big-score">${ok} / ${res.length}</div>
      <div class="muted">正答率 ${res.length ? Math.round(ok / res.length * 100) : 0}%</div>`;
    const wrong = res.filter(r => !r.ok);
    $('btn-retry-wrong').hidden = wrong.length === 0;
    $('result-list').innerHTML = res.map(r => itemHtml(r.q, r.ok)).join('');
  }

  $('btn-retry-wrong').addEventListener('click', () => {
    const wrong = session.results.filter(r => !r.ok).map(r => r.q);
    startQuiz(shuffle(wrong));
  });
  $('btn-home').addEventListener('click', () => show('home'));

  // ---------- 問題一覧 ----------
  function itemHtml(q, ok) {
    const st = store.statsOf(q.key);
    const badge = ok === undefined ? '' : `<span class="mk ${ok ? 'ok' : 'ng'}">${ok ? '○' : '×'}</span> `;
    return `<details class="item">
      <summary>
        <div class="item-q">${badge}${esc(q.question)}</div>
        <div class="item-meta"><span class="tag">${esc(q.category)}</span><span class="muted">${rateText(st)}</span></div>
      </summary>
      <div class="item-body">
        <p><span class="muted">答え</span><br><strong>${esc(q.answer)}</strong></p>
        ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
        ${q.source ? `<p class="muted small">出典：${esc(q.source)}</p>` : ''}
        <p class="history-line"><span class="muted">履歴</span> ${historyMarks(q.key, 20) || '<span class="muted">まだ解いていません</span>'}
        ${st.last ? `<span class="muted small">最終 ${fmtDate(st.last[0])}</span>` : ''}</p>
      </div>
    </details>`;
  }

  function renderList() {
    fillCategorySelect($('list-category'), true);
    const word = P.normalize($('list-search').value);
    const cat = $('list-category').value;
    const sort = $('list-sort').value;
    let qs = store.allQuestions().filter(q => (!cat || q.category === cat) &&
      (!word || P.normalize(q.question + q.answer + (q.explanation || '')).includes(word)));
    const withSt = qs.map(q => ({ q, st: store.statsOf(q.key) }));
    const rate = x => x.st.rate === null ? -1 : x.st.rate;
    if (sort === 'accAsc') withSt.sort((a, b) => (a.st.rate === null ? 2 : a.st.rate) - (b.st.rate === null ? 2 : b.st.rate));
    if (sort === 'accDesc') withSt.sort((a, b) => rate(b) - rate(a));
    if (sort === 'recent') withSt.sort((a, b) => (b.st.last ? b.st.last[0] : 0) - (a.st.last ? a.st.last[0] : 0));
    $('list-count').textContent = `${withSt.length}問`;
    $('list-items').innerHTML = withSt.length
      ? withSt.map(x => itemHtml(x.q)).join('')
      : '<p class="muted center">問題がありません</p>';
  }
  ['list-search', 'list-category', 'list-sort'].forEach(id => $(id).addEventListener('input', renderList));

  // ---------- 成績・設定 ----------
  function renderSettings() {
    const qs = store.allQuestions();
    const cats = store.categories();
    if (!cats.length) { $('cat-stats').innerHTML = '<p class="muted">問題がまだありません</p>'; return; }
    $('cat-stats').innerHTML = cats.map(c => {
      const list = qs.filter(q => q.category === c);
      let att = 0, cor = 0, answered = 0;
      list.forEach(q => { const st = store.statsOf(q.key); att += st.attempts; cor += st.correct; if (st.attempts) answered++; });
      const pct = att ? Math.round(cor / att * 100) : 0;
      return `<div class="cat-row">
        <div class="cat-name">${esc(c)} <span class="muted small">${answered}/${list.length}問 回答済み</span></div>
        <div class="meter"><div style="width:${pct}%"></div></div>
        <div class="cat-pct">${att ? pct + '%' : '-'}</div>
      </div>`;
    }).join('');
  }

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `ouyo-quiz-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });

  $('backup-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = store.importBackup(JSON.parse(await f.text()));
      toast(`読み込みました（問題 新規${r.added}・更新${r.updated}、履歴 ${r.historyMerged}件）`);
      renderSettings();
    } catch (err) {
      toast('読み込めませんでした：' + err.message);
    }
  });

  $('btn-reset-history').addEventListener('click', () => {
    if (confirm('すべての問題の回答履歴を消します。よろしいですか？')) { store.resetHistory(); toast('回答履歴を消しました'); renderSettings(); }
  });
  $('btn-reset-all').addEventListener('click', () => {
    if (confirm('問題と回答履歴をすべて消します。元に戻せません。よろしいですか？')) { store.resetAll(); toast('すべてのデータを消しました'); renderSettings(); }
  });

  // ---------- 起動 ----------
  loadPrefs();
  show('home');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
