/**
 * 审批流程自动化测试脚本
 *
 * 测试目标：验证审批流程逻辑梳理.md中描述的所有路径
 * 运行方式：node test-approval-flow.cjs
 * 前提条件：后端服务已在 localhost:3000 运行
 *
 * 测试覆盖：
 *   A. admin直接操作（无审批）
 *   B. 设备操作审批流程（总体组→其他总体组审批）
 *   C. 连接器操作审批流程
 *   D. 针孔操作（直接生效 vs 需审批）
 *   E. 信号操作审批流程（含completion阶段）
 *   F. 审批推进逻辑（一人通过、拒绝理由必填等）
 *   G. 批量审批
 *   H. 角色权限检查
 *   I. 通知 & 审批历史
 *
 * API路径参考：
 *   设备: POST/PUT/DELETE /api/devices/:id
 *   连接器: POST /api/devices/:devId/connectors
 *   针孔: POST /api/devices/:devId/connectors/:connId/pins
 *   信号: POST/PUT/DELETE /api/signals/:id
 *   审批: GET /api/approvals/by-entity, POST /:id/approve|reject|complete
 */

const jwt = require('jsonwebtoken');
const JWT_SECRET = 'eicd_secret_key_2024';
const BASE = 'http://localhost:3000/api';
const TEST_PROJECT_ID = 41; // CE-25A测试

// ── 工具函数 ──────────────────────────────────────────────────────────────

let testCount = 0, passCount = 0, failCount = 0, skipCount = 0;
const failures = [];

function makeToken(u) { return jwt.sign(u, JWT_SECRET, { expiresIn: '1h' }); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, ok: res.ok };
}

function assert(cond, msg) {
  testCount++;
  if (cond) { passCount++; console.log(`  ✓ ${msg}`); }
  else { failCount++; console.log(`  ✗ FAIL: ${msg}`); failures.push(msg); }
}

function skip(msg) { testCount++; skipCount++; console.log(`  ⊘ SKIP: ${msg}`); }
const wait = ms => new Promise(r => setTimeout(r, ms));

// helper: get device from API
async function getDevice(id, token) {
  const r = await api('GET', `/devices/${id}`, null, token);
  return r.ok ? r.data.device : null;
}
// helper: get signal from API
async function getSignal(id, token) {
  const r = await api('GET', `/signals/${id}`, null, token);
  return r.ok ? r.data.signal : null;
}
// helper: get connector from device
async function getConnector(devId, connId, token) {
  const r = await api('GET', `/devices/${devId}/connectors`, null, token);
  if (!r.ok) return null;
  const list = r.data.connectors || r.data || [];
  return list.find(c => c.id === connId) || null;
}
// helper: get pending approval for entity
async function getPendingApproval(entityType, entityId, token) {
  const r = await api('GET', `/approvals/by-entity?entity_type=${entityType}&entity_id=${entityId}`, null, token);
  return r.data || {};
}

// ── 测试用户（来自数据库中的真实用户）──────────────────────────────────

const ADMIN = { id: 1, username: 'admin', role: 'admin' };
const ZONTI_1 = { id: 22, username: '600640', role: 'user' };  // 总体组, can_approve=true
const ZONTI_2 = { id: 34, username: '600559', role: 'user' };  // 总体组, can_approve=true
const ZONTI_NO_APPROVE = { id: 24, username: '600919', role: 'user' }; // 总体组, no can_approve
const SYS_1 = { id: 21, username: '600664', role: 'user' };    // 系统组(设备管理员)
const SYS_2 = { id: 23, username: '600764', role: 'user' };    // 系统组(设备管理员)

const T = {};
for (const u of [ADMIN, ZONTI_1, ZONTI_2, ZONTI_NO_APPROVE, SYS_1, SYS_2]) {
  T[u.username] = makeToken(u);
}

// 清理追踪
const toClean = { devices: [], connectors: [], signals: [] };

// ── 清理 ──────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n=== 清理测试数据 ===');

  // 取消所有pending审批请求
  for (const [type, ids] of [['signal', toClean.signals], ['connector', toClean.connectors], ['device', toClean.devices]]) {
    for (const id of ids) {
      try {
        const a = await getPendingApproval(type, id, T.admin);
        if (a.request?.id) {
          // 尝试用审批人拒绝
          await api('POST', `/approvals/${a.request.id}/reject`, { reason: '测试清理' }, T['600640']).catch(() => {});
        }
      } catch {}
    }
  }
  await wait(300);

  // admin直接删除（admin删除不走审批）
  for (const id of [...toClean.signals].reverse()) {
    try { await api('DELETE', `/signals/${id}`, null, T.admin); console.log(`  删除信号 #${id}`); } catch {}
  }
  // 连接器需要devId路径 — 用admin直接查DB删
  // 简化处理：直接删设备会级联
  for (const id of [...toClean.devices].reverse()) {
    try { await api('DELETE', `/devices/${id}`, null, T.admin); console.log(`  删除设备 #${id}`); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════════════════
// A: Admin直接操作（无审批）
// ══════════════════════════════════════════════════════════════════════════

async function testA() {
  console.log('\n══ A: Admin直接操作（无审批）══');

  // A1: admin创建设备 → normal
  console.log('\n--- A1: admin创建设备 ---');
  const r = await api('POST', '/devices', {
    project_id: TEST_PROJECT_ID,
    '设备编号': 'TEST-A1-DEV', '设备中文名称': '测试A1',
    '设备编号（DOORS）': 'TEST-A1-D', '设备LIN号（DOORS）': '9999A0001',
    '设备DAL': 'A', '设备部件所属系统（4位ATA）': '24-00',
    '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
    '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机头',
    '设备负责人': SYS_1.username,
  }, T.admin);
  assert(r.ok, 'admin创建设备成功');
  if (!r.ok || !r.data.id) return null;

  const devId = r.data.id;
  toClean.devices.push(devId);
  const dev = await getDevice(devId, T.admin);
  assert(dev?.status === 'normal', `状态为normal (实际: ${dev?.status})`);

  // A2: admin创建连接器 → normal
  console.log('\n--- A2: admin创建连接器 ---');
  const cr = await api('POST', `/devices/${devId}/connectors`, {
    '设备端元器件编号': '9999A0001-J01', '设备端元器件名称及类型': '插头',
  }, T.admin);
  assert(cr.ok, `admin创建连接器成功 (status=${cr.status})`);
  let connId = cr.data?.id;

  // A3: admin创建针孔
  console.log('\n--- A3: admin创建针孔 ---');
  if (connId) {
    const pr = await api('POST', `/devices/${devId}/connectors/${connId}/pins`, {
      '针孔号': 'A1',
    }, T.admin);
    assert(pr.ok, `admin创建针孔成功 (status=${pr.status})`);
  } else skip('admin创建针孔(无连接器)');

  // A4: admin编辑设备 → 直接生效
  console.log('\n--- A4: admin编辑设备 ---');
  const er = await api('PUT', `/devices/${devId}`, { '设备中文名称': '测试A1-编辑' }, T.admin);
  assert(er.ok, 'admin编辑设备成功');
  const devAfter = await getDevice(devId, T.admin);
  assert(devAfter?.['设备中文名称'] === '测试A1-编辑', `字段已更新`);

  return { devId, connId };
}

// ══════════════════════════════════════════════════════════════════════════
// B: 设备操作审批流程
// ══════════════════════════════════════════════════════════════════════════

async function testB() {
  console.log('\n══ B: 设备操作审批流程 ══');

  const devFields = {
    project_id: TEST_PROJECT_ID,
    '设备编号': 'TEST-B1-DEV', '设备中文名称': '测试B1',
    '设备编号（DOORS）': 'TEST-B1-D', '设备LIN号（DOORS）': '9999B0001',
    '设备DAL': 'C', '设备部件所属系统（4位ATA）': '24-01',
    '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
    '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机尾',
    '设备负责人': SYS_1.username,
  };

  // B1: 总体组创建设备 → Pending → 审批通过 → normal
  console.log('\n--- B1: 总体组创建设备+审批通过 ---');
  const r = await api('POST', '/devices', devFields, T['600640']);
  assert(r.ok, `总体组创建设备成功 (status=${r.status}, err=${r.data?.error || ''})`);
  if (!r.ok) { for (let i=0;i<7;i++) skip('B1(创建失败)'); return null; }

  const devId = r.data.id;
  toClean.devices.push(devId);

  // Pending状态
  let dev = await getDevice(devId, T.admin);
  assert(dev?.status === 'Pending', `创建后状态Pending (实际: ${dev?.status})`);

  // 审批请求
  let a = await getPendingApproval('device', devId, T.admin);
  assert(a.request != null, '有审批请求');
  assert(a.request?.action_type === 'create_device', 'action=create_device');
  assert(a.request?.current_phase === 'approval', 'phase=approval (设备无completion)');

  // 审批项不含提交人
  const items = a.items || [];
  const approvers = items.filter(i => i.item_type === 'approval');
  assert(!approvers.find(i => i.recipient_username === ZONTI_1.username), '提交人不在审批项中');

  // 审批通过
  const approveR = await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
  assert(approveR.ok, '审批通过');
  await wait(300);

  dev = await getDevice(devId, T.admin);
  assert(dev?.status === 'normal', `通过后状态normal (实际: ${dev?.status})`);

  // B2: 编辑设备 + 审批通过 → 字段应用
  console.log('\n--- B2: 总体组编辑设备+通过 ---');
  await api('PUT', `/devices/${devId}`, { '设备中文名称': '测试B1-edit' }, T['600640']);
  dev = await getDevice(devId, T.admin);
  assert(dev?.status === 'Pending', `编辑后Pending (实际: ${dev?.status})`);
  // 编辑设备字段不立即写入（存payload中）
  assert(dev?.['设备中文名称'] === '测试B1', `编辑时字段未写入 (实际: ${dev?.['设备中文名称']})`);

  a = await getPendingApproval('device', devId, T['600559']);
  if (a.request) {
    await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
    await wait(300);
    dev = await getDevice(devId, T.admin);
    assert(dev?.['设备中文名称'] === '测试B1-edit', `通过后字段已应用 (实际: ${dev?.['设备中文名称']})`);
    assert(dev?.status === 'normal', `通过后normal`);
  } else { skip('B2审批'); skip('B2字段'); skip('B2状态'); }

  // B3: 编辑设备 + 审批拒绝 → 回滚
  console.log('\n--- B3: 总体组编辑设备+拒绝 ---');
  await api('PUT', `/devices/${devId}`, { '设备中文名称': '不该生效' }, T['600640']);
  a = await getPendingApproval('device', devId, T['600559']);
  if (a.request) {
    const rej = await api('POST', `/approvals/${a.request.id}/reject`, { reason: '测试拒绝' }, T['600559']);
    assert(rej.ok, '拒绝成功');
    await wait(300);
    dev = await getDevice(devId, T.admin);
    assert(dev?.status === 'normal', `拒绝后恢复normal (实际: ${dev?.status})`);
    assert(dev?.['设备中文名称'] === '测试B1-edit', `字段未变 (实际: ${dev?.['设备中文名称']})`);
  } else { skip('B3拒绝'); skip('B3状态'); skip('B3字段'); }

  // B4: 删除设备 + 通过 → 已删除
  console.log('\n--- B4: 总体组删除设备+通过 ---');
  // 用admin另建一个设备专门删
  const delR = await api('POST', '/devices', {
    ...devFields, '设备编号': 'TEST-B4-DEL', '设备LIN号（DOORS）': '9999B0004',
  }, T.admin);
  if (delR.ok) {
    const dId = delR.data.id;
    toClean.devices.push(dId);
    await api('DELETE', `/devices/${dId}`, null, T['600640']);
    dev = await getDevice(dId, T.admin);
    assert(dev?.status === 'Pending', `删除后Pending (实际: ${dev?.status})`);

    a = await getPendingApproval('device', dId, T['600559']);
    if (a.request) {
      await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
      await wait(300);
      const check = await api('GET', `/devices/${dId}`, null, T.admin);
      assert(check.status === 404, '通过后设备已删除');
      // 已删除，从清理列表移除
      const idx = toClean.devices.indexOf(dId);
      if (idx >= 0) toClean.devices.splice(idx, 1);
    }
  } else { skip('B4创建'); skip('B4Pending'); skip('B4删除'); }

  return devId;
}

// ══════════════════════════════════════════════════════════════════════════
// C: 连接器操作审批流程
// ══════════════════════════════════════════════════════════════════════════

async function testC(devId) {
  console.log('\n══ C: 连接器操作审批流程 ══');
  if (!devId) { console.log('  跳过(无父设备)'); return null; }

  // C1: 总体组创建连接器 → 审批通过
  console.log('\n--- C1: 创建连接器+通过 ---');
  const r = await api('POST', `/devices/${devId}/connectors`, {
    '设备端元器件编号': '9999B0001-J01', '设备端元器件名称及类型': '插头',
  }, T['600640']);
  assert(r.ok, `创建连接器成功 (${r.status}, ${r.data?.error || ''})`);
  if (!r.ok) return null;

  const connId = r.data.id;
  toClean.connectors.push(connId);

  let a = await getPendingApproval('connector', connId, T['600559']);
  assert(a.request?.current_phase === 'approval', 'phase=approval');
  if (a.request) {
    await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
    await wait(300);
    const conn = await getConnector(devId, connId, T.admin);
    assert(conn?.status === 'normal', `通过后normal (实际: ${conn?.status})`);
  }

  // C2: 编辑连接器 → 拒绝 → 恢复
  console.log('\n--- C2: 编辑连接器+拒绝 ---');
  await api('PUT', `/devices/${devId}/connectors/${connId}`, { '设备端元器件名称及类型': '插座' }, T['600640']);
  a = await getPendingApproval('connector', connId, T['600559']);
  if (a.request) {
    const rej = await api('POST', `/approvals/${a.request.id}/reject`, { reason: '测试拒绝' }, T['600559']);
    assert(rej.ok, '拒绝编辑连接器');
    await wait(300);
    const conn = await getConnector(devId, connId, T.admin);
    assert(conn?.status === 'normal', `拒绝后恢复 (实际: ${conn?.status})`);
  } else { skip('C2拒绝'); skip('C2恢复'); }

  return { devId, connId };
}

// ══════════════════════════════════════════════════════════════════════════
// D: 针孔操作
// ══════════════════════════════════════════════════════════════════════════

async function testD(devId, connId) {
  console.log('\n══ D: 针孔操作 ══');
  if (!devId || !connId) { console.log('  跳过(无父实体)'); return; }

  // D1: 创建针孔 → 直接生效
  console.log('\n--- D1: 创建针孔(直接生效) ---');
  const r = await api('POST', `/devices/${devId}/connectors/${connId}/pins`, {
    '针孔号': 'TP1',
  }, T['600664']); // 系统组
  assert(r.ok, `创建针孔成功 (${r.status})`);
  const pinId = r.data?.id;

  // D2: 编辑针孔(无关联信号) → 直接更新
  console.log('\n--- D2: 编辑针孔(无关联信号) ---');
  if (pinId) {
    const er = await api('PUT', `/devices/${devId}/connectors/${connId}/pins/${pinId}`, {
      '端接尺寸': '20AWG',
    }, T['600664']);
    assert(er.ok, '编辑成功(直接更新)');
    const a = await getPendingApproval('pin', pinId, T.admin);
    assert(a.request == null, '无审批请求');
  } else { skip('D2编辑'); skip('D2无审批'); }

  // D3: 删除针孔(无关联信号) → 直接删除
  console.log('\n--- D3: 删除针孔(无关联信号) ---');
  if (pinId) {
    const dr = await api('DELETE', `/devices/${devId}/connectors/${connId}/pins/${pinId}`, null, T['600664']);
    assert(dr.ok, '删除成功(直接删除)');
  } else skip('D3删除');
}

// ══════════════════════════════════════════════════════════════════════════
// E: 信号操作审批流程（核心）
// ══════════════════════════════════════════════════════════════════════════

async function testE() {
  console.log('\n══ E: 信号操作审批流程 ══');

  // 准备：admin创建2个设备+连接器+针孔（不同负责人）
  console.log('\n--- E0: 准备测试数据 ---');
  const mkDev = async (num, owner) => {
    const dr = await api('POST', '/devices', {
      project_id: TEST_PROJECT_ID,
      '设备编号': `TEST-E-DEV${num}`, '设备中文名称': `信号测试${num}`,
      '设备编号（DOORS）': `TEST-E-D${num}`, '设备LIN号（DOORS）': `9999E000${num}`,
      '设备负责人': owner, '设备DAL': 'A', '设备部件所属系统（4位ATA）': '24-00',
      '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
      '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机头',
    }, T.admin);
    if (!dr.ok) return null;
    toClean.devices.push(dr.data.id);
    const cr = await api('POST', `/devices/${dr.data.id}/connectors`, {
      '设备端元器件编号': `9999E000${num}-J01`, '设备端元器件名称及类型': '插头',
    }, T.admin);
    if (!cr.ok) return null;
    const pr = await api('POST', `/devices/${dr.data.id}/connectors/${cr.data.id}/pins`, {
      '针孔号': 'E1',
    }, T.admin);
    if (!pr.ok) return null;
    const pr2 = await api('POST', `/devices/${dr.data.id}/connectors/${cr.data.id}/pins`, {
      '针孔号': 'E2',
    }, T.admin);
    const pr3 = await api('POST', `/devices/${dr.data.id}/connectors/${cr.data.id}/pins`, {
      '针孔号': 'E3',
    }, T.admin);
    return { devId: dr.data.id, connId: cr.data.id, pinId: pr.data.id, pin2Id: pr2?.data?.id, pin3Id: pr3?.data?.id };
  };

  const d1 = await mkDev(1, SYS_1.username);
  const d2 = await mkDev(2, SYS_2.username);
  if (!d1 || !d2) { console.log('  准备失败，跳过信号测试'); return; }

  console.log(`  dev1=#${d1.devId}(${SYS_1.username}), dev2=#${d2.devId}(${SYS_2.username})`);

  // E1: 系统组创建信号 → completion → approval → Active
  console.log('\n--- E1: 创建信号(2阶段审批) ---');
  // 信号端点需要使用 设备编号+设备端元器件编号+针孔号 来定位（不能用device_id/pin_id）
  const sr = await api('POST', '/signals', {
    project_id: TEST_PROJECT_ID, unique_id: 'TEST-SIG-E1',
    '连接类型': '点���点',
    endpoints: [
      { '设备编号': `TEST-E-DEV1`, '设备端元器件编号': `9999E0001-J01`, '针孔号': 'E1', '信号名称': 'E1-EP1', '信号定义': '测试1' },
      { '设备编号': `TEST-E-DEV2`, '设备端元器件编号': `9999E0002-J01`, '针孔号': 'E1', '信号名称': 'E1-EP2', '信号定义': '测试2' },
    ],
  }, T['600664']); // SYS_1

  assert(sr.ok, `创建信号成功 (${sr.status}, ${sr.data?.error || ''})`);
  if (!sr.ok) return;

  const sigId = sr.data.id;
  toClean.signals.push(sigId);

  let sig = await getSignal(sigId, T.admin);
  assert(sig?.status === 'Pending', `创建后Pending (实际: ${sig?.status})`);

  let a = await getPendingApproval('signal', sigId, T.admin);
  assert(a.request != null, '有审批请求');
  assert(a.request?.action_type === 'create_signal', 'action=create_signal');

  const completionItems = (a.items || []).filter(i => i.item_type === 'completion');
  const approvalItems = (a.items || []).filter(i => i.item_type === 'approval');
  console.log(`  completion: ${completionItems.length}, approval: ${approvalItems.length}, phase: ${a.request?.current_phase}`);

  if (a.request?.current_phase === 'completion' && completionItems.length > 0) {
    assert(true, '有completion阶段');

    // 对端负责人(SYS_2)完成completion
    const myItem = completionItems.find(i => i.recipient_username === SYS_2.username);
    assert(myItem != null, `对端负责人(${SYS_2.username})有completion项`);

    if (myItem) {
      const cr = await api('POST', `/approvals/${a.request.id}/complete`, { updated_fields: {} }, T['600764']);
      assert(cr.ok, 'completion完成');
      await wait(500);

      // 检查推进到approval
      a = await getPendingApproval('signal', sigId, T.admin);
      assert(a.request?.current_phase === 'approval', `推进到approval (实际: ${a.request?.current_phase})`);
    }
  } else if (a.request?.current_phase === 'approval') {
    assert(true, '直接进入approval(无completion)');
  }

  // 总体组审批通过
  if (a.request && a.request.current_phase === 'approval') {
    const ar = await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600640']);
    assert(ar.ok, '总体组审批通过');
    await wait(500);

    sig = await getSignal(sigId, T.admin);
    assert(sig?.status === 'Active', `通过后Active (实际: ${sig?.status})`);
  }

  // E2: 信号删除 → 无completion，仅approval → 通过后删除
  console.log('\n--- E2: 删除信号(仅approval) ---');
  const s2 = await api('POST', '/signals', {
    project_id: TEST_PROJECT_ID, unique_id: 'TEST-SIG-E2',
    '连接类型': '点���点',
    endpoints: [
      { '设备编号': 'TEST-E-DEV1', '设备端元器件编号': '9999E0001-J01', '针孔号': 'E2', '信号名称': 'E2-EP1', '信号定义': '测试' },
      { '设备编号': 'TEST-E-DEV2', '设备端元器件编号': '9999E0002-J01', '针孔号': 'E2', '信号名称': 'E2-EP2', '信号定义': '测试' },
    ],
  }, T.admin); // admin创建→Active

  if (s2.ok) {
    const s2id = s2.data.id;
    toClean.signals.push(s2id);

    const dr = await api('DELETE', `/signals/${s2id}`, null, T['600664']);
    assert(dr.ok, '系统组发起删除');

    a = await getPendingApproval('signal', s2id, T.admin);
    if (a.request) {
      assert(a.request.action_type === 'delete_signal', 'action=delete_signal');
      const cItems = (a.items || []).filter(i => i.item_type === 'completion');
      assert(cItems.length === 0, '删除信号无completion');
      assert(a.request.current_phase === 'approval', '直接approval');

      await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600640']);
      await wait(500);
      const check = await api('GET', `/signals/${s2id}`, null, T.admin);
      assert(check.status === 404, '通过后信号已删除');
      const idx = toClean.signals.indexOf(s2id);
      if (idx >= 0) toClean.signals.splice(idx, 1);
    }
  } else skip('E2(创建失败)');

  // E3: 信号删除 → 拒绝 → 状态恢复
  console.log('\n--- E3: 删除信号+拒绝→恢复 ---');
  const s3 = await api('POST', '/signals', {
    project_id: TEST_PROJECT_ID, unique_id: 'TEST-SIG-E3',
    '连接类型': '点���点',
    endpoints: [
      { '设备编号': 'TEST-E-DEV1', '设备端元器件编号': '9999E0001-J01', '针孔号': 'E3', '信号名称': 'E3-EP1', '信号定义': '测试' },
      { '设备编号': 'TEST-E-DEV2', '设备端元器件编号': '9999E0002-J01', '针孔号': 'E3', '信号名称': 'E3-EP2', '信号定义': '测试' },
    ],
  }, T.admin);

  if (s3.ok) {
    const s3id = s3.data.id;
    toClean.signals.push(s3id);

    await api('DELETE', `/signals/${s3id}`, null, T['600664']);
    a = await getPendingApproval('signal', s3id, T.admin);
    if (a.request) {
      const rej = await api('POST', `/approvals/${a.request.id}/reject`, { reason: '拒绝删除' }, T['600640']);
      assert(rej.ok, '拒绝删除成功');
      await wait(500);
      sig = await getSignal(s3id, T.admin);
      assert(sig?.status === 'Active', `拒绝后恢复Active (实际: ${sig?.status})`);
    }
  } else skip('E3(创建失败)');

  // E4: 信号编辑(仅属性，端点不变) → 无completion
  console.log('\n--- E4: 编辑信号(属性不变endpoint) ---');
  if (sigId) {
    // 需要先检查sigId当前是否Active
    sig = await getSignal(sigId, T.admin);
    if (sig?.status === 'Active') {
      const er = await api('PUT', `/signals/${sigId}`, {
        '备注': '测试编辑-仅属性',
        // 不传endpoints → 端点不变
      }, T['600664']);
      if (er.ok) {
        a = await getPendingApproval('signal', sigId, T.admin);
        if (a.request) {
          const cItems = (a.items || []).filter(i => i.item_type === 'completion');
          assert(cItems.length === 0, '仅改属性无completion');
          // 通过审批恢复
          await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600640']);
          await wait(300);
        }
      } else {
        console.log(`  编辑信号失败: ${er.data?.error}`);
        skip('E4 completion检查');
      }
    } else skip('E4(信号非Active)');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// F: 审批推进逻辑
// ══════════════════════════════════════════════════════════════════════════

async function testF() {
  console.log('\n══ F: 审批推进逻辑 ══');

  const devFields = {
    project_id: TEST_PROJECT_ID,
    '设备编号': 'TEST-F1', '设备中文名称': '推进测试',
    '设备编号（DOORS）': 'TEST-F1-D', '设备LIN号（DOORS）': '9999F0001',
    '设备DAL': 'A', '设备部件所属系统（4位ATA）': '24-00',
    '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
    '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机翼',
    '设备负责人': SYS_1.username,
  };

  // F1: 一人通过即生效 → 其他审批项cancelled
  console.log('\n--- F1: 一人通过即生效 ---');
  const r = await api('POST', '/devices', devFields, T['600640']);
  if (r.ok) {
    const devId = r.data.id;
    toClean.devices.push(devId);

    let a = await getPendingApproval('device', devId, T.admin);
    const pendingBefore = (a.items || []).filter(i => i.status === 'pending').length;

    await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
    await wait(300);

    const hist = await api('GET', `/approvals/history?entity_type=device&entity_id=${devId}`, null, T.admin);
    const lastReq = hist.data?.requests?.[0];
    assert(lastReq?.status === 'approved', '请求approved');
    if (pendingBefore > 1) {
      const cancelled = (lastReq?.items || []).filter(i => i.status === 'cancelled').length;
      assert(cancelled > 0, `其他项被cancelled (${cancelled}个)`);
    } else {
      assert(true, '仅1个审批人，无需cancel');
    }
  }

  // F2: 拒绝理由必填
  console.log('\n--- F2: 拒绝理由必填 ---');
  const r2 = await api('POST', '/devices', {
    ...devFields, '设备编号': 'TEST-F2', '设备LIN号（DOORS）': '9999F0002',
  }, T['600640']);
  if (r2.ok) {
    const devId = r2.data.id;
    toClean.devices.push(devId);

    let a = await getPendingApproval('device', devId, T['600559']);
    if (a.request) {
      const noReason = await api('POST', `/approvals/${a.request.id}/reject`, {}, T['600559']);
      assert(noReason.status === 400, '无理由返回400');
      const emptyReason = await api('POST', `/approvals/${a.request.id}/reject`, { reason: '  ' }, T['600559']);
      assert(emptyReason.status === 400, '空理由返回400');

      // 正常拒绝清理
      await api('POST', `/approvals/${a.request.id}/reject`, { reason: '清理' }, T['600559']);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// G: 批量审批
// ══════════════════════════════════════════════════════════════════════════

async function testG() {
  console.log('\n══ G: 批量审批 ══');

  const baseDev = {
    project_id: TEST_PROJECT_ID,
    '设备DAL': 'A', '设备部件所属系统（4位ATA）': '24-00',
    '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
    '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机头',
    '设备负责人': SYS_1.username,
  };

  const d1 = await api('POST', '/devices', {
    ...baseDev, '设备编号': 'TEST-G1', '设备中文名称': '批量1',
    '设备编号（DOORS）': 'TEST-G1-D', '设备LIN号（DOORS）': '9999G0001',
  }, T['600640']);
  const d2 = await api('POST', '/devices', {
    ...baseDev, '设备编号': 'TEST-G2', '设备中文名称': '批量2',
    '设备编号（DOORS）': 'TEST-G2-D', '设备LIN号（DOORS）': '9999G0002',
  }, T['600640']);

  if (d1.ok && d2.ok) {
    toClean.devices.push(d1.data.id, d2.data.id);
    const a1 = await getPendingApproval('device', d1.data.id, T['600559']);
    const a2 = await getPendingApproval('device', d2.data.id, T['600559']);

    if (a1.request && a2.request) {
      const br = await api('POST', '/approvals/batch-approve',
        { request_ids: [a1.request.id, a2.request.id] }, T['600559']);
      assert(br.ok, '批量审批成功');
      assert(br.data?.results?.filter(r => r.success).length === 2, '2条全部通过');

      await wait(300);
      const c1 = await getDevice(d1.data.id, T.admin);
      const c2 = await getDevice(d2.data.id, T.admin);
      assert(c1?.status === 'normal', `设备1 normal (实际: ${c1?.status})`);
      assert(c2?.status === 'normal', `设备2 normal (实际: ${c2?.status})`);
    } else skip('批量审批(审批请求不完整)');
  } else skip('批量审批(创建失败)');
}

// ══════════════════════════════════════════════════════════════════════════
// H: 角色权限检查
// ══════════════════════════════════════════════════════════════════════════

async function testH() {
  console.log('\n══ H: 角色权限检查 ══');

  // H1: 系统组不能创建设备
  console.log('\n--- H1: 系统组不能创建设备 ---');
  const r = await api('POST', '/devices', {
    project_id: TEST_PROJECT_ID, '设备编号': 'H1-FAIL',
    '设备中文名称': 'X', '设备编号（DOORS）': 'X', '设备LIN号（DOORS）': '9999H0001',
    '设备负责人': SYS_1.username,
  }, T['600664']);
  assert(!r.ok || r.status === 403, `系统组创建设备拒绝 (status=${r.status})`);
  if (r.ok && r.data?.id) toClean.devices.push(r.data.id);

  // H2: 无审批权总体组不在审批项中
  console.log('\n--- H2: 无审批权总体组不在审批项 ---');
  const h2 = await api('POST', '/devices', {
    project_id: TEST_PROJECT_ID, '设备编号': 'TEST-H2',
    '设备中文名称': '权限测试', '设备编号（DOORS）': 'TEST-H2-D', '设备LIN号（DOORS）': '9999H0002',
    '设备DAL': 'A', '设备部件所属系统（4位ATA）': '24-00',
    '设备壳体是否金属': '否', '金属壳体表面是否经过特殊处理而不易导电': 'N/A',
    '设备壳体接地方式': '无', '壳体接地是否故障电流路径': '否', '设备安装位置': '机头',
    '设备负责人': SYS_1.username,
  }, T['600640']);
  if (h2.ok) {
    toClean.devices.push(h2.data.id);
    const a = await getPendingApproval('device', h2.data.id, T.admin);
    const items = a.items || [];
    const noApprove = items.find(i => i.recipient_username === ZONTI_NO_APPROVE.username);
    assert(!noApprove, `无审批权用户(${ZONTI_NO_APPROVE.username})不在审批项`);
    // 清理
    if (a.request) await api('POST', `/approvals/${a.request.id}/approve`, {}, T['600559']);
  }

  // H3: 未认证请求
  console.log('\n--- H3/H4: 认证检查 ---');
  const noAuth = await api('GET', '/devices?project_id=41');
  assert(noAuth.status === 401, `未认证返回401 (${noAuth.status})`);

  const badToken = await api('GET', '/devices?project_id=41', null, 'bad.token');
  assert(badToken.status === 401, `无效token返回401 (${badToken.status})`);
}

// ══════════════════════════════════════════════════════════════════════════
// I: 通知 & 历史
// ══════════════════════════════════════════════════════════════════════════

async function testI() {
  console.log('\n══ I: 通知 & 审批历史 ══');

  const nr = await api('GET', '/notifications', null, T['600640']);
  assert(nr.ok, '通知API可用');

  if (toClean.devices.length > 0) {
    const hr = await api('GET', `/approvals/history?entity_type=device&entity_id=${toClean.devices[0]}`, null, T.admin);
    assert(hr.ok, '审批历史API可用');
    const reqs = hr.data?.requests || [];
    assert(Array.isArray(reqs), '历史是数组');
    if (reqs.length > 0) assert(reqs[0].items != null, '历史含审批项');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  EICD审批流程自动化测试                          ║');
  console.log('║  服务器: localhost:3000 | 项目: CE-25A测试(41)   ║');
  console.log('╚═══════════════════════════════════════════════╝');

  try {
    const ping = await api('GET', '/projects', null, T.admin);
    if (!ping.ok) { console.error('无法连接/认证失败'); process.exit(1); }
  } catch { console.error('服务器未运行'); process.exit(1); }

  console.log('连接成功，开始测试...');
  const t0 = Date.now();

  try {
    const aResult = await testA();
    const bDevId = await testB();
    const cResult = await testC(bDevId);
    await testD(cResult?.devId || bDevId, cResult?.connId);
    await testE();
    await testF();
    await testG();
    await testH();
    await testI();
  } catch (e) {
    console.error('\n!!! 测试异常 !!!');
    console.error(e);
  }

  await cleanup();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n╔═══════════════════════════════════════════════╗');
  console.log('║  测试结果                                       ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║  总计: ${String(testCount).padStart(3)} | 通过: ${String(passCount).padStart(3)} ✓ | 失败: ${String(failCount).padStart(3)} ✗ | 跳过: ${String(skipCount).padStart(3)} ⊘`);
  console.log(`║  耗时: ${elapsed}s`);
  if (failCount === 0) console.log('║  🎉 全部通过！');
  console.log('╚═══════════════════════════════════════════════╝');

  if (failures.length > 0) {
    console.log('\n失败项:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
