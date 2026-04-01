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
  wantsCompactXml,
  compactXml,
  catalogToRdfXml,
  projectCatalogToRdfXml,
  serviceProviderToRdfXml,
  resourceTypeProviderToRdfXml,
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

// ── Session store for Jazz-style form login (j_security_check) ───
interface SessionData {
  userId: number;
  username: string;
  role: string;
  createdAt: number;
}
const sessions = new Map<string, SessionData>();

function cleanSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of sessions) {
    if (v.createdAt < cutoff) sessions.delete(k);
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      result[pair.substring(0, idx).trim()] = pair.substring(idx + 1).trim();
    }
  }
  return result;
}

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

  // ── OSLC headers + request logging middleware ─────────────
  router.use((req: Request, res: Response, next: NextFunction) => {
    res.set('OSLC-Core-Version', '2.0');
    console.log(`[OSLC] ${req.method} ${req.originalUrl} Accept=${req.headers.accept || '*/*'} Auth=${req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'none'}`);
    next();
  });

  // ── Root Services (OSLC 2.0 discovery, no auth required) ──
  // Jazz-compatible rootservices — DataHub parses rdf:resource attributes
  // to discover the ServiceProviderCatalog URL for each OSLC domain.
  router.get('/rootservices', (req: Request, res: Response) => {
    const base = buildBaseUrl(req);
    const catalogUrl = `${base}/api/oslc/catalog`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:Description
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/terms/"
    xmlns:oslc_rm="http://open-services.net/xmlns/rm/1.0/"
    xmlns:oslc_cm="http://open-services.net/xmlns/cm/1.0/"
    xmlns:oslc_am="http://open-services.net/xmlns/am/1.0/"
    xmlns:jfs="http://jazz.net/xmlns/prod/jazz/jfs/1.0/"
    rdf:about="${base}/api/oslc/rootservices">

  <dc:title>EICD OSLC Root Services</dc:title>

  <!-- Service Provider Catalog (RM domain — DataHub primary) -->
  <oslc_rm:rmServiceProviders rdf:resource="${catalogUrl}"/>

  <!-- OAuth 1.0a endpoints -->
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

  // ── Auth middleware (Session Cookie + JWT Bearer + HTTP Basic Auth + OAuth) ─
  const oslcAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Check session cookies first (Jazz-style form login)
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['JSESSIONID'] || cookies['LtpaToken2'];
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        req.user = { id: session.userId, username: session.username, role: session.role };
        console.log(`[OSLC] Auth via session cookie: user=${session.username}`);
        return next();
      }
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log(`[OSLC-AUTH] ✗ No auth header — ${req.method} ${req.path}`);
      res.set('WWW-Authenticate', 'Basic realm="EICD OSLC"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // JWT Bearer
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded;
        console.log(`[OSLC-AUTH] ✓ JWT user=${decoded.username} — ${req.method} ${req.path}`);
        return next();
      } catch {
        console.log(`[OSLC-AUTH] ✗ Invalid JWT — ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    // HTTP Basic Auth
    if (authHeader.startsWith('Basic ')) {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx < 0) {
        console.log(`[OSLC-AUTH] ✗ Malformed Basic header — ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid Basic credentials' });
      }

      const username = decoded.substring(0, colonIdx);
      const password = decoded.substring(colonIdx + 1);

      try {
        const user = await db.get(
          'SELECT id, username, password, role FROM users WHERE username = ?',
          [username],
        );
        if (!user) {
          console.log(`[OSLC-AUTH] ✗ User not found: ${username} — ${req.method} ${req.path}`);
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          console.log(`[OSLC-AUTH] ✗ Wrong password for: ${username} — ${req.method} ${req.path}`);
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.user = { id: user.id, username: user.username, role: user.role };
        console.log(`[OSLC-AUTH] ✓ Basic user=${username} — ${req.method} ${req.path}`);
        return next();
      } catch (err) {
        console.error(`[OSLC-AUTH] ✗ DB error during Basic auth: ${err}`);
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

  // ── Jazz-style form login (j_security_check) — before auth middleware ──
  // DataHub "login" auth type GETs this URL to show login form in a webview,
  // then the form POSTs credentials back here.
  router.get('/j_security_check', (req: Request, res: Response) => {
    const base = buildBaseUrl(req);
    // Check if already logged in via cookie
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['JSESSIONID'] || cookies['LtpaToken2'];
    if (sessionId && sessions.get(sessionId)) {
      console.log(`[OSLC] j_security_check GET: already authenticated via cookie`);
      return res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>EICD OSLC - Authenticated</title></head>
<body><p>Authenticated. You may close this window.</p></body></html>`);
    }
    console.log(`[OSLC] j_security_check GET: showing login form`);
    res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>EICD OSLC Login</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:320px}
h2{margin-top:0}input{width:100%;padding:8px;margin:6px 0 12px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
button:hover{background:#1d4ed8}</style></head>
<body><div class="card">
<h2>EICD OSLC Login</h2>
<form method="POST" action="${base}/api/oslc/j_security_check">
<label>Username<input name="j_username" required/></label>
<label>Password<input name="j_password" type="password" required/></label>
<button type="submit">Login</button>
</form></div></body></html>`);
  });

  router.post('/j_security_check', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
    const username = req.body?.j_username || req.body?.username;
    const password = req.body?.j_password || req.body?.password;
    console.log(`[OSLC] j_security_check login attempt: user=${username}`);

    if (!username || !password) {
      return res.status(401).send('Missing credentials');
    }

    try {
      const user = await db.get('SELECT id, username, password, role FROM users WHERE username = ?', [username]);
      if (!user) return res.status(401).send('Invalid credentials');
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).send('Invalid credentials');

      cleanSessions();
      const sessionId = generateToken();
      sessions.set(sessionId, {
        userId: user.id,
        username: user.username,
        role: user.role,
        createdAt: Date.now(),
      });

      // Set JSESSIONID cookie (Jazz standard) + LtpaToken2 (some clients check this)
      res.cookie('JSESSIONID', sessionId, { path: '/api/oslc', httpOnly: true });
      res.cookie('LtpaToken2', sessionId, { path: '/api/oslc', httpOnly: true });
      console.log(`[OSLC] j_security_check success: user=${username}, session=${sessionId.substring(0, 8)}...`);

      // If there was an original URL the client wanted, redirect there
      const redirectUrl = req.query.redirect as string;
      if (redirectUrl) {
        return res.redirect(302, redirectUrl);
      }
      // Show success page — DataHub webview should capture the cookies
      res.status(200).type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>EICD OSLC - Login Successful</title></head>
<body><h2>Login Successful</h2><p>Authenticated as ${user.username}. You may close this window.</p></body></html>`);
    } catch (err: any) {
      console.error(`[OSLC] j_security_check error:`, err.message);
      res.status(500).send('Login failed');
    }
  });

  // Jazz-compatible identity endpoint — DataHub may check this to verify session
  router.get('/whoami', (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['JSESSIONID'] || cookies['LtpaToken2'];
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (session) {
      return res.type('application/rdf+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rdf:Description xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:foaf="http://xmlns.com/foaf/0.1/"
    xmlns:dc="http://purl.org/dc/terms/">
  <foaf:name>${session.username}</foaf:name>
  <dc:identifier>${session.userId}</dc:identifier>
</rdf:Description>`);
    }
    res.status(401).send('Not authenticated');
  });

  // Jazz auth redirect — when DataHub hits a protected resource without auth,
  // redirect to login form (DataHub "login" type expects this pattern)
  router.get('/auth', (req: Request, res: Response) => {
    const base = buildBaseUrl(req);
    res.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>EICD OSLC Login</title>
<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:320px}
h2{margin-top:0}input{width:100%;padding:8px;margin:6px 0 12px;box-sizing:border-box;border:1px solid #ccc;border-radius:4px}
button{width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px}
button:hover{background:#1d4ed8}</style></head>
<body><div class="card">
<h2>EICD OSLC Login</h2>
<form method="POST" action="${base}/api/oslc/j_security_check">
<label>Username<input name="j_username" required/></label>
<label>Password<input name="j_password" type="password" required/></label>
<button type="submit">Login</button>
</form></div></body></html>`);
  });

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

      // OSLC Compact Representation (for OSLC Preview panel)
      if (wantsCompactXml(req)) {
        const providerUri = `${base}/api/oslc/projects/${pid}/provider`;
        const previewUrl = `${base}/api/oslc/projects/${pid}/preview`;
        return res.type('application/x-oslc-compact+xml').send(
          compactXml(providerUri, `Project: ${project.name}`, project.name, previewUrl),
        );
      }

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
            'oslc:domain': ['http://open-services.net/ns/rm#', 'http://open-services.net/ns/am#'],
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
  // Project Sub-Catalog (DataHub fetches when expanding a project node)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/catalog', async (req: AuthRequest, res: Response) => {
    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [pid]);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.type('application/rdf+xml').send(projectCatalogToRdfXml(base, pid, project.name));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Per-resource-type Service Provider (e.g., /projects/34/devices/provider)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/:resourceType/provider', async (req: AuthRequest, res: Response) => {
    const validTypes = ['devices', 'connectors', 'pins', 'signals'];
    const rType = req.params.resourceType;
    if (!validTypes.includes(rType)) return res.status(404).json({ error: `Unknown type: ${rType}` });

    try {
      const base = buildBaseUrl(req);
      const pid = Number(req.params.projectId);
      const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [pid]);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      res.type('application/rdf+xml').send(resourceTypeProviderToRdfXml(base, pid, project.name, rType));
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
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 5000, 10000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, DEVICE_ATTR_TO_COL);
      const whereBase = `project_id = ?`;
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
        const inlineResources = rows.map((d: any) => deviceToRdfXml(d, base, pid));
        const resourcesXml = inlineResources.join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri, inlineResources),
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
      if (wantsCompactXml(req)) {
        const uri = `${base}/api/oslc/projects/${pid}/devices/${did}`;
        const title = device['设备编号'] || `Device ${did}`;
        const preview = `${uri}/preview`;
        return res.type('application/x-oslc-compact+xml').send(compactXml(uri, title, title, preview));
      }
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
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 5000, 10000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, CONNECTOR_ATTR_TO_COL);
      const whereBase = `d.project_id = ?`;
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
        const inlineResources = rows.map((c: any) => connectorToRdfXml(c, base, pid));
        const resourcesXml = inlineResources.join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri, inlineResources),
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
      if (wantsCompactXml(req)) {
        const uri = `${base}/api/oslc/projects/${pid}/connectors/${cid}`;
        const title = conn['设备端元器件编号'] || `Connector ${cid}`;
        return res.type('application/x-oslc-compact+xml').send(compactXml(uri, title, title, `${uri}/preview`));
      }
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
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 5000, 10000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, PIN_ATTR_TO_COL);
      const whereBase = `d.project_id = ?`;
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
        const inlineResources = rows.map((p: any) => pinToRdfXml(p, base, pid));
        const resourcesXml = inlineResources.join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri, inlineResources),
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
      if (wantsCompactXml(req)) {
        const uri = `${base}/api/oslc/projects/${pid}/pins/${pinId}`;
        const title = pin['针孔号'] || `Pin ${pinId}`;
        return res.type('application/x-oslc-compact+xml').send(compactXml(uri, title, title, `${uri}/preview`));
      }
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
      const pageSize = Math.min(Number(req.query['oslc.pageSize']) || 5000, 10000);
      const page = Math.max(Number(req.query['oslc.pageNo']) || 1, 1);
      const offset = (page - 1) * pageSize;

      const { clauses, params } = parseOslcWhere(req.query['oslc.where'] as string, SIGNAL_ATTR_TO_COL);
      const whereBase = `project_id = ?`;
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
        const inlineResources = rows.map((s: any) => signalToRdfXml(s, [], [], base, pid));
        const resourcesXml = inlineResources.join('\n');
        const nextPageUri = rows.length === pageSize && offset + pageSize < total.cnt
          ? `${queryBase}?oslc.pageNo=${page + 1}&oslc.pageSize=${pageSize}`
          : undefined;
        return res.type('application/rdf+xml').send(
          queryResponseRdfXml(queryBase, total.cnt, memberUris, resourcesXml, base, nextPageUri, inlineResources),
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
      if (wantsCompactXml(req)) {
        const sid = Number(req.params.id);
        const uri = `${base}/api/oslc/projects/${pid}/signals/${sid}`;
        const title = signal.unique_id || signal.signal_name || `Signal ${sid}`;
        return res.type('application/x-oslc-compact+xml').send(compactXml(uri, title, title, `${uri}/preview`));
      }
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
          where: `project_id = ${pid}`,
        },
        connectors: {
          table: 'connectors c JOIN devices d ON c.device_id = d.id',
          label: 'Connector',
          idCol: '设备端元器件编号',
          titleCol: '设备端元器件名称及类型',
          where: `d.project_id = ${pid}`,
        },
        pins: {
          table: 'pins p JOIN connectors c ON p.connector_id = c.id JOIN devices d ON c.device_id = d.id',
          label: 'Pin',
          idCol: '针孔号',
          titleCol: '针孔号',
          where: `d.project_id = ${pid}`,
        },
        signals: {
          table: 'signals',
          label: 'Signal',
          idCol: 'unique_id',
          titleCol: 'unique_id',
          where: `project_id = ${pid}`,
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

  // ══════════════════════════════════════════════════════════
  // OSLC Preview HTML pages (referenced by compact+xml)
  // ══════════════════════════════════════════════════════════

  // Project preview
  router.get('/projects/:projectId/preview', async (req: AuthRequest, res: Response) => {
    try {
      const pid = Number(req.params.projectId);
      const project = await db.get('SELECT id, name FROM projects WHERE id = ?', [pid]);
      if (!project) return res.status(404).send('Not found');
      const devCount = await db.get(`SELECT COUNT(*) as cnt FROM devices WHERE project_id = ? AND (status='normal' OR status IS NULL)`, [pid]);
      const sigCount = await db.get(`SELECT COUNT(*) as cnt FROM signals WHERE project_id = ? AND (status='Active' OR status='normal' OR status IS NULL)`, [pid]);
      res.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;margin:12px;font-size:13px}h3{margin:0 0 8px}table{border-collapse:collapse}td{padding:2px 12px 2px 0;color:#333}</style></head>
<body><h3>${project.name}</h3>
<table><tr><td>Devices:</td><td><b>${devCount.cnt}</b></td></tr>
<tr><td>Signals:</td><td><b>${sigCount.cnt}</b></td></tr></table></body></html>`);
    } catch { res.status(500).send('Error'); }
  });

  // Device preview
  router.get('/projects/:projectId/devices/:id/preview', async (req: AuthRequest, res: Response) => {
    try {
      const device = await db.get('SELECT * FROM devices WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      if (!device) return res.status(404).send('Not found');
      const rows = Object.entries(device).filter(([k]) => !['id','project_id','status','created_at','updated_at','pending_item_type'].includes(k));
      const html = rows.map(([k,v]) => `<tr><td>${k}</td><td>${v ?? ''}</td></tr>`).join('');
      res.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;margin:12px;font-size:13px}table{border-collapse:collapse}td{padding:2px 8px 2px 0;border-bottom:1px solid #eee}</style></head>
<body><table>${html}</table></body></html>`);
    } catch { res.status(500).send('Error'); }
  });

  // Connector preview
  router.get('/projects/:projectId/connectors/:id/preview', async (req: AuthRequest, res: Response) => {
    try {
      const conn = await db.get(`SELECT c.* FROM connectors c JOIN devices d ON c.device_id=d.id WHERE c.id=? AND d.project_id=?`, [req.params.id, req.params.projectId]);
      if (!conn) return res.status(404).send('Not found');
      const rows = Object.entries(conn).filter(([k]) => !['id','device_id','status','created_at','updated_at','pending_item_type'].includes(k));
      const html = rows.map(([k,v]) => `<tr><td>${k}</td><td>${v ?? ''}</td></tr>`).join('');
      res.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;margin:12px;font-size:13px}table{border-collapse:collapse}td{padding:2px 8px 2px 0;border-bottom:1px solid #eee}</style></head>
<body><table>${html}</table></body></html>`);
    } catch { res.status(500).send('Error'); }
  });

  // Pin preview
  router.get('/projects/:projectId/pins/:id/preview', async (req: AuthRequest, res: Response) => {
    try {
      const pin = await db.get(`SELECT p.* FROM pins p JOIN connectors c ON p.connector_id=c.id JOIN devices d ON c.device_id=d.id WHERE p.id=? AND d.project_id=?`, [req.params.id, req.params.projectId]);
      if (!pin) return res.status(404).send('Not found');
      const rows = Object.entries(pin).filter(([k]) => !['id','connector_id','status','created_at','updated_at','pending_item_type'].includes(k));
      const html = rows.map(([k,v]) => `<tr><td>${k}</td><td>${v ?? ''}</td></tr>`).join('');
      res.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;margin:12px;font-size:13px}table{border-collapse:collapse}td{padding:2px 8px 2px 0;border-bottom:1px solid #eee}</style></head>
<body><table>${html}</table></body></html>`);
    } catch { res.status(500).send('Error'); }
  });

  // Signal preview
  router.get('/projects/:projectId/signals/:id/preview', async (req: AuthRequest, res: Response) => {
    try {
      const signal = await db.get('SELECT * FROM signals WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (!signal) return res.status(404).send('Not found');
      const rows = Object.entries(signal).filter(([k]) => !['id','project_id','status','created_at','updated_at','endpoints','edges','pending_item_type'].includes(k));
      const html = rows.map(([k,v]) => `<tr><td>${k}</td><td>${v ?? ''}</td></tr>`).join('');
      res.type('text/html').send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;margin:12px;font-size:13px}table{border-collapse:collapse}td{padding:2px 8px 2px 0;border-bottom:1px solid #eee}</style></head>
<body><table>${html}</table></body></html>`);
    } catch { res.status(500).send('Error'); }
  });

  // ══════════════════════════════════════════════════════════
  // JSON Export (for MagicDraw Groovy macro — returns raw DB rows)
  // ══════════════════════════════════════════════════════════
  router.get('/projects/:projectId/export/:type', async (req: AuthRequest, res: Response) => {
    const ts = new Date().toISOString();
    const pid = Number(req.params.projectId);
    const type = req.params.type;
    const user = (req as any).user?.username || 'unknown';
    console.log(`[OSLC-EXPORT ${ts}] ➜ GET /projects/${pid}/export/${type}  user=${user}  ip=${req.ip}`);

    try {
      const exclude = ['import_conflicts', 'validation_errors', 'version', 'import_status', 'pending_item_type'];
      const filterRow = (row: any) => {
        const r: any = {};
        for (const [k, v] of Object.entries(row)) {
          if (!exclude.includes(k) && v !== null && v !== undefined && v !== '') r[k] = v;
        }
        return r;
      };

      let rows: any[];
      if (type === 'devices') {
        rows = await db.query('SELECT * FROM devices WHERE project_id = ?', [pid]);
      } else if (type === 'connectors') {
        rows = await db.query(
          'SELECT c.* FROM connectors c JOIN devices d ON c.device_id = d.id WHERE d.project_id = ?', [pid]);
      } else if (type === 'pins') {
        rows = await db.query(
          `SELECT p.* FROM pins p JOIN connectors c ON p.connector_id = c.id
           JOIN devices d ON c.device_id = d.id WHERE d.project_id = ?`, [pid]);
      } else if (type === 'signals') {
        rows = await db.query('SELECT * FROM signals WHERE project_id = ?', [pid]);
      } else if (type === 'signal_endpoints') {
        rows = await db.query(
          `SELECT se.*, d."设备编号" as device_code, c."设备端元器件编号" as connector_code, p."针孔号" as pin_code
           FROM signal_endpoints se
           JOIN signals s ON se.signal_id = s.id
           LEFT JOIN devices d ON se.device_id = d.id
           LEFT JOIN pins p ON se.pin_id = p.id
           LEFT JOIN connectors c ON p.connector_id = c.id
           WHERE s.project_id = ?`, [pid]);
      } else {
        console.log(`[OSLC-EXPORT ${ts}] ✗ Unknown type: ${type}`);
        return res.status(404).json({ error: 'Unknown type' });
      }

      const filtered = rows.map(filterRow);
      const jsonSize = JSON.stringify({ total: filtered.length, results: filtered }).length;
      console.log(`[OSLC-EXPORT ${ts}] ✓ ${type}: ${filtered.length} rows, ${(jsonSize / 1024).toFixed(1)} KB`);
      res.json({ total: filtered.length, results: filtered });
    } catch (err: any) {
      console.error(`[OSLC-EXPORT ${ts}] ✗ ERROR: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
