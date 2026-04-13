const sqlite3 = require('sqlite3');
const xlsx = require('xlsx');
const fs = require('fs');

// ══════════════════════════════════════════════════════════
// 配置：修改这里指定目标项目名称
// ══════════════════════════════════════════════════════════
const PROJECT_NAME = 'CE-25A测试';
// ══════════════════════════════════════════════════════════

const ERN_CONNS = ['8800G0000-TB1', '8800G0000-TB2'];
const SPECIAL_ERN_LIN = '8800G0000';

const db = new sqlite3.Database('../data/sqlite/eicd.db');

// ── 第1步：读取 Excel 建立端点对索引 ──
const workbook = xlsx.readFile('D:/Downloads/MBSE综合管理平台/EICD总V2.xlsx');
const sheetName = workbook.SheetNames.find(n => n.includes('电气接口清单'));
if (!sheetName) { console.error('未找到电气接口清单 Sheet'); process.exit(1); }
const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
const normH = h => String(h).replace(/[\r\n\t]+/g, '').trim();

// 列名映射（处理重复列名）
const colIdx = {};
const colIdx2 = {};
for (let ci = 0; ci < rawRows[0].length; ci++) {
  const h = normH(rawRows[0][ci]);
  if (h) {
    if (!(h in colIdx)) colIdx[h] = ci;
    else if (!(h in colIdx2)) colIdx2[h] = ci;
  }
}

// Excel 列名 → DB 列名映射
const EXCEL_SIG_FIELDS = [
  ['信号编号',               'unique_id'],
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

/** 从 Excel 行读取信号属性 + 信号方向（从） */
function readExcelRow(row) {
  const sigFields = {};
  for (const [excelCol, dbCol] of EXCEL_SIG_FIELDS) {
    const v = String(row[colIdx[excelCol] ?? -1] ?? '').trim();
    if (v) sigFields[dbCol] = v;
  }
  const direction = String(row[colIdx['信号方向（从）'] ?? -1] ?? '').trim().toUpperCase();
  return { sigFields, direction };
}

/** 根据信号方向和ERN在从/到的位置，计算两个端点的 input/output */
function resolveDirection(direction, ernIsSide) {
  // ernIsSide: 'from' 表示 ERN 在从端，'to' 表示 ERN 在到端
  let ernInput = 0, ernOutput = 0, otherInput = 0, otherOutput = 0;

  if (direction === 'BI-DIR' || direction === 'BIDIR' || direction === 'BI_DIR') {
    ernInput = 1; ernOutput = 1; otherInput = 1; otherOutput = 1;
  } else if (ernIsSide === 'from') {
    // 信号方向（从）描述的是"从"端点的方向
    if (direction === 'INPUT') {
      ernInput = 1; ernOutput = 0; otherInput = 0; otherOutput = 1;
    } else if (direction === 'OUTPUT') {
      ernInput = 0; ernOutput = 1; otherInput = 1; otherOutput = 0;
    }
  } else {
    // ERN 在到端，信号方向（从）描述的是非ERN端点（从端点）的方向
    if (direction === 'INPUT') {
      otherInput = 1; otherOutput = 0; ernInput = 0; ernOutput = 1;
    } else if (direction === 'OUTPUT') {
      otherInput = 0; otherOutput = 1; ernInput = 1; ernOutput = 0;
    }
  }

  return { ernInput, ernOutput, otherInput, otherOutput };
}

// ── 构建端点对索引 ──
// key = sorted("conn|pin||conn|pin") → { rowNum, sigFields, direction, fromKey, toKey }
const excelPairMap = {};
// 另建单端点索引：conn|pin → [{ rowNum, row }]，用于未匹配时回退查找
const excelSingleEpMap = {};

for (let i = 1; i < rawRows.length; i++) {
  const row = rawRows[i];
  const rowNum = i + 1;
  const fromConn = String(row[colIdx['连接器（从）']] ?? '').trim();
  const fromPin  = String(row[colIdx['针孔号（从）']] ?? '').trim();
  const toConn   = String(row[colIdx['连接器（到）']] ?? '').trim();
  const toPin    = String(row[colIdx['针孔号（到）']] ?? '').trim();

  if (fromConn && fromPin && toConn && toPin) {
    const fromKey = `${fromConn}|${fromPin}`;
    const toKey = `${toConn}|${toPin}`;
    const pairKey = [fromKey, toKey].sort().join('||');

    if (!excelPairMap[pairKey]) {
      const { sigFields, direction } = readExcelRow(row);
      excelPairMap[pairKey] = { rowNum, sigFields, direction, fromKey, toKey };
    }

    // 单端点索引
    if (!excelSingleEpMap[fromKey]) excelSingleEpMap[fromKey] = [];
    excelSingleEpMap[fromKey].push({ rowNum, row });
    if (!excelSingleEpMap[toKey]) excelSingleEpMap[toKey] = [];
    excelSingleEpMap[toKey].push({ rowNum, row });
  }
}

console.log('Excel 端点对总数:', Object.keys(excelPairMap).length);

// ── 第2步：按项目名称查找包含ERN端点的信号 ──
db.get(`SELECT id FROM projects WHERE name = ?`, [PROJECT_NAME], (err, proj) => {
  if (err || !proj) { console.error('项目不存在:', PROJECT_NAME); db.close(); return; }
  const projectId = proj.id;
  console.log(`项目: ${PROJECT_NAME} (id=${projectId})`);

  db.get(`SELECT id FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" = ?`, [projectId, SPECIAL_ERN_LIN], (err, ernDev) => {
    if (err || !ernDev) { console.error('该项目无ERN设备'); db.close(); return; }
    const ernDevId = ernDev.id;

    db.all(
      `SELECT DISTINCT se.signal_id FROM signal_endpoints se WHERE se.device_id = ?`,
      [ernDevId],
      (err, sigRows) => {
        if (err) { console.error(err); db.close(); return; }
        const SIGNAL_IDS = sigRows.map(r => r.signal_id);
        if (SIGNAL_IDS.length === 0) { console.log('未找到包含ERN端点的信号'); db.close(); return; }
        console.log(`找到 ${SIGNAL_IDS.length} 个包含ERN端点的信号: ${SIGNAL_IDS.join(', ')}`);

        const ph = SIGNAL_IDS.map(() => '?').join(',');
        db.all(
          `SELECT se.signal_id, se.endpoint_index, se.pin_id,
                  se."信号名称", se."信号定义", se."端接尺寸", se."input", se."output", se."备注" as ep_remark,
                  p."针孔号", p."屏蔽类型",
                  c."设备端元器件编号" as conn_num, c.id as connector_id,
                  d.id as device_id, d."设备编号", d."设备LIN号（DOORS）" as lin
           FROM signal_endpoints se
           JOIN devices d ON se.device_id = d.id
           LEFT JOIN pins p ON se.pin_id = p.id
           LEFT JOIN connectors c ON p.connector_id = c.id
           WHERE se.signal_id IN (${ph})
           ORDER BY se.signal_id, se.endpoint_index`,
          SIGNAL_IDS,
          async (err, endpoints) => {
            if (err) { console.error(err); db.close(); return; }

            // DB 查询 Promise 包装
            const dbGet = (sql, params) => new Promise((resolve, reject) => {
              db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
            });

            // ── 第3步：配对+匹配 ──
            const newSignals = [];
            let matchCount = 0, fallbackCount = 0, noMatchCount = 0;

            for (const sigId of SIGNAL_IDS) {
              const eps = endpoints.filter(e => e.signal_id === sigId);
              const ernEps = eps.filter(e => ERN_CONNS.includes(e.conn_num));
              const otherEps = eps.filter(e => !ERN_CONNS.includes(e.conn_num));

              if (ernEps.length === 0 || otherEps.length === 0) continue;

              console.log(`\n信号 ${sigId}: ERN锚点 ${ernEps.length} 个, 非ERN端点 ${otherEps.length} 个`);

              for (const ern of ernEps) {
                const ernKey = `${ern.conn_num}|${ern['针孔号']}`;

                for (const other of otherEps) {
                  const otherKey = `${other.conn_num}|${other['针孔号']}`;
                  const pairKey = [ernKey, otherKey].sort().join('||');
                  const excelMatch = excelPairMap[pairKey];

                  let sigFields, uniqueId, excelRow, ernInput, ernOutput, otherInput, otherOutput;

                  if (excelMatch) {
                    // ── 匹配到端点对 ──
                    matchCount++;
                    sigFields = { ...excelMatch.sigFields };
                    uniqueId = sigFields['unique_id'] || null;
                    delete sigFields['unique_id'];
                    excelRow = excelMatch.rowNum;

                    // 判断 ERN 在从端还是到端
                    const ernIsSide = (excelMatch.fromKey === ernKey) ? 'from' : 'to';
                    const dir = resolveDirection(excelMatch.direction, ernIsSide);
                    ernInput = dir.ernInput; ernOutput = dir.ernOutput;
                    otherInput = dir.otherInput; otherOutput = dir.otherOutput;

                  } else {
                    // ── 未匹配端点对：用非ERN端点单独查 Excel ──
                    const fallbackRows = excelSingleEpMap[otherKey];
                    if (fallbackRows && fallbackRows.length > 0) {
                      fallbackCount++;
                      const fbRow = fallbackRows[0].row;
                      const fbRowNum = fallbackRows[0].rowNum;
                      const { sigFields: fbSigFields, direction: fbDirection } = readExcelRow(fbRow);
                      sigFields = fbSigFields;
                      uniqueId = sigFields['unique_id'] || null;
                      delete sigFields['unique_id'];
                      excelRow = fbRowNum;

                      // 读取 Excel 行的两个端点
                      const fbFromConn = String(fbRow[colIdx['连接器（从）']] ?? '').trim();
                      const fbFromPin  = String(fbRow[colIdx['针孔号（从）']] ?? '').trim();
                      const fbFromLinNo = String(fbRow[colIdx2['设备（从）'] ?? -1] ?? '').trim();
                      const fbToConn   = String(fbRow[colIdx['连接器（到）']] ?? '').trim();
                      const fbToPin    = String(fbRow[colIdx['针孔号（到）']] ?? '').trim();
                      const fbToLinNo  = String(fbRow[colIdx2['设备（到）'] ?? -1] ?? '').trim();
                      const fbFromKey = `${fbFromConn}|${fbFromPin}`;

                      // 判断非ERN端点（other）在从端还是到端，另一端作为 endpoint1
                      let ep1Conn, ep1Pin, ep1LinNo, fromSide;
                      if (fbFromKey === otherKey) {
                        // other 是从端 → 另一端（到端）作为 endpoint1
                        ep1Conn = fbToConn; ep1Pin = fbToPin; ep1LinNo = fbToLinNo;
                        fromSide = 'other'; // 信号方向（从）描述的是 other(非ERN) 端
                      } else {
                        // other 是到端 → 另一端（从端）作为 endpoint1
                        ep1Conn = fbFromConn; ep1Pin = fbFromPin; ep1LinNo = fbFromLinNo;
                        fromSide = 'ep1'; // 信号方向（从）描述的是 ep1 端
                      }

                      // 计算方向：信号方向（从）描述的是"从"端点的方向
                      let ep1Input = 0, ep1Output = 0;
                      if (fromSide === 'ep1') {
                        // ep1 是从端
                        if (fbDirection === 'INPUT') { ep1Input = 1; otherInput = 0; otherOutput = 1; }
                        else if (fbDirection === 'OUTPUT') { ep1Output = 1; otherInput = 1; otherOutput = 0; }
                        else if (fbDirection.includes('BI')) { ep1Input = 1; ep1Output = 1; otherInput = 1; otherOutput = 1; }
                      } else {
                        // other 是从端
                        if (fbDirection === 'INPUT') { otherInput = 1; otherOutput = 0; ep1Input = 0; ep1Output = 1; }
                        else if (fbDirection === 'OUTPUT') { otherInput = 0; otherOutput = 1; ep1Input = 1; ep1Output = 0; }
                        else if (fbDirection.includes('BI')) { ep1Input = 1; ep1Output = 1; otherInput = 1; otherOutput = 1; }
                      }

                      // 从数据库查找 ep1 的 device_id 和 pin_id
                      const ep1Device = await dbGet(
                        `SELECT id, "设备编号" FROM devices WHERE project_id = ? AND "设备LIN号（DOORS）" = ?`,
                        [projectId, ep1LinNo]
                      );
                      let ep1DeviceId = null, ep1PinId = null, ep1DevName = ep1LinNo;
                      if (ep1Device) {
                        ep1DeviceId = ep1Device.id;
                        ep1DevName = ep1Device['设备编号'];
                        const ep1ConnRow = await dbGet(
                          `SELECT id FROM connectors WHERE device_id = ? AND "设备端元器件编号" = ?`,
                          [ep1Device.id, ep1Conn]
                        );
                        if (ep1ConnRow) {
                          const ep1PinRow = await dbGet(
                            `SELECT id FROM pins WHERE connector_id = ? AND "针孔号" = ?`,
                            [ep1ConnRow.id, ep1Pin]
                          );
                          ep1PinId = ep1PinRow?.id || null;
                        }
                      }

                      // endpoint1 用 Excel 行的另一个端点替换 ERN
                      newSignals.push({
                        project_id: projectId,
                        source_signal_id: sigId,
                        unique_id: uniqueId,
                        excel_row: excelRow,
                        sigFields,
                        fallback: true,
                        endpoint1: {
                          device_id: ep1DeviceId,
                          pin_id: ep1PinId,
                          conn: ep1Conn,
                          pin: ep1Pin,
                          device: ep1DevName,
                          信号名称: null,
                          信号定义: null,
                          端接尺寸: null,
                          屏蔽类型: null,
                          input: ep1Input,
                          output: ep1Output,
                          备注: null,
                        },
                        endpoint2: {
                          device_id: other.device_id,
                          pin_id: other.pin_id,
                          conn: other.conn_num,
                          pin: other['针孔号'],
                          device: other['设备编号'],
                          信号名称: other['信号名称'],
                          信号定义: other['信号定义'],
                          端接尺寸: other['端接尺寸'],
                          屏蔽类型: other['屏蔽类型'],
                          input: otherInput,
                          output: otherOutput,
                          备注: other.ep_remark,
                        },
                      });
                      continue; // 已 push，跳过下面的通用 push
                    } else {
                      noMatchCount++;
                      console.error(`  ✗ 错误: 端点 [${otherKey}] 设备${other['设备编号']} 在Excel中完全找不到，无法处理`);
                      continue; // 跳过此记录，不加入 newSignals
                    }
                  }

                  newSignals.push({
                    project_id: projectId,
                    source_signal_id: sigId,
                    unique_id: uniqueId,
                    excel_row: excelRow,
                    sigFields,
                    endpoint1: {
                      device_id: ern.device_id,
                      pin_id: ern.pin_id,
                      conn: ern.conn_num,
                      pin: ern['针孔号'],
                      device: ern['设备编号'],
                      信号名称: ern['信号名称'],
                      信号定义: ern['信号定义'],
                      端接尺寸: ern['端接尺寸'],
                      屏蔽类型: ern['屏蔽类型'],
                      input: ernInput,
                      output: ernOutput,
                      备注: ern.ep_remark,
                    },
                    endpoint2: {
                      device_id: other.device_id,
                      pin_id: other.pin_id,
                      conn: other.conn_num,
                      pin: other['针孔号'],
                      device: other['设备编号'],
                      信号名称: other['信号名称'],
                      信号定义: other['信号定义'],
                      端接尺寸: other['端接尺寸'],
                      屏蔽类型: other['屏蔽类型'],
                      input: otherInput,
                      output: otherOutput,
                      备注: other.ep_remark,
                    },
                  });
                }
              }
            }

            // ── 第4步：输出 ──
            console.log(`\n${'='.repeat(70)}`);
            console.log(`待创建新信号总数: ${newSignals.length}`);
            console.log(`  端点对匹配: ${matchCount}`);
            console.log(`  回退单端点匹配: ${fallbackCount}`);
            console.log(`  完全未匹配: ${noMatchCount}`);
            console.log(`${'='.repeat(70)}\n`);

            for (const sigId of SIGNAL_IDS) {
              const group = newSignals.filter(s => s.source_signal_id === sigId);
              if (group.length === 0) continue;
              console.log(`── 源信号 ${sigId} → ${group.length} 条新信号 ──`);
              console.log(`${'#'.padEnd(4)} ${'Unique ID'.padEnd(30)} ${'ERN端点'.padEnd(20)} ${'ERN IO'.padEnd(8)} ${'对端'.padEnd(25)} ${'对端IO'.padEnd(8)} ${'对端设备'.padEnd(15)} ${'Excel行'.padEnd(10)} ${'匹配方式'}`);
              for (let i = 0; i < group.length; i++) {
                const s = group[i];
                const uid = (s.unique_id || '(空)').substring(0, 28);
                const ep1 = `${s.endpoint1.conn}-${s.endpoint1.pin}`;
                const ep1IO = `${s.endpoint1.input ? 'I' : ''}${s.endpoint1.output ? 'O' : ''}` || '-';
                const ep2 = `${s.endpoint2.conn}-${s.endpoint2.pin}`;
                const ep2IO = `${s.endpoint2.input ? 'I' : ''}${s.endpoint2.output ? 'O' : ''}` || '-';
                const dev = s.endpoint2.device;
                const row = s.excel_row ? `第${s.excel_row}行` : '-';
                const matchType = s.excel_row ? (excelPairMap[[`${s.endpoint1.conn}|${s.endpoint1.pin}`, `${s.endpoint2.conn}|${s.endpoint2.pin}`].sort().join('||')] ? '端点对' : '回退') : '未匹配';
                console.log(`${String(i + 1).padEnd(4)} ${uid.padEnd(30)} ${ep1.padEnd(20)} ${ep1IO.padEnd(8)} ${ep2.padEnd(25)} ${ep2IO.padEnd(8)} ${dev.padEnd(15)} ${row.padEnd(10)} ${matchType}`);
              }
              console.log('');
            }

            fs.writeFileSync('tmp_split_data.json', JSON.stringify(newSignals, null, 2), 'utf-8');
            console.log('完整数据已保存到 server/tmp_split_data.json');

            db.close();
          }
        );
      }
    );
  });
});
