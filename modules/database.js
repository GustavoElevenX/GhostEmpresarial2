const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../db/ghostempresarial.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);

async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.on('open', () => {
      console.log('Conectado ao banco de dados SQLite.');
      db.run('PRAGMA encoding = "UTF-8"');

      const createTables = `
        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT UNIQUE NOT NULL,
          email TEXT
        );
        CREATE TABLE IF NOT EXISTS sales_funnel (
          contact_id INTEGER PRIMARY KEY,
          stage TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (contact_id) REFERENCES contacts(id)
        );
        CREATE TABLE IF NOT EXISTS interactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          source TEXT NOT NULL,
          message TEXT NOT NULL,
          response TEXT,
          timestamp TEXT NOT NULL,
          FOREIGN KEY (contact_id) REFERENCES contacts(id)
        );
        CREATE TABLE IF NOT EXISTS appointments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contact_id INTEGER NOT NULL,
          date_time TEXT NOT NULL,
          FOREIGN KEY (contact_id) REFERENCES contacts(id)
        );
      `;

      db.exec(createTables, (err) => {
        if (err) {
          console.error('Erro ao criar tabelas:', err.message);
          reject(err);
        } else {
          console.log('Tabelas criadas ou verificadas com sucesso.');
          resolve();
        }
      });
    });

    db.on('error', (err) => {
      console.error('Erro ao conectar ao banco de dados:', err.message);
      reject(err);
    });
  });
}

async function upsertContact({ name, phone, email }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO contacts (name, phone, email) VALUES (?, ?, ?) 
       ON CONFLICT(phone) DO UPDATE SET name = excluded.name, email = excluded.email`,
      [name, phone, email],
      function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID || this.changes ? db.get('SELECT id FROM contacts WHERE phone = ?', [phone]) : null, name, phone, email });
      }
    );
  });
}

async function logInteraction({ contact_id, source, message, response }) {
  return new Promise((resolve, reject) => {
    const localTimestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/,/, '');
    db.run(
      'INSERT INTO interactions (contact_id, source, message, response, timestamp) VALUES (?, ?, ?, ?, ?)',
      [contact_id, source, message, response, localTimestamp],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

async function updateFunnelStage({ contact_id, stage }) {
  return new Promise((resolve, reject) => {
    const localTimestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/,/, '');
    db.run(
      'INSERT INTO sales_funnel (contact_id, stage, updated_at) VALUES (?, ?, ?) ON CONFLICT(contact_id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at',
      [contact_id, stage, localTimestamp],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function addAppointment({ contact_id, date_time }) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO appointments (contact_id, date_time) VALUES (?, ?)',
      [contact_id, date_time],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

async function getContact({ phone }) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM contacts WHERE phone = ?', [phone], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function getFunnelStage(contactId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT stage FROM sales_funnel WHERE contact_id = ?', [contactId], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.stage : null);
    });
  });
}

async function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  initializeDatabase,
  upsertContact,
  logInteraction,
  updateFunnelStage,
  addAppointment,
  getContact,
  getFunnelStage,
  all
};

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error('Erro ao fechar o banco de dados:', err.message);
    else console.log('Banco de dados fechado.');
    process.exit(0);
  });
});