// 問題ファイル（CSV / JSON）の読み込みと正規化
(function (global) {
  'use strict';

  // 列名の対応表（日本語・英語どちらの見出しでも読めるようにする）
  const FIELD_ALIASES = {
    id: ['id', 'ID', 'No', 'no', '番号'],
    category: ['category', 'カテゴリ', 'カテゴリー', '分野', 'ジャンル'],
    question: ['question', '問題', '問題文', '問', '質問'],
    answer: ['answer', '答え', '正解', '解答', '回答'],
    explanation: ['explanation', '解説', '説明', '補足'],
    source: ['source', '出典', '出題', '参考'],
  };

  function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // RFC 4180 形式の CSV をパース（ダブルクォート・改行入りセル・"" エスケープ対応）
  function parseCsvRows(text) {
    text = stripBom(text);
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cell); cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim() !== ''));
  }

  function resolveField(name) {
    const n = String(name).trim();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(a => a.toLowerCase() === n.toLowerCase())) return field;
    }
    return null;
  }

  function mapRecord(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const f = resolveField(k);
      if (f && out[f] === undefined) out[f] = v == null ? '' : String(v).trim();
    }
    return out;
  }

  function parseCsv(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) return [];
    const header = rows[0].map(resolveField);
    if (!header.includes('question') || !header.includes('answer')) {
      throw new Error('CSVの1行目に「問題」と「答え」の列が見つかりません');
    }
    return rows.slice(1).map(r => {
      const o = {};
      header.forEach((f, i) => { if (f && o[f] === undefined) o[f] = (r[i] || '').trim(); });
      return o;
    });
  }

  function parseJson(text) {
    let data = JSON.parse(stripBom(text));
    if (!Array.isArray(data)) {
      data = data.questions || data.items || data.data;
      if (!Array.isArray(data)) throw new Error('JSONは問題の配列にしてください');
    }
    return data.filter(x => x && typeof x === 'object').map(mapRecord);
  }

  // ファイル名・中身から形式を判定してパース
  function parseQuestionFile(name, text) {
    const lower = (name || '').toLowerCase();
    const trimmed = stripBom(text).trimStart();
    const isJson = lower.endsWith('.json') || (!lower.endsWith('.csv') && (trimmed[0] === '[' || trimmed[0] === '{'));
    const records = isJson ? parseJson(text) : parseCsv(text);
    const valid = [];
    let invalid = 0;
    for (const r of records) {
      if (r.question && r.answer) valid.push(r); else invalid++;
    }
    return { records: valid, invalid };
  }

  // 重複判定用の正規化（全角半角・空白・句読点の揺れを吸収）
  function normalize(s) {
    return String(s || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[。．.、，,？?！!]+$/g, '');
  }

  // 文字列 → 短いハッシュ（cyrb53）
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // 問題の同一性キー：問題文（正規化後）で判定する
  function questionKey(question) {
    return 'q' + hash(normalize(question));
  }

  const api = { parseCsvRows, parseCsv, parseJson, parseQuestionFile, normalize, questionKey };
  global.QuizParser = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
