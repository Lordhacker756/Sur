// ---------------------------------------------------------------------------
// Sur — persistence.
//
// SQLite via node:sqlite, which is built into Node 22.5+ — so the whole app
// still installs with zero dependencies while keeping a real database rather
// than browser storage. The point is that a singer measures their range once
// and it is still there next week, even if they clear their browser.
//
// The file lives next to the app as sur.db. It is plain SQLite: copy it to
// back it up, open it with any SQLite tool to look inside.
// ---------------------------------------------------------------------------

import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS singer (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  a4             REAL    NOT NULL DEFAULT 440,
  -- just intonation is what the ear wants against a tanpura; equal
  -- temperament is the keyboard's compromise, not the voice's
  tuning         TEXT    NOT NULL DEFAULT 'ji',
  thaat          TEXT    NOT NULL DEFAULT 'bilawal',
  tol_cents      INTEGER NOT NULL DEFAULT 25,
  -- chosen Sa
  sa_hz          REAL,
  sa_note        TEXT,
  sa_key         TEXT,
  -- most recent accepted comfortable range
  low_hz         REAL,
  high_hz        REAL,
  low_note       TEXT,
  high_note      TEXT,
  semitones      REAL,
  tier           TEXT,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS range_test (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  singer_id   INTEGER NOT NULL REFERENCES singer(id) ON DELETE CASCADE,
  taken_at    TEXT    NOT NULL,
  low_hz      REAL    NOT NULL,
  high_hz     REAL    NOT NULL,
  low_note    TEXT,
  high_note   TEXT,
  semitones   REAL,
  tier        TEXT,
  warmed_up   INTEGER NOT NULL DEFAULT 0,
  accepted    INTEGER NOT NULL DEFAULT 1,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS ix_range_singer ON range_test(singer_id, taken_at);

CREATE TABLE IF NOT EXISTS session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  singer_id    INTEGER NOT NULL REFERENCES singer(id) ON DELETE CASCADE,
  started_at   TEXT    NOT NULL,
  ended_at     TEXT,
  seconds      REAL    NOT NULL DEFAULT 0,
  exercise     TEXT,
  thaat        TEXT,
  sa_hz        REAL,
  notes_sung   INTEGER NOT NULL DEFAULT 0,
  in_tune      INTEGER NOT NULL DEFAULT 0,
  mean_abs_cents REAL,
  longest_hold REAL,
  score        REAL
);
CREATE INDEX IF NOT EXISTS ix_session_singer ON session(singer_id, started_at);

-- per-swara accuracy, so the app can show which swaras a singer actually
-- struggles with rather than one undifferentiated score
CREATE TABLE IF NOT EXISTS swara_stat (
  session_id  INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  swara       INTEGER NOT NULL,
  octave      INTEGER NOT NULL,
  n           INTEGER NOT NULL,
  mean_cents  REAL    NOT NULL,
  sd_cents    REAL    NOT NULL,
  PRIMARY KEY (session_id, swara, octave)
);

CREATE TABLE IF NOT EXISTS app_state (
  k TEXT PRIMARY KEY,
  v TEXT
);
`;

const nowISO = () => new Date().toISOString();

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(db) {
  const q = (sql) => db.prepare(sql);

  const getState = (k, fallback = null) => {
    const r = q('SELECT v FROM app_state WHERE k = ?').get(k);
    return r ? r.v : fallback;
  };
  const setState = (k, v) =>
    q('INSERT INTO app_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));

  const api = {
    raw: db,
    close: () => db.close(),

    /* ------------------------------------------------------- singers --- */
    listSingers: () => q('SELECT * FROM singer ORDER BY updated_at DESC').all(),

    getSinger(id) { return q('SELECT * FROM singer WHERE id = ?').get(id) || null; },

    createSinger(name = 'Me') {
      const t = nowISO();
      const r = q('INSERT INTO singer (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, t, t);
      const id = Number(r.lastInsertRowid);
      setState('active_singer', id);
      return api.getSinger(id);
    },

    /** The singer the app is currently working with, created on first run. */
    activeSinger() {
      const id = Number(getState('active_singer', 0));
      let s = id ? api.getSinger(id) : null;
      if (!s) s = api.listSingers()[0] || null;
      if (!s) s = api.createSinger('Me');
      setState('active_singer', s.id);
      return s;
    },

    setActiveSinger(id) {
      const s = api.getSinger(id);
      if (!s) throw new Error('no such singer');
      setState('active_singer', id);
      return s;
    },

    /** Partial update. Only known columns are written. */
    updateSinger(id, patch) {
      const cols = ['name', 'a4', 'tuning', 'thaat', 'tol_cents', 'sa_hz', 'sa_note', 'sa_key',
                    'low_hz', 'high_hz', 'low_note', 'high_note', 'semitones', 'tier'];
      const keys = cols.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
      if (keys.length) {
        const sql = `UPDATE singer SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`;
        q(sql).run(...keys.map((k) => patch[k]), nowISO(), id);
      }
      return api.getSinger(id);
    },

    deleteSinger(id) { q('DELETE FROM singer WHERE id = ?').run(id); },

    /* --------------------------------------------------- range tests --- */
    addRangeTest(singerId, t) {
      const r = q(`INSERT INTO range_test
        (singer_id, taken_at, low_hz, high_hz, low_note, high_note, semitones, tier, warmed_up, accepted, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        singerId, t.taken_at || nowISO(), t.low_hz, t.high_hz, t.low_note ?? null, t.high_note ?? null,
        t.semitones ?? null, t.tier ?? null, t.warmed_up ? 1 : 0, t.accepted === false ? 0 : 1, t.note ?? null);
      return Number(r.lastInsertRowid);
    },

    rangeHistory(singerId, limit = 60) {
      return q('SELECT * FROM range_test WHERE singer_id = ? ORDER BY taken_at DESC LIMIT ?').all(singerId, limit);
    },

    /* ------------------------------------------------------ sessions --- */
    startSession(singerId, s) {
      const r = q(`INSERT INTO session (singer_id, started_at, exercise, thaat, sa_hz)
                   VALUES (?, ?, ?, ?, ?)`).run(
        singerId, s.started_at || nowISO(), s.exercise ?? null, s.thaat ?? null, s.sa_hz ?? null);
      return Number(r.lastInsertRowid);
    },

    finishSession(id, s) {
      q(`UPDATE session SET ended_at = ?, seconds = ?, notes_sung = ?, in_tune = ?,
         mean_abs_cents = ?, longest_hold = ?, score = ? WHERE id = ?`).run(
        s.ended_at || nowISO(), s.seconds ?? 0, s.notes_sung ?? 0, s.in_tune ?? 0,
        s.mean_abs_cents ?? null, s.longest_hold ?? null, s.score ?? null, id);
      if (Array.isArray(s.swaras)) {
        const ins = q(`INSERT INTO swara_stat (session_id, swara, octave, n, mean_cents, sd_cents)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(session_id, swara, octave) DO UPDATE SET
                         n = excluded.n, mean_cents = excluded.mean_cents, sd_cents = excluded.sd_cents`);
        for (const w of s.swaras) ins.run(id, w.swara, w.octave, w.n, w.mean_cents, w.sd_cents);
      }
      return q('SELECT * FROM session WHERE id = ?').get(id);
    },

    sessions(singerId, limit = 60) {
      return q('SELECT * FROM session WHERE singer_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?')
        .all(singerId, limit);
    },

    /* --------------------------------------------------------- stats --- */
    stats(singerId) {
      const totals = q(`SELECT COUNT(*) AS sessions, COALESCE(SUM(seconds),0) AS seconds,
                               COALESCE(SUM(notes_sung),0) AS notes, COALESCE(SUM(in_tune),0) AS in_tune
                        FROM session WHERE singer_id = ? AND ended_at IS NOT NULL`).get(singerId);

      const perSwara = q(`SELECT w.swara, w.octave, SUM(w.n) AS n,
                                 SUM(w.mean_cents * w.n) / SUM(w.n) AS mean_cents
                          FROM swara_stat w JOIN session s ON s.id = w.session_id
                          WHERE s.singer_id = ? GROUP BY w.swara, w.octave ORDER BY w.octave, w.swara`).all(singerId);

      const rangeTrend = q(`SELECT taken_at, low_hz, high_hz, semitones FROM range_test
                            WHERE singer_id = ? AND accepted = 1 ORDER BY taken_at`).all(singerId);

      const days = q(`SELECT DISTINCT substr(started_at, 1, 10) AS d FROM session
                      WHERE singer_id = ? AND ended_at IS NOT NULL ORDER BY d DESC LIMIT 400`).all(singerId)
                    .map((r) => r.d);

      return { totals, perSwara, rangeTrend, days, streak: streakFrom(days) };
    },
  };

  return api;
}

/** Consecutive days up to today (or yesterday, so an evening practice still counts). */
export function streakFrom(daysDesc) {
  if (!daysDesc.length) return 0;
  const day = (d) => Math.floor(new Date(d + 'T00:00:00Z').getTime() / 86400000);
  const today = Math.floor(Date.now() / 86400000);
  let cur = daysDesc[0] === undefined ? null : day(daysDesc[0]);
  if (cur === null || today - cur > 1) return 0;
  let streak = 1;
  for (let i = 1; i < daysDesc.length; i++) {
    const d = day(daysDesc[i]);
    if (cur - d === 1) { streak++; cur = d; }
    else if (cur - d === 0) continue;
    else break;
  }
  return streak;
}
