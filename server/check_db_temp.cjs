const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, '..', 'data', 'sqlite', 'eicd.db'), sqlite3.OPEN_READONLY);

db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'", (err, row) => {
  console.log(row.sql);
  db.close();
});
