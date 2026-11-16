// 問題と回答履歴の保存（ブラウザの localStorage）
(function (global) {
  'use strict';

  const STORAGE_KEY = 'ouyoQuiz.v1';
  const FIELDS = ['category', 'question', 'answer', 'explanation', 'source'];
  const P = global.QuizParser || (typeof require !== 'undefined' ? require('./parser.js') : null);

  function emptyState() {
    return { version: 1, nextOrder: 1, questions: {}, history: {} };
  }

  function createStore(storage) {
    let state = emptyState();

    function load() {
      try {
        const raw = storage && storage.getItem(STORAGE_KEY);
        if (raw) state = Object.assign(emptyState(), JSON.parse(raw));
      } catch (e) {
        console.warn('保存データを読み込めませんでした', e);
      }
    }

    function save() {
      try {
        storage && storage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (e) {
        console.error('保存に失敗しました', e);
        return false;
      }
    }

    // 問題を追加・更新する。同じ問題文の問題は1件にまとめる。
    function upsertQuestions(records) {
      const result = { added: 0, updated: 0, unchanged: 0 };
      const seenThisBatch = new Set();
      const now = Date.now();
      for (const r of records) {
        if (!r.question || !r.answer) continue;
        const key = P.questionKey(r.question);
        const existing = state.questions[key];
        if (seenThisBatch.has(key) && existing) {
          // 同じファイル内の重複：後の行の内容で上書き（件数は重複扱い）
          applyFields(existing, r, now);
          result.unchanged++;
          continue;
        }
        seenThisBatch.add(key);
        if (!existing) {
          const q = { key, order: state.nextOrder++, addedAt: now, updatedAt: now };
          FIELDS.forEach(f => { q[f] = (r[f] || '').trim(); });
          if (!q.category) q.category = '未分類';
          state.questions[key] = q;
          result.added++;
        } else if (applyFields(existing, r, now)) {
          result.updated++;
        } else {
          result.unchanged++;
        }
      }
      save();
      return result;
    }

    function applyFields(q, r, now) {
      let changed = false;
      for (const f of FIELDS) {
        const v = (r[f] || '').trim();
        if (v && v !== q[f]) { q[f] = v; changed = true; }
      }
      if (changed) q.updatedAt = now;
      return changed;
    }

    function allQuestions() {
      return Object.values(state.questions).sort((a, b) => a.order - b.order);
    }

    function categories() {
      const set = new Set(allQuestions().map(q => q.category));
      return [...set];
    }

    function record(key, ok) {
      (state.history[key] = state.history[key] || []).push([Date.now(), ok ? 1 : 0]);
      save();
    }

    function historyOf(key) {
      return state.history[key] || [];
    }

    // 1問ごとの成績
    function statsOf(key) {
      const h = historyOf(key);
      const correct = h.filter(x => x[1]).length;
      const recent = h.slice(-5);
      return {
        attempts: h.length,
        correct,
        rate: h.length ? correct / h.length : null,
        recentRate: recent.length ? recent.filter(x => x[1]).length / recent.length : null,
        last: h.length ? h[h.length - 1] : null,
      };
    }

    function exportData() {
      return {
        app: 'ouyo-quiz',
        version: 1,
        exportedAt: new Date().toISOString(),
        questions: allQuestions(),
        history: state.history,
      };
    }

    // バックアップの読み込み（今のデータに統合する）
    function importBackup(data) {
      if (!data || data.app !== 'ouyo-quiz' || !Array.isArray(data.questions)) {
        throw new Error('このアプリのバックアップファイルではありません');
      }
      const res = upsertQuestions(data.questions);
      let merged = 0;
      for (const [key, list] of Object.entries(data.history || {})) {
        if (!Array.isArray(list)) continue;
        const cur = state.history[key] || [];
        const seen = new Set(cur.map(x => x[0] + ':' + x[1]));
        for (const x of list) {
          if (Array.isArray(x) && !seen.has(x[0] + ':' + x[1])) { cur.push([x[0], x[1] ? 1 : 0]); merged++; }
        }
        cur.sort((a, b) => a[0] - b[0]);
        state.history[key] = cur;
      }
      save();
      return Object.assign(res, { historyMerged: merged });
    }

    function resetHistory() { state.history = {}; save(); }
    function resetAll() { state = emptyState(); save(); }

    load();
    return {
      upsertQuestions, allQuestions, categories, record, historyOf, statsOf,
      exportData, importBackup, resetHistory, resetAll,
      get count() { return Object.keys(state.questions).length; },
    };
  }

  const api = { createStore, STORAGE_KEY };
  global.QuizStore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
