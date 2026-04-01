/**
 * OSLC Provider helpers — JSON-LD builders, property maps, query parser
 */
import { Request } from 'express';
import {
  ataDeviceColumns,
  deviceComponentColumns,
  electricalInterfaceColumns,
  type ColumnDef,
} from '../shared/column-schema.js';

// ── Base URL ────────────────────────────────────────────────
export function buildBaseUrl(req: Request): string {
  if (process.env.OSLC_BASE_URL) return process.env.OSLC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

// ── Namespaces ──────────────────────────────────────────────
export function oslcContext(baseUrl: string) {
  return {
    oslc: 'http://open-services.net/ns/core#',
    dcterms: 'http://purl.org/dc/terms/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    eicd: `${baseUrl}/ns/eicd#`,
  };
}

// ── DB column → sysmlAttr property maps ─────────────────────

/** Build a map from DB column name → eicd:sysmlAttr */
function buildPropertyMap(columns: ColumnDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of columns) {
    // column-schema may have duplicates (aliases); first wins
    if (!Object.values(map).includes(col.sysmlAttr)) {
      map[col.originalName] = col.sysmlAttr;
    }
  }
  return map;
}

// DB column name → eicd property name
export const DEVICE_PROP_MAP = buildPropertyMap(ataDeviceColumns);
export const CONNECTOR_PROP_MAP: Record<string, string> = {
  '设备端元器件编号': 'componentId',
  '设备端元器件名称及类型': 'componentNameType',
  '设备端元器件件号类型及件号': 'componentPartNumber',
  '设备端元器件供应商名称': 'componentSupplier',
  '匹配的线束端元器件件号': 'matchingHarnessPartNumber',
  '匹配的线束线型': 'matchingHarnessWireType',
  '尾附件件号': 'tailAccessoryPartNumber',
  '触件型号': 'contactModel',
  '设备端元器件匹配的元器件是否随设备交付': 'deliveredWithDevice',
  '备注': 'remarks',
};
export const PIN_PROP_MAP: Record<string, string> = {
  '针孔号': 'pinNumber',
  '端接尺寸': 'terminalSize',
  '屏蔽类型': 'shieldType',
  '备注': 'remarks',
};
export const SIGNAL_PROP_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = { unique_id: 'uniqueId' };
  for (const col of electricalInterfaceColumns) {
    if (!col.sysmlAttr.match(/\d$/) && !Object.values(map).includes(col.sysmlAttr)) {
      map[col.originalName] = col.sysmlAttr;
    }
  }
  return map;
})();

// Reverse maps: eicd property name → DB column name (for oslc.where queries)
function reverseMap(m: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) r[v] = k;
  return r;
}
export const DEVICE_ATTR_TO_COL = reverseMap(DEVICE_PROP_MAP);
export const CONNECTOR_ATTR_TO_COL = reverseMap(CONNECTOR_PROP_MAP);
export const PIN_ATTR_TO_COL = reverseMap(PIN_PROP_MAP);
export const SIGNAL_ATTR_TO_COL = reverseMap(SIGNAL_PROP_MAP);

// ── JSON-LD converters ──────────────────────────────────────

function mapRow(row: any, propMap: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [dbCol, attr] of Object.entries(propMap)) {
    const val = row[dbCol];
    if (val !== null && val !== undefined && val !== '') {
      result[`eicd:${attr}`] = val;
    }
  }
  return result;
}

export function deviceToJsonLd(device: any, baseUrl: string, projectId: number, connectorIds?: number[]) {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/devices/${device.id}`;
  const obj: any = {
    '@context': oslcContext(baseUrl),
    '@id': uri,
    '@type': 'eicd:Device',
    'dcterms:identifier': device['设备编号'] || String(device.id),
    'dcterms:title': device['设备中文名称'] || device['设备英文名称'] || device['设备编号'] || '',
    'dcterms:created': device.created_at || '',
    'dcterms:modified': device.updated_at || '',
    ...mapRow(device, DEVICE_PROP_MAP),
  };
  if (connectorIds && connectorIds.length > 0) {
    obj['eicd:hasConnector'] = connectorIds.map(cid => ({
      '@id': `${baseUrl}/api/oslc/projects/${projectId}/connectors/${cid}`,
    }));
  }
  return obj;
}

export function connectorToJsonLd(conn: any, baseUrl: string, projectId: number, pinIds?: number[]) {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/connectors/${conn.id}`;
  const deviceId = conn.device_id;
  const obj: any = {
    '@context': oslcContext(baseUrl),
    '@id': uri,
    '@type': 'eicd:Connector',
    'dcterms:identifier': conn['设备端元器件编号'] || String(conn.id),
    'dcterms:title': conn['设备端元器件名称及类型'] || conn['设备端元器件编号'] || '',
    'dcterms:created': conn.created_at || '',
    'dcterms:modified': conn.updated_at || '',
    ...mapRow(conn, CONNECTOR_PROP_MAP),
  };
  if (deviceId) {
    obj['eicd:belongsToDevice'] = { '@id': `${baseUrl}/api/oslc/projects/${projectId}/devices/${deviceId}` };
  }
  if (pinIds && pinIds.length > 0) {
    obj['eicd:hasPin'] = pinIds.map(pid => ({
      '@id': `${baseUrl}/api/oslc/projects/${projectId}/pins/${pid}`,
    }));
  }
  return obj;
}

export function pinToJsonLd(pin: any, baseUrl: string, projectId: number) {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/pins/${pin.id}`;
  const obj: any = {
    '@context': oslcContext(baseUrl),
    '@id': uri,
    '@type': 'eicd:Pin',
    'dcterms:identifier': pin['针孔号'] || String(pin.id),
    'dcterms:title': pin['针孔号'] || '',
    'dcterms:created': pin.created_at || '',
    'dcterms:modified': pin.updated_at || '',
    ...mapRow(pin, PIN_PROP_MAP),
  };
  if (pin.connector_id) {
    obj['eicd:belongsToConnector'] = {
      '@id': `${baseUrl}/api/oslc/projects/${projectId}/connectors/${pin.connector_id}`,
    };
  }
  // Include device reference if available (from JOIN)
  if (pin.device_id) {
    obj['eicd:belongsToDevice'] = {
      '@id': `${baseUrl}/api/oslc/projects/${projectId}/devices/${pin.device_id}`,
    };
  }
  return obj;
}

export function signalToJsonLd(
  signal: any,
  endpoints: any[],
  edges: any[],
  baseUrl: string,
  projectId: number,
) {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/signals/${signal.id}`;
  const obj: any = {
    '@context': oslcContext(baseUrl),
    '@id': uri,
    '@type': 'eicd:Signal',
    'dcterms:identifier': signal.unique_id || String(signal.id),
    'dcterms:title': signal.unique_id || '',
    'dcterms:created': signal.created_at || '',
    'dcterms:modified': signal.updated_at || '',
    ...mapRow(signal, SIGNAL_PROP_MAP),
  };

  // Endpoints
  if (endpoints.length > 0) {
    obj['eicd:hasEndpoint'] = endpoints.map(ep => {
      const epObj: any = {
        '@type': 'eicd:SignalEndpoint',
        'eicd:endpointIndex': ep.endpoint_index ?? 0,
        'eicd:signalName': ep['信号名称'] || '',
        'eicd:signalDefinition': ep['信号定义'] || '',
        'eicd:input': ep.input === 1,
        'eicd:output': ep.output === 1,
      };
      if (ep.device_id) {
        epObj['eicd:device'] = { '@id': `${baseUrl}/api/oslc/projects/${projectId}/devices/${ep.device_id}` };
      }
      if (ep.pin_id) {
        epObj['eicd:pin'] = { '@id': `${baseUrl}/api/oslc/projects/${projectId}/pins/${ep.pin_id}` };
      }
      if (ep.connector_id) {
        epObj['eicd:connector'] = { '@id': `${baseUrl}/api/oslc/projects/${projectId}/connectors/${ep.connector_id}` };
      }
      // Include human-readable identifiers from JOIN
      if (ep['设备编号']) epObj['eicd:deviceId'] = ep['设备编号'];
      if (ep['设备端元器件编号']) epObj['eicd:componentId'] = ep['设备端元器件编号'];
      if (ep['针孔号']) epObj['eicd:pinNumber'] = ep['针孔号'];
      if (ep['端接尺寸']) epObj['eicd:terminalSize'] = ep['端接尺寸'];
      return epObj;
    });
  }

  // Edges
  if (edges.length > 0) {
    obj['eicd:hasEdge'] = edges.map(edge => ({
      '@type': 'eicd:SignalEdge',
      'eicd:fromEndpointIndex': edge.from_index ?? 0,
      'eicd:toEndpointIndex': edge.to_index ?? 0,
      'eicd:direction': edge.direction || 'directed',
    }));
  }

  return obj;
}

// ── OSLC Query parser (minimal) ─────────────────────────────

/**
 * Parse a simple oslc.where string like:
 *   eicd:deviceId="1G-2910"
 *   eicd:deviceId="1G-2910" and eicd:dalLevel="A"
 *
 * Returns SQL WHERE clauses and params (parameterized).
 */
export function parseOslcWhere(
  whereStr: string | undefined,
  attrToCol: Record<string, string>,
): { clauses: string[]; params: any[] } {
  if (!whereStr) return { clauses: [], params: [] };
  const clauses: string[] = [];
  const params: any[] = [];

  // Split on " and " (case-insensitive)
  const parts = whereStr.split(/\s+and\s+/i);
  for (const part of parts) {
    const match = part.trim().match(/^(?:eicd:)?(\w+)\s*=\s*"([^"]*)"$/);
    if (!match) continue;
    const [, attr, value] = match;
    const dbCol = attrToCol[attr];
    if (!dbCol) continue; // unknown property → skip
    clauses.push(`"${dbCol}" = ?`);
    params.push(value);
  }
  return { clauses, params };
}

// ── Resource Shapes ─────────────────────────────────────────

export interface ShapeProperty {
  name: string;
  description?: string;
  valueType: string; // 'xsd:string', 'xsd:integer', 'xsd:boolean', 'oslc:Resource'
  occurs: string; // 'oslc:Exactly-one', 'oslc:Zero-or-one', 'oslc:Zero-or-many'
}

function buildShapeProperties(
  propMap: Record<string, string>,
  baseUrl: string,
): ShapeProperty[] {
  return Object.entries(propMap).map(([dbCol, attr]) => ({
    name: attr,
    description: dbCol,
    valueType: 'xsd:string',
    occurs: 'oslc:Zero-or-one',
  }));
}

export function buildResourceShape(
  type: string,
  propMap: Record<string, string>,
  baseUrl: string,
  extraProperties?: ShapeProperty[],
) {
  const ctx = oslcContext(baseUrl);
  const shapeUri = `${baseUrl}/api/oslc/shapes/${type}`;
  const properties = [
    ...buildShapeProperties(propMap, baseUrl),
    ...(extraProperties || []),
  ];

  return {
    '@context': ctx,
    '@id': shapeUri,
    '@type': 'oslc:ResourceShape',
    'dcterms:title': `${type.charAt(0).toUpperCase() + type.slice(1)} Shape`,
    'oslc:describes': `${ctx.eicd}${type.charAt(0).toUpperCase() + type.slice(1)}`,
    'oslc:property': properties.map(p => ({
      '@type': 'oslc:Property',
      'oslc:name': p.name,
      'oslc:propertyDefinition': `${ctx.eicd}${p.name}`,
      'oslc:valueType': p.valueType,
      'oslc:occurs': p.occurs,
      ...(p.description ? { 'dcterms:description': p.description } : {}),
    })),
  };
}

// ══════════════════════════════════════════════════════════════
// RDF/XML output — OSLC 2.0 default format for DataHub / MagicDraw
// ══════════════════════════════════════════════════════════════

function xmlEscape(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const OSLC_NS = 'http://open-services.net/ns/core#';
const DCTERMS_NS = 'http://purl.org/dc/terms/';
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';

function rdfXmlPreamble(baseUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF
  xmlns:rdf="${RDF_NS}"
  xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"
  xmlns:oslc="${OSLC_NS}"
  xmlns:dcterms="${DCTERMS_NS}"
  xmlns:xsd="${XSD_NS}"
  xmlns:eicd="${baseUrl}/ns/eicd#">`;
}

/** Check if OSLC client prefers RDF/XML (default for OSLC 2.0) */
export function wantsRdfXml(req: Request): boolean {
  const accept = req.headers.accept || '';
  if (!accept || accept === '*/*') return true;
  if (accept.includes('application/rdf+xml') || accept.includes('application/xml')) return true;
  if (accept.includes('application/ld+json') || accept.includes('application/json')) return false;
  return true;
}

// ── RDF/XML: Catalog ───────────────────────────────────────

export function catalogToRdfXml(
  baseUrl: string,
  projects: { id: number; name: string }[],
): string {
  const catalogUri = `${baseUrl}/api/oslc/catalog`;
  let xml = rdfXmlPreamble(baseUrl);
  xml += `\n  <oslc:ServiceProviderCatalog rdf:about="${xmlEscape(catalogUri)}">`;
  xml += `\n    <dcterms:title>EICD OSLC Service Provider Catalog</dcterms:title>`;
  xml += `\n    <dcterms:description>EICD electrical interface data for MagicDraw SysML integration</dcterms:description>`;
  for (const p of projects) {
    xml += `\n    <oslc:serviceProvider>`;
    xml += `\n      <oslc:ServiceProvider rdf:about="${xmlEscape(baseUrl)}/api/oslc/projects/${p.id}/provider">`;
    xml += `\n        <dcterms:title>${xmlEscape(p.name)}</dcterms:title>`;
    xml += `\n      </oslc:ServiceProvider>`;
    xml += `\n    </oslc:serviceProvider>`;
  }
  xml += `\n  </oslc:ServiceProviderCatalog>`;
  xml += `\n</rdf:RDF>`;
  return xml;
}

// ── RDF/XML: Service Provider ──────────────────────────────

export function serviceProviderToRdfXml(
  baseUrl: string,
  pid: number,
  projectName: string,
): string {
  const providerUri = `${baseUrl}/api/oslc/projects/${pid}/provider`;
  const types = ['devices', 'connectors', 'pins', 'signals'];
  const labels: Record<string, string> = {
    devices: 'Devices',
    connectors: 'Connectors',
    pins: 'Pins',
    signals: 'Signals',
  };

  let xml = rdfXmlPreamble(baseUrl);
  xml += `\n  <oslc:ServiceProvider rdf:about="${xmlEscape(providerUri)}">`;
  xml += `\n    <dcterms:title>Project: ${xmlEscape(projectName)}</dcterms:title>`;
  xml += `\n    <dcterms:description>EICD electrical interface data — ${xmlEscape(projectName)}</dcterms:description>`;
  xml += `\n    <oslc:details rdf:resource="${xmlEscape(providerUri)}"/>`;
  xml += `\n    <oslc:service>`;
  xml += `\n      <oslc:Service>`;
  xml += `\n        <oslc:domain rdf:resource="http://open-services.net/ns/am#"/>`;

  for (const t of types) {
    const singular = t.replace(/s$/, '');
    const Title = t.charAt(0).toUpperCase() + t.slice(1);
    const SingularTitle = singular.charAt(0).toUpperCase() + singular.slice(1);
    const qBase = `${baseUrl}/api/oslc/projects/${pid}/${t}`;
    xml += `\n        <oslc:queryCapability>`;
    xml += `\n          <oslc:QueryCapability>`;
    xml += `\n            <dcterms:title>${labels[t]} Query</dcterms:title>`;
    xml += `\n            <oslc:label>${labels[t]}</oslc:label>`;
    xml += `\n            <oslc:queryBase rdf:resource="${xmlEscape(qBase)}"/>`;
    xml += `\n            <oslc:resourceShape rdf:resource="${xmlEscape(baseUrl)}/api/oslc/shapes/${singular}"/>`;
    xml += `\n            <oslc:resourceType rdf:resource="${xmlEscape(baseUrl)}/ns/eicd#${SingularTitle}"/>`;
    xml += `\n          </oslc:QueryCapability>`;
    xml += `\n        </oslc:queryCapability>`;
    // Selection dialog for each resource type
    xml += `\n        <oslc:selectionDialog>`;
    xml += `\n          <oslc:Dialog>`;
    xml += `\n            <dcterms:title>Select ${labels[t]}</dcterms:title>`;
    xml += `\n            <oslc:label>${labels[t]}</oslc:label>`;
    xml += `\n            <oslc:dialog rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${pid}/selector/${t}"/>`;
    xml += `\n            <oslc:hintWidth>600px</oslc:hintWidth>`;
    xml += `\n            <oslc:hintHeight>500px</oslc:hintHeight>`;
    xml += `\n            <oslc:resourceType rdf:resource="${xmlEscape(baseUrl)}/ns/eicd#${SingularTitle}"/>`;
    xml += `\n          </oslc:Dialog>`;
    xml += `\n        </oslc:selectionDialog>`;
  }

  xml += `\n      </oslc:Service>`;
  xml += `\n    </oslc:service>`;
  xml += `\n  </oslc:ServiceProvider>`;
  xml += `\n</rdf:RDF>`;
  return xml;
}

// ── RDF/XML: Resource Shape ────────────────────────────────

export function resourceShapeToRdfXml(
  type: string,
  propMap: Record<string, string>,
  baseUrl: string,
  extraProperties?: ShapeProperty[],
): string {
  const shapeUri = `${baseUrl}/api/oslc/shapes/${type}`;
  const Title = type.charAt(0).toUpperCase() + type.slice(1);

  let xml = rdfXmlPreamble(baseUrl);
  xml += `\n  <oslc:ResourceShape rdf:about="${xmlEscape(shapeUri)}">`;
  xml += `\n    <dcterms:title>${Title} Shape</dcterms:title>`;
  xml += `\n    <oslc:describes rdf:resource="${xmlEscape(baseUrl)}/ns/eicd#${Title}"/>`;

  for (const [dbCol, attr] of Object.entries(propMap)) {
    xml += `\n    <oslc:property>`;
    xml += `\n      <oslc:Property>`;
    xml += `\n        <oslc:name>${xmlEscape(attr)}</oslc:name>`;
    xml += `\n        <oslc:propertyDefinition rdf:resource="${xmlEscape(baseUrl)}/ns/eicd#${xmlEscape(attr)}"/>`;
    xml += `\n        <oslc:valueType rdf:resource="${XSD_NS}string"/>`;
    xml += `\n        <oslc:occurs rdf:resource="${OSLC_NS}Zero-or-one"/>`;
    xml += `\n        <dcterms:description>${xmlEscape(dbCol)}</dcterms:description>`;
    xml += `\n      </oslc:Property>`;
    xml += `\n    </oslc:property>`;
  }

  if (extraProperties) {
    for (const p of extraProperties) {
      const vtUri = p.valueType === 'oslc:Resource'
        ? `${OSLC_NS}Resource`
        : `${XSD_NS}${p.valueType.split(':')[1] || 'string'}`;
      const occUri = `${OSLC_NS}${p.occurs.split(':')[1] || 'Zero-or-one'}`;
      xml += `\n    <oslc:property>`;
      xml += `\n      <oslc:Property>`;
      xml += `\n        <oslc:name>${xmlEscape(p.name)}</oslc:name>`;
      xml += `\n        <oslc:propertyDefinition rdf:resource="${xmlEscape(baseUrl)}/ns/eicd#${xmlEscape(p.name)}"/>`;
      xml += `\n        <oslc:valueType rdf:resource="${xmlEscape(vtUri)}"/>`;
      xml += `\n        <oslc:occurs rdf:resource="${xmlEscape(occUri)}"/>`;
      if (p.description) xml += `\n        <dcterms:description>${xmlEscape(p.description)}</dcterms:description>`;
      xml += `\n      </oslc:Property>`;
      xml += `\n    </oslc:property>`;
    }
  }

  xml += `\n  </oslc:ResourceShape>`;
  xml += `\n</rdf:RDF>`;
  return xml;
}

// ── RDF/XML: Resource serializers ──────────────────────────

function propsToRdfXml(row: any, propMap: Record<string, string>): string {
  let xml = '';
  for (const [dbCol, attr] of Object.entries(propMap)) {
    const val = row[dbCol];
    if (val !== null && val !== undefined && val !== '') {
      xml += `\n    <eicd:${attr}>${xmlEscape(String(val))}</eicd:${attr}>`;
    }
  }
  return xml;
}

export function deviceToRdfXml(device: any, baseUrl: string, projectId: number, connectorIds?: number[]): string {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/devices/${device.id}`;
  let xml = `  <eicd:Device rdf:about="${xmlEscape(uri)}">`;
  xml += `\n    <dcterms:identifier>${xmlEscape(device['设备编号'] || String(device.id))}</dcterms:identifier>`;
  xml += `\n    <dcterms:title>${xmlEscape(device['设备中文名称'] || device['设备英文名称'] || device['设备编号'] || '')}</dcterms:title>`;
  if (device.created_at) xml += `\n    <dcterms:created>${xmlEscape(device.created_at)}</dcterms:created>`;
  if (device.updated_at) xml += `\n    <dcterms:modified>${xmlEscape(device.updated_at)}</dcterms:modified>`;
  xml += propsToRdfXml(device, DEVICE_PROP_MAP);
  if (connectorIds) {
    for (const cid of connectorIds) {
      xml += `\n    <eicd:hasConnector rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/connectors/${cid}"/>`;
    }
  }
  xml += `\n  </eicd:Device>`;
  return xml;
}

export function connectorToRdfXml(conn: any, baseUrl: string, projectId: number, pinIds?: number[]): string {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/connectors/${conn.id}`;
  let xml = `  <eicd:Connector rdf:about="${xmlEscape(uri)}">`;
  xml += `\n    <dcterms:identifier>${xmlEscape(conn['设备端元器件编号'] || String(conn.id))}</dcterms:identifier>`;
  xml += `\n    <dcterms:title>${xmlEscape(conn['设备端元器件名称及类型'] || conn['设备端元器件编号'] || '')}</dcterms:title>`;
  if (conn.created_at) xml += `\n    <dcterms:created>${xmlEscape(conn.created_at)}</dcterms:created>`;
  if (conn.updated_at) xml += `\n    <dcterms:modified>${xmlEscape(conn.updated_at)}</dcterms:modified>`;
  xml += propsToRdfXml(conn, CONNECTOR_PROP_MAP);
  if (conn.device_id) {
    xml += `\n    <eicd:belongsToDevice rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/devices/${conn.device_id}"/>`;
  }
  if (pinIds) {
    for (const pid of pinIds) {
      xml += `\n    <eicd:hasPin rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/pins/${pid}"/>`;
    }
  }
  xml += `\n  </eicd:Connector>`;
  return xml;
}

export function pinToRdfXml(pin: any, baseUrl: string, projectId: number): string {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/pins/${pin.id}`;
  let xml = `  <eicd:Pin rdf:about="${xmlEscape(uri)}">`;
  xml += `\n    <dcterms:identifier>${xmlEscape(pin['针孔号'] || String(pin.id))}</dcterms:identifier>`;
  xml += `\n    <dcterms:title>${xmlEscape(pin['针孔号'] || '')}</dcterms:title>`;
  if (pin.created_at) xml += `\n    <dcterms:created>${xmlEscape(pin.created_at)}</dcterms:created>`;
  if (pin.updated_at) xml += `\n    <dcterms:modified>${xmlEscape(pin.updated_at)}</dcterms:modified>`;
  xml += propsToRdfXml(pin, PIN_PROP_MAP);
  if (pin.connector_id) {
    xml += `\n    <eicd:belongsToConnector rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/connectors/${pin.connector_id}"/>`;
  }
  if (pin.device_id) {
    xml += `\n    <eicd:belongsToDevice rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/devices/${pin.device_id}"/>`;
  }
  xml += `\n  </eicd:Pin>`;
  return xml;
}

export function signalToRdfXml(
  signal: any,
  endpoints: any[],
  edges: any[],
  baseUrl: string,
  projectId: number,
): string {
  const uri = `${baseUrl}/api/oslc/projects/${projectId}/signals/${signal.id}`;
  let xml = `  <eicd:Signal rdf:about="${xmlEscape(uri)}">`;
  xml += `\n    <dcterms:identifier>${xmlEscape(signal.unique_id || String(signal.id))}</dcterms:identifier>`;
  xml += `\n    <dcterms:title>${xmlEscape(signal.unique_id || '')}</dcterms:title>`;
  if (signal.created_at) xml += `\n    <dcterms:created>${xmlEscape(signal.created_at)}</dcterms:created>`;
  if (signal.updated_at) xml += `\n    <dcterms:modified>${xmlEscape(signal.updated_at)}</dcterms:modified>`;
  xml += propsToRdfXml(signal, SIGNAL_PROP_MAP);

  for (const ep of endpoints) {
    xml += `\n    <eicd:hasEndpoint>`;
    xml += `\n      <eicd:SignalEndpoint>`;
    xml += `\n        <eicd:endpointIndex>${ep.endpoint_index ?? 0}</eicd:endpointIndex>`;
    if (ep['信号名称']) xml += `\n        <eicd:signalName>${xmlEscape(ep['信号名称'])}</eicd:signalName>`;
    if (ep['信号定义']) xml += `\n        <eicd:signalDefinition>${xmlEscape(ep['信号定义'])}</eicd:signalDefinition>`;
    xml += `\n        <eicd:input>${ep.input === 1}</eicd:input>`;
    xml += `\n        <eicd:output>${ep.output === 1}</eicd:output>`;
    if (ep.device_id) xml += `\n        <eicd:device rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/devices/${ep.device_id}"/>`;
    if (ep.pin_id) xml += `\n        <eicd:pin rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/pins/${ep.pin_id}"/>`;
    if (ep.connector_id) xml += `\n        <eicd:connector rdf:resource="${xmlEscape(baseUrl)}/api/oslc/projects/${projectId}/connectors/${ep.connector_id}"/>`;
    if (ep['设备编号']) xml += `\n        <eicd:deviceId>${xmlEscape(ep['设备编号'])}</eicd:deviceId>`;
    if (ep['设备端元器件编号']) xml += `\n        <eicd:componentId>${xmlEscape(ep['设备端元器件编号'])}</eicd:componentId>`;
    if (ep['针孔号']) xml += `\n        <eicd:pinNumber>${xmlEscape(ep['针孔号'])}</eicd:pinNumber>`;
    if (ep['端接尺寸']) xml += `\n        <eicd:terminalSize>${xmlEscape(ep['端接尺寸'])}</eicd:terminalSize>`;
    xml += `\n      </eicd:SignalEndpoint>`;
    xml += `\n    </eicd:hasEndpoint>`;
  }

  for (const edge of edges) {
    xml += `\n    <eicd:hasEdge>`;
    xml += `\n      <eicd:SignalEdge>`;
    xml += `\n        <eicd:fromEndpointIndex>${edge.from_index ?? 0}</eicd:fromEndpointIndex>`;
    xml += `\n        <eicd:toEndpointIndex>${edge.to_index ?? 0}</eicd:toEndpointIndex>`;
    xml += `\n        <eicd:direction>${xmlEscape(edge.direction || 'directed')}</eicd:direction>`;
    xml += `\n      </eicd:SignalEdge>`;
    xml += `\n    </eicd:hasEdge>`;
  }

  xml += `\n  </eicd:Signal>`;
  return xml;
}

/** Wrap inner resource XML in rdf:RDF for single-resource responses */
export function wrapRdfXml(innerXml: string, baseUrl: string): string {
  return `${rdfXmlPreamble(baseUrl)}\n${innerXml}\n</rdf:RDF>`;
}

/** Build a query response in RDF/XML */
export function queryResponseRdfXml(
  queryUri: string,
  totalCount: number,
  memberUris: string[],
  resourcesXml: string,
  baseUrl: string,
  nextPageUri?: string,
): string {
  const membersXml = memberUris
    .map(uri => `    <rdfs:member rdf:resource="${xmlEscape(uri)}"/>`)
    .join('\n');
  const nextPageXml = nextPageUri
    ? `\n    <oslc:nextPage rdf:resource="${xmlEscape(nextPageUri)}"/>`
    : '';
  return `${rdfXmlPreamble(baseUrl)}
  <oslc:ResponseInfo rdf:about="${xmlEscape(queryUri)}">
    <oslc:totalCount>${totalCount}</oslc:totalCount>${nextPageXml}
  </oslc:ResponseInfo>
  <rdf:Description rdf:about="${xmlEscape(queryUri)}">
${membersXml}
  </rdf:Description>
${resourcesXml}
</rdf:RDF>`;
}
