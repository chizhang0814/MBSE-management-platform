/**
 * 导出功能测试：下载项目数据 + WB导出
 * 验证：字段完整性、Excel格式、分组背景色、合并单元格
 * 账号：admin/123456
 */

const http = require('http');
const fs = require('fs');

const PROJECT_ID = 45;
let passed = 0, failed = 0;
const results = [];

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, 'http://localhost:3000');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        let json;
        if (ct.includes('json')) { try { json = JSON.parse(buf.toString()); } catch { json = { _raw: buf.toString().slice(0, 200) }; } }
        resolve({ status: res.statusCode, body: json, buffer: buf, contentType: ct, headers: res.headers });
      });
    });
    r.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}

function test(name, condition, detail) {
  if (condition) { passed++; results.push(`  ✓ ${name}`); }
  else { failed++; results.push(`  ✗ ${name} — ${detail || 'FAILED'}`); }
}

function section(name) { results.push(`\n── ${name} ──`); }

async function main() {
  console.log('=== 导出功能测试 ===\n');

  // 登录
  const loginRes = await req('POST', '/api/auth/login', { username: 'admin', password: '123456' });
  if (!loginRes.body?.token) { console.log('登录失败:', loginRes.body); return; }
  const token = loginRes.body.token;
  results.push('  ✓ admin 登录成功');
  passed++;

  // ════════════════════════════════════════
  // 1. 下载项目数据 — 字段完整性
  // ════════════════════════════════════════
  section('1. 下载项目数据字段');

  const dlRes = await req('GET', `/api/projects/${PROJECT_ID}/download?sheets=devices,connectors,signals`, null, token);
  test('下载项目数据 → 200', dlRes.status === 200, `status=${dlRes.status}`);
  test('返回xlsx格式', dlRes.contentType?.includes('spreadsheet') || dlRes.contentType?.includes('octet'), `ct=${dlRes.contentType}`);
  test('文件大小>0', dlRes.buffer.length > 1000, `size=${dlRes.buffer.length}`);

  // 用exceljs解析验证内容
  let workbook;
  try {
    const ExcelJS = require('exceljs');
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(dlRes.buffer);
    test('Excel可正常解析', true);
  } catch (e) {
    test('Excel可正常解析', false, e.message);
  }

  if (workbook) {
    // 设备表字段检查
    const devSheet = workbook.getWorksheet('ATA章节设备表');
    if (devSheet) {
      const devHeaders = [];
      devSheet.getRow(1).eachCell((cell) => devHeaders.push(String(cell.value)));
      test('设备表包含"设备等级"', devHeaders.includes('设备等级'), `headers=${devHeaders.join(',')}`);
      test('设备表包含"是否有特殊布线需求"', devHeaders.includes('是否有特殊布线需求'));
    } else { test('设备表Sheet存在', false); }

    // 连接器表字段检查
    const connSheet = workbook.getWorksheet('设备端元器件表');
    if (connSheet) {
      const connHeaders = [];
      connSheet.getRow(1).eachCell((cell) => connHeaders.push(String(cell.value)));
      test('连接器表包含"匹配的线束线型"', connHeaders.includes('匹配的线束线型'));
      test('连接器表包含"尾附件件号"', connHeaders.includes('尾附件件号'));
      test('连接器表包含"触件型号"', connHeaders.includes('触件型号'));
    } else { test('连接器表Sheet存在', false); }

    // 信号表字段检查
    const sigSheet = workbook.getWorksheet('电气接口数据表');
    if (sigSheet) {
      const sigHeaders = [];
      sigSheet.getRow(1).eachCell((cell) => sigHeaders.push(String(cell.value)));
      test('信号表包含"导线等级"', sigHeaders.includes('导线等级'));
      test('信号表包含"信号组"', sigHeaders.includes('信号组'));
      test('信号表包含"绞线组"', sigHeaders.includes('绞线组'));
      test('信号表包含"协议标识"', sigHeaders.includes('协议标识'));
      test('信号表包含"线类型"', sigHeaders.includes('线类型'));

      // 检查合并单元格
      const merges = sigSheet._merges || {};
      const mergeCount = Object.keys(merges).length;
      test('信号表有合并单元格', mergeCount > 0, `merges=${mergeCount}`);

      // 检查分组背景色（找一个有信号组的行）
      let hasBgColor = false;
      for (let r = 2; r <= Math.min(sigSheet.rowCount, 50); r++) {
        const cell = sigSheet.getRow(r).getCell(1);
        if (cell.value && cell.fill?.fgColor?.argb && cell.fill.fgColor.argb !== 'FFFFFFFF') {
          hasBgColor = true;
          break;
        }
      }
      test('信号表有分组背景色', hasBgColor);

      // 检查导线等级列有数据
      const gradeIdx = sigHeaders.indexOf('导线等级') + 1;
      if (gradeIdx > 0) {
        let hasGrade = false;
        for (let r = 2; r <= Math.min(sigSheet.rowCount, 100); r++) {
          const v = sigSheet.getRow(r).getCell(gradeIdx).value;
          if (v && String(v).includes('级')) { hasGrade = true; break; }
        }
        test('导线等级列有计算值', hasGrade);
      }
    } else { test('信号表Sheet存在', false); }
  }

  // ════════════════════════════════════════
  // 2. WB导出（export-pairs）
  // ════════════════════════════════════════
  section('2. WB导出');

  // 找两个有信号的设备
  const devRes = await req('GET', `/api/devices?projectId=${PROJECT_ID}&limit=5`, null, token);
  const deviceIds = (devRes.body?.devices || []).slice(0, 2).map(d => d.id);

  if (deviceIds.length < 2) {
    results.push('  ⚠ 设备不足2台，跳过WB导出测试');
  } else {
    const wbRes = await req('POST', '/api/signals/export-pairs', { projectId: PROJECT_ID, deviceIds }, token);
    test('WB导出 → 200', wbRes.status === 200, `status=${wbRes.status} body=${wbRes.body ? JSON.stringify(wbRes.body).slice(0,100) : ''}`);
    test('返回xlsx格式', wbRes.contentType?.includes('spreadsheet') || wbRes.contentType?.includes('octet'), `ct=${wbRes.contentType}`);
    test('文件大小>0', wbRes.buffer.length > 500, `size=${wbRes.buffer.length}`);

    // 解析WB导出的Excel
    let wbWorkbook;
    try {
      const ExcelJS = require('exceljs');
      wbWorkbook = new ExcelJS.Workbook();
      await wbWorkbook.xlsx.load(wbRes.buffer);
      test('WB Excel可正常解析', true);
    } catch (e) {
      test('WB Excel可正常解析', false, e.message);
    }

    if (wbWorkbook) {
      const ws = wbWorkbook.getWorksheet('电气接口数据表');
      test('WB导出Sheet名为"电气接口数据表"', !!ws);

      if (ws) {
        const wbHeaders = [];
        ws.getRow(1).eachCell((cell) => wbHeaders.push(String(cell.value)));

        // 列与项目下载完全一致
        test('WB包含"信号组"列', wbHeaders.includes('信号组'));
        test('WB包含"设备（从）"列', wbHeaders.includes('设备（从）'));
        test('WB包含"设备（到）"列', wbHeaders.includes('设备（到）'));
        test('WB包含"导线等级"列', wbHeaders.includes('导线等级'));
        test('WB包含"LIN号（从）"列', wbHeaders.includes('LIN号（从）'));

        // 样式检查
        const h1 = ws.getRow(1).getCell(1);
        test('WB表头有蓝色背景', h1.fill?.fgColor?.argb === 'FFD9E1F2', `fill=${h1.fill?.fgColor?.argb}`);
        test('WB表头字体粗体', h1.font?.bold === true);

        // 合并单元格
        const wbMerges = ws._merges || {};
        const wbMergeCount = Object.keys(wbMerges).length;
        // 如果数据量少可能没有可合并的
        if (ws.rowCount > 3) {
          test('WB有合并单元格', wbMergeCount > 0, `merges=${wbMergeCount} rows=${ws.rowCount}`);
        } else {
          results.push(`  ⚠ WB数据行少(${ws.rowCount})，跳过合并单元格检查`);
        }

        // 分组背景色
        let wbHasBg = false;
        for (let r = 2; r <= Math.min(ws.rowCount, 30); r++) {
          const cell = ws.getRow(r).getCell(1);
          if (cell.value && cell.fill?.fgColor?.argb && cell.fill.fgColor.argb !== 'FFFFFFFF') {
            wbHasBg = true; break;
          }
        }
        if (ws.rowCount > 2) {
          test('WB有分组背景色', wbHasBg);
        }
      }
    }
  }

  // ════════════════════════════════════════
  // 3. 连接类型筛选（前端改动，间接验证后端数据）
  // ════════════════════════════════════════
  section('3. 信号列表回归');
  const sigListRes = await req('GET', `/api/signals?projectId=${PROJECT_ID}&limit=5`, null, token);
  test('信号列表 → 200', sigListRes.status === 200);
  test('信号列表有数据', sigListRes.body?.signals?.length > 0);

  // 检查连接类型字段存在且不为undefined
  if (sigListRes.body?.signals?.[0]) {
    const s = sigListRes.body.signals[0];
    test('信号有连接类型字段', '连接类型' in s, `keys=${Object.keys(s).slice(0,10)}`);
  }

  // ════════════════════════════════════════
  // 4. RHI/互联点按钮隐藏不影响其他功能
  // ════════════════════════════════════════
  section('4. RHI状态API仍可用');
  const rhiRes = await req('GET', `/api/rhi/status/all?project_id=${PROJECT_ID}`, null, token);
  test('RHI status → 200', rhiRes.status === 200);

  // 结果
  console.log(results.join('\n'));
  console.log(`\n${'='.repeat(50)}`);
  console.log(`总计: ${passed + failed} | 通过: ${passed} | 失败: ${failed}`);
  console.log(`${'='.repeat(50)}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('脚本异常:', e); process.exit(1); });
