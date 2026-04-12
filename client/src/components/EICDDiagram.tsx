import React, { useRef, useMemo, useCallback, useState } from 'react';

/* ───────── Types ───────── */

interface PinData { id: number; 针孔号: string; }
interface ConnectorData { id: number; 设备端元器件编号: string; pins: PinData[]; }
interface DeviceData { id: number; 设备编号: string; 设备中文名称?: string; connectors: ConnectorData[]; }
interface ConnectionData {
  signalId: number; signalUniqueId?: string; signalStatus: string;
  mainPinId: number; remotePinId: number; remoteDeviceId: number;
}

export interface EICDDiagramProps {
  mainDevice: DeviceData;
  remoteDevices: DeviceData[];
  connections: ConnectionData[];
}

/* ───────── Layout Constants ───────── */

const PIN_SIZE = 14;
const PIN_GAP = 4;
const PIN_LABEL_CHAR_W = 6.5;
const CONN_LABEL_W = 22;          // vertical label strip width inside connector
const CONN_PADDING_TOP = 6;
const CONN_PADDING_BOTTOM = 6;
const CONN_GAP = 10;              // gap between connectors on same device
const DEV_PADDING_Y = 12;
const DEV_HEADER_H = 30;
const DEV_MIN_W = 140;
const CHANNEL_WIDTH = 260;        // horizontal space between main and remote
const MIN_REMOTE_GAP = 24;        // vertical gap between remote devices
const MARGIN = 40;

/* ───────── Colour Palette ───────── */

function getColors(dark: boolean) {
  return dark ? {
    bg: '#171717',
    deviceFill: '#1E293B', deviceBorder: '#475569', deviceText: '#F1F5F9',
    connFill: '#334155',   connBorder: '#64748B',   connText: '#CBD5E1',
    pinFill: '#312E81',    pinBorder: '#818CF8',     pinText: '#C7D2FE',
    approvedLine: '#34D399', pendingLine: '#737373',
    labelBg: '#1E293B', labelBorder: '#475569', labelText: '#E2E8F0',
    legendText: '#94A3B8',
  } : {
    bg: '#FFFFFF',
    deviceFill: '#F0FDF4', deviceBorder: '#16A34A', deviceText: '#14532D',
    connFill: '#EFF6FF',   connBorder: '#3B82F6',   connText: '#1E40AF',
    pinFill: '#FEF3C7',    pinBorder: '#D97706',     pinText: '#92400E',
    approvedLine: '#059669', pendingLine: '#9CA3AF',
    labelBg: '#FFFFFF', labelBorder: '#D1D5DB', labelText: '#374151',
    legendText: '#6B7280',
  };
}

/* ───────── Helpers ───────── */

function approxTextWidth(text: string, charW: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += text.charCodeAt(i) > 0x2e80 ? charW * 1.6 : charW;
  }
  return w;
}

function isApproved(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'normal' || s === 'active' || s === 'approved';
}

function deviceLabel(d: DeviceData): string {
  return d.设备中文名称 ? `${d.设备编号}\n${d.设备中文名称}` : d.设备编号;
}

/* ───────── Layout: connector dimensions ───────── */

/** Connector is a narrow rectangle holding pins vertically + a label strip */
function connHeight(pins: PinData[]): number {
  if (pins.length === 0) return CONN_PADDING_TOP + CONN_PADDING_BOTTOM + PIN_SIZE;
  return CONN_PADDING_TOP + pins.length * PIN_SIZE + (pins.length - 1) * PIN_GAP + CONN_PADDING_BOTTOM;
}

function connWidth(pins: PinData[]): number {
  const maxLabelW = Math.max(24, ...pins.map(p => approxTextWidth(p.针孔号, PIN_LABEL_CHAR_W)));
  return CONN_LABEL_W + 6 + maxLabelW + 6 + PIN_SIZE + 4;
}

/* ───────── Layout: device body (no connectors inside) ───────── */

function deviceBodyW(device: DeviceData): number {
  const lines = deviceLabel(device).split('\n');
  const maxLine = Math.max(...lines.map(l => approxTextWidth(l, 8)));
  return Math.max(DEV_MIN_W, maxLine + 24);
}

function deviceBodyH(connectors: ConnectorData[]): number {
  if (connectors.length === 0) return DEV_HEADER_H + DEV_PADDING_Y * 2;
  const totalConnH = connectors.reduce((s, c) => s + connHeight(c.pins), 0);
  const gaps = (connectors.length - 1) * CONN_GAP;
  return Math.max(DEV_HEADER_H + DEV_PADDING_Y * 2, DEV_PADDING_Y + totalConnH + gaps + DEV_PADDING_Y);
}

/* ───────── Pin positions (IBD style: connectors outside device body) ───────── */

interface Pos { x: number; y: number; }

function buildPinPositions(
  device: DeviceData, devX: number, devY: number,
  bodyW: number, pinsOnRight: boolean,
): Map<number, Pos> {
  const map = new Map<number, Pos>();
  const bodyH = deviceBodyH(device.connectors);

  // connectors are stacked vertically, centered on the device body edge
  const totalConnH = device.connectors.reduce((s, c) => s + connHeight(c.pins), 0)
    + Math.max(0, device.connectors.length - 1) * CONN_GAP;
  let cy = devY + (bodyH - totalConnH) / 2;

  for (const conn of device.connectors) {
    const cH = connHeight(conn.pins);
    let pinY = cy + CONN_PADDING_TOP;

    for (const pin of conn.pins) {
      const pinCenterY = pinY + PIN_SIZE / 2;
      // Pin edge: the side of the pin square facing outward (toward the wires)
      let edgeX: number;
      if (pinsOnRight) {
        // Connector is to the RIGHT of device body
        const connX = devX + bodyW; // connector left edge = device right edge
        const cW = connWidth(conn.pins);
        edgeX = connX + cW; // right edge of pin square
      } else {
        // Connector is to the LEFT of device body
        const cW = connWidth(conn.pins);
        const connX = devX - cW;
        edgeX = connX; // left edge of pin square
      }
      map.set(pin.id, { x: edgeX, y: pinCenterY });
      pinY += PIN_SIZE + PIN_GAP;
    }
    cy += cH + CONN_GAP;
  }
  return map;
}

/* ───────── Crossing minimization: reorder pins within remote connectors ───────── */

function optimizeRemoteDeviceOrder(
  remotes: DeviceData[], connections: ConnectionData[],
  mainPinPos: Map<number, Pos>,
): DeviceData[] {
  if (remotes.length <= 1) return remotes;
  const scores = new Map<number, number>();
  for (const rd of remotes) {
    const ys = connections
      .filter(c => c.remoteDeviceId === rd.id)
      .map(c => mainPinPos.get(c.mainPinId)?.y ?? 0);
    scores.set(rd.id, ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity);
  }
  return [...remotes].sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0));
}

/** Reorder pins within each connector of a remote device to minimize crossings */
function optimizePinOrder(device: DeviceData, connections: ConnectionData[], mainPinPos: Map<number, Pos>): DeviceData {
  return {
    ...device,
    connectors: device.connectors.map(conn => {
      const pinsWithScore = conn.pins.map(pin => {
        const conns = connections.filter(c => c.remotePinId === pin.id);
        const avgY = conns.length > 0
          ? conns.reduce((s, c) => s + (mainPinPos.get(c.mainPinId)?.y ?? 0), 0) / conns.length
          : Infinity;
        return { pin, avgY };
      });
      pinsWithScore.sort((a, b) => a.avgY - b.avgY);
      return { ...conn, pins: pinsWithScore.map(p => p.pin) };
    }),
  };
}

/* ───────── Connection path ───────── */

function connectionPath(from: Pos, to: Pos): string {
  const dy = to.y - from.y;
  if (Math.abs(dy) < 2) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const dx = to.x - from.x;
  const cpOffset = Math.min(Math.abs(dx) * 0.4, 100);
  return `M ${from.x} ${from.y} C ${from.x + cpOffset} ${from.y}, ${to.x - cpOffset} ${to.y}, ${to.x} ${to.y}`;
}

/* ───────── Component ───────── */

export default function EICDDiagram({ mainDevice, remoteDevices, connections }: EICDDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDark = document.documentElement.classList.contains('dark');
  const COL = getColors(isDark);

  const [showLabels, setShowLabels] = useState(true);
  // deviceOffsets: deviceId -> {dx, dy} drag offset from default position
  const [deviceOffsets, setDeviceOffsets] = useState<Record<number, { dx: number; dy: number }>>({});
  const [dragging, setDragging] = useState<{ deviceId: number; startMX: number; startMY: number; startDX: number; startDY: number } | null>(null);

  /* ── Default layout computation ── */
  const defaultLayout = useMemo(() => {
    // Filter to only connected pins/connectors
    const connectedMainPinIds = new Set(connections.map(c => c.mainPinId));
    const connectedRemotePinIds = new Set(connections.map(c => c.remotePinId));

    const filterDevice = (d: DeviceData, pinIds: Set<number>): DeviceData => {
      const connIds = new Set<number>();
      for (const conn of d.connectors) {
        for (const pin of conn.pins) {
          if (pinIds.has(pin.id)) { connIds.add(conn.id); break; }
        }
      }
      return {
        ...d,
        connectors: d.connectors
          .filter(c => connIds.has(c.id))
          .map(c => ({ ...c, pins: c.pins.filter(p => pinIds.has(p.id)) })),
      };
    };

    const mainFiltered = filterDevice(mainDevice, connectedMainPinIds);
    const mainBW = deviceBodyW(mainFiltered);
    const mainBH = deviceBodyH(mainFiltered.connectors);
    const mainX = MARGIN;
    const mainY = MARGIN;

    // Build initial main pin positions for barycenter sort
    const mainPinPos = buildPinPositions(mainFiltered, mainX, mainY, mainBW, true);

    // Sort remote devices and optimize pin order
    const remotesFiltered = remoteDevices
      .filter(rd => connections.some(c => c.remoteDeviceId === rd.id))
      .map(rd => filterDevice(rd, connectedRemotePinIds));
    const orderedRemotes = optimizeRemoteDeviceOrder(remotesFiltered, connections, mainPinPos);
    const optimizedRemotes = orderedRemotes.map(rd => optimizePinOrder(rd, connections, mainPinPos));

    // Position remotes
    const maxConnW = mainFiltered.connectors.length > 0
      ? Math.max(...mainFiltered.connectors.map(c => connWidth(c.pins)))
      : 40;
    const remoteStartX = mainX + mainBW + maxConnW + CHANNEL_WIDTH;
    let remoteY = mainY;

    const remoteLayouts: Array<{ device: DeviceData; x: number; y: number; bodyW: number; bodyH: number }> = [];
    for (const rd of optimizedRemotes) {
      const bw = deviceBodyW(rd);
      const bh = deviceBodyH(rd.connectors);
      const maxRConnW = rd.connectors.length > 0 ? Math.max(...rd.connectors.map(c => connWidth(c.pins))) : 40;
      // Remote device x: leave room for connectors on the left
      const rx = remoteStartX + maxRConnW;
      remoteLayouts.push({ device: rd, x: rx, y: remoteY, bodyW: bw, bodyH: bh });
      remoteY += bh + MIN_REMOTE_GAP;
    }

    // Center vertically
    const totalRemoteH = remoteY - mainY - (optimizedRemotes.length > 0 ? MIN_REMOTE_GAP : 0);
    let adjustedMainY = mainY;
    if (totalRemoteH > mainBH) {
      adjustedMainY = mainY + (totalRemoteH - mainBH) / 2;
    } else if (mainBH > totalRemoteH) {
      const offset = (mainBH - totalRemoteH) / 2;
      for (const rl of remoteLayouts) rl.y += offset;
    }

    // SVG dimensions
    const maxRight = remoteLayouts.length > 0
      ? Math.max(...remoteLayouts.map(r => r.x + r.bodyW)) + MARGIN
      : remoteStartX + 120;
    const maxBottom = Math.max(
      adjustedMainY + mainBH,
      ...remoteLayouts.map(r => r.y + r.bodyH),
    ) + MARGIN + 40; // extra for legend

    return {
      mainDevice: mainFiltered, mainX, mainY: adjustedMainY, mainBW, mainBH,
      remoteLayouts,
      svgW: Math.max(maxRight, 600),
      svgH: Math.max(maxBottom, 200),
    };
  }, [mainDevice, remoteDevices, connections]);

  /* ── Compute pin positions considering drag offsets ── */
  const { mainPinPos, remotePinPos } = useMemo(() => {
    const mpp = buildPinPositions(
      defaultLayout.mainDevice, defaultLayout.mainX, defaultLayout.mainY,
      defaultLayout.mainBW, true,
    );
    const rpp = new Map<number, Pos>();
    for (const rl of defaultLayout.remoteLayouts) {
      const off = deviceOffsets[rl.device.id] || { dx: 0, dy: 0 };
      const pins = buildPinPositions(rl.device, rl.x + off.dx, rl.y + off.dy, rl.bodyW, false);
      pins.forEach((v, k) => rpp.set(k, v));
    }
    return { mainPinPos: mpp, remotePinPos: rpp };
  }, [defaultLayout, deviceOffsets]);

  /* ── SVG Export ── */
  const handleExport = useCallback(() => {
    if (!svgRef.current) return;
    const svgStr = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EICD-${mainDevice.设备编号}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [mainDevice.设备编号]);

  /* ── Drag handlers ── */
  const handleMouseDown = useCallback((deviceId: number, e: React.MouseEvent) => {
    e.preventDefault();
    const off = deviceOffsets[deviceId] || { dx: 0, dy: 0 };
    setDragging({ deviceId, startMX: e.clientX, startMY: e.clientY, startDX: off.dx, startDY: off.dy });
  }, [deviceOffsets]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = dragging.startDX + (e.clientX - dragging.startMX);
    const dy = dragging.startDY + (e.clientY - dragging.startMY);
    setDeviceOffsets(prev => ({ ...prev, [dragging.deviceId]: { dx, dy } }));
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  /* ── Render: device body (IBD style) ── */
  function renderDeviceBody(
    device: DeviceData, x: number, y: number, bodyW: number, bodyH: number,
    pinsOnRight: boolean, draggable: boolean,
  ): JSX.Element[] {
    const els: JSX.Element[] = [];
    const lines = deviceLabel(device).split('\n');

    // Device body rect
    els.push(
      <rect key={`dbody-${device.id}`} x={x} y={y} width={bodyW} height={bodyH}
        rx={6} fill={COL.deviceFill} stroke={COL.deviceBorder} strokeWidth={2}
        style={draggable ? { cursor: 'grab' } : undefined}
        onMouseDown={draggable ? (e) => handleMouseDown(device.id, e) : undefined}
      />
    );

    // Device label (centered, multi-line)
    lines.forEach((line, i) => {
      els.push(
        <text key={`dtxt-${device.id}-${i}`} x={x + bodyW / 2}
          y={y + bodyH / 2 + (i - (lines.length - 1) / 2) * 16}
          textAnchor="middle" dominantBaseline="central"
          fontSize={11} fontWeight={600} fill={COL.deviceText}
          style={draggable ? { cursor: 'grab', pointerEvents: 'none' } : { pointerEvents: 'none' }}
        >
          {line}
        </text>
      );
    });

    // Connectors (outside device body, on the edge)
    const totalConnH = device.connectors.reduce((s, c) => s + connHeight(c.pins), 0)
      + Math.max(0, device.connectors.length - 1) * CONN_GAP;
    let cy = y + (bodyH - totalConnH) / 2;

    for (const conn of device.connectors) {
      const cH = connHeight(conn.pins);
      const cW = connWidth(conn.pins);

      // Connector position: attached to device edge
      let cx: number;
      if (pinsOnRight) {
        cx = x + bodyW; // right edge of device
      } else {
        cx = x - cW; // left of device
      }

      // Connector rect
      els.push(
        <rect key={`conn-${conn.id}`} x={cx} y={cy} width={cW} height={cH}
          rx={3} fill={COL.connFill} stroke={COL.connBorder} strokeWidth={1.5} />
      );

      // Connector label (vertical, in label strip)
      const labelStripX = pinsOnRight ? cx : cx + cW - CONN_LABEL_W;
      const labelCenterX = labelStripX + CONN_LABEL_W / 2;
      const labelCenterY = cy + cH / 2;
      els.push(
        <text key={`clbl-${conn.id}`} x={labelCenterX} y={labelCenterY}
          textAnchor="middle" dominantBaseline="central"
          fontSize={9} fontWeight={500} fill={COL.connText}
          transform={`rotate(-90, ${labelCenterX}, ${labelCenterY})`}
        >
          {conn.设备端元器件编号}
        </text>
      );

      // Label strip separator
      if (pinsOnRight) {
        els.push(
          <line key={`csep-${conn.id}`}
            x1={cx + CONN_LABEL_W} y1={cy} x2={cx + CONN_LABEL_W} y2={cy + cH}
            stroke={COL.connBorder} strokeWidth={0.5} strokeDasharray="2 2" />
        );
      } else {
        els.push(
          <line key={`csep-${conn.id}`}
            x1={cx + cW - CONN_LABEL_W} y1={cy} x2={cx + cW - CONN_LABEL_W} y2={cy + cH}
            stroke={COL.connBorder} strokeWidth={0.5} strokeDasharray="2 2" />
        );
      }

      // Pins
      let pinY = cy + CONN_PADDING_TOP;
      for (const pin of conn.pins) {
        let pinX: number;
        let labelX: number;
        let labelAnchor: 'start' | 'end';

        if (pinsOnRight) {
          // Pin square on right end; label between separator and pin
          pinX = cx + cW - PIN_SIZE - 4;
          labelX = cx + CONN_LABEL_W + 6;
          labelAnchor = 'start';
        } else {
          // Pin square on left end; label between pin and separator
          pinX = cx + 4;
          labelX = cx + cW - CONN_LABEL_W - 6;
          labelAnchor = 'end';
        }

        els.push(
          <rect key={`pin-${pin.id}`} x={pinX} y={pinY}
            width={PIN_SIZE} height={PIN_SIZE} rx={2}
            fill={COL.pinFill} stroke={COL.pinBorder} strokeWidth={1} />
        );
        els.push(
          <text key={`plbl-${pin.id}`} x={labelX} y={pinY + PIN_SIZE / 2}
            textAnchor={labelAnchor} dominantBaseline="central"
            fontSize={9} fontFamily="monospace" fill={COL.pinText}>
            {pin.针孔号}
          </text>
        );
        pinY += PIN_SIZE + PIN_GAP;
      }

      cy += cH + CONN_GAP;
    }

    return els;
  }

  /* ── Render: connections ── */
  function renderConnections(): JSX.Element[] {
    const els: JSX.Element[] = [];
    for (const conn of connections) {
      const from = mainPinPos.get(conn.mainPinId);
      const to = remotePinPos.get(conn.remotePinId);
      if (!from || !to) continue;
      const approved = isApproved(conn.signalStatus);
      const color = approved ? COL.approvedLine : COL.pendingLine;

      els.push(
        <path key={`wire-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`}
          d={connectionPath(from, to)} fill="none"
          stroke={color} strokeWidth={1.5}
          strokeDasharray={approved ? undefined : '6 3'} />
      );

      if (showLabels && conn.signalUniqueId) {
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const lw = approxTextWidth(conn.signalUniqueId, 6) + 8;
        els.push(
          <g key={`wlbl-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`}>
            <rect x={midX - lw / 2} y={midY - 8} width={lw} height={16}
              rx={3} fill={COL.labelBg} stroke={COL.labelBorder} strokeWidth={0.5} opacity={0.95} />
            <text x={midX} y={midY} textAnchor="middle" dominantBaseline="central"
              fontSize={8} fontFamily="monospace" fill={COL.labelText}>
              {conn.signalUniqueId}
            </text>
          </g>
        );
      }
    }
    return els;
  }

  /* ── Render: legend ── */
  function renderLegend(): JSX.Element {
    const ly = defaultLayout.svgH - 30;
    return (
      <g>
        <line x1={MARGIN} y1={ly} x2={MARGIN + 30} y2={ly} stroke={COL.approvedLine} strokeWidth={1.5} />
        <text x={MARGIN + 36} y={ly} dominantBaseline="central" fontSize={10} fill={COL.legendText}>已批准</text>
        <line x1={MARGIN + 90} y1={ly} x2={MARGIN + 120} y2={ly} stroke={COL.pendingLine} strokeWidth={1.5} strokeDasharray="6 3" />
        <text x={MARGIN + 126} y={ly} dominantBaseline="central" fontSize={10} fill={COL.legendText}>草稿/审批中</text>
      </g>
    );
  }

  /* ── Empty state ── */
  if (connections.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 dark:text-white/40">
        该设备暂无针孔连接关系
      </div>
    );
  }

  /* ── Main render ── */
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-white/10 shrink-0">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 mr-auto">
          EICD 接口连接图
        </span>

        {/* Toggle NET labels */}
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={showLabels} onChange={() => setShowLabels(v => !v)}
            className="rounded border-gray-300 dark:border-white/20 h-3.5 w-3.5" />
          NET号
        </label>

        {/* Reset layout */}
        <button onClick={() => setDeviceOffsets({})}
          className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-white/10 rounded hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors">
          还原布局
        </button>

        {/* Export SVG */}
        <button onClick={handleExport}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          导出 SVG
        </button>
      </div>

      {/* Diagram area - scrollable */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-neutral-950"
        onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg"
          width={defaultLayout.svgW} height={defaultLayout.svgH}
          viewBox={`0 0 ${defaultLayout.svgW} ${defaultLayout.svgH}`}
          style={{ minWidth: defaultLayout.svgW, minHeight: defaultLayout.svgH, userSelect: 'none' }}>

          <rect width={defaultLayout.svgW} height={defaultLayout.svgH} fill={COL.bg} />

          {/* Connections (behind devices) */}
          {renderConnections()}

          {/* Main device */}
          {renderDeviceBody(
            defaultLayout.mainDevice,
            defaultLayout.mainX, defaultLayout.mainY,
            defaultLayout.mainBW, defaultLayout.mainBH,
            true, false,
          )}

          {/* Remote devices (draggable) */}
          {defaultLayout.remoteLayouts.map(rl => {
            const off = deviceOffsets[rl.device.id] || { dx: 0, dy: 0 };
            return (
              <g key={`rdev-${rl.device.id}`}>
                {renderDeviceBody(
                  rl.device,
                  rl.x + off.dx, rl.y + off.dy,
                  rl.bodyW, rl.bodyH,
                  false, true,
                )}
              </g>
            );
          })}

          {/* Legend */}
          {renderLegend()}
        </svg>
      </div>
    </div>
  );
}
