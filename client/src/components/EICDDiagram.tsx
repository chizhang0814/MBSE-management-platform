import React, { useRef, useMemo, useCallback, useState } from 'react';

/* ───────── Types ───────── */

interface PinData { id: number; 针孔号: string; }
interface ConnectorData { id: number; 设备端元器件编号: string; pins: PinData[]; }
interface DeviceData { id: number; 设备编号: string; 设备中文名称?: string; ata?: string | null; connectors: ConnectorData[]; }
interface ConnectionData {
  signalId: number; signalUniqueId?: string; signalStatus: string;
  mainPinId: number; remotePinId: number; remoteDeviceId: number;
  direction?: 'toRemote' | 'toMain' | 'bidirectional' | 'unknown';
  signalGroup?: string | null;
}

interface SignalGroupInfo { present: string[]; missing: string[]; }

export type Selection =
  | { type: 'device'; deviceId: number }
  | { type: 'connector'; connectorId: number; deviceId: number }
  | { type: 'pin'; pinId: number; connectorId: number; deviceId: number }
  | { type: 'signal'; signalId: number }
  | null;

export interface EICDDiagramProps {
  mainDevice: DeviceData;
  remoteDevices: DeviceData[];
  connections: ConnectionData[];
  signalGroups?: Record<string, SignalGroupInfo>;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onDblClick?: (sel: NonNullable<Selection>) => void;
}

/* ───────── Layout Constants ───────── */

const PIN_SQ = 12;               // pin square size
const PIN_GAP = 4;               // vertical gap between pins (uniform everywhere)
const CONN_MIN_H = 20;           // min connector height
const CONN_GAP = 14;             // gap between connectors on device edge
const DEV_PAD = 16;              // padding inside device (top/bottom)
const DEV_MIN_BODY_W = 100;
const CHANNEL_W = 340;           // horizontal gap between main pin edge and remote pin edge
const REMOTE_GAP = 32;           // vertical gap between remote devices
const MARGIN = 40;

/* ───────── Colours ───────── */

function getColors(dark: boolean) {
  return dark ? {
    bg: '#0F172A',
    devFill: '#1E293B', devBorder: '#3B82F6', devText: '#E2E8F0',
    connFill: '#1E3A5F', connBorder: '#60A5FA', connText: '#93C5FD',
    pinFill: '#78350F', pinBorder: '#F59E0B', pinText: '#FCD34D',
    wireApproved: '#34D399', wirePending: '#6B7280',
    selStroke: '#F472B6', legendText: '#94A3B8',
    arrowToRemote: '#60A5FA',   // blue — main→remote
    arrowToMain: '#F59E0B',     // amber — remote→main
    arrowBidi: '#A78BFA',       // purple — bidirectional
  } : {
    bg: '#FFFFFF',
    devFill: '#ECFDF5', devBorder: '#059669', devText: '#064E3B',
    connFill: '#EFF6FF', connBorder: '#3B82F6', connText: '#1D4ED8',
    pinFill: '#FFFBEB', pinBorder: '#D97706', pinText: '#92400E',
    wireApproved: '#059669', wirePending: '#9CA3AF',
    selStroke: '#EC4899', legendText: '#6B7280',
    arrowToRemote: '#3B82F6',   // blue — main→remote
    arrowToMain: '#D97706',     // amber — remote→main
    arrowBidi: '#7C3AED',       // purple — bidirectional
  };
}

/* ───────── ATA Color Palette ───────── */

const ATA_COLORS = [
  { devFill: '#ECFDF5', devBorder: '#059669' },
  { devFill: '#EFF6FF', devBorder: '#2563EB' },
  { devFill: '#FEF3C7', devBorder: '#D97706' },
  { devFill: '#FDE2E2', devBorder: '#DC2626' },
  { devFill: '#F3E8FF', devBorder: '#7C3AED' },
  { devFill: '#E0F2FE', devBorder: '#0284C7' },
  { devFill: '#FFF1F2', devBorder: '#E11D48' },
  { devFill: '#ECFEFF', devBorder: '#0891B2' },
  { devFill: '#F0FDF4', devBorder: '#16A34A' },
  { devFill: '#FEF9C3', devBorder: '#CA8A04' },
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

/* ───────── Helpers ───────── */

function approxW(text: string, charW: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) > 0x2e80 ? charW * 1.6 : charW;
  return w;
}

function isApproved(s: string): boolean {
  const l = s.toLowerCase();
  return l === 'normal' || l === 'active' || l === 'approved';
}

/* ───────── Geometry calculations ───────── */

/** Width of connector rect: just enough for pin labels. */
function connW(pins: PinData[]): number {
  if (pins.length === 0) return PIN_SQ;
  const maxLabel = Math.max(...pins.map(p => approxW(p.针孔号, 6)));
  return Math.max(PIN_SQ, maxLabel + 4);
}

/** Height of connector rect: fits pin stack AND vertical connector label (capped). */
function connH(conn: ConnectorData): number {
  const n = conn.pins.length;
  const pinStackH = n === 0 ? 0 : n * PIN_SQ + (n - 1) * PIN_GAP;
  const pinH = pinStackH + 8; // 4px padding top + bottom for centering
  const labelH = Math.min(approxW(conn.设备端元器件编号, 7) + 10, 80); // cap label height at 80
  return Math.max(CONN_MIN_H, pinH, labelH);
}

/** Height of device body: must fit all connectors stacked + padding. */
function devBodyH(connectors: ConnectorData[]): number {
  if (connectors.length === 0) return DEV_PAD * 2 + 24;
  const total = connectors.reduce((s, c) => s + connH(c), 0) + (connectors.length - 1) * CONN_GAP;
  return DEV_PAD * 2 + total;
}

/** Width of device body: fits device name. */
function devBodyW(device: DeviceData): number {
  const nameLine = device.设备中文名称 ? `${device.设备编号} (${device.设备中文名称})` : device.设备编号;
  const nameW = approxW(nameLine, 7.5) + 20;
  return Math.max(DEV_MIN_BODY_W, nameW);
}

/* ───────── Pin position builder ───────── */

interface Pos { x: number; y: number; }

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
    let pinY = cy + (cH - pinStackH) / 2; // centered vertically

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

/* ───────── Crossing minimization ───────── */

function sortRemoteDevices(
  remotes: DeviceData[], conns: ConnectionData[], mainPins: Map<number, Pos>,
): DeviceData[] {
  if (remotes.length <= 1) return remotes;
  const scores = new Map<number, number>();
  for (const rd of remotes) {
    const ys = conns.filter(c => c.remoteDeviceId === rd.id)
      .map(c => mainPins.get(c.mainPinId)?.y ?? 0);
    scores.set(rd.id, ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity);
  }
  return [...remotes].sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0));
}

function sortPinsInRemote(device: DeviceData, conns: ConnectionData[], mainPins: Map<number, Pos>): DeviceData {
  return {
    ...device,
    connectors: device.connectors.map(conn => {
      const scored = conn.pins.map(pin => {
        const cs = conns.filter(c => c.remotePinId === pin.id);
        const avg = cs.length > 0 ? cs.reduce((s, c) => s + (mainPins.get(c.mainPinId)?.y ?? 0), 0) / cs.length : Infinity;
        return { pin, avg };
      });
      scored.sort((a, b) => a.avg - b.avg);
      return { ...conn, pins: scored.map(s => s.pin) };
    }),
  };
}

/* ───────── Connection path & arrows ───────── */

function wirePath(from: Pos, to: Pos): string {
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const dx = to.x - from.x;
  const cp = Math.min(Math.abs(dx) * 0.4, 100);
  return `M ${from.x} ${from.y} C ${from.x + cp} ${from.y}, ${to.x - cp} ${to.y}, ${to.x} ${to.y}`;
}

/** Evaluate cubic bezier at parameter t ∈ [0,1]. */
function bezierPoint(from: Pos, to: Pos, t: number): Pos {
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
  const dx = to.x - from.x;
  const cp = Math.min(Math.abs(dx) * 0.4, 100);
  const p0x = from.x, p0y = from.y;
  const p1x = from.x + cp, p1y = from.y;
  const p2x = to.x - cp, p2y = to.y;
  const p3x = to.x, p3y = to.y;
  const u = 1 - t;
  return {
    x: u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x,
    y: u * u * u * p0y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y,
  };
}

/** Tangent vector (dx, dy) of cubic bezier at parameter t. */
function bezierTangent(from: Pos, to: Pos, t: number): Pos {
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) {
    return { x: to.x - from.x, y: to.y - from.y };
  }
  const dx = to.x - from.x;
  const cp = Math.min(Math.abs(dx) * 0.4, 100);
  const p0x = from.x, p0y = from.y;
  const p1x = from.x + cp, p1y = from.y;
  const p2x = to.x - cp, p2y = to.y;
  const p3x = to.x, p3y = to.y;
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1x - p0x) + 6 * u * t * (p2x - p1x) + 3 * t * t * (p3x - p2x),
    y: 3 * u * u * (p1y - p0y) + 6 * u * t * (p2y - p1y) + 3 * t * t * (p3y - p2y),
  };
}

/** Draw an arrowhead at parameter t along a wire from→to pointing in tangent direction. */
function arrowAt(from: Pos, to: Pos, t: number, color: string, key: string, flip?: boolean): JSX.Element {
  const pt = bezierPoint(from, to, t);
  const tg = bezierTangent(from, to, t);
  const len = Math.sqrt(tg.x * tg.x + tg.y * tg.y);
  if (len === 0) return <g key={key} />;
  let ux = tg.x / len, uy = tg.y / len;
  if (flip) { ux = -ux; uy = -uy; }
  const sz = 5; // arrowhead size
  // Two points of the arrowhead (perpendicular offsets)
  const ax = pt.x - ux * sz + uy * sz * 0.5;
  const ay = pt.y - uy * sz - ux * sz * 0.5;
  const bx = pt.x - ux * sz - uy * sz * 0.5;
  const by = pt.y - uy * sz + ux * sz * 0.5;
  return (
    <polygon key={key}
      points={`${pt.x},${pt.y} ${ax},${ay} ${bx},${by}`}
      fill={color} style={{ pointerEvents: 'none' }} />
  );
}

/* ───────── Twisted pair markers (IEC 60617 figure-eight style) ───────── */

const TWIST_MARKER_INTERVAL = 30; // pixels between twist markers along the wire path
const TWIST_MARKER_SIZE = 4;      // half-size of each figure-eight marker

/* ═══════════ Component ═══════════ */

export default function EICDDiagram({ mainDevice, remoteDevices, connections, signalGroups, selection, onSelect, onDblClick }: EICDDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDark = document.documentElement.classList.contains('dark');
  const C = getColors(isDark);

  const [offsets, setOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [drag, setDrag] = useState<{ id: number; mx: number; my: number; ox: number; oy: number } | null>(null);
  const [twistedView, setTwistedView] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');

  /* ── Connected remote device list (stable) ── */
  const connectedRemotes = useMemo(() => {
    const ids = [...new Set(connections.map(c => c.remoteDeviceId))];
    return remoteDevices.filter(rd => ids.includes(rd.id));
  }, [connections, remoteDevices]);

  /* ── ATA color map ── */
  const ataColorMap = useMemo(() => {
    const allDevices = [mainDevice, ...remoteDevices];
    const chapters = [...new Set(allDevices.map(d => ataChapter(d.ata)).filter(Boolean))].sort();
    const m = new Map<string, number>();
    chapters.forEach((ch, i) => m.set(ch, i % ATA_COLORS.length));
    return m;
  }, [mainDevice, remoteDevices]);

  const [visibleDeviceIds, setVisibleDeviceIds] = useState<Set<number> | null>(null); // null = show all

  /* ── Filter to connected items ── */
  const filterDev = useCallback((d: DeviceData, pinIds: Set<number>): DeviceData => {
    const connIds = new Set<number>();
    for (const c of d.connectors) for (const p of c.pins) if (pinIds.has(p.id)) { connIds.add(c.id); break; }
    return {
      ...d,
      connectors: d.connectors.filter(c => connIds.has(c.id)).map(c => ({ ...c, pins: c.pins.filter(p => pinIds.has(p.id)) })),
    };
  }, []);

  /* ── Apply device filter ── */
  const filteredConns = useMemo(() => {
    if (!visibleDeviceIds) return connections;
    return connections.filter(c => visibleDeviceIds.has(c.remoteDeviceId));
  }, [connections, visibleDeviceIds]);

  const filteredRemotes = useMemo(() => {
    if (!visibleDeviceIds) return remoteDevices;
    return remoteDevices.filter(rd => visibleDeviceIds.has(rd.id));
  }, [remoteDevices, visibleDeviceIds]);

  /* ── Layout ── */
  const layout = useMemo(() => {
    const mainPinIds = new Set(filteredConns.map(c => c.mainPinId));
    const remotePinIds = new Set(filteredConns.map(c => c.remotePinId));

    const mDev = filterDev(mainDevice, mainPinIds);
    const mBW = devBodyW(mDev);
    const mBH = devBodyH(mDev.connectors);
    const mX = MARGIN;
    const mY = MARGIN;
    const mainPins = buildPinPositions(mDev, mX, mY, mBW, true);

    const maxMainCW = mDev.connectors.length > 0
      ? Math.max(...mDev.connectors.map(c => connW(c.pins))) : 0;

    const filtered = filteredRemotes.filter(rd => filteredConns.some(c => c.remoteDeviceId === rd.id)).map(rd => filterDev(rd, remotePinIds));
    const sorted = sortRemoteDevices(filtered, filteredConns, mainPins);
    const optimized = sorted.map(rd => sortPinsInRemote(rd, filteredConns, mainPins));

    // Compute a single unified maxRCW so all remote devices align horizontally
    const globalMaxRCW = optimized.length > 0
      ? Math.max(...optimized.flatMap(rd => rd.connectors.length > 0
          ? rd.connectors.map(c => connW(c.pins)) : [0]))
      : 0;

    let ry = mY;
    const rLayouts: { dev: DeviceData; x: number; y: number; bw: number; bh: number }[] = [];
    for (const rd of optimized) {
      const bw = devBodyW(rd);
      const bh = devBodyH(rd.connectors);
      const rx = mX + mBW + maxMainCW + PIN_SQ + CHANNEL_W + PIN_SQ + globalMaxRCW;
      rLayouts.push({ dev: rd, x: rx, y: ry, bw, bh });
      ry += bh + REMOTE_GAP;
    }

    // Vertical centering
    const totalRH = ry - mY - (optimized.length > 0 ? REMOTE_GAP : 0);
    let adjMY = mY;
    if (totalRH > mBH) {
      adjMY = mY + (totalRH - mBH) / 2;
    } else if (mBH > totalRH) {
      const off = (mBH - totalRH) / 2;
      for (const rl of rLayouts) rl.y += off;
    }

    const maxRight = rLayouts.length > 0 ? Math.max(...rLayouts.map(r => r.x + r.bw)) + MARGIN : mX + mBW + maxMainCW + PIN_SQ + 400;
    // Reserve space at bottom: status legend row (22px) + ATA legend block above it
    const ataCount = ataColorMap.size;
    const legendH = 22 + (ataCount > 1 ? 14 + ataCount * 14 + 16 : 0);
    const maxBot = Math.max(adjMY + mBH, ...rLayouts.map(r => r.y + r.bh)) + MARGIN + legendH;

    return { mDev, mX, mY: adjMY, mBW, mBH, rLayouts, baseSvgW: Math.max(maxRight, 600), baseSvgH: Math.max(maxBot, 200) };
  }, [mainDevice, filteredRemotes, filteredConns, filterDev]);

  /* ── Pin positions with drag offsets ── */
  const { mPins, rPins } = useMemo(() => {
    const mo = offsets[layout.mDev.id] || { dx: 0, dy: 0 };
    const mp = buildPinPositions(layout.mDev, layout.mX + mo.dx, layout.mY + mo.dy, layout.mBW, true);
    const rp = new Map<number, Pos>();
    for (const rl of layout.rLayouts) {
      const o = offsets[rl.dev.id] || { dx: 0, dy: 0 };
      const pins = buildPinPositions(rl.dev, rl.x + o.dx, rl.y + o.dy, rl.bw, false);
      pins.forEach((v, k) => rp.set(k, v));
    }
    return { mPins: mp, rPins: rp };
  }, [layout, offsets]);

  /* ── Legend height (for SVG bottom reservation) ── */
  const legendH = useMemo(() => {
    const ataCount = ataColorMap.size;
    return 22 + (ataCount > 1 ? 14 + ataCount * 14 + 16 : 0);
  }, [ataColorMap]);

  /* ── Dynamic SVG size: expand canvas when devices are dragged beyond initial bounds ── */
  const { svgW, svgH } = useMemo(() => {
    let maxR = layout.baseSvgW;
    let maxB = layout.baseSvgH;
    // Main device bounding box with offset
    const mo = offsets[layout.mDev.id] || { dx: 0, dy: 0 };
    const mMaxCW = layout.mDev.connectors.length > 0
      ? Math.max(...layout.mDev.connectors.map(c => connW(c.pins))) : 0;
    maxR = Math.max(maxR, layout.mX + mo.dx + layout.mBW + mMaxCW + PIN_SQ + MARGIN);
    maxB = Math.max(maxB, layout.mY + mo.dy + layout.mBH + MARGIN + legendH);
    // Remote devices bounding box with offsets
    for (const rl of layout.rLayouts) {
      const o = offsets[rl.dev.id] || { dx: 0, dy: 0 };
      maxR = Math.max(maxR, rl.x + o.dx + rl.bw + MARGIN);
      maxB = Math.max(maxB, rl.y + o.dy + rl.bh + MARGIN + legendH);
    }
    return { svgW: maxR, svgH: maxB };
  }, [layout, offsets]);

  /* ── SVG export ── */
  const handleExport = useCallback(() => {
    if (!svgRef.current) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svgRef.current)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `EICD-${mainDevice.设备编号}.svg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [mainDevice.设备编号]);

  /* ── Drag ── */
  const onMouseDown = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const o = offsets[id] || { dx: 0, dy: 0 };
    setDrag({ id, mx: e.clientX, my: e.clientY, ox: o.dx, oy: o.dy });
  }, [offsets]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return;
    setOffsets(p => ({ ...p, [drag.id]: { dx: drag.ox + e.clientX - drag.mx, dy: drag.oy + e.clientY - drag.my } }));
  }, [drag]);
  const onMouseUp = useCallback(() => setDrag(null), []);

  /* ── Selection highlight helper ── */
  function isSelected(type: string, id: number): boolean {
    if (!selection) return false;
    if (type === 'device') return selection.type === 'device' && selection.deviceId === id;
    if (type === 'connector') return selection.type === 'connector' && selection.connectorId === id;
    if (type === 'pin') return selection.type === 'pin' && selection.pinId === id;
    if (type === 'signal') return selection.type === 'signal' && selection.signalId === id;
    return false;
  }

  /* ── Render: one device (body + connectors + pins) ── */
  function renderDevice(dev: DeviceData, dx: number, dy: number, bw: number, bh: number, right: boolean, draggable: boolean) {
    const els: JSX.Element[] = [];
    const sel = isSelected('device', dev.id);
    const label = dev.设备中文名称 ? `${dev.设备编号} (${dev.设备中文名称})` : dev.设备编号;

    // ATA-based colors
    const ch = ataChapter(dev.ata);
    const ataIdx = ataColorMap.get(ch);
    const palette = isDark ? ATA_COLORS_DARK : ATA_COLORS;
    const devFill = ataIdx !== undefined ? palette[ataIdx].devFill : C.devFill;
    const devBorder = ataIdx !== undefined ? palette[ataIdx].devBorder : C.devBorder;

    // Device body
    els.push(
      <rect key={`d-${dev.id}`} x={dx} y={dy} width={bw} height={bh} rx={6}
        fill={devFill} stroke={sel ? C.selStroke : devBorder} strokeWidth={sel ? 2.5 : 1.5}
        style={{ cursor: draggable ? 'grab' : 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onSelect({ type: 'device', deviceId: dev.id }); }}
        onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick({ type: 'device', deviceId: dev.id }); } : undefined}
        onMouseDown={draggable ? (e) => onMouseDown(dev.id, e) : undefined}
      />
    );

    // ATA badge (below device body, outside)
    if (ch) {
      els.push(
        <text key={`ata-${dev.id}`} x={dx + bw / 2} y={dy + bh + 10}
          textAnchor="middle" fontSize={7} fill={devBorder} opacity={0.7}
          style={{ pointerEvents: 'none' }}>
          ATA {dev.ata}
        </text>
      );
    }

    // Device label (centered in body, top area)
    els.push(
      <text key={`dl-${dev.id}`} x={dx + bw / 2} y={dy + DEV_PAD / 2 + 6}
        textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600} fill={C.devText}
        style={{ pointerEvents: 'none' }}>
        {label}
      </text>
    );

    // Connectors
    const totalCH = dev.connectors.reduce((s, c) => s + connH(c), 0) + Math.max(0, dev.connectors.length - 1) * CONN_GAP;
    let cy = dy + (bh - totalCH) / 2;

    for (const conn of dev.connectors) {
      const cH = connH(conn);
      const cW = connW(conn.pins);
      const cSel = isSelected('connector', conn.id);

      // Connector rect (outside device body)
      const cx = right ? dx + bw : dx - cW;

      els.push(
        <rect key={`c-${conn.id}`} x={cx} y={cy} width={cW} height={cH} rx={3}
          fill={C.connFill} stroke={cSel ? C.selStroke : C.connBorder} strokeWidth={cSel ? 2 : 1}
          style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'connector', connectorId: conn.id, deviceId: dev.id }); }}
          onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick({ type: 'connector', connectorId: conn.id, deviceId: dev.id }); } : undefined}
        />
      );

      // Connector label: vertical, inside device body, adjacent to the connector
      const vlX = right ? dx + bw - 7 : dx + 7;
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

      // Pins (attached outside connector, centered vertically in connector)
      const n = conn.pins.length;
      const pinStackH = n * PIN_SQ + Math.max(0, n - 1) * PIN_GAP;
      let pinY = cy + (cH - pinStackH) / 2;

      for (const pin of conn.pins) {
        const pSel = isSelected('pin', pin.id);
        const pinX = right ? cx + cW : cx - PIN_SQ;

        // Pin square
        els.push(
          <rect key={`p-${pin.id}`} x={pinX} y={pinY} width={PIN_SQ} height={PIN_SQ} rx={2}
            fill={C.pinFill} stroke={pSel ? C.selStroke : C.pinBorder} strokeWidth={pSel ? 2 : 1}
            style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect({ type: 'pin', pinId: pin.id, connectorId: conn.id, deviceId: dev.id }); }}
            onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick({ type: 'pin', pinId: pin.id, connectorId: conn.id, deviceId: dev.id }); } : undefined}
          />
        );

        // Pin label inside connector rect, adjacent to pin
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

    return els;
  }

  /* ── Build group index for twisted view ── */
  const groupIndex = useMemo(() => {
    if (!twistedView) return null;
    const groups = new Map<string, ConnectionData[]>();
    for (const conn of filteredConns) {
      if (!conn.signalGroup) continue;
      if (!groups.has(conn.signalGroup)) groups.set(conn.signalGroup, []);
      groups.get(conn.signalGroup)!.push(conn);
    }
    // Only keep groups with 2+ wires visible
    for (const [k, v] of groups) { if (v.length < 2) groups.delete(k); }
    return groups;
  }, [filteredConns, twistedView]);

  /* ── Render: wires ── */
  function renderWires() {
    const els: JSX.Element[] = [];
    const twistedSignalIds = new Set<number>();
    if (groupIndex) {
      for (const members of groupIndex.values()) {
        for (const m of members) twistedSignalIds.add(m.signalId);
      }
    }

    // Render twisted groups — IEC 60617 style:
    //   Draw each wire as a normal path, then add figure-eight twist markers
    //   along the center line between wires at regular intervals.
    if (groupIndex) {
      for (const [groupName, members] of groupIndex) {
        // Draw each wire normally (same as non-twisted)
        const wireFromTo: { from: Pos; to: Pos; color: string }[] = [];
        for (const conn of members) {
          const from = mPins.get(conn.mainPinId);
          const to = rPins.get(conn.remotePinId);
          if (!from || !to) continue;
          const ok = isApproved(conn.signalStatus);
          const sSel = isSelected('signal', conn.signalId);
          const color = sSel ? C.selStroke : (ok ? C.wireApproved : C.wirePending);
          const wKey = `tw-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`;
          els.push(
            <path key={wKey} d={wirePath(from, to)} fill="none"
              stroke={color} strokeWidth={sSel ? 2.5 : 1.2}
              strokeDasharray={ok ? undefined : '5 3'}
              style={{ cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onSelect({ type: 'signal', signalId: conn.signalId }); }}
              onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick({ type: 'signal', signalId: conn.signalId }); } : undefined}
            />
          );
          // Direction arrows (same colors as normal wires)
          const dir = conn.direction;
          if (dir === 'toRemote') {
            els.push(arrowAt(from, to, 0.5, C.arrowToRemote, `${wKey}-arr`));
          } else if (dir === 'toMain') {
            els.push(arrowAt(from, to, 0.5, C.arrowToMain, `${wKey}-arr`, true));
          } else if (dir === 'bidirectional') {
            els.push(arrowAt(from, to, 1 / 3, C.arrowBidi, `${wKey}-arr1`));
            els.push(arrowAt(from, to, 2 / 3, C.arrowBidi, `${wKey}-arr2`, true));
          }
          wireFromTo.push({ from, to, color });
        }

        if (wireFromTo.length < 2) continue;

        // Compute center path between the first two wires (representative pair)
        const wA = wireFromTo[0], wB = wireFromTo[1];
        const centerFrom = { x: (wA.from.x + wB.from.x) / 2, y: (wA.from.y + wB.from.y) / 2 };
        const centerTo = { x: (wA.to.x + wB.to.x) / 2, y: (wA.to.y + wB.to.y) / 2 };

        // Estimate total path length for interval spacing
        const totalDx = centerTo.x - centerFrom.x, totalDy = centerTo.y - centerFrom.y;
        const estLen = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
        const markerCount = Math.max(1, Math.floor(estLen / TWIST_MARKER_INTERVAL));

        // Draw figure-eight twist markers along the center path
        const sz = TWIST_MARKER_SIZE;
        for (let k = 1; k <= markerCount; k++) {
          const t = k / (markerCount + 1);
          // Points on each wire at this t
          const pA = bezierPoint(wA.from, wA.to, t);
          const pB = bezierPoint(wB.from, wB.to, t);
          const cx = (pA.x + pB.x) / 2, cy = (pA.y + pB.y) / 2;
          // Tangent direction along center path
          const tg = bezierTangent(centerFrom, centerTo, t);
          const tLen = Math.sqrt(tg.x * tg.x + tg.y * tg.y);
          if (tLen === 0) continue;
          const ux = tg.x / tLen, uy = tg.y / tLen;
          // Normal (perpendicular)
          const nx = -uy, ny = ux;

          // Figure-eight: two small S-curves crossing at center
          // Top-left → center → bottom-right (curve 1)
          // Bottom-left → center → top-right (curve 2)
          const d = `M${(cx - ux * sz + nx * sz).toFixed(1)} ${(cy - uy * sz + ny * sz).toFixed(1)}`
            + `Q${(cx).toFixed(1)} ${(cy).toFixed(1)} ${(cx + ux * sz - nx * sz).toFixed(1)} ${(cy + uy * sz - ny * sz).toFixed(1)}`
            + `M${(cx - ux * sz - nx * sz).toFixed(1)} ${(cy - uy * sz - ny * sz).toFixed(1)}`
            + `Q${(cx).toFixed(1)} ${(cy).toFixed(1)} ${(cx + ux * sz + nx * sz).toFixed(1)} ${(cy + uy * sz + ny * sz).toFixed(1)}`;

          els.push(
            <path key={`tm-${groupName}-${k}`} d={d} fill="none"
              stroke={C.connBorder} strokeWidth={0.8} opacity={0.7}
              style={{ pointerEvents: 'none' }} />
          );
        }

        // Warning for incomplete groups (missing signals)
        const gInfo = signalGroups?.[groupName];
        if (gInfo && gInfo.missing.length > 0) {
          const mid = bezierPoint(centerFrom, centerTo, 0.5);
          els.push(
            <g key={`gw-${groupName}`}>
              <circle cx={mid.x} cy={mid.y - 10} r={5}
                fill="#FEF2F2" stroke="#EF4444" strokeWidth={0.8} />
              <text x={mid.x} y={mid.y - 10}
                textAnchor="middle" dominantBaseline="central"
                fontSize={8} fontWeight={700} fill="#EF4444" style={{ pointerEvents: 'none' }}>!</text>
              <title>{`${groupName} 缺失信号: ${gInfo.missing.join(', ')}`}</title>
            </g>
          );
        }
      }
    }

    // Render normal (non-twisted) wires
    for (const conn of filteredConns) {
      if (twistedSignalIds.has(conn.signalId)) continue;
      const from = mPins.get(conn.mainPinId);
      const to = rPins.get(conn.remotePinId);
      if (!from || !to) continue;
      const ok = isApproved(conn.signalStatus);
      const sSel = isSelected('signal', conn.signalId);
      const color = sSel ? C.selStroke : (ok ? C.wireApproved : C.wirePending);
      const wKey = `w-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`;
      els.push(
        <path key={wKey}
          d={wirePath(from, to)} fill="none"
          stroke={color} strokeWidth={sSel ? 2.5 : 1.2}
          strokeDasharray={ok ? undefined : '5 3'}
          style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelect({ type: 'signal', signalId: conn.signalId }); }}
          onDoubleClick={onDblClick ? (e) => { e.stopPropagation(); onDblClick({ type: 'signal', signalId: conn.signalId }); } : undefined}
        />
      );

      // Direction arrows (color varies by direction)
      const dir = conn.direction;
      if (dir === 'toRemote') {
        els.push(arrowAt(from, to, 0.5, C.arrowToRemote, `${wKey}-arr`));
      } else if (dir === 'toMain') {
        els.push(arrowAt(from, to, 0.5, C.arrowToMain, `${wKey}-arr`, true));
      } else if (dir === 'bidirectional') {
        els.push(arrowAt(from, to, 1 / 3, C.arrowBidi, `${wKey}-arr1`));
        els.push(arrowAt(from, to, 2 / 3, C.arrowBidi, `${wKey}-arr2`, true));
      }
    }
    return els;
  }

  /* ── Legend ── */
  function renderLegend() {
    const ataEntries = [...ataColorMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const palette = isDark ? ATA_COLORS_DARK : ATA_COLORS;
    const ataLegendH = ataEntries.length > 1 ? 14 + ataEntries.length * 14 + 8 : 0;
    const ly = svgH - 22;
    return (
      <g>
        {/* Status legend */}
        <line x1={MARGIN} y1={ly} x2={MARGIN + 24} y2={ly} stroke={C.wireApproved} strokeWidth={1.5} />
        <text x={MARGIN + 30} y={ly} dominantBaseline="central" fontSize={9} fill={C.legendText}>已批准</text>
        <line x1={MARGIN + 75} y1={ly} x2={MARGIN + 99} y2={ly} stroke={C.wirePending} strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={MARGIN + 105} y={ly} dominantBaseline="central" fontSize={9} fill={C.legendText}>草稿/审批中</text>
        {/* Arrow direction legend */}
        <polygon points={`${MARGIN + 168},${ly} ${MARGIN + 162},${ly - 3} ${MARGIN + 162},${ly + 3}`} fill={C.arrowToRemote} />
        <text x={MARGIN + 174} y={ly} dominantBaseline="central" fontSize={9} fill={C.legendText}>输出</text>
        <polygon points={`${MARGIN + 210},${ly} ${MARGIN + 216},${ly - 3} ${MARGIN + 216},${ly + 3}`} fill={C.arrowToMain} />
        <text x={MARGIN + 222} y={ly} dominantBaseline="central" fontSize={9} fill={C.legendText}>输入</text>
        <polygon points={`${MARGIN + 255},${ly} ${MARGIN + 249},${ly - 3} ${MARGIN + 249},${ly + 3}`} fill={C.arrowBidi} />
        <polygon points={`${MARGIN + 261},${ly} ${MARGIN + 267},${ly - 3} ${MARGIN + 267},${ly + 3}`} fill={C.arrowBidi} />
        <text x={MARGIN + 273} y={ly} dominantBaseline="central" fontSize={9} fill={C.legendText}>双向</text>
        {/* ATA legend */}
        {ataEntries.length > 1 && (
          <g transform={`translate(${MARGIN}, ${ly - 14 - ataLegendH})`}>
            <text x={0} y={0} fontSize={9} fontWeight={600} fill={C.legendText}>ATA 系统</text>
            {ataEntries.map(([ch, idx], i) => (
              <g key={ch} transform={`translate(0, ${14 + i * 14})`}>
                <rect x={0} y={-7} width={14} height={10} rx={2}
                  fill={palette[idx].devFill} stroke={palette[idx].devBorder} strokeWidth={1} />
                <text x={18} y={0} fontSize={8} fill={C.legendText}>ATA {ch}</text>
              </g>
            ))}
          </g>
        )}
      </g>
    );
  }

  /* ── Empty ── */
  if (connections.length === 0) {
    return <div className="flex items-center justify-center h-full text-gray-400 dark:text-white/40">该设备暂无针孔连接关系</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-200 dark:border-white/10 shrink-0 flex-wrap">
        <button onClick={() => setOffsets({})}
          className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/15 rounded hover:bg-gray-100 dark:hover:bg-neutral-800">
          还原布局
        </button>
        <button onClick={handleExport}
          className="px-2 py-0.5 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700">
          导出 SVG
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={twistedView} onChange={e => setTwistedView(e.target.checked)}
            className="rounded border-gray-300 dark:border-white/20 w-3.5 h-3.5" />
          绞线视图
        </label>

        {/* Device filter */}
        <div className="relative ml-auto">
          <button onClick={() => { setShowFilter(f => { if (f) setFilterSearch(''); return !f; }); }}
            className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/15 rounded hover:bg-gray-100 dark:hover:bg-neutral-800">
            筛选设备{visibleDeviceIds ? ` (${visibleDeviceIds.size}/${connectedRemotes.length})` : ''}
          </button>
          {showFilter && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-white/15 rounded shadow-lg p-2 min-w-[180px] max-h-[260px] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <input type="text" value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
                placeholder="搜索设备..."
                className="w-full mb-2 px-2 py-1 text-xs border border-gray-200 dark:border-white/15 rounded bg-white dark:bg-neutral-700 text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400 dark:focus:border-blue-500" />
              <div className="flex flex-wrap gap-x-2 gap-y-1 mb-2 border-b border-gray-100 dark:border-white/10 pb-2">
                <button onClick={() => setVisibleDeviceIds(null)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">全选</button>
                <button onClick={() => {
                  const cur = visibleDeviceIds ?? new Set(connectedRemotes.map(r => r.id));
                  const inverted = new Set(connectedRemotes.filter(r => !cur.has(r.id)).map(r => r.id));
                  setVisibleDeviceIds(inverted.size === connectedRemotes.length ? null : inverted);
                }} className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">反选</button>
                <button onClick={() => {
                  const ids = new Set(connections.filter(c => c.signalStatus === 'Active' || c.signalStatus === 'normal').map(c => c.remoteDeviceId));
                  setVisibleDeviceIds(ids.size === connectedRemotes.length ? null : ids);
                }} className="text-[11px] text-green-600 dark:text-green-400 hover:underline">有效连接</button>
                <button onClick={() => {
                  const ids = new Set(connections.filter(c => c.signalStatus === 'Pending').map(c => c.remoteDeviceId));
                  setVisibleDeviceIds(ids.size === connectedRemotes.length ? null : ids);
                }} className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline">未审批</button>
              </div>
              {connectedRemotes.filter(rd => {
                if (!filterSearch) return true;
                const q = filterSearch.toLowerCase();
                return rd.设备编号?.toLowerCase().includes(q) || rd.设备中文名称?.toLowerCase().includes(q);
              }).map(rd => {
                const checked = !visibleDeviceIds || visibleDeviceIds.has(rd.id);
                const label = rd.设备中文名称 ? `${rd.设备编号} (${rd.设备中文名称})` : rd.设备编号;
                return (
                  <label key={rd.id} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 py-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-neutral-700 px-1 rounded">
                    <input type="checkbox" checked={checked}
                      onChange={() => {
                        setVisibleDeviceIds(prev => {
                          const cur = prev ?? new Set(connectedRemotes.map(r => r.id));
                          const next = new Set(cur);
                          if (next.has(rd.id)) next.delete(rd.id); else next.add(rd.id);
                          // If all selected, reset to null (show all)
                          if (next.size === connectedRemotes.length) return null;
                          return next;
                        });
                      }}
                      className="rounded border-gray-300 dark:border-white/20 w-3 h-3" />
                    <span className="truncate max-w-[140px]" title={label}>{label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* SVG area */}
      <div className="flex-1 overflow-auto bg-white dark:bg-slate-900"
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onClick={() => onSelect(null)}>
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg"
          width={svgW} height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          style={{ minWidth: svgW, minHeight: svgH, userSelect: 'none' }}>
          <rect width={svgW} height={svgH} fill={C.bg} />
          {renderWires()}
          {(() => {
            const mo = offsets[layout.mDev.id] || { dx: 0, dy: 0 };
            return renderDevice(layout.mDev, layout.mX + mo.dx, layout.mY + mo.dy, layout.mBW, layout.mBH, true, true);
          })()}
          {layout.rLayouts.map(rl => {
            const o = offsets[rl.dev.id] || { dx: 0, dy: 0 };
            return <g key={`rd-${rl.dev.id}`}>{renderDevice(rl.dev, rl.x + o.dx, rl.y + o.dy, rl.bw, rl.bh, false, true)}</g>;
          })}
          {renderLegend()}
        </svg>
      </div>
    </div>
  );
}
