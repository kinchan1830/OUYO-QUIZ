// 実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../parser.js');
const { createStore } = require('../store.js');

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const sample = name => fs.readFileSync(path.join(__dirname, '..', 'samples', name), 'utf8');

test('サンプルCSVとJSONが同じ34問として読める', () => {
  const csv = P.parseQuestionFile('a.csv', sample('用語メモ_クイズ.csv')).records;
  const json = P.parseQuestionFile('a.json', sample('用語メモ_クイズ.json')).records;
  assert.strictEqual(csv.length, 34);
  assert.strictEqual(json.length, 34);
  assert.deepStrictEqual(csv.map(r => r.question), json.map(r => r.question));
  assert.strictEqual(csv[0].category, '情報セキュリティ');
  assert.strictEqual(csv[0].answer, '一方向性');
});

test('CSVの引用符・改行・カンマを正しく扱う', () => {
  const rows = P.parseCsv('問題,答え,解説\r\n"A, B ""とは""",答1,"1行目\n2行目"\n');
  assert.deepStrictEqual(rows, [{ question: 'A, B "とは"', answer: '答1', explanation: '1行目\n2行目' }]);
});

test('同じファイルを何度取り込んでも重複しない（CSVとJSONの両方でも）', () => {
  const store = createStore(memoryStorage());
  const csv = P.parseQuestionFile('a.csv', sample('用語メモ_クイズ.csv')).records;
  const json = P.parseQuestionFile('a.json', sample('用語メモ_クイズ.json')).records;
  assert.strictEqual(store.upsertQuestions(csv).added, 34);
  const again = store.upsertQuestions(json);
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.unchanged, 34);
  assert.strictEqual(store.count, 34);
});

test('空白や全角半角の違いは同じ問題とみなし、履歴を引き継いで内容を更新する', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.upsertQuestions([{ question: 'TCPとは何か？', answer: '旧' }]);
  const key = store.allQuestions()[0].key;
  store.record(key, true);
  const r = store.upsertQuestions([{ id: '99', question: ' ＴＣＰとは 何か? ', answer: '新', category: 'ネットワーク' }]);
  assert.deepStrictEqual(r, { added: 0, updated: 1, unchanged: 0 });
  const q = store.allQuestions()[0];
  assert.strictEqual(q.answer, '新');
  assert.strictEqual(store.statsOf(q.key).attempts, 1);
  // 再読み込みしても保持されている
  const reloaded = createStore(storage);
  assert.strictEqual(reloaded.count, 1);
  assert.strictEqual(reloaded.statsOf(key).correct, 1);
});

test('バックアップを別端末に読み込むと問題と履歴が統合される', () => {
  const a = createStore(memoryStorage());
  a.upsertQuestions([{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }]);
  const k = a.allQuestions()[0].key;
  a.record(k, false); a.record(k, true);
  const b = createStore(memoryStorage());
  const res = b.importBackup(JSON.parse(JSON.stringify(a.exportData())));
  assert.strictEqual(res.added, 2);
  assert.strictEqual(res.historyMerged, 2);
  assert.strictEqual(b.importBackup(a.exportData()).historyMerged, 0); // 2回目は増えない
  assert.strictEqual(b.statsOf(k).attempts, 2);
});

test('不正なキーを含むバックアップを読み込んでもプロトタイプが汚染されない', () => {
  const s = createStore(memoryStorage());
  const evil = JSON.parse('{"app":"ouyo-quiz","questions":[{"question":"Q","answer":"A"}],"history":{"__proto__":[[1,1]],"constructor":[[1,1]],"qabc":[["x",1],[5,1]]}}');
  const r = s.importBackup(evil);
  assert.strictEqual(r.historyMerged, 1);
  assert.strictEqual({}.polluted, undefined);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, '0'), false);
});
