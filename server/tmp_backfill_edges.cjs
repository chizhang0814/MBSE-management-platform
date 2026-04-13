const sqlite3 = require('sqlite3');
const xlsx = require('xlsx');
const fs = require('fs');

// ══════════════════════════════════════════════════════════
// 配置
// ══════════════════════════════════════════════════════════
const PROJECT_NAME = process.argv[2] || 'CE-25A测试';
const EXCEL_PATH = 'D:/Downloads/MBSE综合管理平台/EICD总V2.xlsx';
// ══════════════════════════════════════════════════════════

const db = new sqlite3.Database('../data/sqlite/eicd.db');

function runAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
  });
}
function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function getAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

async function main() {
  // ── 第1步：读取 Excel ──
  console.log('读取 Excel...');
  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheetName = workbook.SheetNames.find(n => n.includes('电气接口清单'));
  if (!sheetName) { console.error('未找到电气接口清单 Sheet'); process.exit(1); }
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
  const getV = (row, h) => String(row[colIdx[h] ?? -1] ?? '').trim();

  console.log(`Excel Sheet: ${sheetName}, ${rawRows.length - 1} 数据行`);

  // ── 第2步：查找项目 ──
  const project = await getAsync('SELECT id FROM projects WHERE name = ?', [PROJECT_NAME]);
  if (!project) { console.error('项目不存在:', PROJECT_NAME); db.close(); return; }
  const projectId = project.id;
  console.log(`项目: ${PROJECT_NAME} (id=${projectId})`);

  // ── 第3步：清空该项目的 signal_edges（幂等）──
  const delResult = await runAsync(
    'DELETE FROM signal_edges WHERE signal_id IN (SELECT id FROM signals WHERE project_id = ?)',
    [projectId]
  );
  console.log(`清空旧 edges: ${delResult.changes} 条`);

  // ── 第4步：构建 pin 查找缓存 ──
  console.log('构建 pin 缓存...');
  const allPins = await queryAsync(
    `SELECT p.id as pin_id, p."针孔号", c."设备端元器件编号" as conn_num, c.id as conn_id
     FROM pins p
     JOIN connectors c ON p.connector_id = c.id
     JOIN devices d ON c.device_id = d.id
     WHERE d.project_id = ?`,
    [projectId]
  );
  // key: "conn_num|pin_num" → pin_id
  const pinMap = new Map();
  for (const p of allPins) {
    pinMap.set(`${p.conn_num}|${p['针孔号']}`, p.pin_id);
  }
  console.log(`pin 缓存: ${pinMap.size} 个`);

  // ── 第5步：构建 signal_endpoints 查找缓存 ──
  console.log('构建 signal_endpoints 缓存...');
  const allEndpoints = await queryAsync(
    `SELECT se.id as ep_id, se.signal_id, se.pin_id
     FROM signal_endpoints se
     JOIN signals s ON se.signal_id = s.id
     WHERE s.project_id = ? AND se.pin_id IS NOT NULL`,
    [projectId]
  );
  // key: pin_id → [{ep_id, signal_id}]
  const epByPin = new Map();
  for (const ep of allEndpoints) {
    if (!epByPin.has(ep.pin_id)) epByPin.set(ep.pin_id, []);
    epByPin.get(ep.pin_id).push({ ep_id: ep.ep_id, signal_id: ep.signal_id });
  }
  console.log(`signal_endpoints 缓存: ${allEndpoints.length} 条`);

  // ── 第6步：逐行处理 Excel，创建 edges ──
  console.log('开始处理 Excel 行...');
  let created = 0, notMatched = 0, pinNotFound = 0, skipped = 0;
  const errors = [];

  await runAsync('BEGIN TRANSACTION');

  try {
    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 1;
      const firstCell = String(row[0] ?? '').trim();
      if (firstCell.includes('填写说明') || firstCell.includes('示例')) { skipped++; continue; }

      const fromConn = getV(row, '连接器（从）');
      const fromPin = getV(row, '针孔号（从）');
      const toConn = getV(row, '连接器（到）');
      const toPin = getV(row, '针孔号（到）');

      if (!fromConn || !fromPin || !toConn || !toPin) { skipped++; continue; }

      // 查找 pin_id
      const pinIdA = pinMap.get(`${fromConn}|${fromPin}`);
      const pinIdB = pinMap.get(`${toConn}|${toPin}`);

      if (!pinIdA || !pinIdB) {
        pinNotFound++;
        if (!pinIdA) errors.push(`第${rowNum}行: pin 未找到 ${fromConn}-${fromPin}`);
        if (!pinIdB) errors.push(`第${rowNum}行: pin 未找到 ${toConn}-${toPin}`);
        continue;
      }

      // 查找同时包含两个 pin 的信号
      const epsA = epByPin.get(pinIdA) || [];
      const epsB = epByPin.get(pinIdB) || [];

      let matchedEpA = null, matchedEpB = null;
      for (const a of epsA) {
        for (const b of epsB) {
          if (a.signal_id === b.signal_id) {
            matchedEpA = a;
            matchedEpB = b;
            break;
          }
        }
        if (matchedEpA) break;
      }

      if (!matchedEpA || !matchedEpB) {
        notMatched++;
        if (errors.length < 50) errors.push(`第${rowNum}行: 未找到同时包含 ${fromConn}-${fromPin} 和 ${toConn}-${toPin} 的信号`);
        continue;
      }

      // 确定方向
      const dirRaw = getV(row, '信号方向（从）').toUpperCase();
      const direction = (dirRaw === 'BI-DIR' || dirRaw === 'BIDIR' || dirRaw === 'BI_DIR') ? 'bidirectional' : 'directed';

      // 插入 edge
      await runAsync(
        `INSERT INTO signal_edges (signal_id, from_endpoint_id, to_endpoint_id, direction, source_info)
         VALUES (?, ?, ?, ?, ?)`,
        [matchedEpA.signal_id, matchedEpA.ep_id, matchedEpB.ep_id, direction, `EICD总V2.xlsx / 第${rowNum}行`]
      );
      created++;

      if (created % 500 === 0) console.log(`  进度: ${created} edges...`);
    }

    await runAsync('COMMIT');
  } catch (err) {
    console.error('失败，回滚:', err.message);
    await runAsync('ROLLBACK');
    db.close();
    return;
  }

  // ── 统计 ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`完成！`);
  console.log(`  创建 edges: ${created}`);
  console.log(`  跳过（空行/说明行）: ${skipped}`);
  console.log(`  pin 未找到: ${pinNotFound}`);
  console.log(`  信号未匹配: ${notMatched}`);
  console.log(`${'='.repeat(50)}`);

  if (errors.length > 0) {
    console.log(`\n错误详情（前50条）:`);
    errors.slice(0, 50).forEach(e => console.log(`  ${e}`));
    if (errors.length > 50) console.log(`  ... 还有 ${errors.length - 50} 条`);
  }

  // 统计每个信号的 edge 数量分布
  const edgeStats = await queryAsync(
    `SELECT se.signal_id, COUNT(*) as edge_count
     FROM signal_edges se
     JOIN signals s ON se.signal_id = s.id
     WHERE s.project_id = ?
     GROUP BY se.signal_id`,
    [projectId]
  );
  const dist = {};
  for (const s of edgeStats) {
    const k = s.edge_count;
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log(`\n信号 edge 数量分布:`);
  Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([k, v]) => {
    console.log(`  ${k} 条 edge: ${v} 个信号`);
  });

  // 无 edge 的信号数
  const noEdge = await getAsync(
    `SELECT COUNT(*) as cnt FROM signals s
     WHERE s.project_id = ? AND NOT EXISTS (SELECT 1 FROM signal_edges e WHERE e.signal_id = s.id)`,
    [projectId]
  );
  console.log(`  无 edge: ${noEdge.cnt} 个信号`);

  db.close();
}

main().catch(err => { console.error(err); db.close(); });
