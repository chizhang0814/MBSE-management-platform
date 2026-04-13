const sqlite3 = require('sqlite3');
const fs = require('fs');

const db = new sqlite3.Database('../data/sqlite/eicd.db');
const data = JSON.parse(fs.readFileSync('tmp_split_data.json', 'utf-8'));

// 分为两组：ERN记录（endpoint1是ERN）和非ERN记录（回退，两端都不是ERN）
const ernRecords = data.filter(d => !d.fallback);
const fallbackRecords = data.filter(d => d.fallback);

console.log(`待处理: ${data.length} 条 (ERN: ${ernRecords.length}, 回退: ${fallbackRecords.length})`);

const SIG_SKIP = new Set(['id', 'project_id', 'unique_id', 'status', 'created_at', 'updated_at',
  'import_conflicts', 'import_status', 'version', 'created_by']);

function runAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function insertSignal(item) {
  const { project_id, unique_id, sigFields, endpoint1, endpoint2 } = item;

  const cols = [];
  const vals = [];

  cols.push('"unique_id"');
  vals.push(unique_id || null);

  for (const [k, v] of Object.entries(sigFields)) {
    if (SIG_SKIP.has(k) || k === 'unique_id') continue;
    cols.push(`"${k}"`);
    vals.push(v);
  }

  cols.push('"status"', '"created_by"');
  vals.push('Active', 'system_split');

  const placeholders = cols.map(() => '?').join(', ');
  const sigResult = await runAsync(
    `INSERT INTO signals (project_id, ${cols.join(', ')}) VALUES (?, ${placeholders})`,
    [project_id, ...vals]
  );
  const newSignalId = sigResult.lastID;

  await runAsync(
    `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "信号名称", "信号定义", "端接尺寸", "input", "output", "备注")
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [newSignalId, endpoint1.device_id, endpoint1.pin_id,
     endpoint1['信号名称'] || null, endpoint1['信号定义'] || null, endpoint1['端接尺寸'] || null,
     endpoint1.input || 0, endpoint1.output || 0, endpoint1['备注'] || null]
  );

  await runAsync(
    `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "信号名称", "信号定义", "端接尺寸", "input", "output", "备注")
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    [newSignalId, endpoint2.device_id, endpoint2.pin_id,
     endpoint2['信号名称'] || null, endpoint2['信号定义'] || null, endpoint2['端接尺寸'] || null,
     endpoint2.input || 0, endpoint2.output || 0, endpoint2['备注'] || null]
  );

  return newSignalId;
}

async function execute() {
  let created = 0, removed = 0, skipped = 0;

  await runAsync('BEGIN TRANSACTION');

  try {
    // ── 第一阶段：处理 ERN 记录 ──
    console.log(`\n── 第一阶段：处理 ${ernRecords.length} 条 ERN 记录 ──`);
    for (let i = 0; i < ernRecords.length; i++) {
      const item = ernRecords[i];

      await insertSignal(item);

      // 从源信号删除非ERN端点
      const delResult = await runAsync(
        `DELETE FROM signal_endpoints WHERE signal_id = ? AND pin_id = ?`,
        [item.source_signal_id, item.endpoint2.pin_id]
      );
      removed += delResult.changes;

      created++;
      if (created % 50 === 0) console.log(`  进度: ${created}/${ernRecords.length}`);
    }
    console.log(`  ERN 阶段完成: 新建 ${created}, 删除端点 ${removed}`);

    // ── 第二阶段：处理回退记录（两端都不是ERN）──
    console.log(`\n── 第二阶段：处理 ${fallbackRecords.length} 条回退记录 ──`);
    let fbCreated = 0, fbMerged = 0;

    // 查找占用某 pin_id 的非ERN信号（排除包含ERN端点的信号和指定的排除信号）
    const NON_ERN_SQL = `
      SELECT DISTINCT se.signal_id, s.unique_id
      FROM signal_endpoints se
      JOIN signals s ON se.signal_id = s.id
      WHERE se.pin_id = ? AND s.project_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM signal_endpoints se2
        JOIN devices d2 ON se2.device_id = d2.id
        WHERE se2.signal_id = se.signal_id AND d2."设备LIN号（DOORS）" = '8800G0000'
      )`;

    for (let i = 0; i < fallbackRecords.length; i++) {
      const item = fallbackRecords[i];
      const { endpoint1, endpoint2, source_signal_id, project_id } = item;

      // 查 endpoint1 是否被非ERN信号占用
      let signalA = null; // 占用 ep1 的非ERN信号
      if (endpoint1.pin_id) {
        const ep1Owners = await queryAsync(NON_ERN_SQL, [endpoint1.pin_id, project_id]);
        if (ep1Owners.length > 0) signalA = ep1Owners[0];
      }

      if (signalA) {
        // endpoint1 已被 signalA 占用 → 检查 endpoint2
        let signalB = null; // 占用 ep2 的非ERN信号（排除 signalA 和源信号）
        if (endpoint2.pin_id) {
          const ep2Owners = await queryAsync(
            NON_ERN_SQL + ` AND se.signal_id != ? AND se.signal_id != ?`,
            [endpoint2.pin_id, project_id, signalA.signal_id, source_signal_id]
          );
          if (ep2Owners.length > 0) signalB = ep2Owners[0];
        }

        if (signalB) {
          // ── 三方组网：signalA + signalB + 当前记录 ──
          // 以 ID 最小的为主信号
          const primaryId = Math.min(signalA.signal_id, signalB.signal_id);
          const secondaryId = Math.max(signalA.signal_id, signalB.signal_id);

          // 收集主信号已有 pin_id
          const primaryPins = await queryAsync(
            `SELECT pin_id FROM signal_endpoints WHERE signal_id = ? AND pin_id IS NOT NULL`, [primaryId]
          );
          const primaryPinSet = new Set(primaryPins.map(p => p.pin_id));

          // 迁移次信号端点到主信号（去重）
          const secEps = await queryAsync(`SELECT * FROM signal_endpoints WHERE signal_id = ?`, [secondaryId]);
          const maxIdxRow = await queryAsync(`SELECT MAX(endpoint_index) as m FROM signal_endpoints WHERE signal_id = ?`, [primaryId]);
          let nextIdx = ((maxIdxRow[0]?.m) ?? -1) + 1;

          for (const sep of secEps) {
            if (sep.pin_id && primaryPinSet.has(sep.pin_id)) continue;
            await runAsync(
              `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "端接尺寸", "信号名称", "信号定义", "input", "output", "备注")
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [primaryId, sep.device_id, sep.pin_id, nextIdx++,
               sep['端接尺寸'] || null, sep['信号名称'] || null, sep['信号定义'] || null, sep.input || 0, sep.output || 0, sep['备注'] || null]
            );
            if (sep.pin_id) primaryPinSet.add(sep.pin_id);
          }

          // 删除次信号
          await runAsync(`DELETE FROM signal_endpoints WHERE signal_id = ?`, [secondaryId]);
          await runAsync(`DELETE FROM signals WHERE id = ?`, [secondaryId]);

          // 添加当前记录中不重复的端点
          for (const ep of [endpoint1, endpoint2]) {
            if (ep.pin_id && !primaryPinSet.has(ep.pin_id)) {
              await runAsync(
                `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "信号名称", "信号定义", "端接尺寸", "input", "output", "备注")
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [primaryId, ep.device_id, ep.pin_id, nextIdx++,
                 ep['信号名称'] || null, ep['信号定义'] || null, ep['端接尺寸'] || null, ep.input || 0, ep.output || 0, ep['备注'] || null]
              );
              primaryPinSet.add(ep.pin_id);
            }
          }

          // 从源信号删除 endpoint2
          const delResult = await runAsync(
            `DELETE FROM signal_endpoints WHERE signal_id = ? AND pin_id = ?`,
            [source_signal_id, endpoint2.pin_id]
          );
          removed += delResult.changes;

          fbMerged++;
          console.log(`  ✓ 三方组网: signalA=${signalA.signal_id}(${signalA.unique_id}) + signalB=${secondaryId}(${signalB.unique_id}) + [${endpoint1.conn}-${endpoint1.pin} ↔ ${endpoint2.conn}-${endpoint2.pin}] → 主信号 ${primaryId}`);

        } else {
          // ── 双方组网：signalA + 当前记录的 endpoint2 ──
          const primaryPins = await queryAsync(
            `SELECT pin_id FROM signal_endpoints WHERE signal_id = ? AND pin_id IS NOT NULL`, [signalA.signal_id]
          );
          const primaryPinSet = new Set(primaryPins.map(p => p.pin_id));

          const maxIdxRow = await queryAsync(`SELECT MAX(endpoint_index) as m FROM signal_endpoints WHERE signal_id = ?`, [signalA.signal_id]);
          let nextIdx = ((maxIdxRow[0]?.m) ?? -1) + 1;

          // 添加 endpoint2（如果不重复）
          if (endpoint2.pin_id && !primaryPinSet.has(endpoint2.pin_id)) {
            await runAsync(
              `INSERT INTO signal_endpoints (signal_id, device_id, pin_id, endpoint_index, "信号名称", "信号定义", "端接尺寸", "input", "output", "备注")
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [signalA.signal_id, endpoint2.device_id, endpoint2.pin_id, nextIdx++,
               endpoint2['信号名称'] || null, endpoint2['信号定义'] || null, endpoint2['端接尺寸'] || null, endpoint2.input || 0, endpoint2.output || 0, endpoint2['备注'] || null]
            );
          }

          // 从源信号删除 endpoint2
          const delResult = await runAsync(
            `DELETE FROM signal_endpoints WHERE signal_id = ? AND pin_id = ?`,
            [source_signal_id, endpoint2.pin_id]
          );
          removed += delResult.changes;

          fbMerged++;
          console.log(`  ✓ 双方组网: signalA=${signalA.signal_id}(${signalA.unique_id}) + ep2[${endpoint2.conn}-${endpoint2.pin}] → 信号 ${signalA.signal_id}`);
        }

      } else {
        // endpoint1 未被占用 → 正常新建信号
        await insertSignal(item);

        const delResult = await runAsync(
          `DELETE FROM signal_endpoints WHERE signal_id = ? AND pin_id = ?`,
          [source_signal_id, endpoint2.pin_id]
        );
        removed += delResult.changes;

        fbCreated++;
        created++;
        console.log(`  ✓ 新建: [${endpoint1.conn}-${endpoint1.pin} ↔ ${endpoint2.conn}-${endpoint2.pin}]`);
      }
    }
    console.log(`  回退阶段完成: 新建 ${fbCreated}, 组网 ${fbMerged}, 跳过 ${skipped}`);

    await runAsync('COMMIT');
    console.log(`\n══ 全部完成 ══`);
    console.log(`  新建信号: ${created}`);
    console.log(`  从源信号删除端点: ${removed}`);
    console.log(`  跳过（pin冲突）: ${skipped}`);

    // 检查源信号剩余端点
    const sourceIds = [...new Set(data.map(d => d.source_signal_id))];
    db.all(
      `SELECT se.signal_id, COUNT(*) as cnt
       FROM signal_endpoints se
       WHERE se.signal_id IN (${sourceIds.join(',')})
       GROUP BY se.signal_id`,
      (err, rows) => {
        console.log(`\n源信号剩余端点:`);
        for (const r of rows) {
          console.log(`  信号 ${r.signal_id}: ${r.cnt} 个端点`);
        }
        db.close();
      }
    );

  } catch (err) {
    console.error('执行失败，回滚:', err.message);
    await runAsync('ROLLBACK');
    db.close();
  }
}

execute();
