import Database from 'better-sqlite3';
import path from 'path';

// Configuración inicial de la base de datos
const isTest = process.env.NODE_ENV === 'test';
const dbPath = isTest ? ':memory:' : path.join(__dirname, '..', 'weekboard.db');

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Definición de tablas del sistema
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
    start_date TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL,
    week_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    duration_seconds INTEGER NULL,
    remaining_seconds INTEGER NULL,
    timer_running INTEGER DEFAULT 0,
    last_started_at TEXT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
`);

// Migraciones de esquema
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('cards', 'duration_seconds', 'INTEGER NULL');
ensureColumn('cards', 'remaining_seconds', 'INTEGER NULL');
ensureColumn('cards', 'timer_running', 'INTEGER DEFAULT 0');
ensureColumn('cards', 'last_started_at', 'TEXT NULL');

// Migración: elimina filas duplicadas en weeks (mismo start_date) y reasigna
// las cards que apuntaban a las filas duplicadas hacia la fila canónica (id mínimo).
// Es idempotente: si no hay duplicados, no realiza ningún cambio.
function deduplicateWeeks(): void {
  const duplicates = db
    .prepare(
      `SELECT start_date, MIN(id) AS canonical_id
       FROM weeks
       GROUP BY start_date
       HAVING COUNT(*) > 1`
    )
    .all() as { start_date: string; canonical_id: number }[];

  if (duplicates.length === 0) return;

  const migrate = db.transaction(() => {
    for (const { start_date, canonical_id } of duplicates) {
      const dupes = db
        .prepare('SELECT id FROM weeks WHERE start_date = ? AND id != ?')
        .all(start_date, canonical_id) as { id: number }[];

      for (const { id } of dupes) {
        // Reasignar las cards que apuntan a la fila duplicada hacia la canónica
        db.prepare('UPDATE cards SET week_id = ? WHERE week_id = ?').run(canonical_id, id);
        // Eliminar la fila duplicada
        db.prepare('DELETE FROM weeks WHERE id = ?').run(id);
      }
    }
  });

  migrate();
}

deduplicateWeeks();

// Garantiza el constraint UNIQUE en bases de datos existentes (donde la tabla weeks
// ya fue creada sin UNIQUE). Para bases nuevas, el UNIQUE inline del CREATE TABLE
// ya lo cubre, por lo que este índice es redundante pero inofensivo.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_weeks_start_date ON weeks(start_date)');

console.log('Base de datos inicializada: tablas verificadas o creadas.');

export default db;