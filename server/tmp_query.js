const Database = require('better-sqlite3');
const db = new Database('../data/sqlite/eicd.db', { readonly: true });
const rows = db.prepare("SELECT DISTINCT [独立电源代码] FROM signals WHERE [独立电源代码] IS NOT NULL AND [独立电源代码] != '' ORDER BY [独立电源代码]").all();
console.log(JSON.stringify(rows.map(r => r['独立电源代码'])));
db.close();
