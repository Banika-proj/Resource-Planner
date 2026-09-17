-- Resource Planner — D1 schema
-- Run this once against your D1 database before first deploy (see README).

CREATE TABLE IF NOT EXISTS members (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_tasks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  date      TEXT NOT NULL,          -- YYYY-MM-DD
  task_id   INTEGER,                -- nullable: the task may since have been deleted
  task      TEXT NOT NULL,          -- snapshotted at save time
  type      TEXT NOT NULL,          -- snapshotted at save time
  minutes   INTEGER NOT NULL,
  avail     TEXT NOT NULL DEFAULT 'Full'
);

CREATE TABLE IF NOT EXISTS capacity (
  key     TEXT PRIMARY KEY,          -- 'Full' | 'Half' | 'Leave'
  minutes INTEGER NOT NULL
);

-- Seed data (safe to skip/edit before running if you don't want the sample team)
INSERT INTO members (name) VALUES
  ('Banika Kalra'), ('Gurvinder Singh'), ('Neetu Harjait'), ('Nardip Singh'), ('Silpa Sahoo');

INSERT INTO capacity (key, minutes) VALUES
  ('Full', 400), ('Half', 200), ('Leave', 0);
