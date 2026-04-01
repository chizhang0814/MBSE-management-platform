/**
 * OSLC Provider routes — read-only provider for MagicDraw 2026x integration.
 *
 * Discovery:  GET /catalog, GET /projects/:pid/provider
 * Shapes:     GET /shapes/:type
 * Query:      GET /projects/:pid/devices|connectors|pins|signals
 * Resource:   GET /projects/:pid/devices|connectors|pins|signals/:id
 */
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Database } from '../database.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  buildBaseUrl,
  oslcContext,
  deviceToJsonLd,
  connectorToJsonLd,
  pinToJsonLd,
  signalToJsonLd,
  parseOslcWhere,
  buildResourceShape,
  DEVICE_PROP_MAP,
  CONNECTOR_PROP_MAP,
  PIN_PROP_MAP,
  SIGNAL_PROP_MAP,
  DEVICE_ATTR_TO_COL,
  CONNECTOR_ATTR_TO_COL,
  PIN_ATTR_TO_COL,
  SIGNAL_ATTR_TO_COL,
  // RDF/XML support for OSLC 2.0 clients (DataHub / MagicDraw)
  wantsRdfXml,
  catalogToRdfXml,
  serviceProviderToRdfXml,
  resourceShapeToRdfXml,
  deviceToRdfXml,
  connectorToRdfXml,
  pinToRdfXml,
  signalToRdfXml,
  wrapRdfXml,
  queryResponseRdfXml,
} from './oslc-helpers.js';

const JWT_SECRET = process.env.JWT_SECRET || 'eicd_secret_key_2024';

// ── OAuth 1.0a token store (in-memory) ─────────────────────
// Accepted consumer keys — DataHub will send one of these
const OAUTH_CONSUMERS: Record<string, string> = {
  eicd: 'eicd',               // consumer_key → consumer_secret
  magicdraw: 'magicdraw',
};
// Allow any consumer key by env var
const OAUTH_OPEN = process.env.OSLC_OAUTH_OPEN === 'true';

interface OAuthToken {
  secret: string;
  consumerKey: string;
  authorized: boolean;
  userId?: number;
  username?: string;
  role?: string;
  callback?: string;
  verifier?: string;
  createdAt: number;
}
const oauthTokens = new Map<string, OAuthToken>();

// Clean up tokens older than 24 hours (DataHub maintains long sessions)
function cleanOAuthTokens() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of oauthTokens) {
    if (v.createdAt < cutoff) oauthTokens.delete(k);
  }
}

function generateToken(): string {
  return crypto.randomBytes(20).toString('hex');
}

export function oslcRoutes(db: Database) {
  const router = express.Router();

  // ── OSLC headers middleware ───────────────────────────────
  router.use((_req: Request, res: Response, next: NextFunction) => {
    res.set('OSLC-Core-Version', '2.0');
    next();
  });

  // ── Root Services (OSLC 2.0 discovery, no auth required) ──
  router.get('/rootservices', (req: Request, res: Response) => {
    const base = buildBaseUrl(req);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:Description
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/terms/"
    xmlns:oslc_cm="http://open-services.net/xmlns/cm/1.0/"
    xmlns:oslc_am="http://open-services.net/xmlns/am/1.0/"
    xmlns:oslc="http://open-services.net/xmlns/discovery/1.0/"
    xmlns:jfs="http://jazz.net/xmlns/prod/jazz/jfs/1.0/"
    rdf:about="${base}/api/oslc/rootservices">

  <dc:title>EICD OSLC Root Services</dc:title>

  <!-- Service Provider Catalog -->
  <oslc_cm:cmServiceProviders>
    <oslc:ServiceProviderCatalog rdf:about="${base}/api/oslc/catalog">
      <dc:title>EICD Service Provider Catalog</dc:title>
    </oslc:ServiceProviderCatalog>
  </oslc_cm:cmServiceProviders>

  <oslc_am:amServiceProviders>
    <oslc:ServiceProviderCatalog rdf:about="${base}/api/oslc/catalog">
      <dc:title>EICD Service Provider Catalog</dc:title>
    </oslc:ServiceProviderCatalog>
  </oslc_am:amServiceProviders>

  <!-- OAuth not used — Basic Auth -->
  <jfs:oauthRequestTokenUrl rdf:resource="${base}/api/oslc/oauth/requestToken"/>
  <jfs:oauthAccessTokenUrl rdf:resource="${base}/api/oslc/oauth/accessToken"/>
  <jfs:oauthUserAuthorizationUrl rdf:resource="${base}/api/oslc/oauth/authorize"/>
  <jfs:oauthRealmName>EICD</jfs:oauthRealmName>

</rdf:Description>`;

    res.type('application/rdf+xml').send(xml);
  });

  // ── OAuth 1.0a endpoints ─────────────────────────────────

  // Step 1: Request Token
  router.post('/oauth/requestToken', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    cleanOAuthTokens();
    // Extract consumer key from Authorization header or body
    const authHeader = req.headers.authorization || '';
    let consumerKey = '';
    if (authHeader.startsWith('OAuth ')) {
      const match = authHeader.match(/oauth_consumer_key="([^"]*)"/);
      consumerKey = match ? decodeURIComponent(match[1]) : '';
    }
    if (!consumerKey) consumerKey = (req.body?.oauth_consumer_key as string) || '';

    // Validate consumer
    if (!OAUTH_OPEN && !OAUTH_CONSUMERS[consumerKey]) {
      return res.status(401).send('Invalid consumer key');
    }

    const token = generateToken();
    const secret = generateToken();
    const callback = (() => {
      if (authHeader) {
        const m = authHeader.match(/oauth_callback="([^"]*)"/);
        if (m) return decodeURIComponent(m[1]);
      }
      return req.body?.oauth_callback || 'oob';
    })();

    oauthTokens.set(token, {
      secret,
      consumerKey,
      authorized: false,
      callback: callback as string,
      createdAt: Date.now(),
    });

    res.type('application/x-www-form-urlencoded')
      .send(`oauth_token=${encodeURIComponent(token)}&oauth_token_secret=${encodeURIComponent(secret)}&oauth_callback_confirmed=true`);
  });

  // Step 2: User Authorization — show login form or auto-authorize
  router.get('/oauth/authorize', async (req: Request, res: Response) => {
    const oauthToken = req.query.oauth_token as string;
    const tokenData = oauthToken ? oauthTokens.get(oauthToken) : undefined;
    if (!tokenData) return res.status(400).send('Invalid or expired oauth_token');

    const base = buildBaseUrl(req);
    // Show a simple login form
    res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>EICD OSLC Authorization</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:320px}
h2{margin-top:0}input{width:100%;padding:8px;margin:6px 0 12px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
button:hover{background:#1d4ed8}.err{color:red;font-size:13px}</style></head>
<body><div class="card">
<h2>EICD OSLC</h2><p>Authorize MagicDraw to access EICD data</p>
<form method="POST" action="${base}/api/oslc/oauth/authorize">
<input type="hidden" name="oauth_token" value="${oauthToken}"/>
<label>Username<input name="username" required/></label>
<label>Password<input name="password" type="password" required/></label>
<button type="submit">Authorize</button>
</form></div></body></html>`);
  });

  router.post('/oauth/authorize', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    const { oauth_token, username, password } = req.body;
    const tokenData = oauth_token ? oauthTokens.get(oauth_token) : undefined;
    if (!tokenData) return res.status(400).send('Invalid or expired oauth_token');

    // Verify user credentials
    try {
      const user = await db.get('SELECT id, username, password, role FROM users WHERE username = ?', [username]);
      if (!user) return res.status(401).send('Invalid credentials');
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).send('Invalid credentials');

      // Authorize the token
      const verifier = generateToken().slice(0, 8);
      tokenData.authorized = true;
      tokenData.userId = user.id;
      tokenData.username = user.username;
      tokenData.role = user.role;
      tokenData.verifier = verifier;

      // Redirect back to callback
      if (tokenData.callback && tokenData.callback !== 'oob') {
        const sep = tokenData.callback.includes('?') ? '&' : '?';
        return res.redirect(`${tokenData.callback}${sep}oauth_token=${encodeURIComponent(oauth_token)}&oauth_verifier=${encodeURIComponent(verifier)}`);
      }

      // Out-of-band: show verifier
      res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorized</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}</style></head>
<body><div class="card"><h2>Authorized</h2><p>Verification code:</p><h1>${verifier}</h1><p>Enter this code in MagicDraw.</p></div></body></html>`);
    } catch (err: any) {
      res.status(500).send('Authorization failed');
    }
  });

  // Step 3: Access Token
  router.post('/oauth/accessToken', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    let requestToken = '';
    let verifier = '';

    if (authHeader.startsWith('OAuth ')) {
      const tokenMatch = authHeader.match(/oauth_token="([^"]*)"/);
      const verifierMatch = authHeader.match(/oauth_verifier="([^"]*)"/);
      requestToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
      verifier = verifierMatch ? decodeURIComponent(verifierMatch[1]) : '';
    }
    if (!requestToken) requestToken = req.body?.oauth_token || '';
    if (!verifier) verifier = req.body?.oauth_verifier || '';

    const tokenData = requestToken ? oauthTokens.get(requestToken) : undefined;
    if (!tokenData || !tokenData.authorized) {
      return res.status(401).send('Invalid or unauthorized request token');
    }
    if (tokenData.verifier !== verifier) {
      return res.status(401).send('Invalid verifier');
    }

    // Issue access token
    const accessToken = generateToken();
    const accessSecret = generateToken();

    // Store access token with user info
    oauthTokens.set(accessToken, {
      secret: accessSecret,
      consumerKey: tokenData.consumerKey,
      authorized: true,
      userId: tokenData.userId,
      username: tokenData.username,
      role: tokenData.role,
      createdAt: Date.now(),
    });

    // Remove the request token
    oauthTokens.delete(requestToken);

    res.type('application/x-www-form-urlencoded')
      .send(`oauth_token=${encodeURIComponent(accessToken)}&oauth_token_secret=${encodeURIComponent(accessSecret)}`);
  });

  // ── Auth middleware (JWT Bearer + HTTP Basic Auth + OAuth) ─
  const oslcAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.set('WWW-Authenticate', 'Basic realm="EICD OSLC"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // JWT Bearer
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded;
        return next();
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    // HTTP Basic Auth
    if (authHeader.startsWith('Basic ')) {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx < 0) return res.status(401).json({ error: 'Invalid Basic credentials' });

      const username = decoded.substring(0, colonIdx);
      const password = decoded.substring(colonIdx + 1);

      try {
        const user = await db.get(
          'SELECT id, username, password, role FROM users WHERE username = ?',
          [username],
        );
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        req.user = { id: user.id, username: user.username, role: user.role };
        return next();
      } catch (err) {
        return res.status(500).json({ error: 'Auth error' });
      }
    }

    // OAuth 1.0a access token
    if (authHeader.startsWith('OAuth ')) {
      const tokenMatch = authHeader.match(/oauth_token="([^"]*)"/);
      const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';
      const tokenData = token ? oauthTokens.get(token) : undefined;
      if (tokenData && tokenData.authorized && tokenData.userId) {
        req.user = { id: tokenData.userId, username: tokenData.username!, role: tokenData.role! };
        return next();
      }
      return res.status(401).json({ error: 'Invalid or expired OAuth token' });
    }

    res.set('WWW-Authenticate', 'Basic realm="EICD OSLC"');
    return res.status(401).json({ error: 'Unsupported auth scheme' });
  };

  router.use(oslcAuth);

  // ══════════════════════════════════════════════════════════
  // Service Provider Catalog
  // ══════════════════════════════════════════════════════════
  router.get('/catalog', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const projects = await db.query('SELECT id, name FROM projects ORDER BY id');

      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(catalogToRdfXml(base, projects));
      }

      const catalog = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/catalog`,
        '@type': 'oslc:ServiceProviderCatalog',
        'dcterms:title': 'EICD OSLC Service Provider Catalog',
        'dcterms:description': 'EICD electrical interface data for MagicDraw SysML integration',
        'oslc:serviceProvider': projects.map((p: any) => ({
          '@id': `${base}/api/oslc/projects/${p.id}/provider`,
          'dcterms:title': p.name,
        })),
      };

      res.type('application/ld+json').json(catalog);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Service Provider (per project)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/provider', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [pid]);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(serviceProviderToRdfXml(base, pid, project.name));
      }

      const resourceTypes = ['devices', 'connectors', 'pins', 'signals'];
      const queryCapabilities = resourceTypes.map(type => ({
        '@type': 'oslc:QueryCapability',
        'dcterms:title': `${type.charAt(0).toUpperCase() + type.slice(1)} Query`,
        'oslc:queryBase': `${base}/api/oslc/projects/${pid}/${type}`,
        'oslc:resourceShape': `${base}/api/oslc/shapes/${type.replace(/s$/, '')}`,
        'oslc:resourceType': `${base}/ns/eicd#${type.charAt(0).toUpperCase() + type.slice(1, -1)}`,
      }));

      const provider = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/projects/${pid}/provider`,
        '@type': 'oslc:ServiceProvider',
        'dcterms:title': `Project: ${project.name}`,
        'oslc:service': [
          {
            '@type': 'oslc:Service',
            'oslc:domain': 'http://open-services.net/ns/am#',
            'oslc:queryCapability': queryCapabilities,
          },
        ],
      };

      res.type('application/ld+json').json(provider);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Resource Shapes
  // ══════════════════════════════════════════════════════════
  router.get('/shapes/:type', (req: AuthRequest, res: Response) => {
    const base = buildBaseUrl(req);
    const type = req.params.type;

    const shapeMap: Record<string, Record<string, string>> = {
      device: DEVICE_PROP_MAP,
      connector: CONNECTOR_PROP_MAP,
      pin: PIN_PROP_MAP,
      signal: SIGNAL_PROP_MAP,
    };

    const propMap = shapeMap[type];
    if (!propMap) return res.status(404).json({ error: `Unknown shape: ${type}` });

    const extraProps: any[] = [];
    if (type === 'device') {
      extraProps.push({
        name: 'hasConnector', valueType: 'oslc:Resource', occurs: 'oslc:Zero-or-many',
        description: 'Links to child connectors (ports)',
      });
    } else if (type === 'connector') {
      extraProps.push(
        { name: 'belongsToDevice', valueType: 'oslc:Resource', occurs: 'oslc:Exactly-one', description: 'Parent device' },
        { name: 'hasPin', valueType: 'oslc:Resource', occurs: 'oslc:Zero-or-many', description: 'Links to child pins' },
      );
    } else if (type === 'pin') {
      extraProps.push(
        { name: 'belongsToConnector', valueType: 'oslc:Resource', occurs: 'oslc:Exactly-one', description: 'Parent connector' },
        { name: 'belongsToDevice', valueType: 'oslc:Resource', occurs: 'oslc:Zero-or-one', description: 'Parent device' },
      );
    } else if (type === 'signal') {
      extraProps.push(
        { name: 'hasEndpoint', valueType: 'oslc:Resource', occurs: 'oslc:Zero-or-many', description: 'Signal endpoints' },
        { name: 'hasEdge', valueType: 'oslc:Resource', occurs: 'oslc:Zero-or-many', description: 'Signal edges (connections)' },
      );
    }

    if (wantsRdfXml(req)) {
      return res.type('application/rdf+xml').send(resourceShapeToRdfXml(type, propMap, base, extraProps));
    }

    const shape = buildResourceShape(type, propMap, base, extraProps);
    res.type('application/ld+json').json(shape);
  });

  // ══════════════════════════════════════════════════════════
  // Query: Devices
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/devices', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 200, 1000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, DEVICE_ATTR_TO_COL);
      const whereBase = `project_id = ? AND (status = 'normal' OR status IS NULL)`;
      const where = clauses.length > 0
        ? `${whereBase} AND ${clauses.join(' AND ')}`
        : whereBase;
      const allParams = [pid, ...params];

      const total = await db.get(`SELECT COUNT(*) as cnt FROM devices WHERE ${where}`, allParams);
      const rows = await db.query(
        `SELECT * FROM devices WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
        [...allParams, pageSize, offset],
      );

      if (wantsRdfXml(req)) {
        const queryBase = `${base}/api/oslc/projects/${pid}/devices`;
        const memberUris = rows.map((d: any) => `${queryBase}/${d.id}`);
        const resourcesXml = rows.map((d: any) => deviceToRdfXml(d, base, pid)).join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri),
        );
      }

      const result = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/projects/${pid}/devices`,
        '@type': 'oslc:ResponseInfo',
        'oslc:totalCount': total.cnt,
        'oslc:results': rows.map((d: any) => {
          const { '@context': _ctx, ...body } = deviceToJsonLd(d, base, pid);
          return body;
        }),
      };

      res.type('application/ld+json').json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Single Device
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/devices/:id', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const did = Number(req.params.id);

      const device = await db.get(
        'SELECT * FROM devices WHERE id = ? AND project_id = ?',
        [did, pid],
      );
      if (!device) return res.status(404).json({ error: 'Device not found' });

      const connectors = await db.query(
        'SELECT id FROM connectors WHERE device_id = ?',
        [did],
      );
      const connectorIds = connectors.map((c: any) => c.id);

      res.set('ETag', `"${device.updated_at || device.created_at}"`);
      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(wrapRdfXml(deviceToRdfXml(device, base, pid, connectorIds), base));
      }
      const jsonLd = deviceToJsonLd(device, base, pid, connectorIds);
      res.type('application/ld+json').json(jsonLd);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Query: Connectors
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/connectors', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 200, 1000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, CONNECTOR_ATTR_TO_COL);
      const whereBase = `d.project_id = ? AND (c.status = 'normal' OR c.status IS NULL)`;
      const where = clauses.length > 0
        ? `${whereBase} AND ${clauses.map(c => `c.${c}`).join(' AND ')}`
        : whereBase;
      const allParams = [pid, ...params];

      const total = await db.get(
        `SELECT COUNT(*) as cnt FROM connectors c JOIN devices d ON c.device_id = d.id WHERE ${where}`,
        allParams,
      );
      const rows = await db.query(
        `SELECT c.* FROM connectors c JOIN devices d ON c.device_id = d.id WHERE ${where} ORDER BY c.id LIMIT ? OFFSET ?`,
        [...allParams, pageSize, offset],
      );

      if (wantsRdfXml(req)) {
        const queryBase = `${base}/api/oslc/projects/${pid}/connectors`;
        const memberUris = rows.map((c: any) => `${queryBase}/${c.id}`);
        const resourcesXml = rows.map((c: any) => connectorToRdfXml(c, base, pid)).join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri),
        );
      }

      const result = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/projects/${pid}/connectors`,
        '@type': 'oslc:ResponseInfo',
        'oslc:totalCount': total.cnt,
        'oslc:results': rows.map((c: any) => {
          const { '@context': _ctx, ...body } = connectorToJsonLd(c, base, pid);
          return body;
        }),
      };

      res.type('application/ld+json').json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Single Connector
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/connectors/:id', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const cid = Number(req.params.id);

      const conn = await db.get(
        `SELECT c.* FROM connectors c JOIN devices d ON c.device_id = d.id
         WHERE c.id = ? AND d.project_id = ?`,
        [cid, pid],
      );
      if (!conn) return res.status(404).json({ error: 'Connector not found' });

      const pins = await db.query('SELECT id FROM pins WHERE connector_id = ?', [cid]);
      const pinIds = pins.map((p: any) => p.id);

      res.set('ETag', `"${conn.updated_at || conn.created_at}"`);
      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(wrapRdfXml(connectorToRdfXml(conn, base, pid, pinIds), base));
      }
      const jsonLd = connectorToJsonLd(conn, base, pid, pinIds);
      res.type('application/ld+json').json(jsonLd);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Query: Pins
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/pins', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 500, 2000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, PIN_ATTR_TO_COL);
      const whereBase = `d.project_id = ? AND (p.status = 'normal' OR p.status IS NULL)`;
      const where = clauses.length > 0
        ? `${whereBase} AND ${clauses.map(c => `p.${c}`).join(' AND ')}`
        : whereBase;
      const allParams = [pid, ...params];

      const total = await db.get(
        `SELECT COUNT(*) as cnt FROM pins p
         JOIN connectors c ON p.connector_id = c.id
         JOIN devices d ON c.device_id = d.id
         WHERE ${where}`,
        allParams,
      );
      const rows = await db.query(
        `SELECT p.*, c.device_id FROM pins p
         JOIN connectors c ON p.connector_id = c.id
         JOIN devices d ON c.device_id = d.id
         WHERE ${where} ORDER BY p.id LIMIT ? OFFSET ?`,
        [...allParams, pageSize, offset],
      );

      if (wantsRdfXml(req)) {
        const queryBase = `${base}/api/oslc/projects/${pid}/pins`;
        const memberUris = rows.map((p: any) => `${queryBase}/${p.id}`);
        const resourcesXml = rows.map((p: any) => pinToRdfXml(p, base, pid)).join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri),
        );
      }

      const result = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/projects/${pid}/pins`,
        '@type': 'oslc:ResponseInfo',
        'oslc:totalCount': total.cnt,
        'oslc:results': rows.map((p: any) => {
          const { '@context': _ctx, ...body } = pinToJsonLd(p, base, pid);
          return body;
        }),
      };

      res.type('application/ld+json').json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Single Pin
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/pins/:id', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const pinId = Number(req.params.id);

      const pin = await db.get(
        `SELECT p.*, c.device_id FROM pins p
         JOIN connectors c ON p.connector_id = c.id
         JOIN devices d ON c.device_id = d.id
         WHERE p.id = ? AND d.project_id = ?`,
        [pinId, pid],
      );
      if (!pin) return res.status(404).json({ error: 'Pin not found' });

      res.set('ETag', `"${pin.updated_at || pin.created_at}"`);
      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(wrapRdfXml(pinToRdfXml(pin, base, pid), base));
      }
      const jsonLd = pinToJsonLd(pin, base, pid);
      res.type('application/ld+json').json(jsonLd);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Query: Signals
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/signals', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 200, 1000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, SIGNAL_ATTR_TO_COL);
      const whereBase = `project_id = ? AND (status = 'Active' OR status = 'normal' OR status IS NULL)`;
      const where = clauses.length > 0
        ? `${whereBase} AND ${clauses.join(' AND ')}`
        : whereBase;
      const allParams = [pid, ...params];

      const total = await db.get(`SELECT COUNT(*) as cnt FROM signals WHERE ${where}`, allParams);
      const rows = await db.query(
        `SELECT * FROM signals WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`,
        [...allParams, pageSize, offset],
      );

      if (wantsRdfXml(req)) {
        const queryBase = `${base}/api/oslc/projects/${pid}/signals`;
        const memberUris = rows.map((s: any) => `${queryBase}/${s.id}`);
        const resourcesXml = rows.map((s: any) => signalToRdfXml(s, [], [], base, pid)).join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri),
        );
      }

      // For list view, include a summary without full endpoint details
      const result = {
        '@context': oslcContext(base),
        '@id': `${base}/api/oslc/projects/${pid}/signals`,
        '@type': 'oslc:ResponseInfo',
        'oslc:totalCount': total.cnt,
        'oslc:results': rows.map((s: any) => {
          const { '@context': _ctx, ...body } = signalToJsonLd(s, [], [], base, pid);
          return body;
        }),
      };

      res.type('application/ld+json').json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Single Signal (with full endpoints & edges)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/signals/:id', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const sid = Number(req.params.id);

      const signal = await db.get(
        'SELECT * FROM signals WHERE id = ? AND project_id = ?',
        [sid, pid],
      );
      if (!signal) return res.status(404).json({ error: 'Signal not found' });

      // Endpoints with device/connector/pin info
      const endpoints = await db.query(
        `SELECT se.*,
                d."设备编号", d."设备中文名称",
                c.id as connector_id, c."设备端元器件编号",
                p."针孔号", p."端接尺寸"
         FROM signal_endpoints se
         LEFT JOIN devices d ON se.device_id = d.id
         LEFT JOIN pins p ON se.pin_id = p.id
         LEFT JOIN connectors c ON p.connector_id = c.id
         WHERE se.signal_id = ?
         ORDER BY se.endpoint_index`,
        [sid],
      );

      // Edges with endpoint indices
      const edges = await db.query(
        `SELECT e.*,
                ef.endpoint_index as from_index,
                et.endpoint_index as to_index
         FROM signal_edges e
         LEFT JOIN signal_endpoints ef ON e.from_endpoint_id = ef.id
         LEFT JOIN signal_endpoints et ON e.to_endpoint_id = et.id
         WHERE e.signal_id = ?`,
        [sid],
      );

      res.set('ETag', `"${signal.updated_at || signal.created_at}"`);
      if (wantsRdfXml(req)) {
        return res.type('application/rdf+xml').send(
          wrapRdfXml(signalToRdfXml(signal, endpoints, edges, base, pid), base),
        );
      }
      const jsonLd = signalToJsonLd(signal, endpoints, edges, base, pid);
      res.type('application/ld+json').json(jsonLd);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Selection Dialog (HTML UI for "Select OSLC Resource" in DataHub)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/selector/:type', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const type = req.params.type; // devices, connectors, pins, signals
      const searchTerm = (req.query['oslc.searchTerms'] as string) || '';

      const typeConfig: Record<string, { table: string; label: string; idCol: string; titleCol: string; where: string }> = {
        devices: {
          table: 'devices',
          label: 'Device',
          idCol: '设备编号',
          titleCol: '设备中文名称',
          where: `project_id = ${pid} AND (status = 'normal' OR status IS NULL)`,
        },
        connectors: {
          table: 'connectors c JOIN devices d ON c.device_id = d.id',
          label: 'Connector',
          idCol: '设备端元器件编号',
          titleCol: '设备端元器件名称及类型',
          where: `d.project_id = ${pid} AND (c.status = 'normal' OR c.status IS NULL)`,
        },
        pins: {
          table: 'pins p JOIN connectors c ON p.connector_id = c.id JOIN devices d ON c.device_id = d.id',
          label: 'Pin',
          idCol: '针孔号',
          titleCol: '针孔号',
          where: `d.project_id = ${pid} AND (p.status = 'normal' OR p.status IS NULL)`,
        },
        signals: {
          table: 'signals',
          label: 'Signal',
          idCol: 'unique_id',
          titleCol: 'unique_id',
          where: `project_id = ${pid} AND (status = 'Active' OR status = 'normal' OR status IS NULL)`,
        },
      };

      const cfg = typeConfig[type];
      if (!cfg) return res.status(404).send('Unknown type');

      const prefix = type === 'connectors' ? 'c' : type === 'pins' ? 'p' : '';
      const idSelect = prefix ? `${prefix}.id` : 'id';
      const idColSelect = prefix ? `${prefix}."${cfg.idCol}"` : `"${cfg.idCol}"`;
      const titleColSelect = cfg.titleCol === cfg.idCol ? idColSelect
        : (prefix ? `${prefix}."${cfg.titleCol}"` : `"${cfg.titleCol}"`);

      let where = cfg.where;
      if (searchTerm) {
        where += ` AND (${idColSelect} LIKE '%${searchTerm.replace(/'/g, "''")}%' OR ${titleColSelect} LIKE '%${searchTerm.replace(/'/g, "''")}%')`;
      }

      const rows = await db.query(
        `SELECT ${idSelect} as id, ${idColSelect} as identifier, ${titleColSelect} as title FROM ${cfg.table} WHERE ${where} ORDER BY ${idSelect} LIMIT 100`,
        [],
      );

      // Return an HTML page that posts selected resource URI via postMessage (OSLC delegated UI)
      const itemsHtml = rows.map((r: any) => {
        const uri = `${base}/api/oslc/projects/${pid}/${type}/${r.id}`;
        const label = r.identifier ? `${r.identifier} — ${r.title || ''}` : (r.title || `#${r.id}`);
        return `<li class="item" data-uri="${uri}" data-title="${label.replace(/"/g, '&quot;')}">${label}</li>`;
      }).join('\n');

      res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Select ${cfg.label}</title>
<style>
body{font-family:sans-serif;margin:0;padding:12px}
h3{margin-top:0}
input{width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
ul{list-style:none;padding:0;margin:0;max-height:380px;overflow-y:auto}
li.item{padding:6px 8px;cursor:pointer;border-bottom:1px solid #eee}
li.item:hover,li.item.selected{background:#e3f2fd}
.actions{margin-top:8px;text-align:right}
button{padding:6px 16px;margin-left:8px;border:1px solid #ccc;border-radius:4px;cursor:pointer}
button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
</style></head><body>
<h3>Select ${cfg.label}</h3>
<input id="search" placeholder="Search..." value="${searchTerm}"/>
<ul id="list">${itemsHtml}</ul>
<div class="actions">
  <button onclick="cancel()">Cancel</button>
  <button class="primary" onclick="ok()">OK</button>
</div>
<script>
let selected = null;
document.querySelectorAll('.item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.item').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    selected = { uri: el.dataset.uri, title: el.dataset.title };
  });
  el.addEventListener('dblclick', () => { selected = { uri: el.dataset.uri, title: el.dataset.title }; ok(); });
});
function ok() {
  if (!selected) return;
  var result = 'oslc-response:{"oslc:results":[{"oslc:label":"' + selected.title + '","rdf:resource":"' + selected.uri + '"}]}';
  if (window.opener) window.opener.postMessage(result, '*');
  else if (window.parent !== window) window.parent.postMessage(result, '*');
  else window.postMessage(result, '*');
}
function cancel() {
  var result = 'oslc-response:{"oslc:results":[]}';
  if (window.opener) window.opener.postMessage(result, '*');
  else if (window.parent !== window) window.parent.postMessage(result, '*');
}
</script></body></html>`);
    } catch (err: any) {
      res.status(500).send('Error loading selector');
    }
  });

  return router;
}
