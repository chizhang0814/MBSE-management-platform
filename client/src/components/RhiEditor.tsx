import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const API_HEADERS = () => ({ 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' });
const COLOR_POOL = ['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1'];
// 绞线固定配色：双绞=红蓝，三绞=红蓝绿，所有绞线组统一
const TWIST_COLORS = ['#ef4444', '#3b82f6', '#22c55e']; // 红、蓝、绿

interface Slot { id: number; protocol: string; twist_group: string; pin_num: string; sig_name: string; direction: string; ic_pin_num?: string; interconnect_pin_id?: number; }
interface RhiNode { id: number; type: string; dev_num: string; dev_name: string; conn_name: string; interconnect_label: string; interconnect_id?: number; ic_type?: string; ic_zone?: string; slots: Slot[]; x: number; y: number; }
interface Link { from: number; to: number; }
interface PendingIcDrop { ic: any; x: number; y: number; pinMap: Record<string, string>; }

const IC_HEADER = 38, IC_SLOT_H = 26, IC_PW = 120, IC_PAD = 8, IC_BADGE_W = 30;
function icBoxSize(slotCount: number) {
  const h = IC_HEADER + Math.max(1, slotCount) * IC_SLOT_H + IC_PAD;
  const w = IC_PW + IC_PAD * 2;
  return { w, h };
}
function icSlotPos(node: RhiNode, slotIdx: number, side: 'left' | 'right') {
  const { w } = icBoxSize(node.slots.length);
  const ox = -w / 2, oy = -icBoxSize(node.slots.length).h / 2;
  const sy = oy + IC_HEADER + slotIdx * IC_SLOT_H + IC_SLOT_H / 2;
  // 附着在针孔小矩形的左/右边缘
  const pinLeft = ox + IC_PAD;
  const pinRight = ox + w - IC_PAD;
  return { x: node.x + (side === 'left' ? pinLeft : pinRight), y: node.y + sy };
}
// 设备节点针孔右端绝对坐标
const DEV_SLOT_H = 28, DEV_DW = 140, DEV_CW = 22, DEV_PW = 52;
function devSlotRight(node: RhiNode, slotIdx: number) {
  const dh = Math.max(60, 20 + node.slots.length * DEV_SLOT_H);
  const oy = -dh / 2;
  const py = oy + 6 + slotIdx * DEV_SLOT_H + DEV_SLOT_H / 2;
  const ox = -(DEV_DW + DEV_CW + DEV_PW + 30);
  const sx = ox + DEV_DW + DEV_CW + DEV_PW;
  return { x: node.x + sx, y: node.y + py };
}

export default function RhiEditor({ signalGroup, projectId, onClose }: { signalGroup: string; projectId: number; onClose: () => void }) {
  const [nodes, setNodes] = useState<RhiNode[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [interconnects, setInterconnects] = useState<any[]>([]);
  const [pendingDrop, setPendingDrop] = useState<PendingIcDrop | null>(null);
  const [icGroupBy, setIcGroupBy] = useState<'none' | 'ic_type' | 'ic_zone'>('ic_type');
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ node: RhiNode; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const connDragRef = useRef<{ fromNodeId: number; sx: number; sy: number; mx: number; my: number } | null>(null);
  const panelDragRef = useRef<{ ic: any; ghost: HTMLDivElement | null } | null>(null);
  const [, forceRender] = useState(0);
  const nextId = useRef(1000);

  const usedIcIds = new Set(nodes.filter(n => n.type === 'interconnect' && n.interconnect_id).map(n => n.interconnect_id));

  const colors: Record<string, string> = {};
  const protocols: string[] = [];
  const seen = new Set<string>();
  nodes.forEach(n => n.slots.forEach(s => { if (!seen.has(s.protocol)) { seen.add(s.protocol); protocols.push(s.protocol); } }));
  protocols.forEach((p, i) => { colors[p] = COLOR_POOL[i % COLOR_POOL.length]; });

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // ── SVG坐标转换 ──
  const clientToSvg = useCallback((cx: number, cy: number) => {
    if (!canvasRef.current) return { x: cx, y: cy };
    const r = canvasRef.current.getBoundingClientRect();
    return { x: cx - r.left + canvasRef.current.scrollLeft, y: cy - r.top + canvasRef.current.scrollTop };
  }, []);

  // ── 查找鼠标位置下的节点 ──
  const findNodeAt = useCallback((svgX: number, svgY: number, excludeId?: number): RhiNode | null => {
    for (const node of nodes) {
      if (node.id === excludeId) continue;
      if (node.type === 'device') {
        const slotH = 28, dw = 140, dh = Math.max(60, 20 + node.slots.length * slotH), cw = 22, pw = 52;
        const left = node.x - (dw + cw + pw + 30), top = node.y - dh / 2;
        if (svgX >= left && svgX <= node.x + 15 && svgY >= top && svgY <= top + dh) return node;
      } else {
        const { w, h } = icBoxSize(node.slots.length);
        if (svgX >= node.x - w / 2 && svgX <= node.x + w / 2 && svgY >= node.y - h / 2 && svgY <= node.y + h / 2) return node;
      }
    }
    return null;
  }, [nodes]);

  // ── 加载 ──
  const load = useCallback(async () => {
    try {
      const [r, icR] = await Promise.all([
        fetch(`/api/rhi/${encodeURIComponent(signalGroup)}?project_id=${projectId}`, { headers: API_HEADERS() }),
        fetch(`/api/interconnects?project_id=${projectId}`, { headers: API_HEADERS() }),
      ]);
      const d = await r.json();
      const icData = await icR.json();
      const icList: any[] = icData.interconnects || [];
      setInterconnects(icList);
      const icMap = new Map(icList.map((ic: any) => [ic.id, ic]));
      if (!d.nodes?.length) return;
      const cx = 700, cy = 380;
      const icNodes = d.nodes.filter((n: any) => n.type === 'interconnect');
      const devNodes = d.nodes.filter((n: any) => n.type !== 'interconnect');

      // 互联点排在中心区域（竖向排列）
      const icSpacing = 160;
      const icStartY = cy - ((icNodes.length - 1) * icSpacing) / 2;

      // 设备节点环绕互联点排列
      const devRad = Math.min(400, 180 + devNodes.length * 20);

      const loaded: RhiNode[] = [];
      icNodes.forEach((n: any, i: number) => {
        const icInfo = n.interconnect_id ? icMap.get(n.interconnect_id) : null;
        loaded.push({
          ...n, dev_num: n.dev_num || '', dev_name: n.dev_name || '', conn_name: n.conn_name || '', interconnect_label: n.interconnect_label || '',
          ic_type: icInfo?.ic_type || '', ic_zone: icInfo?.ic_zone || '',
          slots: (n.slots || []).map((s: any) => ({ ...s, pin_num: s.pin_num || s.ic_pin_num || '', sig_name: s.sig_name || '', twist_group: s.twist_group || '', direction: s.direction || '' })),
          x: cx, y: Math.round(icStartY + i * icSpacing),
        });
      });
      devNodes.forEach((n: any, i: number) => {
        const a = (i / devNodes.length) * Math.PI * 2 - Math.PI / 2;
        const icInfo = n.interconnect_id ? icMap.get(n.interconnect_id) : null;
        loaded.push({
          ...n, dev_num: n.dev_num || '', dev_name: n.dev_name || '', conn_name: n.conn_name || '', interconnect_label: n.interconnect_label || '',
          ic_type: icInfo?.ic_type || '', ic_zone: icInfo?.ic_zone || '',
          slots: (n.slots || []).map((s: any) => ({ ...s, pin_num: s.pin_num || s.ic_pin_num || '', sig_name: s.sig_name || '', twist_group: s.twist_group || '', direction: s.direction || '' })),
          x: Math.round(cx + devRad * Math.cos(a)), y: Math.round(cy + devRad * Math.sin(a)),
        });
      });
      setNodes(loaded);
      setLinks((d.links || []).map((l: any) => ({ from: l.from_node_id, to: l.to_node_id })));
    } catch (e) { console.error(e); }
  }, [signalGroup, projectId]);

  useEffect(() => { load(); }, [load]);

  // ── 保存 ──
  const save = async () => {
    const newICs = nodes.filter(n => n.type === 'interconnect' && n.id >= 1000).map(n => ({ _isNew: true, _tempId: n.id, interconnectId: n.interconnect_id }));
    const pinAssignments: any[] = [];
    for (const n of nodes) {
      if (n.type !== 'interconnect') continue;
      for (const s of n.slots) {
        if (s.interconnect_pin_id) {
          pinAssignments.push({ nodeId: n.id, nodeTempId: n.id >= 1000 ? n.id : undefined, protocol: s.protocol, interconnectPinId: s.interconnect_pin_id });
        }
      }
    }
    try {
      const r = await fetch(`/api/rhi/${encodeURIComponent(signalGroup)}/save`, {
        method: 'POST', headers: API_HEADERS(),
        body: JSON.stringify({ project_id: projectId, links, interconnect_nodes: newICs, pin_assignments: pinAssignments }),
      });
      const d = await r.json();
      if (d.success) { alert('保存成功'); await load(); } else alert('失败: ' + (d.error || ''));
    } catch (e) { alert('保存失败: ' + e); }
  };

  // ── 导出CSV ──
  const exportCSV = () => {
    if (!links.length) { alert('无连接数据'); return; }
    const rows = [['协议', '绞线组', '线型', 'From设备', 'From连接器', 'From针孔', 'From信号名', 'From方向', 'To设备', 'To连接器', 'To针孔', 'To信号名', 'To方向'].join(',')];
    for (const conn of links) {
      const a = nodes.find(n => n.id === conn.from), b = nodes.find(n => n.id === conn.to);
      if (!a || !b) continue;
      const toMap: Record<string, Slot> = {}; b.slots.forEach(s => { toMap[s.protocol] = s; });
      for (const fs of a.slots) {
        const ts = toMap[fs.protocol]; if (!ts) continue;
        rows.push([fs.protocol, fs.twist_group, fs.twist_group ? '双绞' : '单线', a.dev_num || a.interconnect_label, a.conn_name, fs.pin_num, fs.sig_name, fs.direction, b.dev_num || b.interconnect_label, b.conn_name, ts.pin_num, ts.sig_name, ts.direction].map(v => '"' + v + '"').join(','));
      }
    }
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `RHI_${signalGroup}_connections.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // ── 左侧面板拖拽 ──
  const onPanelDragStart = (e: React.MouseEvent, ic: any) => {
    if (usedIcIds.has(ic.id)) return;
    e.preventDefault();
    const ghost = document.createElement('div');
    ghost.textContent = ic.label;
    ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;padding:4px 10px;background:#f97316;color:#fff;border-radius:8px;font-size:11px;font-weight:600;opacity:0.9;white-space:nowrap;';
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    panelDragRef.current = { ic, ghost };
    const onMove = (ev: MouseEvent) => { if (panelDragRef.current?.ghost) { panelDragRef.current.ghost.style.left = ev.clientX + 8 + 'px'; panelDragRef.current.ghost.style.top = ev.clientY + 8 + 'px'; } };
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      if (panelDragRef.current?.ghost) document.body.removeChild(panelDragRef.current.ghost);
      const pd = panelDragRef.current; panelDragRef.current = null;
      if (!pd || !canvasRef.current) return;
      const canvasRect = canvasRef.current.getBoundingClientRect();
      if (ev.clientX < canvasRect.left || ev.clientX > canvasRect.right || ev.clientY < canvasRect.top || ev.clientY > canvasRect.bottom) return;
      const svgX = ev.clientX - canvasRect.left + canvasRef.current.scrollLeft;
      const svgY = ev.clientY - canvasRect.top + canvasRef.current.scrollTop;
      const initMap: Record<string, string> = {}; protocols.forEach(p => { initMap[p] = ''; });
      setPendingDrop({ ic: pd.ic, x: svgX, y: svgY, pinMap: initMap });
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  };

  const confirmPinAssignment = () => {
    if (!pendingDrop) return;
    const { ic, x, y, pinMap } = pendingDrop;
    const pins: any[] = ic.pins || [];
    const newNode: RhiNode = {
      id: nextId.current++, type: 'interconnect', dev_num: '', dev_name: '', conn_name: '',
      interconnect_label: ic.label, interconnect_id: ic.id,
      ic_type: ic.ic_type || '', ic_zone: ic.ic_zone || '',
      slots: protocols.map(p => {
        const tw = nodes[0]?.slots.find(s => s.protocol === p)?.twist_group || '';
        const selectedPinNum = pinMap[p] || '';
        const pin = pins.find((pp: any) => pp.pin_num === selectedPinNum);
        return { id: nextId.current++, protocol: p, twist_group: tw, pin_num: selectedPinNum, sig_name: '', direction: '', interconnect_pin_id: pin?.id };
      }),
      x, y,
    };
    setNodes(prev => [...prev, newNode]);
    setPendingDrop(null);
  };

  const removeInterconnectNode = (node: RhiNode) => {
    setLinks(prev => prev.filter(l => l.from !== node.id && l.to !== node.id));
    setNodes(prev => prev.filter(n => n.id !== node.id));
  };

  // ── 全局鼠标事件：节点拖拽 + 连线拖拽 ──
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (dragRef.current) {
      const d = dragRef.current;
      d.node.x = d.ox + e.clientX - d.sx;
      d.node.y = d.oy + e.clientY - d.sy;
      forceRender(c => c + 1);
    } else if (connDragRef.current) {
      const pos = clientToSvg(e.clientX, e.clientY);
      connDragRef.current.mx = pos.x;
      connDragRef.current.my = pos.y;
      forceRender(c => c + 1);
    }
  }, [clientToSvg]);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (connDragRef.current) {
      const cd = connDragRef.current;
      connDragRef.current = null;
      const pos = clientToSvg(e.clientX, e.clientY);
      const target = findNodeAt(pos.x, pos.y, cd.fromNodeId);
      if (target) {
        const fromNode = nodes.find(n => n.id === cd.fromNodeId);
        // 不允许设备与设备之间连线，必须有互联点参与
        if (fromNode?.type === 'device' && target.type === 'device') {
          // 忽略
        } else {
          const already = links.some(l =>
            (l.from === cd.fromNodeId && l.to === target.id) || (l.from === target.id && l.to === cd.fromNodeId)
          );
          if (!already) {
            setLinks(prev => [...prev, { from: cd.fromNodeId, to: target.id }]);
          }
        }
      }
      forceRender(c => c + 1);
    }
    dragRef.current = null;
  }, [clientToSvg, findNodeAt, links]);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
  }, [onMouseMove, onMouseUp]);

  // ── 节点体拖拽（非针孔区域） ──
  const startNodeDrag = (e: React.MouseEvent, node: RhiNode) => {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { node, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y };
  };

  // ── 针孔拖拽 → 连线 ──
  const startConnDrag = (e: React.MouseEvent, nodeId: number) => {
    e.preventDefault(); e.stopPropagation();
    const pos = clientToSvg(e.clientX, e.clientY);
    connDragRef.current = { fromNodeId: nodeId, sx: pos.x, sy: pos.y, mx: pos.x, my: pos.y };
  };

  // ── 贝塞尔 ──
  const bezPath = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    return `M${ax},${ay} C${ax + dx * 0.4},${ay} ${bx - dx * 0.4},${by} ${bx},${by}`;
  };

  // ── 渲染连线 ──
  // 贝塞尔参数化采样（用于绞线正弦波）
  const sampleBez = (ax: number, ay: number, bx: number, by: number, t: number) => {
    const dx = bx - ax;
    const cx1 = ax + dx * 0.4, cy1 = ay, cx2 = bx - dx * 0.4, cy2 = by;
    const u = 1 - t;
    const x = u * u * u * ax + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * bx;
    const y = u * u * u * ay + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * by;
    // 法向量
    const tx = 3 * u * u * (cx1 - ax) + 6 * u * t * (cx2 - cx1) + 3 * t * t * (bx - cx2);
    const ty = 3 * u * u * (cy1 - ay) + 6 * u * t * (cy2 - cy1) + 3 * t * t * (by - cy2);
    const l = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x, y, nx: -ty / l, ny: tx / l };
  };

  const renderLinks = () => {
    return links.map((conn, ci) => {
      const a = nodeMap.get(conn.from), b = nodeMap.get(conn.to);
      if (!a || !b) return null;
      // 跳过设备-设备连线（不应该存在）
      if (a.type === 'device' && b.type === 'device') return null;

      // 确定 device 和 interconnect
      const dev = a.type === 'device' ? a : b;
      const ic = a.type === 'interconnect' ? a : b;

      const devProtoIdx = new Map<string, number>();
      dev.slots.forEach((s, i) => { if (!devProtoIdx.has(s.protocol)) devProtoIdx.set(s.protocol, i); });
      const icProtoIdx = new Map<string, number>();
      ic.slots.forEach((s, i) => { if (!icProtoIdx.has(s.protocol)) icProtoIdx.set(s.protocol, i); });
      const matched = dev.slots.map(s => s.protocol).filter(p => icProtoIdx.has(p));

      // 互联点针孔附着侧：设备在互联点左边→左侧，右边→右侧
      const icSide: 'left' | 'right' = dev.x < ic.x ? 'left' : 'right';

      const getEndpoints = (proto: string) => {
        const from = devSlotRight(dev, devProtoIdx.get(proto)!);
        const to = icSlotPos(ic, icProtoIdx.get(proto)!, icSide);
        return { from, to };
      };

      // 按 twist_group 分组
      const twistGroups = new Map<string, string[]>();
      const singles: string[] = [];
      for (const p of matched) {
        const tw = dev.slots.find(s => s.protocol === p)?.twist_group || '';
        if (tw) { if (!twistGroups.has(tw)) twistGroups.set(tw, []); twistGroups.get(tw)!.push(p); }
        else singles.push(p);
      }

      return <g key={ci}>
        <path d={bezPath(dev.x, dev.y, ic.x, ic.y)} stroke="transparent" strokeWidth={20} fill="none" style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
          onClick={() => { if (confirm('删除连线？')) setLinks(links.filter((_, i) => i !== ci)); }} />

        {/* 绞线：从各自针孔出发→汇合绞线→分开到各自针孔 */}
        {Array.from(twistGroups.entries()).map(([tw, protos]) => {
          if (protos.length < 2) {
            const { from, to } = getEndpoints(protos[0]);
            return <path key={tw} d={bezPath(from.x, from.y, to.x, to.y)} stroke={TWIST_COLORS[0]} strokeWidth={1.5} fill="none" opacity={0.6} style={{ pointerEvents: 'none' }} />;
          }
          const endpoints = protos.map(p => getEndpoints(p));
          // 基线：平均位置
          const ax0 = endpoints.reduce((s, e) => s + e.from.x, 0) / endpoints.length;
          const ay0 = endpoints.reduce((s, e) => s + e.from.y, 0) / endpoints.length;
          const bx0 = endpoints.reduce((s, e) => s + e.to.x, 0) / endpoints.length;
          const by0 = endpoints.reduce((s, e) => s + e.to.y, 0) / endpoints.length;
          const len = Math.sqrt((bx0 - ax0) ** 2 + (by0 - ay0) ** 2);
          const cycles = Math.max(4, Math.round(len / 30)), amp = 4;
          const twistCount = Math.min(protos.length, 3);
          const mergeT = 0.05, splitT = 0.95;
          const steps = Math.max(60, cycles * 12);

          return protos.slice(0, twistCount).map((p, pi) => {
            const col = TWIST_COLORS[pi] || TWIST_COLORS[0];
            const phaseOffset = (pi / twistCount) * Math.PI * 2;
            const myFrom = endpoints[pi].from, myTo = endpoints[pi].to;
            let d = '';
            for (let i = 0; i <= steps; i++) {
              const t = i / steps;
              // 基线上的点（绞线中段）
              const basePt = sampleBez(ax0, ay0, bx0, by0, t);
              const twistPhase = Math.sin(t * Math.PI * 2 * cycles + phaseOffset) * amp;
              const twistX = basePt.x + basePt.nx * twistPhase;
              const twistY = basePt.y + basePt.ny * twistPhase;

              let x: number, y: number;
              if (t < mergeT) {
                // 从自己的针孔位置渐变到绞线基线
                const blend = t / mergeT; // 0→1
                const ease = blend * blend * (3 - 2 * blend); // smoothstep
                const fromPt = sampleBez(myFrom.x, myFrom.y, bx0, by0, t);
                x = fromPt.x * (1 - ease) + twistX * ease;
                y = fromPt.y * (1 - ease) + twistY * ease;
              } else if (t > splitT) {
                // 从绞线基线渐变到自己的针孔位置
                const blend = (t - splitT) / (1 - splitT); // 0→1
                const ease = blend * blend * (3 - 2 * blend);
                const toPt = sampleBez(ax0, ay0, myTo.x, myTo.y, t);
                x = twistX * (1 - ease) + toPt.x * ease;
                y = twistY * (1 - ease) + toPt.y * ease;
              } else {
                x = twistX;
                y = twistY;
              }
              d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
            }
            return <path key={p} d={d} stroke={col} strokeWidth={2} fill="none" opacity={0.7} style={{ pointerEvents: 'none' }} />;
          });
        })}

        {/* 单线：用协议标识颜色 */}
        {singles.map(p => {
          const { from, to } = getEndpoints(p);
          const col = colors[p] || '#94a3b8';
          return <path key={p} d={bezPath(from.x, from.y, to.x, to.y)} stroke={col} strokeWidth={1.5} fill="none" opacity={0.6} style={{ pointerEvents: 'none' }} />;
        })}
      </g>;
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-lg w-[95vw] h-[90vh] flex flex-col shadow-2xl">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-white/10 shrink-0 text-xs">
          <span className="font-bold text-sm text-teal-700">RHI — {signalGroup}</span>
          <div className="flex-1" />
          <span className="text-gray-400">{nodes.filter(n => n.type === 'device').length}设备 {nodes.filter(n => n.type === 'interconnect').length}互联点 {links.length}连接</span>
          <button onClick={() => { if (confirm('清除所有连线？')) setLinks([]); }} className="px-2 py-1 border border-red-300 text-red-500 rounded text-xs">清除连线</button>
          <button onClick={save} className="px-3 py-1 bg-teal-700 text-white rounded text-xs font-semibold">保存</button>
          <button onClick={exportCSV} className="px-2 py-1 bg-purple-600 text-white rounded text-xs">导出CSV</button>
          <button onClick={onClose} className="px-3 py-1 border border-gray-300 rounded text-xs">关闭</button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* ── 左侧互联点面板 ── */}
          <div className="w-52 shrink-0 border-r border-gray-200 dark:border-white/10 bg-white dark:bg-neutral-900 flex flex-col">
            <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 flex items-center gap-1">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">互联点</span>
              <div className="flex-1" />
              <select value={icGroupBy} onChange={e => setIcGroupBy(e.target.value as any)}
                className="text-[10px] border border-gray-200 dark:border-white/15 rounded px-1 py-0.5 bg-white dark:bg-neutral-800 dark:text-white">
                <option value="none">不分组</option>
                <option value="ic_type">按类型</option>
                <option value="ic_zone">按区域</option>
              </select>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-1">
              {interconnects.length === 0 && <div className="text-[10px] text-gray-400 text-center py-4">暂无互联点<br />请先在互联点管理中创建</div>}
              {(() => {
                const groups = new Map<string, any[]>();
                if (icGroupBy === 'none') { groups.set('', interconnects); }
                else { for (const ic of interconnects) { const key = (ic[icGroupBy] || '').trim() || '未分类'; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(ic); } }
                return Array.from(groups.entries()).map(([groupName, items]) => (
                  <div key={groupName}>
                    {icGroupBy !== 'none' && (
                      <div className="flex items-center gap-1 px-1 pt-2 pb-0.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${icGroupBy === 'ic_type' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}>{groupName}</span>
                        <span className="text-[9px] text-gray-400">{items.length}</span>
                      </div>
                    )}
                    {items.map((ic: any) => {
                      const inCanvas = usedIcIds.has(ic.id);
                      return (
                        <div key={ic.id}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md mb-0.5 text-xs select-none transition-colors ${inCanvas ? 'bg-gray-100 text-gray-400 cursor-default' : 'bg-orange-50 text-orange-700 cursor-grab hover:bg-orange-100'}`}
                          onMouseDown={e => onPanelDragStart(e, ic)}>
                          <span className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center text-[7px] font-bold shrink-0 ${inCanvas ? 'border-gray-300 text-gray-400' : 'border-orange-400 text-orange-500'}`}>IC</span>
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium leading-tight">{ic.label}</div>
                            {(ic.ic_type || ic.ic_zone) && <div className="flex gap-1 mt-0.5">
                              {icGroupBy !== 'ic_type' && ic.ic_type && <span className="text-[8px] text-indigo-400 truncate">{ic.ic_type}</span>}
                              {icGroupBy !== 'ic_zone' && ic.ic_zone && <span className="text-[8px] text-amber-500 truncate">{ic.ic_zone}</span>}
                            </div>}
                          </div>
                          {ic.pins?.length > 0 && <span className={`text-[9px] shrink-0 ${inCanvas ? 'text-gray-400' : 'text-orange-400'}`}>{ic.pins.length}p</span>}
                          {inCanvas && <span className="text-[9px] text-gray-400 shrink-0">已用</span>}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* ── 右侧画布 ── */}
          <div ref={canvasRef} className="flex-1 overflow-auto bg-gray-50 dark:bg-neutral-950">
            <svg ref={svgRef} width="3000" height="2000" className="select-none">
              {/* 节点 */}
              {nodes.map(node => {
                return <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                  {node.type === 'device' ? (() => {
                    const slotH = 28, dw = 140, dh = Math.max(60, 20 + node.slots.length * slotH), cw = 22, pw = 52;
                    const ox = -(dw + cw + pw + 30), oy = -dh / 2;
                    return <>
                      {/* 设备框+连接器：拖拽区域 */}
                      <rect x={ox} y={oy} width={dw + cw} height={dh} rx={8} fill="transparent" style={{ cursor: 'grab' }}
                        onMouseDown={e => startNodeDrag(e, node)} />
                      <rect x={ox} y={oy} width={dw} height={dh} rx={8} fill="#fff" stroke="#0f766e" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
                      <text x={ox + 8} y={oy + 18} fontSize={12} fontWeight={700} fill="#0f766e" style={{ pointerEvents: 'none' }}>{node.dev_num}</text>
                      <text x={ox + 8} y={oy + 32} fontSize={8} fill="#64748b" style={{ pointerEvents: 'none' }}>{(node.dev_name || '').slice(0, 12)}</text>
                      <rect x={ox + dw} y={oy + 3} width={cw} height={dh - 6} rx={2} fill="#334155" style={{ pointerEvents: 'none' }} />
                      <text x={ox + dw + cw / 2} y={oy + dh / 2} fontSize={7} fill="#e2e8f0" textAnchor="middle" dominantBaseline="middle" writingMode="tb" style={{ pointerEvents: 'none' }}>{node.conn_name}</text>
                      {/* 针孔：拖拽开始连线 */}
                      {node.slots.map((s, si) => {
                        const py = oy + 6 + si * slotH, col = colors[s.protocol] || '#94a3b8';
                        return <g key={si}>
                          <rect x={ox + dw + cw} y={py} width={pw} height={slotH - 4} rx={2} fill={col + '22'} stroke={col} strokeWidth={1}
                            style={{ cursor: 'crosshair' }} onMouseDown={e => startConnDrag(e, node.id)} />
                          <text x={ox + dw + cw + 3} y={py + 10} fontSize={9} fill={col} fontWeight={600} style={{ pointerEvents: 'none' }}>{s.pin_num || '—'}</text>
                          <text x={ox + dw + cw + 3} y={py + 20} fontSize={7} fill={col} opacity={0.7} style={{ pointerEvents: 'none' }}>{s.protocol}</text>
                        </g>;
                      })}
                    </>;
                  })() : (() => {
                    // ── 互联点节点 ──
                    const { w: bw, h: bh } = icBoxSize(node.slots.length);
                    const ox = -bw / 2, oy = -bh / 2;
                    return <>
                      {/* 整个框：拖拽区域 */}
                      <rect x={ox} y={oy} width={bw} height={bh} rx={8} fill="#fffbf5" stroke="#f97316" strokeWidth={2}
                        style={{ cursor: 'grab' }} onMouseDown={e => startNodeDrag(e, node)} />
                      {/* RHI 徽章 */}
                      <rect x={ox + bw - IC_BADGE_W - 6} y={oy + 4} width={IC_BADGE_W} height={14} rx={4} fill="#f97316" style={{ pointerEvents: 'none' }} />
                      <text x={ox + bw - IC_BADGE_W / 2 - 6} y={oy + 14} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>RHI</text>
                      {/* 标签 */}
                      <text x={ox + bw / 2} y={oy + 16} textAnchor="middle" fontSize={11} fontWeight={700} fill="#c2410c" style={{ pointerEvents: 'none' }}>{node.interconnect_label}</text>
                      <text x={ox + bw / 2} y={oy + 28} textAnchor="middle" fontSize={8} fill="#9a3412" style={{ pointerEvents: 'none' }}>
                        {[node.ic_type, node.ic_zone].filter(Boolean).join(' · ') || '互联点'}
                      </text>
                      <line x1={ox + 4} y1={oy + IC_HEADER - 2} x2={ox + bw - 4} y2={oy + IC_HEADER - 2} stroke="#fed7aa" strokeWidth={1} style={{ pointerEvents: 'none' }} />
                      {/* 针孔：拖拽开始连线 */}
                      {node.slots.map((s, si) => {
                        const py = oy + IC_HEADER + si * IC_SLOT_H;
                        const col = colors[s.protocol] || '#94a3b8';
                        return <g key={si}>
                          <rect x={ox + IC_PAD} y={py} width={bw - IC_PAD * 2} height={IC_SLOT_H - 4} rx={3} fill={col + '18'} stroke={col} strokeWidth={0.8}
                            style={{ cursor: 'crosshair' }} onMouseDown={e => startConnDrag(e, node.id)} />
                          <text x={ox + IC_PAD + 4} y={py + 10} fontSize={9} fill={col} fontWeight={600} style={{ pointerEvents: 'none' }}>{s.pin_num || '—'}</text>
                          <text x={ox + IC_PAD + 4} y={py + 19} fontSize={7} fill={col} opacity={0.7} style={{ pointerEvents: 'none' }}>{s.protocol}</text>
                          {/* 针孔矩形左右两侧附着点 */}
                          <circle cx={ox + IC_PAD} cy={py + IC_SLOT_H / 2 - 2} r={3} fill={col} opacity={0.4} style={{ pointerEvents: 'none' }} />
                          <circle cx={ox + bw - IC_PAD} cy={py + IC_SLOT_H / 2 - 2} r={3} fill={col} opacity={0.4} style={{ pointerEvents: 'none' }} />
                        </g>;
                      })}
                    </>;
                  })()}
                  {/* 右键删除互联点 */}
                  {node.type === 'interconnect' && <rect x={-icBoxSize(node.slots.length).w / 2} y={-icBoxSize(node.slots.length).h / 2} width={icBoxSize(node.slots.length).w} height={icBoxSize(node.slots.length).h} fill="transparent" style={{ pointerEvents: 'all' }}
                    onContextMenu={e => { e.preventDefault(); removeInterconnectNode(node); }} />}
                </g>;
              })}

              {/* 连线（置于节点之上，穿入互联点框内） */}
              {renderLinks()}

              {/* 连线拖拽预览线 */}
              {connDragRef.current && (() => {
                const from = nodeMap.get(connDragRef.current.fromNodeId);
                if (!from) return null;
                return <path d={bezPath(connDragRef.current.sx, connDragRef.current.sy, connDragRef.current.mx, connDragRef.current.my)}
                  stroke="#3b82f6" strokeWidth={2} strokeDasharray="6,4" fill="none" opacity={0.7} style={{ pointerEvents: 'none' }} />;
              })()}
            </svg>
          </div>
        </div>

        {/* 图例 */}
        <div className="flex items-center gap-3 px-4 py-1 border-t border-gray-200 dark:border-white/10 text-[10px] text-gray-400">
          {protocols.map(p => <span key={p} className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: colors[p] }} />{p}</span>)}
          <span className="ml-auto">拖拽框体移动 · 拖拽针孔连线 · 右键移除互联点 · 点连线删除</span>
        </div>
      </div>

      {/* ── 针孔分配对话框 ── */}
      {pendingDrop && (() => {
        const pins: any[] = pendingDrop.ic.pins || [];
        const usedPins = new Set(Object.values(pendingDrop.pinMap).filter(Boolean));
        return (
          <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-[60] pt-[8vh]">
            <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-2xl w-[420px] max-h-[80vh] flex flex-col">
              <div className="px-5 py-3 border-b border-gray-200 dark:border-white/10">
                <h3 className="text-sm font-bold text-orange-700">分配针孔 — {pendingDrop.ic.label}</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">为每个协议标识选择对应的互联点针孔</p>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {pins.length === 0 && <div className="text-xs text-red-500 text-center py-4">该互联点没有针孔，请先在互联点管理中添加</div>}
                {protocols.map(p => {
                  const col = colors[p] || '#94a3b8';
                  return (
                    <div key={p} className="flex items-center gap-3 mb-2">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: col }} />
                      <span className="text-xs font-medium w-32 truncate" style={{ color: col }}>{p}</span>
                      <select value={pendingDrop.pinMap[p] || ''}
                        onChange={e => setPendingDrop(prev => prev ? { ...prev, pinMap: { ...prev.pinMap, [p]: e.target.value } } : null)}
                        className="flex-1 text-xs border border-gray-300 dark:border-white/20 rounded px-2 py-1 bg-white dark:bg-neutral-700 dark:text-white">
                        <option value="">— 不分配 —</option>
                        {[...pins].sort((a: any, b: any) => {
                          const aFree = !usedPins.has(a.pin_num) && !(a.used_by_group && a.used_by_group !== signalGroup);
                          const bFree = !usedPins.has(b.pin_num) && !(b.used_by_group && b.used_by_group !== signalGroup);
                          if (aFree !== bFree) return aFree ? -1 : 1;
                          return 0;
                        }).map((pin: any) => {
                          const takenHere = usedPins.has(pin.pin_num) && pendingDrop.pinMap[p] !== pin.pin_num;
                          const otherGroup = pin.used_by_group && pin.used_by_group !== signalGroup;
                          const disabled = takenHere || otherGroup;
                          const suffix = otherGroup ? ` (已被 ${pin.used_by_group} 占用)` : takenHere ? ' (已分配)' : '';
                          return <option key={pin.id} value={pin.pin_num} disabled={disabled}>{pin.pin_num}{suffix}</option>;
                        })}
                      </select>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-white/10">
                <button onClick={() => setPendingDrop(null)} className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50">取消</button>
                <button onClick={confirmPinAssignment} disabled={pins.length === 0}
                  className="px-4 py-1.5 text-xs bg-orange-600 text-white rounded font-semibold hover:bg-orange-700 disabled:opacity-40">确认添加</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
