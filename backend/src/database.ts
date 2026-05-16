import Database from 'better-sqlite3';
import path from 'path';

// La ruta del archivo apunta a la carpeta "backend", un nivel arriba de "src"
const dbPath = path.join(__dirname, '..', 'weekboard.db');

export const db = new Database(dbPath);

// Configurar pragmas recomendados (Write-Ahead Logging y habilitar llaves foráneas)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Crear tablas si no existen
db.exec(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT,
    days TEXT NOT NULL, -- Guardará el arreglo de días en formato JSON
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
    completed INTEGER DEFAULT 0, -- 0 para falso, 1 para verdadero
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
`);

console.log('Base de datos inicializada: tablas verificadas o creadas.');

export default db;
