import Database from 'better-sqlite3';
import path from 'path';

const isTest = process.env.NODE_ENV === 'test';
const dbPath = isTest ? ':memory:' : path.join(__dirname, '..', 'weekboard.db');

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    days TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    week_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
`);

console.log('Base de datos inicializada: tablas verificadas o creadas.');

export default db;