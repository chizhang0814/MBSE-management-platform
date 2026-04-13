const sqlite3 = require('sqlite3');
const xlsx = require('xlsx');

const db = new sqlite3.Database('../data/sqlite/eicd.db');

// 读取 Excel
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

// 构建 Excel 端点对集合：key = "connA|pinA||connB|pinB"（排序后去方向）→ [行号]
const excelPairs = {};
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
    // 不考虑方向，排序后作为 key
    const key = [a, b].sort().join('||');
    if (!excelPairs[key]) excelPairs[key] = [];
    excelPairs[key].push(rowNum);
  }
}

console.log('Excel 端点对总数（去重key）:', Object.keys(excelPairs).length);

const SIGNAL_IDS = [54790, 54785];
const ERN_CONNS = ['8800G0000-TB1', '8800G0000-TB2'];

db.all(
  `SELECT se.signal_id, se.endpoint_index, se.pin_id,
          p."针孔号", c."设备端元器件编号" as conn_num,
          d."设备编号", d."设备LIN号（DOORS）" as lin
   FROM signal_endpoints se
   JOIN devices d ON se.device_id = d.id
   LEFT JOIN pins p ON se.pin_id = p.id
   LEFT JOIN connectors c ON p.connector_id = c.id
   WHERE se.signal_id IN (${SIGNAL_IDS.join(',')})
   ORDER BY se.signal_id, se.endpoint_index`,
  (err, endpoints) => {
    if (err) { console.error(err); db.close(); return; }

    let totalFound = 0, totalNotFound = 0;

    for (const sigId of SIGNAL_IDS) {
      const eps = endpoints.filter(e => e.signal_id === sigId);
      const ernEps = eps.filter(e => ERN_CONNS.includes(e.conn_num));
      const otherEps = eps.filter(e => !ERN_CONNS.includes(e.conn_num));

      console.log(`\n${'='.repeat(60)}`);
      console.log(`信号 ${sigId}`);

      let found = 0, notFound = 0;
      const notFoundList = [];

      for (const ern of ernEps) {
        const ernKey = `${ern.conn_num}|${ern['针孔号']}`;
        for (const other of otherEps) {
          const otherKey = `${other.conn_num}|${other['针孔号']}`;
          const pairKey = [ernKey, otherKey].sort().join('||');
          const matches = excelPairs[pairKey];
          if (matches && matches.length > 0) {
            found++;
          } else {
            notFound++;
            notFoundList.push(`  ✗ [${ern.conn_num}-${ern['针孔号']}] ↔ [${other.conn_num}-${other['针孔号']}] 设备${other['设备编号']}`);
          }
        }
      }

      console.log(`  找到: ${found}, 未找到: ${notFound}`);
      if (notFoundList.length > 0) {
        console.log('  未找到的端点对:');
        notFoundList.forEach(l => console.log(l));
      }
      totalFound += found;
      totalNotFound += notFound;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`总计: 找到 ${totalFound}, 未找到 ${totalNotFound}, 共 ${totalFound + totalNotFound}`);
    db.close();
  }
);
