/**
 * 信号连接类型/协议标识推断 + 分组候选脚本
 * 用法: node tmp_infer_groups.cjs [project_id]
 * 默认 project_id = 44 (CE-25A X号机)
 */
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const db = new sqlite3.Database('./data/sqlite/eicd.db');

const PROJECT_ID = parseInt(process.argv[2]) || 44;

// ── 第一步：推断连接类型 ──

function inferConnType(sigNames) {
  // sigNames: 该信号所有端点的信号名称数组
  const all = sigNames.join(' ').toUpperCase();

  // 优先级1: ARINC 429
  if (/A429|ARINC\s*429|(?<!\w)429(?!\d)/.test(all) && !/RS429/.test(all)) return 'ARINC 429';

  // 优先级2: CAN Bus
  if (/CAN[_\s]?H|CAN[_\s]?L|CANH|CANL|CAN\d?_GND|CAN\d?_H|CAN\d?_L/.test(all)) return 'CAN Bus';

  // 优先级3: RS-422
  if (/RS[-_]?422|(?<!\w)422_/.test(all) && /_(HI|LO|POSITIVE|NEGATIVE|SIGNALGND|A\b|B\b)|TX[+-]|RX[+-]/i.test(all)) return 'RS-422';

  // 优先级4: RS-485
  if (/RS[-_]?485|(?<!\w)485_/.test(all)) return 'RS-485';

  // 优先级5: RS-232
  if (/RS[-_]?232|(?<!\w)232_/.test(all) && /_(TX|RX)\b/.test(all)) return 'RS-232';

  // 优先级6: 以太网
  if (/\bETH/.test(all) && /_(TH|TL|RH|RL|0P|0N|1P|1N|2P|2N|3P|3N)\b/.test(all)) return '以太网';

  // 优先级7: 电源（高压）
  if (/270V|115VAC/.test(all)) return '电源（高压）';

  // 优先级8: 电源（低压）— 28V 相关且有电源特征后缀
  if (/28V|\+28VDC/.test(all) && /_(PWR|RTN|POWER|RETURN)\b|[+-]$/.test(all)) return '电源（低压）';

  // 优先级9: 模拟量 (RVDT/LVDT)
  if (/RVDT|LVDT/.test(all) && /_(EXCITATION|CENTER|HIGH|LOW|RETURN)\b/.test(all)) return '模拟量';

  // 优先级10: Discrete
  if (/_(CTRL|DISC|STATUS|ACT|WOW|BUS)\s*$/i.test(all)) return 'Discrete';

  return null; // 不确定
}

// ── 第二步：推断协议标识 ──

function inferProtocol(connType, sigName) {
  const n = sigName.toUpperCase().trim();

  if (connType === 'ARINC 429') {
    // Positive: +结尾, _P, _HI(后缀或中间), _RH, _H(后缀), _A/_1A, 空格A结尾, CH*A, DATA +
    if (/[+]$|_P\b|_P\d|_HI_|_HI\b|_RH\b|_H\b|_POSITIVE|DATA\s*\+|CH\d?\s*A\b|[_\s]A$|_\d+A$|[_\s]\d+A$/.test(n)) return 'A429_Positive';
    // Negative: -结尾, _N, _LO(后缀或中间), _RL, _L(后缀), _B/_1B, 空格B结尾, CH*B, DATA -
    if (/[-]$|_N\b|_N\d|_LO_|_LO\b|_RL\b|_L\b|_NEGATIVE|DATA\s*-|CH\d?\s*B\b|[_\s]B$|_\d+B$|[_\s]\d+B$/.test(n)) return 'A429_Negative';
    return null;
  }
  if (connType === 'CAN Bus') {
    if (/_H\b|_CANH|CAN\d?_H|CAN\s+HIGH/.test(n)) return 'CAN_High';
    if (/_L\b|_CANL|CAN\d?_L|CAN\s+LOW/.test(n)) return 'CAN_Low';
    if (/_GND|CAN\d?_GND/.test(n)) return 'CAN_Gnd';
    return null;
  }
  if (connType === 'RS-422') {
    if (/_HI_|_HI\b|_A\b|_POSITIVE|[+]$/.test(n)) return 'RS-422_A';
    if (/_LO_|_LO\b|_B\b|_NEGATIVE|[-]$/.test(n)) return 'RS-422_B';
    if (/_GND|_SIGNALGND/.test(n)) return 'RS-422_Gnd';
    return null;
  }
  if (connType === 'RS-485') {
    if (/_A\b|_A\d/.test(n)) return 'RS-485_A';
    if (/_B\b|_B\d/.test(n)) return 'RS-485_B';
    if (/_GND/.test(n)) return 'RS-485_Gnd';
    return null;
  }
  if (connType === '电源（高压）') {
    if (/_POS\b|_P\b|[+]$|_L\b|火线|正极/.test(n)) return '电源（高压）正极';
    if (/_NEG\b|_N\b|[-]$|_RETURN|零线|负极|地线/.test(n)) return '电源（高压）负极';
    return null;
  }
  if (connType === '电源（低压）') {
    if (/[+]$|_PWR\b|_POWER\b|_P\b|_POS\b|正极|火线/.test(n)) return '电源（低压）正极';
    if (/[-]$|_RTN\b|_RETURN\b|_N\b|_NEG\b|_GND\b|负极|零线|地线/.test(n)) return '电源（低压）负极';
    return null;
  }
  return null;
}

// ── 第三步：推断线类型 ──

function inferLineType(connType) {
  if (!connType) return null;
  if (connType === '电源（低压）' || connType === '电源（高压）') return '功率线';
  return '信号线';
}

// ── 主逻辑 ──

db.all(`
  SELECT s.id, s.unique_id, s."连接类型" as conn_type, s."协议标识" as proto,
         s."线类型" as line_type, s.signal_group,
         GROUP_CONCAT(se."信号名称", '||') as all_names,
         GROUP_CONCAT(p."针孔号", '||') as all_pins,
         GROUP_CONCAT(c."设备端元器件编号", '||') as all_conns,
         GROUP_CONCAT(d."设备编号", '||') as all_devs
  FROM signals s
  LEFT JOIN signal_endpoints se ON se.signal_id = s.id
  LEFT JOIN pins p ON se.pin_id = p.id
  LEFT JOIN connectors c ON p.connector_id = c.id
  LEFT JOIN devices d ON se.device_id = d.id
  WHERE s.project_id = ?
  GROUP BY s.id
  ORDER BY s.unique_id
`, [PROJECT_ID], (err, rows) => {
  if (err) { console.error(err); db.close(); return; }

  const output = [];
  const stats = { total: 0, inferred_type: 0, inferred_proto: 0, already_typed: 0, candidates: 0 };

  // 推断结果收集
  const inferred = []; // { id, unique_id, conn_type, proto, line_type, confidence, names }

  for (const r of rows) {
    stats.total++;
    const names = (r.all_names || '').split('||').filter(Boolean);
    const existingType = r.conn_type || '';
    const existingProto = r.proto || '';

    if (existingType) {
      stats.already_typed++;
      // 已有连接类型，只推断缺失的协议标识（遍历所有端点名称，取第一个匹配）
      if (!existingProto && names.length > 0) {
        let proto = null;
        for (const nm of names) { proto = inferProtocol(existingType, nm); if (proto) break; }
        if (proto) {
          inferred.push({
            id: r.id, unique_id: r.unique_id,
            conn_type: existingType, proto, line_type: inferLineType(existingType),
            action: '补充协议标识', names: names.slice(0, 2).join(' / ')
          });
          stats.inferred_proto++;
        }
      }
      continue;
    }

    // 连接类型为空，尝试推断
    if (names.length === 0) continue;
    const ct = inferConnType(names);
    if (!ct) continue;

    stats.inferred_type++;
    let proto = null;
    for (const nm of names) { proto = inferProtocol(ct, nm); if (proto) break; }
    if (proto) stats.inferred_proto++;

    inferred.push({
      id: r.id, unique_id: r.unique_id,
      conn_type: ct, proto: proto || '(无法推断)',
      line_type: inferLineType(ct),
      action: '推断连接类型+协议标识',
      names: names.slice(0, 2).join(' / '),
      pins: (r.all_pins || '').split('||').slice(0, 2).join(', '),
      conns: (r.all_conns || '').split('||').slice(0, 2).join(', ')
    });
  }

  // ── 第四步：分组候选 ──
  // 从已推断+已有数据中，找同连接器+同连接类型+协议标识互补的信号
  // 重新查一遍带连接器信息的
  db.all(`
    SELECT s.id, s.unique_id, s."连接类型" as conn_type, s."协议标识" as proto,
           s.signal_group, se."信号名称" as sig_name,
           c.id as cid, c."设备端元器件编号" as conn_comp, p."针孔号" as pin
    FROM signals s
    JOIN signal_endpoints se ON se.signal_id = s.id
    LEFT JOIN pins p ON se.pin_id = p.id
    LEFT JOIN connectors c ON p.connector_id = c.id
    WHERE s.project_id = ? AND c.id IS NOT NULL
    ORDER BY c."设备端元器件编号", p."针孔号"
  `, [PROJECT_ID], (err2, epRows) => {
    if (err2) { console.error(err2); db.close(); return; }

    // 合并推断结果（模拟已写入）
    const inferredMap = {};
    for (const inf of inferred) {
      inferredMap[inf.id] = { conn_type: inf.conn_type, proto: inf.proto };
    }

    // 按连接器+连接类型分桶
    const buckets = {};
    for (const ep of epRows) {
      const ct = ep.conn_type || (inferredMap[ep.id]?.conn_type) || '';
      const proto = ep.proto || (inferredMap[ep.id]?.proto) || '';
      if (!ct || !proto || proto === '(无法推断)') continue;

      const key = ep.conn_comp + '|' + ct;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push({ ...ep, inferred_ct: ct, inferred_proto: proto });
    }

    // 分组定义（required: 必须, optional: 可选）
    const GROUP_DEFS = {
      'ARINC 429': { required: ['A429_Positive', 'A429_Negative'], optional: [] },
      'CAN Bus': { required: ['CAN_High', 'CAN_Low', 'CAN_Gnd'], optional: [] },
      'RS-422': { required: ['RS-422_A', 'RS-422_B'], optional: ['RS-422_Gnd'] },
      'RS-485': { required: ['RS-485_A', 'RS-485_B'], optional: ['RS-485_Gnd'] },
      '电源（低压）': { required: ['电源（低压）正极', '电源（低压）负极'], optional: [] },
      '电源（高压）': { required: ['电源（高压）正极', '电源（高压）负极'], optional: [] },
    };

    const groupCandidates = [];

    for (const [key, eps] of Object.entries(buckets)) {
      const [conn, ct] = key.split('|');
      const def = GROUP_DEFS[ct];
      if (!def) continue;

      // 去重（同一信号可能有多个端点在同一连接器上）
      const sigMap = {};
      for (const ep of eps) {
        if (!sigMap[ep.id]) sigMap[ep.id] = ep;
      }
      const uniqueSigs = Object.values(sigMap);

      const allProtos = [...def.required, ...def.optional];
      const minCount = def.required.length;
      const maxCount = allProtos.length;
      if (uniqueSigs.length < minCount) continue;

      // 尝试按信号名称共干分子组
      const byStem = {};
      for (const sig of uniqueSigs) {
        const name = (sig.sig_name || '').toUpperCase();
        // 去掉协议后缀得到共干（英文+中文后缀）
        const stem = name
          .replace(/[_\s]*(CAN[_\s]?GND|CAN[_\s]?HIGH|CAN[_\s]?LOW|CANH|CANL|CAN\d?_H|CAN\d?_L|CAN\d?_GND)$/i, '')  // CAN 复合后缀优先
          .replace(/[_\s]*(POSITIVE|NEGATIVE|HIGH|LOW|HI|LO|GND|SIGNALGND\d*|[+-])$/i, '')
          .replace(/[_\s]+\d*[ABHL]$/i, '')  // 空格或下划线 + 可选数字 + 单字母 A/B/H/L 结尾
          .replace(/[_\s](HI|LO)[_\s].*$/i, '')  // _HI_xxx / _LO_xxx 中间位置
          .replace(/(正极|负极|火线|零线|地线|屏蔽|正|负)$/, '')
          .replace(/[_\s]+$/, '');
        if (!byStem[stem]) byStem[stem] = [];
        byStem[stem].push(sig);
      }

      for (const [stem, sigs] of Object.entries(byStem)) {
        if (sigs.length < minCount || sigs.length > maxCount) continue;

        // 检查协议标识是否互补（必须包含所有 required，不能有 allProtos 之外的）
        const protos = sigs.map(s => s.inferred_proto || s.proto);
        const hasAllRequired = def.required.every(p => protos.includes(p));
        const noExtra = protos.every(p => allProtos.includes(p));
        const alreadyGrouped = sigs.some(s => s.signal_group);

        if (hasAllRequired && noExtra) {
          groupCandidates.push({
            connector: conn,
            type: ct,
            stem: stem || '(空)',
            confidence: '高（同连接器+名称共干+协议互补）',
            already_grouped: alreadyGrouped,
            signals: sigs.map(s => ({
              id: s.id, unique_id: s.unique_id,
              proto: s.inferred_proto || s.proto,
              name: s.sig_name, pin: s.pin,
              group: s.signal_group || '(无)'
            }))
          });
        }
      }

      // 如果按名称共干没找到，尝试只按协议标识互补
      if (!Object.values(byStem).some(s => s.length >= minCount)) {
        const protos = uniqueSigs.map(s => s.inferred_proto || s.proto);
        const hasAllRequired = def.required.every(p => protos.includes(p));
        if (hasAllRequired && uniqueSigs.length >= minCount) {
          // 优先取 required，再取 optional
          const picked = [];
          for (const p of allProtos) {
            const sig = uniqueSigs.find(s => (s.inferred_proto || s.proto) === p && !picked.includes(s));
            if (sig) picked.push(sig);
          }
          if (picked.length >= minCount) {
            const alreadyGrouped = picked.some(s => s.signal_group);
            groupCandidates.push({
              connector: conn,
              type: ct,
              stem: '(无共干)',
              confidence: '中（同连接器+协议互补，名称不同干）',
              already_grouped: alreadyGrouped,
              signals: picked.map(s => ({
                id: s.id, unique_id: s.unique_id,
                proto: s.inferred_proto || s.proto,
                name: s.sig_name, pin: s.pin,
                group: s.signal_group || '(无)'
              }))
            });
          }
        }
      }
    }

    // ── 输出报告 ──
    const report = [];
    report.push('=' .repeat(120));
    report.push(`信号推断与分组候选报告 — 项目ID: ${PROJECT_ID}`);
    report.push(`总信号数: ${stats.total} | 已有连接类型: ${stats.already_typed} | 推断出连接类型: ${stats.inferred_type}`);
    report.push('=' .repeat(120));

    report.push('\n## 一、推断结果（连接类型/协议标识）\n');
    // 按推断的连接类型分组显示
    const byType = {};
    for (const inf of inferred) {
      if (!byType[inf.conn_type]) byType[inf.conn_type] = [];
      byType[inf.conn_type].push(inf);
    }
    for (const [ct, items] of Object.entries(byType).sort()) {
      report.push(`### ${ct}（${items.length}条）`);
      report.push('  unique_id | 协议标识 | 线类型 | 信号名称');
      report.push('  ' + '-'.repeat(100));
      for (const it of items.slice(0, 30)) {
        report.push(`  ${(it.unique_id||'').substring(0,30).padEnd(32)} | ${(it.proto||'').padEnd(18)} | ${(it.line_type||'').padEnd(6)} | ${(it.names||'').substring(0,50)}`);
      }
      if (items.length > 30) report.push(`  ... 还有 ${items.length - 30} 条`);
      report.push('');
    }

    report.push('\n## 二、分组候选\n');
    const newCandidates = groupCandidates.filter(g => !g.already_grouped);
    const existingGroups = groupCandidates.filter(g => g.already_grouped);

    report.push(`新候选组: ${newCandidates.length} | 已分组（验证）: ${existingGroups.length}\n`);

    for (const g of newCandidates) {
      report.push(`--- 候选组 [${g.type}] 置信度: ${g.confidence}`);
      report.push(`    连接器: ${g.connector}  名称共干: ${g.stem}`);
      for (const s of g.signals) {
        report.push(`    信号ID:${s.id}  ${(s.unique_id||'').substring(0,25).padEnd(27)} pin=${(s.pin||'-').padEnd(6)} proto=${s.proto.padEnd(18)} name=${(s.name||'').substring(0,35)}`);
      }
      report.push('');
    }

    if (existingGroups.length > 0) {
      report.push('\n### 已分组信号（验证一致性）\n');
      for (const g of existingGroups) {
        report.push(`--- [${g.type}] 连接器: ${g.connector}  共干: ${g.stem}`);
        for (const s of g.signals) {
          report.push(`    ${(s.unique_id||'').substring(0,25).padEnd(27)} proto=${s.proto.padEnd(18)} group=${s.group}`);
        }
        report.push('');
      }
    }

    const BOM = '\uFEFF';
    const outPath = 'd:/tmp/信号推断与分组报告.txt';
    fs.writeFileSync(outPath, BOM + report.join('\n'), 'utf8');
    console.log(report.join('\n'));
    console.log('\n报告已保存到: ' + outPath);
    db.close();
  });
});
