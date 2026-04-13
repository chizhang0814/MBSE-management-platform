import React, { useRef, useMemo, useState, useCallback, useEffect } from 'react';

/* ───────── Types ───────── */

interface PinData { id: number; 针孔号: string; }
interface ConnectorData { id: number; 设备端元器件编号: string; pins: PinData[]; }
interface DeviceData { id: number; 设备编号: string; 设备中文名称?: string; ata?: string | null; connectors: ConnectorData[]; }

interface EndpointInfo {
  endpointId: number; deviceId: number; pinId: number | null;
  connectorId: number | null;
  设备编号: string; 针孔号: string | null; 设备端元器件编号: string | null;
}
interface SignalDetail {
  id: number; unique_id: string; status: string; signal_group: string;
  连接类型?: string; 信号名称摘要?: string;
  endpoints: EndpointInfo[];
  edges: { from_endpoint_id: number; to_endpoint_id: number; direction: string }[];
}

export interface SignalGroupDiagramProps {
  groupName: string;
  signals: SignalDetail[];
  devices: DeviceData[];
  highlightSignalId?: number;
}

/* ───────── Layout Constants (same as EICDDiagram) ───────── */

const PIN_SQ = 12;
const PIN_GAP = 4;
const CONN_MIN_H = 20;
const CONN_GAP = 14;
const DEV_PAD = 16;
const DEV_MIN_BODY_W = 100;
const DEV_GAP = 50;
const MARGIN = 40;
const HUB_RADIUS = 6;

/* ───────── ATA Color Palette ───────── */

const ATA_COLORS = [
  { devFill: '#ECFDF5', devBorder: '#059669' }, // green (default / first ATA)
  { devFill: '#EFF6FF', devBorder: '#2563EB' }, // blue
  { devFill: '#FEF3C7', devBorder: '#D97706' }, // amber
  { devFill: '#FDE2E2', devBorder: '#DC2626' }, // red
  { devFill: '#F3E8FF', devBorder: '#7C3AED' }, // violet
  { devFill: '#E0F2FE', devBorder: '#0284C7' }, // sky
  { devFill: '#FFF1F2', devBorder: '#E11D48' }, // rose
  { devFill: '#ECFEFF', devBorder: '#0891B2' }, // cyan
  { devFill: '#F0FDF4', devBorder: '#16A34A' }, // emerald
  { devFill: '#FEF9C3', devBorder: '#CA8A04' }, // yellow
];
const ATA_COLORS_DARK = [
  { devFill: '#064E3B', devBorder: '#34D399' },
  { devFill: '#1E3A5F', devBorder: '#60A5FA' },
  { devFill: '#451A03', devBorder: '#FBBF24' },
  { devFill: '#450A0A', devBorder: '#F87171' },
  { devFill: '#2E1065', devBorder: '#A78BFA' },
  { devFill: '#0C4A6E', devBorder: '#38BDF8' },
  { devFill: '#4C0519', devBorder: '#FB7185' },
  { devFill: '#164E63', devBorder: '#22D3EE' },
  { devFill: '#052E16', devBorder: '#4ADE80' },
  { devFill: '#422006', devBorder: '#FACC15' },
];

function ataChapter(ata: string | null | undefined): string {
  if (!ata) return '';
  const m = ata.match(/^(\d{2})/);
  return m ? m[1] : '';
}

/* ───────── Signal Color Palette ───────── */

const SIGNAL_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6',
  '#E11D48', '#84CC16', '#7C3AED', '#0EA5E9', '#D946EF',
];

/* ───────── Colours (same as EICDDiagram) ───────── */

function getColors(dark: boolean) {
  return dark ? {
    bg: '#0F172A',
    devFill: '#1E293B', devBorder: '#3B82F6', devText: '#E2E8F0',
    connFill: '#1E3A5F', connBorder: '#60A5FA', connText: '#93C5FD',
    pinFill: '#78350F', pinBorder: '#F59E0B', pinText: '#FCD34D',
    legendText: '#94A3B8',
  } : {
    bg: '#FFFFFF',
    devFill: '#ECFDF5', devBorder: '#059669', devText: '#064E3B',
    connFill: '#EFF6FF', connBorder: '#3B82F6', connText: '#1D4ED8',
    pinFill: '#FFFBEB', pinBorder: '#D97706', pinText: '#92400E',
    legendText: '#6B7280',
  };
}

/* ───────── Geometry helpers (identical to EICDDiagram) ───────── */

function approxW(text: string, charW: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e80 ? charW * 1.6 : charW;
  return w;
}

function connW(pins: PinData[]): number {
  if (pins.length === 0) return PIN_SQ;
  const maxLabel = Math.max(...pins.map(p => approxW(p.针孔号, 6)));
  return Math.max(PIN_SQ, maxLabel + 4);
}

function connH(conn: ConnectorData): number {
  const n = conn.pins.length;
  const pinStackH = n === 0 ? 0 : n * PIN_SQ + (n - 1) * PIN_GAP;
  const pinH = pinStackH + 8;
  const labelH = approxW(conn.设备端元器件编号, 7) + 10;
  return Math.max(CONN_MIN_H, pinH, labelH);
}

function devBodyH(connectors: ConnectorData[]): number {
  if (connectors.length === 0) return DEV_PAD * 2 + 24;
  const total = connectors.reduce((s, c) => s + connH(c), 0) + (connectors.length - 1) * CONN_GAP;
  return DEV_PAD * 2 + total;
}

function devBodyW(device: DeviceData): number {
  const nameLine = device.设备中文名称 ? `${device.设备编号} (${device.设备中文名称})` : device.设备编号;
  const nameW = approxW(nameLine, 7.5) + 20;
  return Math.max(DEV_MIN_BODY_W, nameW);
}

interface Pos { x: number; y: number; }

/* ───────── Pin positions (identical to EICDDiagram) ───────── */

function buildPinPositions(
  device: DeviceData, devX: number, devY: number, bW: number, pinsOnRight: boolean,
): Map<number, Pos> {
  const map = new Map<number, Pos>();
  const bH = devBodyH(device.connectors);
  const totalConnH = device.connectors.reduce((s, c) => s + connH(c), 0)
    + Math.max(0, device.connectors.length - 1) * CONN_GAP;
  let cy = devY + (bH - totalConnH) / 2;

  for (const conn of device.connectors) {
    const cH = connH(conn);
    const cW = connW(conn.pins);
    const n = conn.pins.length;
    const pinStackH = n * PIN_SQ + Math.max(0, n - 1) * PIN_GAP;
    let pinY = cy + (cH - pinStackH) / 2;

    for (const pin of conn.pins) {
      const centerY = pinY + PIN_SQ / 2;
      let edgeX: number;
      if (pinsOnRight) {
        edgeX = devX + bW + cW + PIN_SQ;
      } else {
        edgeX = devX - cW - PIN_SQ;
      }
      map.set(pin.id, { x: edgeX, y: centerY });
      pinY += PIN_SQ + PIN_GAP;
    }
    cy += cH + CONN_GAP;
  }
  return map;
}

/* ───────── Wire path (identical to EICDDiagram) ───────── */

function wirePath(from: Pos, to: Pos): string {
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const dx = to.x - from.x;
  const cp = Math.min(Math.abs(dx) * 0.4, 100);
  return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`;
}

/* ═══════════ Component ═══════════ */

export default function SignalGroupDiagram({ groupName, signals, devices, highlightSignalId }: SignalGroupDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDark = document.documentElement.classList.contains('dark');
  const C = getColors(isDark);

  const [offsets, setOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [drag, setDrag] = useState<{ id: number; mx: number; my: number; ox: number; oy: number } | null>(null);
  const [hubOffsets, setHubOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [hubDrag, setHubDrag] = useState<{ id: number; mx: number; my: number; ox: number; oy: number } | null>(null);
  const [flashOn, setFlashOn] = useState(true);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [visibleSignalIds, setVisibleSignalIds] = useState<Set<number> | null>(null); // null = show all
  const [showSignalFilter, setShowSignalFilter] = useState(false);

  /* Flash animation for highlighted signal */
  useEffect(() => {
    if (!highlightSignalId) return;
    const interval = setInterval(() => setFlashOn(v => !v), 500);
    // Stop flashing after 6 seconds
    const timeout = setTimeout(() => clearInterval(interval), 6000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [highlightSignalId]);

  /* Color map: signalId → color */
  const signalColorMap = useMemo(() => {
    const m = new Map<number, string>();
    signals.forEach((s, i) => m.set(s.id, SIGNAL_COLORS[i % SIGNAL_COLORS.length]));
    return m;
  }, [signals]);

  /* ── ATA chapter → color index map ── */
  const ataColorMap = useMemo(() => {
    const chapters = [...new Set(devices.map(d => ataChapter(d.ata)).filter(Boolean))].sort();
    const m = new Map<string, number>();
    chapters.forEach((ch, i) => m.set(ch, i % ATA_COLORS.length));
    return m;
  }, [devices]);

  /* ── Filtered signals ── */
  const filteredSignals = useMemo(() => {
    if (!visibleSignalIds) return signals;
    return signals.filter(s => visibleSignalIds.has(s.id));
  }, [signals, visibleSignalIds]);

  /* ── Filtered devices: only those with endpoints in filtered signals ── */
  const filteredDevices = useMemo(() => {
    const devIds = new Set<number>();
    for (const sig of filteredSignals) {
      for (const ep of sig.endpoints) if (ep.deviceId) devIds.add(ep.deviceId);
    }
    // Filter device connectors/pins to only those referenced
    const pinIds = new Set<number>();
    for (const sig of filteredSignals) {
      for (const ep of sig.endpoints) if (ep.pinId) pinIds.add(ep.pinId);
    }
    return devices.filter(d => devIds.has(d.id)).map(d => ({
      ...d,
      connectors: d.connectors
        .map(c => ({ ...c, pins: c.pins.filter(p => pinIds.has(p.id)) }))
        .filter(c => c.pins.length > 0),
    }));
  }, [devices, filteredSignals]);

  /* ── Layout: two columns, left devices pins face right, right devices pins face left ── */
  const layout = useMemo(() => {
    if (filteredDevices.length === 0) return { devPositions: [] as { dev: DeviceData; x: number; y: number; bW: number; bH: number; right: boolean }[], pinPositions: new Map<number, Pos>(), contentW: 400, contentH: 300 };

    // Sort devices by ATA chapter so same-ATA devices are adjacent
    const sorted = [...filteredDevices].sort((a, b) => {
      const aa = ataChapter(a.ata), ba = ataChapter(b.ata);
      if (aa !== ba) return aa.localeCompare(ba);
      return a.设备编号.localeCompare(b.设备编号);
    });
    const devSizes = sorted.map(d => ({ id: d.id, bW: devBodyW(d), bH: devBodyH(d.connectors), dev: d, maxCW: d.connectors.length > 0 ? Math.max(...d.connectors.map(c => connW(c.pins))) : 0 }));

    // Split into left and right columns, keeping same-ATA together on one side
    const leftDevs: typeof devSizes = [];
    const rightDevs: typeof devSizes = [];
    if (devSizes.length <= 1) {
      leftDevs.push(...devSizes);
    } else if (devSizes.length === 2) {
      // 恰好两个设备时，强制对放：一个左、一个右
      leftDevs.push(devSizes[0]);
      rightDevs.push(devSizes[1]);
    } else {
      // Group by ATA chapter
      const ataGroups: typeof devSizes[] = [];
      let currentGroup: typeof devSizes = [];
      let currentAta = '';
      for (const ds of devSizes) {
        const ch = ataChapter(ds.dev.ata);
        if (ch !== currentAta && currentGroup.length > 0) {
          ataGroups.push(currentGroup);
          currentGroup = [];
        }
        currentAta = ch;
        currentGroup.push(ds);
      }
      if (currentGroup.length > 0) ataGroups.push(currentGroup);

      // Distribute ATA groups to left/right, balancing total height
      let leftH = 0, rightH = 0;
      for (const group of ataGroups) {
        const groupH = group.reduce((s, d) => s + d.bH, 0) + (group.length - 1) * DEV_GAP;
        if (leftH <= rightH) {
          leftDevs.push(...group);
          leftH += groupH + DEV_GAP;
        } else {
          rightDevs.push(...group);
          rightH += groupH + DEV_GAP;
        }
      }
      // 如果所有设备都在同一侧（同ATA），强制拆分一半到右侧
      if (rightDevs.length === 0 && leftDevs.length > 1) {
        const half = Math.ceil(leftDevs.length / 2);
        rightDevs.push(...leftDevs.splice(half));
      }
    }

    const maxLeftBW = leftDevs.length > 0 ? Math.max(...leftDevs.map(d => d.bW)) : 0;
    const maxLeftCW = leftDevs.length > 0 ? Math.max(...leftDevs.map(d => d.maxCW)) : 0;

    const channelW = 300;
    const leftPinEdge = MARGIN + maxLeftBW + maxLeftCW + PIN_SQ;
    const rightPinEdge = leftPinEdge + channelW;

    const devPositions: { dev: DeviceData; x: number; y: number; bW: number; bH: number; right: boolean }[] = [];
    const pinPositions = new Map<number, Pos>();

    // Left column (pins face right)
    let ly = MARGIN;
    for (const ds of leftDevs) {
      const x = MARGIN;
      devPositions.push({ dev: ds.dev, x, y: ly, bW: ds.bW, bH: ds.bH, right: true });
      const pins = buildPinPositions(ds.dev, x, ly, ds.bW, true);
      pins.forEach((pos, pinId) => pinPositions.set(pinId, pos));
      ly += ds.bH + DEV_GAP;
    }

    // Right column (pins face left)
    let ry = MARGIN;
    for (const ds of rightDevs) {
      const x = rightPinEdge + PIN_SQ + ds.maxCW;
      devPositions.push({ dev: ds.dev, x, y: ry, bW: ds.bW, bH: ds.bH, right: false });
      const pins = buildPinPositions(ds.dev, x, ry, ds.bW, false);
      pins.forEach((pos, pinId) => pinPositions.set(pinId, pos));
      ry += ds.bH + DEV_GAP;
    }

    // Vertical center alignment between columns
    const leftH = ly - DEV_GAP;
    const rightH = ry - DEV_GAP;
    if (rightDevs.length > 0 && leftH !== rightH) {
      const shorter = leftH < rightH ? 'left' : 'right';
      const diff = Math.abs(leftH - rightH) / 2;
      for (const dp of devPositions) {
        const isLeft = leftDevs.some(l => l.id === dp.dev.id);
        if ((shorter === 'left' && isLeft) || (shorter === 'right' && !isLeft)) {
          dp.y += diff;
          // Rebuild pin positions for adjusted device
          const pins = buildPinPositions(dp.dev, dp.x, dp.y, dp.bW, dp.right);
          pins.forEach((pos, pinId) => pinPositions.set(pinId, pos));
        }
      }
    }

    const maxR = Math.max(...devPositions.map(d => d.x + d.bW + (d.right ? 0 : 0) + d.dev.connectors.reduce((m, c) => Math.max(m, connW(c.pins)), 0) + PIN_SQ)) + MARGIN;
    const maxB = Math.max(...devPositions.map(d => d.y + d.bH)) + MARGIN;

    return { devPositions, pinPositions, contentW: Math.max(maxR, 600), contentH: Math.max(maxB, 300) };
  }, [filteredDevices]);

  /* ── Base hub positions for signals with >2 endpoints (spread out vertically) ── */
  const hubBasePositions = useMemo(() => {
    const hubs = new Map<number, Pos>();
    const multiSigs = filteredSignals.filter(s => s.endpoints.filter(ep => ep.pinId).length > 2);
    // Place hubs in the center of the channel, spaced vertically
    let hubIdx = 0;
    for (const sig of multiSigs) {
      const positions = sig.endpoints
        .filter(ep => ep.pinId)
        .map(ep => {
          const base = layout.pinPositions.get(ep.pinId!);
          if (!base) return null;
          const o = offsets[ep.deviceId] || { dx: 0, dy: 0 };
          return { x: base.x + o.dx, y: base.y + o.dy };
        })
        .filter(Boolean) as Pos[];
      if (positions.length >= 2) {
        const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
        const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
        // Spread hubs apart: offset each by 40px vertically from center
        const spreadOffset = (hubIdx - (multiSigs.length - 1) / 2) * 40;
        hubs.set(sig.id, { x: cx, y: cy + spreadOffset });
        hubIdx++;
      }
    }
    return hubs;
  }, [signals, layout, offsets]);

  /* ── Final hub positions = base + user drag offset ── */
  const hubPositions = useMemo(() => {
    const result = new Map<number, Pos>();
    for (const [id, base] of hubBasePositions) {
      const ho = hubOffsets[id] || { dx: 0, dy: 0 };
      result.set(id, { x: base.x + ho.dx, y: base.y + ho.dy });
    }
    return result;
  }, [hubBasePositions, hubOffsets]);

  /* ── Content bounding box (expand with drag) ── */
  const contentBounds = useMemo(() => {
    let maxR = layout.contentW, maxB = layout.contentH;
    for (const dp of layout.devPositions) {
      const o = offsets[dp.dev.id] || { dx: 0, dy: 0 };
      const maxCW = dp.dev.connectors.length > 0 ? Math.max(...dp.dev.connectors.map(c => connW(c.pins))) : 0;
      maxR = Math.max(maxR, dp.x + o.dx + dp.bW + maxCW + PIN_SQ + MARGIN);
      maxB = Math.max(maxB, dp.y + o.dy + dp.bH + MARGIN);
    }
    return { w: maxR, h: maxB };
  }, [layout, offsets]);

  /* ── Center offset: shift content so it's centered in the viewport ── */
  const centerOffset = useMemo(() => {
    const cw = containerSize.w, ch = containerSize.h;
    if (cw === 0 || ch === 0) return { dx: 0, dy: 0 };
    const dx = Math.max(0, (cw - contentBounds.w) / 2);
    const dy = Math.max(0, (ch - contentBounds.h) / 2);
    return { dx, dy };
  }, [containerSize, contentBounds]);

  const svgW = Math.max(contentBounds.w + centerOffset.dx * 2, containerSize.w);
  const svgH = Math.max(contentBounds.h + centerOffset.dy * 2, containerSize.h);

  /* ── Track container size for centering ── */
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ── Drag ── */
  const onMouseDown = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const o = offsets[id] || { dx: 0, dy: 0 };
    setDrag({ id, mx: e.clientX, my: e.clientY, ox: o.dx, oy: o.dy });
  }, [offsets]);
  const onHubMouseDown = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const o = hubOffsets[id] || { dx: 0, dy: 0 };
    setHubDrag({ id, mx: e.clientX, my: e.clientY, ox: o.dx, oy: o.dy });
  }, [hubOffsets]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (hubDrag) {
      setHubOffsets(p => ({ ...p, [hubDrag.id]: { dx: hubDrag.ox + e.clientX - hubDrag.mx, dy: hubDrag.oy + e.clientY - hubDrag.my } }));
    } else if (drag) {
      setOffsets(p => ({ ...p, [drag.id]: { dx: drag.ox + e.clientX - drag.mx, dy: drag.oy + e.clientY - drag.my } }));
    }
  }, [drag, hubDrag]);
  const onMouseUp = useCallback(() => { setDrag(null); setHubDrag(null); }, []);

  /* ── SVG export ── */
  const handleExport = useCallback(() => {
    if (!svgRef.current) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgRef.current)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `signal-group-${groupName}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [groupName]);

  /* ── Render: one device (body + connectors + pins) — matches EICDDiagram style ── */
  function renderDevice(dp: { dev: DeviceData; x: number; y: number; bW: number; bH: number; right: boolean }) {
    const dev = dp.dev;
    const o = offsets[dev.id] || { dx: 0, dy: 0 };
    const dx = dp.x + o.dx, dy = dp.y + o.dy;
    const bW = dp.bW, bH = dp.bH;
    const right = dp.right;
    const label = dev.设备中文名称 ? `${dev.设备编号} (${dev.设备中文名称})` : dev.设备编号;

    // ATA-based colors
    const ch = ataChapter(dev.ata);
    const ataIdx = ataColorMap.get(ch);
    const palette = isDark ? ATA_COLORS_DARK : ATA_COLORS;
    const devFill = ataIdx !== undefined ? palette[ataIdx].devFill : C.devFill;
    const devBorder = ataIdx !== undefined ? palette[ataIdx].devBorder : C.devBorder;

    const els: JSX.Element[] = [];

    // Device body
    els.push(
      <rect key={`d-${dev.id}`} x={dx} y={dy} width={bW} height={bH} rx={6}
        fill={devFill} stroke={devBorder} strokeWidth={1.5}
        style={{ cursor: 'grab' }}
        onMouseDown={e => onMouseDown(dev.id, e)} />
    );

    // ATA badge (small tag in top-right/top-left corner)
    {ch && els.push(
      <text key={`ata-${dev.id}`} x={right ? dx + bW - 4 : dx + 4} y={dy + bH - 4}
        textAnchor={right ? 'end' : 'start'} fontSize={7} fill={devBorder} opacity={0.7}
        style={{ pointerEvents: 'none' }}>
        ATA {dev.ata}
      </text>
    );}

    // Device label (centered in body top)
    els.push(
      <text key={`dl-${dev.id}`} x={dx + bW / 2} y={dy + DEV_PAD / 2 + 6}
        textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill={C.devText}
        style={{ pointerEvents: 'none' }}>
        {label}
      </text>
    );

    // Connectors
    const totalCH = dev.connectors.reduce((s, c) => s + connH(c), 0) + Math.max(0, dev.connectors.length - 1) * CONN_GAP;
    let cy = dy + (bH - totalCH) / 2;

    for (const conn of dev.connectors) {
      const cH = connH(conn);
      const cW = connW(conn.pins);
      const cx = right ? dx + bW : dx - cW;

      // Connector rect (outside device body)
      els.push(
        <rect key={`c-${conn.id}`} x={cx} y={cy} width={cW} height={cH} rx={3}
          fill={C.connFill} stroke={C.connBorder} strokeWidth={1} />
      );

      // Connector label: vertical, inside device body
      const vlX = right ? dx + bW - 7 : dx + 7;
      const vlY = cy + cH / 2;
      els.push(
        <text key={`cl-${conn.id}`} x={vlX} y={vlY}
          textAnchor="middle" dominantBaseline="central"
          fontSize={9} fill={C.connText} fontWeight={500}
          transform={`rotate(-90, ${vlX}, ${vlY})`}
          style={{ pointerEvents: 'none' }}>
          {conn.设备端元器件编号}
        </text>
      );

      // Pins
      const n = conn.pins.length;
      const pinStackH = n * PIN_SQ + Math.max(0, n - 1) * PIN_GAP;
      let pinY = cy + (cH - pinStackH) / 2;

      for (const pin of conn.pins) {
        const pinX = right ? cx + cW : cx - PIN_SQ;

        // Pin square
        els.push(
          <rect key={`p-${pin.id}`} x={pinX} y={pinY} width={PIN_SQ} height={PIN_SQ} rx={2}
            fill={C.pinFill} stroke={C.pinBorder} strokeWidth={1} />
        );

        // Pin label inside connector rect
        const plX = right ? cx + cW - 2 : cx + 2;
        const plAnchor: 'end' | 'start' = right ? 'end' : 'start';
        els.push(
          <text key={`pl-${pin.id}`} x={plX} y={pinY + PIN_SQ / 2}
            textAnchor={plAnchor} dominantBaseline="central"
            fontSize={8} fontFamily="monospace" fill={C.pinText} style={{ pointerEvents: 'none' }}>
            {pin.针孔号}
          </text>
        );

        pinY += PIN_SQ + PIN_GAP;
      }

      cy += cH + CONN_GAP;
    }

    return <g key={`dev-${dev.id}`}>{els}</g>;
  }

  /* ── Render: wires ── */
  function renderWires() {
    const els: JSX.Element[] = [];

    for (const sig of filteredSignals) {
      const color = signalColorMap.get(sig.id) || '#999';
      const isHighlighted = sig.id === highlightSignalId;
      const opacity = isHighlighted && !flashOn ? 0.15 : 0.85;
      const strokeW = isHighlighted ? 2.5 : 1.5;
      const eps = sig.endpoints.filter(ep => ep.pinId);

      if (eps.length === 2) {
        const p0 = layout.pinPositions.get(eps[0].pinId!);
        const p1 = layout.pinPositions.get(eps[1].pinId!);
        if (p0 && p1) {
          const o0 = offsets[eps[0].deviceId] || { dx: 0, dy: 0 };
          const o1 = offsets[eps[1].deviceId] || { dx: 0, dy: 0 };
          const from = { x: p0.x + o0.dx, y: p0.y + o0.dy };
          const to = { x: p1.x + o1.dx, y: p1.y + o1.dy };
          els.push(
            <path key={`w-${sig.id}`} d={wirePath(from, to)}
              fill="none" stroke={color} strokeWidth={strokeW} opacity={opacity} />
          );
          const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
          els.push(
            <text key={`wl-${sig.id}`} x={mx} y={my - 5}
              textAnchor="middle" fontSize={8} fill={color} opacity={opacity}
              style={{ pointerEvents: 'none' }}>
              {sig.unique_id}
            </text>
          );
        }
      } else if (eps.length > 2) {
        const hub = hubPositions.get(sig.id);
        if (hub) {
          // Bezier curves from each endpoint to hub boundary
          for (const ep of eps) {
            const p = layout.pinPositions.get(ep.pinId!);
            if (p) {
              const o = offsets[ep.deviceId] || { dx: 0, dy: 0 };
              const from = { x: p.x + o.dx, y: p.y + o.dy };
              // Offset target to circle boundary instead of center
              const ddx = from.x - hub.x, ddy = from.y - hub.y;
              const dist = Math.sqrt(ddx * ddx + ddy * ddy);
              const to = dist > 0
                ? { x: hub.x + ddx / dist * HUB_RADIUS, y: hub.y + ddy / dist * HUB_RADIUS }
                : hub;
              els.push(
                <path key={`hw-${sig.id}-${ep.endpointId}`} d={wirePath(from, to)}
                  fill="none" stroke={color} strokeWidth={strokeW} opacity={opacity} />
              );
            }
          }
          // Hub dot (draggable, drawn on top of lines)
          els.push(
            <circle key={`hub-${sig.id}`} cx={hub.x} cy={hub.y} r={HUB_RADIUS}
              fill={color} opacity={opacity} style={{ cursor: 'grab' }}
              onMouseDown={e => onHubMouseDown(sig.id, e)} />
          );
        }
      } else if (eps.length === 1) {
        const p = layout.pinPositions.get(eps[0].pinId!);
        if (p) {
          const o = offsets[eps[0].deviceId] || { dx: 0, dy: 0 };
          const px = p.x + o.dx, py = p.y + o.dy;
          els.push(
            <line key={`stub-${sig.id}`} x1={px} y1={py} x2={px + 30} y2={py}
              stroke={color} strokeWidth={strokeW} opacity={opacity * 0.6} strokeDasharray="3,2" />
          );
          els.push(
            <text key={`sl-${sig.id}`} x={px + 32} y={py + 3}
              fontSize={8} fill={color} opacity={opacity} style={{ pointerEvents: 'none' }}>
              {sig.unique_id}
            </text>
          );
        }
      }
    }

    return els;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 px-3 py-1.5 border-b border-gray-200 dark:border-white/10 flex items-center gap-3 bg-gray-50 dark:bg-neutral-800/50">
        <button onClick={handleExport}
          className="px-2 py-0.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700">
          导出 SVG
        </button>
        <span className="text-xs text-gray-500 dark:text-white/40">
          协议组: <b className="text-gray-700 dark:text-white/70">{groupName}</b>
          &nbsp;·&nbsp;{filteredSignals.length}/{signals.length} 个信号&nbsp;·&nbsp;{filteredDevices.length} 个设备
        </span>

        {/* Signal filter */}
        <div className="relative ml-auto">
          <button onClick={() => setShowSignalFilter(f => !f)}
            className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/15 rounded hover:bg-gray-100 dark:hover:bg-neutral-800">
            筛选信号{visibleSignalIds ? ` (${visibleSignalIds.size}/${signals.length})` : ''}
          </button>
          {showSignalFilter && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-white/15 rounded shadow-lg p-2 min-w-[200px] max-h-[260px] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex gap-2 mb-2 border-b border-gray-100 dark:border-white/10 pb-2">
                <button onClick={() => setVisibleSignalIds(null)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">全选</button>
                <button onClick={() => {
                  const cur = visibleSignalIds ?? new Set(signals.map(s => s.id));
                  const inverted = new Set(signals.filter(s => !cur.has(s.id)).map(s => s.id));
                  setVisibleSignalIds(inverted.size === signals.length ? null : inverted);
                }} className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">反选</button>
              </div>
              {signals.map(sig => {
                const checked = !visibleSignalIds || visibleSignalIds.has(sig.id);
                const color = signalColorMap.get(sig.id) || '#999';
                return (
                  <label key={sig.id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 py-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-700 px-1 rounded">
                    <input type="checkbox" checked={checked}
                      onChange={() => {
                        setVisibleSignalIds(prev => {
                          const cur = prev ?? new Set(signals.map(s => s.id));
                          const next = new Set(cur);
                          if (next.has(sig.id)) next.delete(sig.id); else next.add(sig.id);
                          if (next.size === signals.length) return null;
                          return next;
                        });
                      }}
                      className="rounded border-gray-300 dark:border-white/20 w-3 h-3" />
                    <span className="w-3 h-0.5 rounded shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate max-w-[140px] font-mono" title={sig.unique_id}>{sig.unique_id}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SVG area */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-white dark:bg-slate-900"
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg"
          width={svgW} height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ minWidth: svgW, minHeight: svgH, userSelect: 'none' }}>
          <rect width={svgW} height={svgH} fill={C.bg} />
          <g transform={`translate(${centerOffset.dx}, ${centerOffset.dy})`}>
            {renderWires()}
            {layout.devPositions.map(dp => renderDevice(dp))}

            {/* Legend */}
            {(() => {
              const legendY = Math.max(...layout.devPositions.map(d => d.y + d.bH + (offsets[d.dev.id]?.dy || 0)), 200) + 20;
              const ataEntries = [...ataColorMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
              const palette = isDark ? ATA_COLORS_DARK : ATA_COLORS;
              return (
                <g transform={`translate(${MARGIN}, ${legendY})`}>
                  {/* ATA legend */}
                  {ataEntries.length > 1 && (<>
                    <text x={0} y={0} fontSize={9} fontWeight={600} fill={C.legendText}>ATA 系统</text>
                    {ataEntries.map(([ch, idx], i) => (
                      <g key={ch} transform={`translate(0, ${14 + i * 14})`}>
                        <rect x={0} y={-7} width={14} height={10} rx={2}
                          fill={palette[idx].devFill} stroke={palette[idx].devBorder} strokeWidth={1} />
                        <text x={18} y={0} fontSize={8} fill={C.legendText}>ATA {ch}</text>
                      </g>
                    ))}
                  </>)}

                  {/* Signal legend */}
                  <g transform={`translate(0, ${ataEntries.length > 1 ? 14 + ataEntries.length * 14 + 6 : 0})`}>
                    <text x={0} y={0} fontSize={9} fontWeight={600} fill={C.legendText}>信号图例</text>
                    {filteredSignals.map((sig, i) => {
                      const color = signalColorMap.get(sig.id) || '#999';
                      return (
                        <g key={sig.id} transform={`translate(0, ${14 + i * 14})`}>
                          <line x1={0} y1={-3} x2={18} y2={-3} stroke={color} strokeWidth={2} />
                          {sig.endpoints.length > 2 && (
                            <circle cx={9} cy={-3} r={3} fill={color} />
                          )}
                          <text x={22} y={0} fontSize={8} fill={C.legendText}>
                            {sig.unique_id}{sig.信号名称摘要 ? ` (${sig.信号名称摘要})` : ''}{sig.endpoints.length > 2 ? ` [${sig.endpoints.length}端点]` : ''}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })()}
          </g>
        </svg>
      </div>
    </div>
  );
}
