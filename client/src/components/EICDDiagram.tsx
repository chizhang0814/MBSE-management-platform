import { useRef, useMemo, useCallback } from 'react';

/* ───────── Types ───────── */

interface PinData {
  id: number;
  针孔号: string;
}

interface ConnectorData {
  id: number;
  设备端元器件编号: string;
  pins: PinData[];
}

interface DeviceData {
  id: number;
  设备编号: string;
  设备中文名称?: string;
  connectors: ConnectorData[];
}

interface ConnectionData {
  signalId: number;
  signalUniqueId?: string;
  signalStatus: string;
  mainPinId: number;
  remotePinId: number;
  remoteDeviceId: number;
}

export interface EICDDiagramProps {
  mainDevice: DeviceData;
  remoteDevices: DeviceData[];
  connections: ConnectionData[];
}

/* ───────── Layout Constants ───────── */

const PIN_SIZE = 16;
const PIN_GAP = 6;
const CONN_PADDING_X = 12;
const CONN_PADDING_Y = 8;
const CONN_HEADER_H = 22;
const CONN_GAP = 14;
const DEV_PADDING_X = 14;
const DEV_PADDING_Y = 10;
const DEV_HEADER_H = 28;
const CHANNEL_WIDTH = 280;
const MIN_REMOTE_GAP = 20;

const PIN_LABEL_CHAR_W = 7;
const MIN_PIN_LABEL_W = 36;

/* ───────── Colour Palette ───────── */

const COL = {
  deviceBorder: '#374151',
  deviceFill: '#FFFFFF',
  deviceHeaderBg: '#F3F4F6',
  connectorFill: '#F9FAFB',
  connectorBorder: '#D1D5DB',
  pinFill: '#EEF2FF',
  pinBorder: '#6366F1',
  pinText: '#3730A3',
  approvedLine: '#059669',
  pendingLine: '#9CA3AF',
  labelBg: '#FFFFFF',
  labelText: '#374151',
  headerText: '#111827',
  connHeaderText: '#4B5563',
};

/* ───────── Helper: text width approximation ───────── */

function approxTextWidth(text: string, charW: number): number {
  // Rough heuristic: CJK characters are ~1.6x the width of latin chars
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    w += code > 0x2e80 ? charW * 1.6 : charW;
  }
  return w;
}

/* ───────── Layout Helpers ───────── */

/** Height of a single connector block given pin count. */
function connectorHeight(pinCount: number): number {
  if (pinCount === 0) return CONN_HEADER_H + CONN_PADDING_Y * 2;
  return CONN_HEADER_H + CONN_PADDING_Y * 2 + pinCount * PIN_SIZE + (pinCount - 1) * PIN_GAP;
}

/** Total height of a device given its connectors. */
function deviceHeight(connectors: ConnectorData[]): number {
  if (connectors.length === 0) return DEV_HEADER_H + DEV_PADDING_Y * 2;
  const connH = connectors.reduce((sum, c) => sum + connectorHeight(c.pins.length), 0);
  const gaps = (connectors.length - 1) * CONN_GAP;
  return DEV_HEADER_H + DEV_PADDING_Y * 2 + connH + gaps;
}

/** Width of a connector block based on its widest pin label. */
function connectorWidth(pins: PinData[]): number {
  if (pins.length === 0) return CONN_PADDING_X * 2 + MIN_PIN_LABEL_W + PIN_SIZE;
  const maxLabelW = Math.max(
    MIN_PIN_LABEL_W,
    ...pins.map(p => approxTextWidth(p.针孔号, PIN_LABEL_CHAR_W))
  );
  return CONN_PADDING_X * 2 + maxLabelW + PIN_SIZE + 8; // 8 = gap between pin square and label
}

/** Width of a device based on widest connector and header text. */
function deviceWidth(connectors: ConnectorData[], headerText: string): number {
  const headerW = approxTextWidth(headerText, 8) + DEV_PADDING_X * 2 + 16;
  if (connectors.length === 0) return Math.max(headerW, 120);
  const maxConnW = Math.max(...connectors.map(c => connectorWidth(c.pins)));
  return Math.max(headerW, maxConnW + DEV_PADDING_X * 2);
}

interface PinPosition {
  x: number;
  y: number;
}

/**
 * Build a map of pin ID -> {x, y} position.
 * @param pinsOnRight - if true, pin squares sit on the right edge of the connector
 */
function buildPinPositions(
  device: DeviceData,
  devX: number,
  devY: number,
  pinsOnRight: boolean,
  filteredConnectorIds?: Set<number>
): Map<number, PinPosition> {
  const positions = new Map<number, PinPosition>();
  const devW = deviceWidth(
    filteredConnectorIds
      ? device.connectors.filter(c => filteredConnectorIds.has(c.id))
      : device.connectors,
    deviceHeaderText(device)
  );

  let cy = devY + DEV_HEADER_H + DEV_PADDING_Y;

  for (const conn of device.connectors) {
    if (filteredConnectorIds && !filteredConnectorIds.has(conn.id)) continue;
    const cH = connectorHeight(conn.pins.length);

    let pinY = cy + CONN_HEADER_H + CONN_PADDING_Y;
    for (const pin of conn.pins) {
      const px = pinsOnRight ? devX + devW - CONN_PADDING_X : devX + CONN_PADDING_X;
      const pinCenterY = pinY + PIN_SIZE / 2;
      // Connection line starts/ends at the outer edge of the pin square
      const edgeX = pinsOnRight ? px + PIN_SIZE : px;
      positions.set(pin.id, { x: edgeX, y: pinCenterY });
      pinY += PIN_SIZE + PIN_GAP;
    }

    cy += cH + CONN_GAP;
  }

  return positions;
}

function deviceHeaderText(device: DeviceData): string {
  return device.设备中文名称
    ? `${device.设备编号} (${device.设备中文名称})`
    : device.设备编号;
}

/* ───────── Crossing Minimization (Barycenter Heuristic) ───────── */

function optimizeRemoteOrder(
  remoteDevices: DeviceData[],
  connections: ConnectionData[],
  mainPinPositions: Map<number, PinPosition>
): DeviceData[] {
  if (remoteDevices.length <= 1) return remoteDevices;

  // For each remote device, compute the average Y of the main-side pins it connects to
  const deviceBarycenter = new Map<number, number>();
  for (const rd of remoteDevices) {
    const relevantConns = connections.filter(c => c.remoteDeviceId === rd.id);
    if (relevantConns.length === 0) {
      deviceBarycenter.set(rd.id, Infinity);
      continue;
    }
    const avgY =
      relevantConns.reduce((sum, c) => {
        const pos = mainPinPositions.get(c.mainPinId);
        return sum + (pos ? pos.y : 0);
      }, 0) / relevantConns.length;
    deviceBarycenter.set(rd.id, avgY);
  }

  return [...remoteDevices].sort(
    (a, b) => (deviceBarycenter.get(a.id) ?? 0) - (deviceBarycenter.get(b.id) ?? 0)
  );
}

/* ───────── Connection Path Generator ───────── */

function connectionPath(from: PinPosition, to: PinPosition): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Straight horizontal line if pins are nearly aligned vertically
  if (Math.abs(dy) < 2) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  // Bezier curve with horizontal tangents
  const cpOffset = Math.min(Math.abs(dx) * 0.45, 120);
  return `M ${from.x} ${from.y} C ${from.x + cpOffset} ${from.y}, ${to.x - cpOffset} ${to.y}, ${to.x} ${to.y}`;
}

function isApprovedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'normal' || s === 'active' || s === 'approved';
}

/* ───────── Component ───────── */

export default function EICDDiagram({ mainDevice, remoteDevices, connections }: EICDDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  /* ── Layout computation ── */
  const layout = useMemo(() => {
    // 1. Collect IDs of connected pins/connectors on the main device
    const connectedMainPinIds = new Set(connections.map(c => c.mainPinId));
    const connectedMainConnectorIds = new Set<number>();
    for (const conn of mainDevice.connectors) {
      for (const pin of conn.pins) {
        if (connectedMainPinIds.has(pin.id)) {
          connectedMainConnectorIds.add(conn.id);
          break;
        }
      }
    }

    // Build filtered main device (only connectors/pins with connections)
    const filteredMainDevice: DeviceData = {
      ...mainDevice,
      connectors: mainDevice.connectors
        .filter(c => connectedMainConnectorIds.has(c.id))
        .map(c => ({
          ...c,
          pins: c.pins.filter(p => connectedMainPinIds.has(p.id)),
        })),
    };

    // 2. Similarly filter remote devices
    const connectedRemotePinIds = new Set(connections.map(c => c.remotePinId));
    const filteredRemoteDevices: DeviceData[] = remoteDevices
      .filter(rd => connections.some(c => c.remoteDeviceId === rd.id))
      .map(rd => {
        const connectedConnIds = new Set<number>();
        for (const conn of rd.connectors) {
          for (const pin of conn.pins) {
            if (connectedRemotePinIds.has(pin.id)) {
              connectedConnIds.add(conn.id);
              break;
            }
          }
        }
        return {
          ...rd,
          connectors: rd.connectors
            .filter(c => connectedConnIds.has(c.id))
            .map(c => ({
              ...c,
              pins: c.pins.filter(p => connectedRemotePinIds.has(p.id)),
            })),
        };
      });

    // 3. Position main device on the left
    const mainX = 40;
    const mainY = 40;
    const mainHeaderTxt = deviceHeaderText(filteredMainDevice);
    const mainW = deviceWidth(filteredMainDevice.connectors, mainHeaderTxt);
    const mainH = deviceHeight(filteredMainDevice.connectors);

    // 4. Build main pin positions (pins on right edge)
    const mainPinPositions = buildPinPositions(
      filteredMainDevice,
      mainX,
      mainY,
      true
    );

    // 5. Optimize remote device order
    const orderedRemote = optimizeRemoteOrder(filteredRemoteDevices, connections, mainPinPositions);

    // 6. Position remote devices on the right, vertically stacked
    const remoteX = mainX + mainW + CHANNEL_WIDTH;
    let remoteY = mainY;
    const remoteLayouts: Array<{
      device: DeviceData;
      x: number;
      y: number;
      w: number;
      h: number;
    }> = [];
    const remotePinPositions = new Map<number, PinPosition>();

    for (const rd of orderedRemote) {
      const rHeaderTxt = deviceHeaderText(rd);
      const rW = deviceWidth(rd.connectors, rHeaderTxt);
      const rH = deviceHeight(rd.connectors);
      remoteLayouts.push({ device: rd, x: remoteX, y: remoteY, w: rW, h: rH });

      // Build pin positions (pins on left edge)
      const pins = buildPinPositions(rd, remoteX, remoteY, false);
      pins.forEach((v, k) => remotePinPositions.set(k, v));

      remoteY += rH + MIN_REMOTE_GAP;
    }

    // 7. Center the shorter side relative to the taller side
    const totalRemoteH = remoteY - mainY - (orderedRemote.length > 0 ? MIN_REMOTE_GAP : 0);
    if (mainH > totalRemoteH) {
      const offset = (mainH - totalRemoteH) / 2;
      for (const rl of remoteLayouts) {
        rl.y += offset;
      }
      // Rebuild remote pin positions with offset
      remotePinPositions.clear();
      for (const rl of remoteLayouts) {
        const pins = buildPinPositions(rl.device, rl.x, rl.y, false);
        pins.forEach((v, k) => remotePinPositions.set(k, v));
      }
    } else if (totalRemoteH > mainH) {
      const offset = (totalRemoteH - mainH) / 2;
      // Shift main device down and rebuild its pin positions
      const adjustedMainY = mainY + offset;
      mainPinPositions.clear();
      const pins = buildPinPositions(filteredMainDevice, mainX, adjustedMainY, true);
      pins.forEach((v, k) => mainPinPositions.set(k, v));
      // Return adjusted main Y
      return {
        filteredMainDevice,
        mainX,
        mainY: adjustedMainY,
        mainW,
        mainH,
        remoteLayouts,
        mainPinPositions,
        remotePinPositions,
        svgWidth: Math.max(
          remoteX + Math.max(120, ...remoteLayouts.map(r => r.w)) + 40,
          600
        ),
        svgHeight: Math.max(adjustedMainY + mainH, remoteY) + 60,
      };
    }

    // 8. SVG dimensions
    const maxRemoteRight = remoteLayouts.length > 0
      ? Math.max(...remoteLayouts.map(r => r.x + r.w))
      : remoteX + 120;
    const maxBottom = Math.max(
      mainY + mainH,
      remoteLayouts.length > 0
        ? Math.max(...remoteLayouts.map(r => r.y + r.h))
        : mainY + mainH
    );

    return {
      filteredMainDevice,
      mainX,
      mainY,
      mainW,
      mainH,
      remoteLayouts,
      mainPinPositions,
      remotePinPositions,
      svgWidth: Math.max(maxRemoteRight + 40, 600),
      svgHeight: maxBottom + 60,
    };
  }, [mainDevice, remoteDevices, connections]);

  /* ── SVG Export ── */
  const handleExport = useCallback(() => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EICD-${mainDevice.设备编号}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [mainDevice.设备编号]);

  /* ── Render: Device ── */
  function renderDevice(
    device: DeviceData,
    x: number,
    y: number,
    w: number,
    _h: number,
    pinsOnRight: boolean
  ) {
    const h = deviceHeight(device.connectors);
    const headerTxt = deviceHeaderText(device);
    const elements: JSX.Element[] = [];

    // Device rectangle
    elements.push(
      <rect
        key={`dev-bg-${device.id}`}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill={COL.deviceFill}
        stroke={COL.deviceBorder}
        strokeWidth={1.5}
      />
    );

    // Header background
    elements.push(
      <rect
        key={`dev-hdr-bg-${device.id}`}
        x={x}
        y={y}
        width={w}
        height={DEV_HEADER_H}
        rx={8}
        ry={8}
        fill={COL.deviceHeaderBg}
      />
    );
    // Cover bottom corners of the header rect so it looks flush
    elements.push(
      <rect
        key={`dev-hdr-fill-${device.id}`}
        x={x}
        y={y + DEV_HEADER_H - 8}
        width={w}
        height={8}
        fill={COL.deviceHeaderBg}
      />
    );

    // Header text
    elements.push(
      <text
        key={`dev-hdr-txt-${device.id}`}
        x={x + w / 2}
        y={y + DEV_HEADER_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={COL.headerText}
        fontSize={12}
        fontWeight={600}
      >
        {headerTxt}
      </text>
    );

    // Separator line
    elements.push(
      <line
        key={`dev-sep-${device.id}`}
        x1={x}
        y1={y + DEV_HEADER_H}
        x2={x + w}
        y2={y + DEV_HEADER_H}
        stroke={COL.deviceBorder}
        strokeWidth={1}
      />
    );

    // Connectors
    let cy = y + DEV_HEADER_H + DEV_PADDING_Y;
    for (const conn of device.connectors) {
      const cW = w - DEV_PADDING_X * 2;
      const cH = connectorHeight(conn.pins.length);
      const cx = x + DEV_PADDING_X;

      // Connector rectangle
      elements.push(
        <rect
          key={`conn-bg-${conn.id}`}
          x={cx}
          y={cy}
          width={cW}
          height={cH}
          rx={4}
          ry={4}
          fill={COL.connectorFill}
          stroke={COL.connectorBorder}
          strokeWidth={1}
        />
      );

      // Connector header text
      elements.push(
        <text
          key={`conn-hdr-${conn.id}`}
          x={cx + cW / 2}
          y={cy + CONN_HEADER_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={COL.connHeaderText}
          fontSize={10}
          fontWeight={500}
        >
          {conn.设备端元器件编号}
        </text>
      );

      // Connector header separator
      elements.push(
        <line
          key={`conn-sep-${conn.id}`}
          x1={cx}
          y1={cy + CONN_HEADER_H}
          x2={cx + cW}
          y2={cy + CONN_HEADER_H}
          stroke={COL.connectorBorder}
          strokeWidth={0.5}
        />
      );

      // Pins
      let pinY = cy + CONN_HEADER_H + CONN_PADDING_Y;
      for (const pin of conn.pins) {
        const px = pinsOnRight
          ? x + w - CONN_PADDING_X
          : x + CONN_PADDING_X;

        // Pin square
        elements.push(
          <rect
            key={`pin-sq-${pin.id}`}
            x={px}
            y={pinY}
            width={PIN_SIZE}
            height={PIN_SIZE}
            rx={2}
            ry={2}
            fill={COL.pinFill}
            stroke={COL.pinBorder}
            strokeWidth={1}
          />
        );

        // Pin label — positioned inside connector, next to pin square
        const labelX = pinsOnRight
          ? px - 6 // label to the left of pin
          : px + PIN_SIZE + 6; // label to the right of pin
        elements.push(
          <text
            key={`pin-lbl-${pin.id}`}
            x={labelX}
            y={pinY + PIN_SIZE / 2}
            textAnchor={pinsOnRight ? 'end' : 'start'}
            dominantBaseline="central"
            fill={COL.pinText}
            fontSize={10}
            fontFamily="monospace"
          >
            {pin.针孔号}
          </text>
        );

        pinY += PIN_SIZE + PIN_GAP;
      }

      cy += cH + CONN_GAP;
    }

    return elements;
  }

  /* ── Render: Connections ── */
  function renderConnections() {
    const elements: JSX.Element[] = [];

    for (const conn of connections) {
      const from = layout.mainPinPositions.get(conn.mainPinId);
      const to = layout.remotePinPositions.get(conn.remotePinId);
      if (!from || !to) continue;

      const approved = isApprovedStatus(conn.signalStatus);
      const pathD = connectionPath(from, to);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;

      // Connection line
      elements.push(
        <path
          key={`conn-line-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`}
          d={pathD}
          fill="none"
          stroke={approved ? COL.approvedLine : COL.pendingLine}
          strokeWidth={1.5}
          strokeDasharray={approved ? undefined : '6 3'}
        />
      );

      // Signal label at midpoint
      if (conn.signalUniqueId) {
        const labelW = approxTextWidth(conn.signalUniqueId, 6.5) + 10;
        const labelH = 16;
        elements.push(
          <g key={`conn-lbl-g-${conn.signalId}-${conn.mainPinId}-${conn.remotePinId}`}>
            <rect
              x={midX - labelW / 2}
              y={midY - labelH / 2}
              width={labelW}
              height={labelH}
              rx={3}
              fill={COL.labelBg}
              stroke={approved ? COL.approvedLine : COL.pendingLine}
              strokeWidth={0.5}
              opacity={0.95}
            />
            <text
              x={midX}
              y={midY}
              textAnchor="middle"
              dominantBaseline="central"
              fill={COL.labelText}
              fontSize={9}
              fontFamily="monospace"
            >
              {conn.signalUniqueId}
            </text>
          </g>
        );
      }
    }

    return elements;
  }

  /* ── Render: Legend ── */
  function renderLegend() {
    const lx = 12;
    const ly = layout.svgHeight - 36;
    return (
      <g>
        {/* Approved */}
        <line x1={lx} y1={ly} x2={lx + 30} y2={ly} stroke={COL.approvedLine} strokeWidth={1.5} />
        <text x={lx + 36} y={ly} dominantBaseline="central" fill={COL.labelText} fontSize={10}>
          已批准 (Approved)
        </text>
        {/* Pending */}
        <line
          x1={lx + 160}
          y1={ly}
          x2={lx + 190}
          y2={ly}
          stroke={COL.pendingLine}
          strokeWidth={1.5}
          strokeDasharray="6 3"
        />
        <text x={lx + 196} y={ly} dominantBaseline="central" fill={COL.labelText} fontSize={10}>
          待审批 (Draft / Pending)
        </text>
      </g>
    );
  }

  /* ── No-connection empty state ── */
  if (connections.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        该设备暂无针孔连接关系
      </div>
    );
  }

  /* ── Main Render ── */
  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-white/10 shrink-0">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          EICD 接口连接图 — {deviceHeaderText(mainDevice)}
        </span>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-neutral-800 border border-gray-300 dark:border-white/10 rounded-md hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          导出 SVG
        </button>
      </div>

      {/* Diagram area */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-neutral-950">
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          width={layout.svgWidth}
          height={layout.svgHeight}
          viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}
          style={{ minWidth: layout.svgWidth, minHeight: layout.svgHeight }}
        >
          {/* Background */}
          <rect width={layout.svgWidth} height={layout.svgHeight} fill="white" />

          {/* Main device */}
          {renderDevice(
            layout.filteredMainDevice,
            layout.mainX,
            layout.mainY,
            layout.mainW,
            layout.mainH,
            true
          )}

          {/* Remote devices */}
          {layout.remoteLayouts.map(rl =>
            renderDevice(rl.device, rl.x, rl.y, rl.w, rl.h, false)
          )}

          {/* Connections */}
          {renderConnections()}

          {/* Legend */}
          {renderLegend()}
        </svg>
      </div>
    </div>
  );
}
