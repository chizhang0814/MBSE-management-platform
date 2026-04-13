const sqlite3 = require('sqlite3');
const xlsx = require('xlsx');

const db = new sqlite3.Database('../data/sqlite/eicd.db');

// 读取 Excel
const workbook = xlsx.readFile('D:\\Downloads\\MBSE综合管理平台\\EICD总V2.xlsx');
const sheetName = workbook.SheetNames.find(n => n.includes('电气接口清单'));
if (!sheetName) { console.error('未找到电气接口清单 Sheet'); process.exit(1); }
console.log('Sheet:', sheetName);

const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
const normH = h => String(h).replace(/[\r\n\t]+/g, '').trim();

// 构建列名映射（处理重复列名：第一次出现 → colIdx，第二次 → colIdx2）
const colIdx = {};
const colIdx2 = {};
for (let ci = 0; ci < rawRows[0].length; ci++) {
  const h = normH(rawRows[0][ci]);
  if (h) {
    if (!(h in colIdx)) colIdx[h] = ci;
    else if (!(h in colIdx2)) colIdx2[h] = ci;
  }
}

console.log('列名映射:');
console.log('  连接器（从） col:', colIdx['连接器（从）']);
console.log('  针孔号（从） col:', colIdx['针孔号（从）']);
console.log('  连接器（到） col:', colIdx['连接器（到）']);
console.log('  针孔号（到） col:', colIdx['针孔号（到）']);
console.log('  设备（从） col:', colIdx['设备（从）'], '/ col2:', colIdx2['设备（从）']);
console.log('  设备（到） col:', colIdx['设备（到）'], '/ col2:', colIdx2['设备（到）']);
console.log('  总数据行:', rawRows.length - 1);

// 构建 Excel 端点集合：key = "连接器号|针孔号" → [行号]
const excelEndpoints = {};  // key → [{row, from/to, connVal, pinVal, devNum, linNo}]
for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  const rowNum = i + 1;

  const fromConn = String(row[colIdx['连接器（从）']] ?? '').trim();
  const fromPin  = String(row[colIdx['针孔号（从）']] ?? '').trim();
  const toConn   = String(row[colIdx['连接器（到）']] ?? '').trim();
  const toPin    = String(row[colIdx['针孔号（到）']] ?? '').trim();
  // 设备LIN号是第二次出现的"设备"列
  const fromLinNo = String(row[colIdx2['设备（从）']] ?? '').trim();
  const toLinNo   = String(row[colIdx2['设备（到）']] ?? '').trim();
  const fromDevNum = String(row[colIdx['设备（从）']] ?? '').trim();
  const toDevNum   = String(row[colIdx['设备（到）']] ?? '').trim();

  if (fromConn && fromPin) {
    const key = `${fromConn}|${fromPin}`;
    if (!excelEndpoints[key]) excelEndpoints[key] = [];
    excelEndpoints[key].push({ rowNum, side: '从', conn: fromConn, pin: fromPin, devNum: fromDevNum, linNo: fromLinNo });
  }
  if (toConn && toPin) {
    const key = `${toConn}|${toPin}`;
    if (!excelEndpoints[key]) excelEndpoints[key] = [];
    excelEndpoints[key].push({ rowNum, side: '到', conn: toConn, pin: toPin, devNum: toDevNum, linNo: toLinNo });
  }
}

console.log('\nExcel 端点总数（去重key）:', Object.keys(excelEndpoints).length);

// 查询数据库中信号 54790 和 54785 的端点
const SIGNAL_IDS = [54790, 54785];

db.all(
  `SELECT se.signal_id, se.endpoint_index, se.pin_id, se."信号名称",
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

    for (const sigId of SIGNAL_IDS) {
      const eps = endpoints.filter(e => e.signal_id === sigId);
      console.log(`\n${'='.repeat(60)}`);
      console.log(`信号 ${sigId}：共 ${eps.length} 个端点`);
      console.log(`${'='.repeat(60)}`);

      let found = 0, notFound = 0;
      for (const ep of eps) {
        const connNum = ep.conn_num || '';
        const pinNum = ep['针孔号'] || '';
        const key = `${connNum}|${pinNum}`;
        const matches = excelEndpoints[key];

        if (matches && matches.length > 0) {
          found++;
          const matchInfo = matches.map(m => `第${m.rowNum}行(${m.side},设备${m.devNum},LIN=${m.linNo})`).join('; ');
          console.log(`  ✓ ep${ep.endpoint_index} [${connNum}-${pinNum}] 设备${ep['设备编号']}(LIN=${ep.lin}) → Excel: ${matchInfo}`);
        } else {
          notFound++;
          console.log(`  ✗ ep${ep.endpoint_index} [${connNum}-${pinNum}] 设备${ep['设备编号']}(LIN=${ep.lin}) → Excel中未找到`);
        }
      }
      console.log(`\n  统计: 找到 ${found}, 未找到 ${notFound}, 共 ${eps.length}`);
    }

    db.close();
  }
);
