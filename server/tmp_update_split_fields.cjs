const sqlite3 = require('sqlite3');
const xlsx = require('xlsx');

const db = new sqlite3.Database('../data/sqlite/eicd.db');
const PROJECT_ID = 42;
const ERN_CONNS = ['8800G0000-TB1', '8800G0000-TB2'];

// ── 读取 Excel ──
const workbook = xlsx.readFile('D:\\Downloads\\MBSE综合管理平台\\EICD总V2.xlsx');
const sheetName = workbook.SheetNames.find(n => n.includes('电气接口清单'));
const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
const normH = h => String(h).replace(/[\r\n\t]+/g, '').trim();

const colIdx = {};
const colIdx2 = {};
for (let ci = 0; ci < rawRows[0].length; ci++) {
  const h = normH(rawRows[0][ci]);
  if (h) {
    if (!(h in colIdx)) colIdx[h] = ci;
    else if (!(h in colIdx2)) colIdx2[h] = ci;
  }
}

const EXCEL_SIG_FIELDS = [
  ['推荐导线线规',           '推荐导线线规'],
  ['推荐导线线型',           '推荐导线线型'],
  ['独立电源代码',           '独立电源代码'],
  ['敷设代码',               '敷设代码'],
  ['电磁兼容代码',           '电磁兼容代码'],
  ['余度代码',               '余度代码'],
  ['功能代码',               '功能代码'],
  ['接地代码',               '接地代码'],
  ['极性',                   '极性'],
  ['信号ATA',                '信号ATA'],
  ['信号架次有效性',         '信号架次有效性'],
  ['额定电压（V）',          '额定电压'],
  ['设备正常工作电压范围（V）', '设备正常工作电压范围'],
  ['额定电流（A）',          '额定电流'],
  ['是否为成品线',           '是否成品线'],
  ['成品线件号',             '成品线件号'],
  ['成品线线规',             '成品线线规'],
  ['成品线类型',             '成品线类型'],
  ['成品线长度（MM）',       '成品线长度'],
  ['成品线载流量（A）',      '成品线载流量'],
  ['成品线线路压降（V）',    '成品线线路压降'],
  ['成品线标识',             '成品线标识'],
  ['成品线与机上线束对接方式', '成品线与机上线束对接方式'],
  ['成品线安装责任',         '成品线安装责任'],
];

// 构建 Excel 端点对 → sigFields
const excelPairMap = {};
for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  const rowNum = i + 1;
  const fromConn = String(row[colIdx['连接器（从）']] ?? '').trim();
  const fromPin  = String(row[colIdx['针孔号（从）']] ?? '').trim();
  const toConn   = String(row[colIdx['连接器（到）']] ?? '').trim();
  const toPin    = String(row[colIdx['针孔号（到）']] ?? '').trim();

  if (fromConn && fromPin && toConn && toPin) {
    const a = `${fromConn}|${fromPin}`;
    const b = `${toConn}|${toPin}`;
    const key = [a, b].sort().join('||');
    if (!excelPairMap[key]) {
      const sigFields = {};
      for (const [excelCol, dbCol] of EXCEL_SIG_FIELDS) {
        const v = String(row[colIdx[excelCol] ?? -1] ?? '').trim();
        sigFields[dbCol] = v || null; // 空值设为 null 以清除旧值
      }
      excelPairMap[key] = { rowNum, sigFields };
    }
  }
}

console.log('Excel 端点对总数:', Object.keys(excelPairMap).length);

// ── 查询已拆分的信号及其端点 ──
db.all(
  `SELECT s.id as signal_id,
          se.endpoint_index,
          c."设备端元器件编号" as conn_num,
          p."针孔号"
   FROM signals s
   JOIN signal_endpoints se ON se.signal_id = s.id
   LEFT JOIN pins p ON se.pin_id = p.id
   LEFT JOIN connectors c ON p.connector_id = c.id
   WHERE s.project_id = ? AND s.created_by = 'system_split'
   ORDER BY s.id, se.endpoint_index`,
  [PROJECT_ID],
  (err, rows) => {
    if (err) { console.error(err); db.close(); return; }

    // 按信号分组
    const signalEps = {};
    for (const r of rows) {
      if (!signalEps[r.signal_id]) signalEps[r.signal_id] = [];
      signalEps[r.signal_id].push(r);
    }

    let updated = 0, notMatched = 0, noChange = 0;

    function runAsync(sql, params) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        });
      });
    }

    async function execute() {
      await runAsync('BEGIN TRANSACTION');

      try {
        for (const [sigIdStr, eps] of Object.entries(signalEps)) {
          const sigId = Number(sigIdStr);
          const ernEp = eps.find(e => ERN_CONNS.includes(e.conn_num));
          const otherEp = eps.find(e => !ERN_CONNS.includes(e.conn_num));

          if (!ernEp || !otherEp) { notMatched++; continue; }

          const ernKey = `${ernEp.conn_num}|${ernEp['针孔号']}`;
          const otherKey = `${otherEp.conn_num}|${otherEp['针孔号']}`;
          const pairKey = [ernKey, otherKey].sort().join('||');
          const excelMatch = excelPairMap[pairKey];

          if (!excelMatch) { notMatched++; continue; }

          const { sigFields } = excelMatch;
          const setClauses = [];
          const values = [];
          for (const [dbCol, val] of Object.entries(sigFields)) {
            setClauses.push(`"${dbCol}" = ?`);
            values.push(val);
          }

          if (setClauses.length > 0) {
            await runAsync(
              `UPDATE signals SET ${setClauses.join(', ')} WHERE id = ?`,
              [...values, sigId]
            );
            updated++;
          } else {
            noChange++;
          }
        }

        await runAsync('COMMIT');
        console.log(`\n完成！更新: ${updated}, 未匹配Excel: ${notMatched}, 无变化: ${noChange}`);
      } catch (err) {
        console.error('失败，回滚:', err.message);
        await runAsync('ROLLBACK');
      }

      db.close();
    }

    execute();
  }
);
