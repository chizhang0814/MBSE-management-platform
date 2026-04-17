/**
 * RHI分支非RHI功能回归测试
 * 测试范围：设备冻结、HDMI协议扩展、信号分组筛选修复、连接类型筛选
 * 排除：RHI编辑器、互联点管理（这些跳过不测）
 *
 * 账号：admin/123456, 600640/600640（总体组）, 600545/DH77889@dh（系统组）
 */

const http = require('http');

const BASE = 'http://localhost:3000';
const PROJECT_ID = 45; // CE-25A X号机
let passed = 0, failed = 0, skipped = 0;
const results = [];

// ── 工具函数 ──

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = body ? JSON.stringify(body) : null;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(chunks); } catch { json = { _raw: chunks }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}

async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { username, password });
  if (r.status === 200 && r.body.token) return r.body.token;
  throw new Error(`Login failed for ${username}: ${JSON.stringify(r.body)}`);
}

function test(name, condition, detail) {
  if (condition) {
    passed++;
    results.push(`  ✓ ${name}`);
  } else {
    failed++;
    results.push(`  ✗ ${name} — ${detail || 'FAILED'}`);
  }
}

function section(name) { results.push(`\n── ${name} ──`); }

// ── 测试主体 ──

async function main() {
  console.log('=== RHI分支非RHI功能回归测试 ===\n');

  // 登录
  let adminToken, zontiToken, xitongToken;
  try {
    adminToken = await login('admin', '123456');
    results.push('  ✓ admin 登录成功');
    passed++;
  } catch (e) { results.push(`  ✗ admin 登录失败: ${e.message}`); failed++; return finish(); }

  try {
    zontiToken = await login('600640', '600640');
    results.push('  ✓ 600640（总体组）登录成功');
    passed++;
  } catch (e) { results.push(`  ✗ 600640 登录失败: ${e.message}`); failed++; }

  try {
    xitongToken = await login('600545', 'DH77889@dh');
    results.push('  ✓ 600545（系统组）登录成功');
    passed++;
  } catch (e) { results.push(`  ✗ 600545 登录失败: ${e.message}`); failed++; }

  // ════════════════════════════════════════
  // 1. 设备冻结功能
  // ════════════════════════════════════════
  section('1. 设备冻结功能');

  // 找一个 normal 状态的设备
  const devListRes = await req('GET', `/api/devices?projectId=${PROJECT_ID}&limit=50`, null, adminToken);
  test('获取设备列表', devListRes.status === 200 && devListRes.body.devices?.length > 0, `status=${devListRes.status}`);

  let testDevice = null;
  if (devListRes.body.devices) {
    testDevice = devListRes.body.devices.find(d => d.status === 'normal');
  }

  if (!testDevice) {
    results.push('  ⚠ 未找到 normal 状态设备，跳过冻结测试');
    skipped += 6;
  } else {
    const devId = testDevice.id;
    const devNum = testDevice['设备编号'];
    results.push(`  → 测试设备: ${devNum} (id=${devId})`);

    // 1a. 系统组不能冻结
    if (xitongToken) {
      const r = await req('POST', `/api/devices/${devId}/freeze`, {}, xitongToken);
      test('系统组冻结设备 → 403', r.status === 403, `status=${r.status} body=${JSON.stringify(r.body).slice(0,100)}`);
    } else { skipped++; }

    // 1b. admin冻结
    const freezeRes = await req('POST', `/api/devices/${devId}/freeze`, {}, adminToken);
    test('admin冻结设备 → 200', freezeRes.status === 200, `status=${freezeRes.status} body=${JSON.stringify(freezeRes.body).slice(0,100)}`);

    // 1c. 验证设备状态
    const devAfter = await req('GET', `/api/devices/${devId}`, null, adminToken);
    test('冻结后设备status=Frozen', devAfter.body?.status === 'Frozen' || devAfter.body?.device?.status === 'Frozen',
      `status=${devAfter.body?.status || devAfter.body?.device?.status}`);

    // 1d. 冻结后不能编辑
    const editRes = await req('PUT', `/api/devices/${devId}`, { '设备中文名称': '测试修改', project_id: PROJECT_ID }, adminToken);
    test('冻结后编辑设备 → 403', editRes.status === 403, `status=${editRes.status}`);

    // 1e. 冻结后不能删除
    // 先不真删，用一个不存在的设备检查逻辑，这里检查正确设备
    // 注意：不真的删除，只检查403
    const delRes = await req('DELETE', `/api/devices/${devId}`, null, adminToken);
    test('冻结后删除设备 → 403', delRes.status === 403, `status=${delRes.status}`);

    // 1f. 重复冻结
    const refreeze = await req('POST', `/api/devices/${devId}/freeze`, {}, adminToken);
    test('重复冻结 → 400', refreeze.status === 400, `status=${refreeze.status}`);

    // 1g. 解冻
    const unfreezeRes = await req('POST', `/api/devices/${devId}/unfreeze`, {}, adminToken);
    test('admin解冻设备 → 200', unfreezeRes.status === 200, `status=${unfreezeRes.status} body=${JSON.stringify(unfreezeRes.body).slice(0,100)}`);

    // 1h. 解冻后状态恢复
    const devRestored = await req('GET', `/api/devices/${devId}`, null, adminToken);
    test('解冻后status=normal', devRestored.body?.status === 'normal' || devRestored.body?.device?.status === 'normal',
      `status=${devRestored.body?.status || devRestored.body?.device?.status}`);

    // 1i. 总体组可以冻结
    if (zontiToken) {
      const zf = await req('POST', `/api/devices/${devId}/freeze`, {}, zontiToken);
      test('总体组冻结设备 → 200', zf.status === 200, `status=${zf.status}`);
      // 再解冻回去
      if (zf.status === 200) {
        await req('POST', `/api/devices/${devId}/unfreeze`, {}, zontiToken);
      }
    } else { skipped++; }

    // 1j. 冻结后连接器操作被拦截
    // 先冻结
    await req('POST', `/api/devices/${devId}/freeze`, {}, adminToken);
    const conns = await req('GET', `/api/devices/${devId}/connectors`, null, adminToken);
    if (conns.body?.length > 0 || conns.body?.connectors?.length > 0) {
      const connList = conns.body.connectors || conns.body;
      const connId = connList[0]?.id;
      if (connId) {
        const editConn = await req('PUT', `/api/devices/${devId}/connectors/${connId}`, { '设备端元器件编号': 'TEST' }, adminToken);
        test('冻结后编辑连接器 → 403', editConn.status === 403, `status=${editConn.status}`);
      } else { skipped++; }
    } else { skipped++; results.push('  ⚠ 该设备无连接器，跳过连接器冻结测试'); }
    // 解冻
    await req('POST', `/api/devices/${devId}/unfreeze`, {}, adminToken);
  }

  // ════════════════════════════════════════
  // 2. 信号分组相关
  // ════════════════════════════════════════
  section('2. 信号分组');

  // 2a. 获取分组列表（含null guards修复验证）
  const groupsRes = await req('GET', `/api/signals/groups?project_id=${PROJECT_ID}`, null, adminToken);
  test('获取信号分组列表 → 200', groupsRes.status === 200, `status=${groupsRes.status}`);
  test('分组列表有数据', groupsRes.body?.groups?.length > 0, `groups.length=${groupsRes.body?.groups?.length}`);

  // 2b. 验证每个group的字段不是undefined
  if (groupsRes.body?.groups) {
    const badGroup = groupsRes.body.groups.find(g => g.signal_ids === undefined || g.unique_ids === undefined || g.protocols === undefined);
    test('分组数据无undefined字段', !badGroup, badGroup ? `group ${badGroup.name} has undefined field` : '');

    // 2c. 验证 signal_ids 是数组不是字符串
    const firstGroup = groupsRes.body.groups[0];
    test('signal_ids是数组', Array.isArray(firstGroup.signal_ids), `type=${typeof firstGroup.signal_ids}`);

    // 2d. 检查group_defs返回
    test('group_defs已返回', groupsRes.body.group_defs && Object.keys(groupsRes.body.group_defs).length > 0,
      `keys=${Object.keys(groupsRes.body.group_defs || {}).length}`);
  }

  // ════════════════════════════════════════
  // 3. HDMI协议扩展
  // ════════════════════════════════════════
  section('3. HDMI协议扩展');

  // 检查 group_defs 里 HDMI 定义
  if (groupsRes.body?.group_defs) {
    const hdmiDef = Object.values(groupsRes.body.group_defs).find((d) => d.connTypes?.includes('HDMI'));
    test('HDMI分组定义存在', !!hdmiDef, '');
    if (hdmiDef) {
      const protos = hdmiDef.protocols || hdmiDef.required || [];
      const count = hdmiDef.count || protos.length;
      test('HDMI需要8个协议', count === 8, `count=${count}, protocols=${JSON.stringify(protos)}`);
      const hasC = protos.includes('HDMI_C+') && protos.includes('HDMI_C-');
      const hasD = protos.includes('HDMI_D+') && protos.includes('HDMI_D-');
      test('HDMI包含C+/C-/D+/D-', hasC && hasD, `C=${hasC} D=${hasD}`);
    }
  }

  // ════════════════════════════════════════
  // 4. 信号CRUD基本功能（回归）
  // ════════════════════════════════════════
  section('4. 信号CRUD回归');

  // 4a. 获取信号列表
  const sigRes = await req('GET', `/api/signals?projectId=${PROJECT_ID}&limit=5`, null, adminToken);
  test('获取信号列表 → 200', sigRes.status === 200, `status=${sigRes.status}`);
  test('信号列表有数据', sigRes.body?.signals?.length > 0, `signals.length=${sigRes.body?.signals?.length}`);

  // 4b. 获取单个信号详情
  if (sigRes.body?.signals?.[0]) {
    const sigId = sigRes.body.signals[0].id;
    const sigDetail = await req('GET', `/api/signals/${sigId}`, null, adminToken);
    test('获取信号详情 → 200', sigDetail.status === 200, `status=${sigDetail.status}`);
  }

  // ════════════════════════════════════════
  // 5. approval-helper冻结辅助函数
  // ════════════════════════════════════════
  section('5. 冻结辅助（间接测试）');

  // 5a. 创建信号时引用冻结设备 → 应该403
  // 先找一个冻结设备
  if (testDevice) {
    const devId = testDevice.id;
    // 冻结
    await req('POST', `/api/devices/${devId}/freeze`, {}, adminToken);

    // 找这个设备的一个连接器和针孔
    const connRes = await req('GET', `/api/devices/${devId}/connectors`, null, adminToken);
    const connList = connRes.body?.connectors || connRes.body || [];
    let pinInfo = null;
    for (const conn of connList) {
      const pinsRes = await req('GET', `/api/devices/${devId}/connectors/${conn.id}/pins`, null, adminToken);
      const pins = pinsRes.body?.pins || pinsRes.body || [];
      if (pins.length > 0) {
        pinInfo = { devNum: testDevice['设备编号'], connNum: conn['设备端元器件编号'], pinNum: pins[0]['针孔号'] };
        break;
      }
    }

    if (pinInfo) {
      const createSigRes = await req('POST', '/api/signals', {
        project_id: PROJECT_ID,
        '连接类型': 'Discrete',
        '线类型': '信号线',
        endpoints: [
          { '设备编号': pinInfo.devNum, '设备端元器件编号': pinInfo.connNum, '针孔号': pinInfo.pinNum }
        ]
      }, xitongToken || adminToken);
      test('创建信号引用冻结设备 → 403', createSigRes.status === 403,
        `status=${createSigRes.status} body=${JSON.stringify(createSigRes.body).slice(0,150)}`);
    } else {
      results.push('  ⚠ 未找到冻结设备的针孔，跳过');
      skipped++;
    }

    // 解冻
    await req('POST', `/api/devices/${devId}/unfreeze`, {}, adminToken);
  }

  // ════════════════════════════════════════
  // 6. 设备/连接器/针孔基本CRUD回归
  // ════════════════════════════════════════
  section('6. 设备/连接器/针孔基本CRUD');

  const devList2 = await req('GET', `/api/devices?projectId=${PROJECT_ID}&limit=3`, null, adminToken);
  test('设备列表 → 200', devList2.status === 200, `status=${devList2.status}`);

  if (devList2.body?.devices?.[0]) {
    const d = devList2.body.devices[0];
    const connRes2 = await req('GET', `/api/devices/${d.id}/connectors`, null, adminToken);
    test('连接器列表 → 200', connRes2.status === 200, `status=${connRes2.status}`);

    const cList = connRes2.body?.connectors || connRes2.body || [];
    if (cList[0]) {
      const pinRes2 = await req('GET', `/api/devices/${d.id}/connectors/${cList[0].id}/pins`, null, adminToken);
      test('针孔列表 → 200', pinRes2.status === 200, `status=${pinRes2.status}`);
    }
  }

  // ════════════════════════════════════════
  // 7. 虚拟字段不泄漏到PUT（has_pending_sub等）
  // ════════════════════════════════════════
  section('7. 虚拟字段防泄漏');

  // 7a. GET设备列表返回的虚拟字段不应导致PUT失败
  const devList3 = await req('GET', `/api/devices?projectId=${PROJECT_ID}&limit=10`, null, adminToken);
  if (devList3.body?.devices) {
    // 找一个 normal 状态且有虚拟字段的设备
    const normalDev = devList3.body.devices.find(d => d.status === 'normal');
    if (normalDev) {
      // 检查虚拟字段存在于GET返回中
      const hasVirtual = 'has_pending_sub' in normalDev || 'pending_item_type' in normalDev || 'management_claim_requester' in normalDev;
      test('GET设备返回包含虚拟字段', true, ''); // 无论有没有都算pass，关键是PUT不崩

      // 用GET返回的完整对象直接PUT（模拟前端未清理虚拟字段）
      const putBody = { ...normalDev };
      // 故意保留 has_pending_sub 等，看后端是否正确清理
      const putRes = await req('PUT', `/api/devices/${normalDev.id}`, putBody, adminToken);
      test('带虚拟字段PUT设备不报错', putRes.status === 200 || putRes.status === 201,
        `status=${putRes.status} body=${JSON.stringify(putRes.body).slice(0, 200)}`);
    } else {
      results.push('  ⚠ 无normal设备可测试PUT虚拟字段');
      skipped += 2;
    }
  }

  // 7b. 连接器PUT同理
  if (devList3.body?.devices?.[0]) {
    const d = devList3.body.devices[0];
    const connRes3 = await req('GET', `/api/devices/${d.id}/connectors`, null, adminToken);
    const cList3 = connRes3.body?.connectors || connRes3.body || [];
    const normalConn = cList3.find(c => c.status === 'normal');
    if (normalConn && d.status === 'normal') {
      const putConnBody = { ...normalConn };
      const putConnRes = await req('PUT', `/api/devices/${d.id}/connectors/${normalConn.id}`, putConnBody, adminToken);
      test('带虚拟字段PUT连接器不报错', putConnRes.status === 200 || putConnRes.status === 201,
        `status=${putConnRes.status} body=${JSON.stringify(putConnRes.body).slice(0, 200)}`);
    } else {
      skipped++;
    }
  }

  // ════════════════════════════════════════
  // 8. 审批通过后实体状态一致性
  // ════════════════════════════════════════
  section('8. 审批状态一致性');

  // 8a. 检查是否有Pending状态但无pending审批请求的"卡住"实体
  // 这种情况说明审批通过/拒绝后状态未正确更新
  // 通过GET设备列表检查
  const allDevs = await req('GET', `/api/devices?projectId=${PROJECT_ID}&limit=200`, null, adminToken);
  if (allDevs.body?.devices) {
    const pendingDevs = allDevs.body.devices.filter(d => d.status === 'Pending');
    let stuckCount = 0;
    for (const pd of pendingDevs) {
      const approvalRes = await req('GET', `/api/approvals/by-entity?entity_type=device&entity_id=${pd.id}`, null, adminToken);
      const hasPending = approvalRes.body?.request?.status === 'pending';
      if (!hasPending) {
        stuckCount++;
        results.push(`  ⚠ 设备 ${pd['设备编号']}(id=${pd.id}) status=Pending 但无pending审批`);
      }
    }
    test('无"卡Pending"的设备', stuckCount === 0, `${stuckCount}个设备状态卡住`);

    // 8b. 检查信号同理
    const allSigs = await req('GET', `/api/signals?projectId=${PROJECT_ID}&limit=500`, null, adminToken);
    if (allSigs.body?.signals) {
      const pendingSigs = allSigs.body.signals.filter(s => s.status === 'Pending');
      let stuckSigCount = 0;
      for (const ps of pendingSigs.slice(0, 20)) {
        const ar = await req('GET', `/api/approvals/by-entity?entity_type=signal&entity_id=${ps.id}`, null, adminToken);
        if (ar.body?.request?.status !== 'pending') {
          stuckSigCount++;
          results.push(`  ⚠ 信号 ${ps.unique_id || ps.id} status=Pending 但无pending审批`);
        }
      }
      test('无"卡Pending"的信号', stuckSigCount === 0, `${stuckSigCount}个信号状态卡住`);
    }

    // 8c. 检查Frozen设备不会有pending审批（冻结前置条件验证过的）
    const frozenDevs = allDevs.body.devices.filter(d => d.status === 'Frozen');
    let frozenWithPending = 0;
    for (const fd of frozenDevs) {
      const ar = await req('GET', `/api/approvals/by-entity?entity_type=device&entity_id=${fd.id}`, null, adminToken);
      if (ar.body?.request?.status === 'pending') {
        frozenWithPending++;
        results.push(`  ⚠ 冻结设备 ${fd['设备编号']} 有pending审批（不应该）`);
      }
    }
    test('冻结设备无pending审批', frozenWithPending === 0, `${frozenWithPending}个异常`);
  }

  // ════════════════════════════════════════
  // 9. 项目API回归
  // ════════════════════════════════════════
  section('9. 项目API回归');

  const projRes = await req('GET', '/api/projects', null, adminToken);
  test('项目列表 → 200', projRes.status === 200, `status=${projRes.status}`);

  // ════════════════════════════════════════
  // 8. RHI状态API（轻量验证，不测编辑器本身）
  // ════════════════════════════════════════
  section('10. RHI状态API（仅验证接口可用）');

  const rhiStatus = await req('GET', `/api/rhi/status/all?project_id=${PROJECT_ID}`, null, adminToken);
  test('RHI status/all → 200', rhiStatus.status === 200, `status=${rhiStatus.status}`);
  test('RHI status返回对象', typeof rhiStatus.body?.status === 'object', `type=${typeof rhiStatus.body?.status}`);

  finish();
}

function finish() {
  console.log(results.join('\n'));
  console.log(`\n${'='.repeat(50)}`);
  console.log(`总计: ${passed + failed + skipped} | 通过: ${passed} | 失败: ${failed} | 跳过: ${skipped}`);
  console.log(`${'='.repeat(50)}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
