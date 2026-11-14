import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SqlDb } from './db.ts';

function loadFirebaseConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    // Ignore missing or unreadable config
  }
  return {};
}

const firebaseConfig = loadFirebaseConfig();

async function ensureFirebaseAdminApp() {
  if (!firebaseConfig?.projectId || firebaseConfig.projectId === 'remixed-project-id') {
    return null;
  }
  const fbAppPkg = 'firebase-admin/app';
  const { initializeApp, getApps } = await import(/* @vite-ignore */ fbAppPkg);
  if (!getApps().length) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  return getApps()[0] || null;
}

export const MASTER_OWNER_EMAIL = 'azeco77@gmail.com';
export const DEFAULT_ADMIN_USERNAME = 'admin';
const ALSAFA_BIZ_ID = 'alsafa-steel-workspace';

const SESSION_SECRET =
  process.env.AUTH_SESSION_SECRET ||
  process.env.INTEGRATION_ENCRYPTION_KEY ||
  crypto
    .createHash('sha256')
    .update(`leadflow-session-v1:${firebaseConfig?.projectId || 'local'}:${ALSAFA_BIZ_ID}`)
    .digest('hex');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!password || !storedHash || !storedHash.startsWith('scrypt:')) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface SessionTokenPayload {
  sub: string;
  username: string;
  email: string;
  name: string;
  isOwner: boolean;
  isPlatformSuperAdmin: boolean;
  accountSlot: 'manager' | 'accountant';
  exp: number;
}

export function signSessionToken(payload: Omit<SessionTokenPayload, 'exp'>): string {
  const fullPayload: SessionTokenPayload = {
    ...payload,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `lf1.${body}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  if (!token || !token.startsWith('lf1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;
  try {
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    if (!parsed.sub || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function syncSystemAccountsToFirestore(db: SqlDb): Promise<void> {
  const projectId = firebaseConfig?.projectId;
  const dbId = firebaseConfig?.firestoreDatabaseId;
  if (!projectId || !dbId) return;
  // Only attempt Admin Firestore sync when GCP credentials exist in the runtime environment
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.K_SERVICE) return;

  try {
    const app = await ensureFirebaseAdminApp();
    if (!app) return;
    const fbFirestorePkg = 'firebase-admin/firestore';
    const { getFirestore: getAdminFirestore } = await import(/* @vite-ignore */ fbFirestorePkg);
    const adminFs = getAdminFirestore(app, dbId);
    const rows = db
      .prepare(`
        SELECT u.id, u.username, u.email, u.full_name, u.is_platform_super_admin,
               bm.account_slot, bm.role, bm.status
        FROM users u
        JOIN business_memberships bm ON bm.user_id = u.id
        WHERE bm.business_id = ?
      `)
      .all(ALSAFA_BIZ_ID) as any[];

    const nowIso = new Date().toISOString();
    for (const r of rows) {
      await adminFs.collection('users').doc(r.id).set(
        {
          uid: r.id,
          username: r.username || r.email.split('@')[0],
          email: r.email,
          fullName: r.full_name,
          accountType: r.account_slot === 'manager' ? 'manager' : 'accountant',
          isOwner: Boolean(r.is_platform_super_admin || r.username === DEFAULT_ADMIN_USERNAME),
          defaultLanguage: 'ar',
          theme: 'light',
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }
  } catch {
    // Graceful skip when Firestore Admin credentials are unavailable
  }
}

export type Role = 'super_admin' | 'business_admin' | 'manager' | 'employee';

export interface AuthUser {
  id: string;
  firebaseUid: string;
  username?: string;
  email: string;
  fullName: string;
  isDemoUser: boolean;
  isPlatformSuperAdmin: boolean;
  isOwner: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
  membership?: {
    id: string;
    business_id: string;
    role: Role;
    status: string;
    account_slot?: 'manager' | 'accountant';
  };
  rawBody?: Buffer;
}

export type TokenVerifier = (token: string) => Promise<{
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}>;

export const defaultTokenVerifier: TokenVerifier = async (token: string) => {
  const app = await ensureFirebaseAdminApp();
  if (!app) {
    throw new Error('Firebase Admin is not configured in this environment');
  }
  const fbAuthPkg = 'firebase-admin/auth';
  const { getAuth } = await import(/* @vite-ignore */ fbAuthPkg);
  const adminAuth = getAuth(app);
  const decoded = await adminAuth.verifyIdToken(token);
  if (!decoded.email) {
    throw new Error('Verified token missing email address');
  }
  return {
    uid: decoded.uid,
    email: decoded.email.toLowerCase(),
    name: decoded.name || decoded.email.split('@')[0],
    picture: decoded.picture,
  };
};

export function upsertUserFromAuth(
  db: SqlDb,
  payload: { uid: string; email: string; name?: string; picture?: string; username?: string }
): AuthUser {
  const now = new Date().toISOString();
  const normalizedEmail = payload.email.toLowerCase().trim();
  const normalizedUsername = payload.username?.trim().toLowerCase() || undefined;
  const isOwner = normalizedEmail === MASTER_OWNER_EMAIL || normalizedUsername === DEFAULT_ADMIN_USERNAME;
  const existingByUid = db.prepare('SELECT * FROM users WHERE firebase_uid = ? OR id = ?').get(payload.uid, payload.uid) as any;
  const existingByUsername = !existingByUid && normalizedUsername
    ? (db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(normalizedUsername) as any)
    : null;
  const existingByEmail = !existingByUid && !existingByUsername
    ? (db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail) as any)
    : null;
  const existing = existingByUid || existingByUsername || existingByEmail;

  let userId: string;
  let isPlatformSuperAdmin = isOwner ? 1 : 0;

  if (existing) {
    userId = existing.id;
    isPlatformSuperAdmin = isOwner ? 1 : existing.is_platform_super_admin || 0;
    db.prepare(`
      UPDATE users
      SET firebase_uid = COALESCE(firebase_uid, ?),
          username = COALESCE(username, ?),
          email = ?,
          full_name = COALESCE(NULLIF(?, ''), full_name),
          avatar_url = COALESCE(?, avatar_url),
          is_platform_super_admin = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      payload.uid,
      normalizedUsername || null,
      normalizedEmail,
      payload.name || '',
      payload.picture || null,
      isPlatformSuperAdmin,
      now,
      userId
    );
  } else {
    userId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, firebase_uid, username, email, full_name, avatar_url, default_language, theme, is_platform_super_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ar', 'light', ?, ?, ?)
    `).run(
      userId,
      payload.uid,
      normalizedUsername || null,
      normalizedEmail,
      payload.name || normalizedEmail.split('@')[0],
      payload.picture || null,
      isPlatformSuperAdmin,
      now,
      now
    );
  }

  // Activate any pending or pre-seeded workspace memberships for this email
  db.prepare(`
    UPDATE business_memberships
    SET user_id = ?,
        status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
        updated_at = ?
    WHERE LOWER(invited_email) = ? AND status != 'inactive'
  `).run(userId, now, normalizedEmail);

  // Guarantee Owner (admin / azeco77@gmail.com) always has full business_admin Manager membership on Al-Safa Steel
  if (isOwner) {
    const alsafaExists = db.prepare('SELECT id FROM businesses WHERE id = ?').get(ALSAFA_BIZ_ID);
    if (alsafaExists) {
      db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'manager', 'business_admin', 'active', ?, ?)
        ON CONFLICT(business_id, invited_email) DO UPDATE SET
          user_id = excluded.user_id,
          account_slot = 'manager',
          role = 'business_admin',
          status = 'active',
          updated_at = excluded.updated_at
      `).run(
        crypto.randomUUID(),
        ALSAFA_BIZ_ID,
        userId,
        normalizedEmail,
        payload.name || 'المدير (admin) | Manager (Owner)',
        now,
        now
      );
    }
  }

  return {
    id: userId,
    firebaseUid: existing?.firebase_uid || payload.uid,
    username: existing?.username || normalizedUsername,
    email: normalizedEmail,
    fullName: payload.name || existing?.full_name || normalizedEmail.split('@')[0],
    isDemoUser: false,
    isPlatformSuperAdmin: Boolean(isPlatformSuperAdmin),
    isOwner,
  };
}

export async function resolveUserFromToken(
  db: SqlDb,
  token: string,
  verifier: TokenVerifier = defaultTokenVerifier
): Promise<AuthUser> {
  // 1. Check signed traditional username/password session token
  const session = verifySessionToken(token);
  if (session) {
    const dbUser =
      (db.prepare('SELECT * FROM users WHERE id = ?').get(session.sub) as any) ||
      (db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(session.username.toLowerCase()) as any) ||
      (db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(session.email.toLowerCase()) as any);

    if (dbUser) {
      // Ensure active membership on Al-Safa Steel for valid seeded/session accounts
      const hasMembership = db
        .prepare("SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ? AND status = 'active'")
        .get(ALSAFA_BIZ_ID, dbUser.id);
      if (!hasMembership && (session.isOwner || dbUser.username === DEFAULT_ADMIN_USERNAME || session.accountSlot)) {
        const now = new Date().toISOString();
        const alsafaExists = db.prepare('SELECT id FROM businesses WHERE id = ?').get(ALSAFA_BIZ_ID);
        if (alsafaExists) {
          db.prepare(`
            INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'business_admin', 'active', ?, ?)
            ON CONFLICT(business_id, invited_email) DO UPDATE SET
              user_id = excluded.user_id,
              status = 'active',
              role = 'business_admin',
              updated_at = excluded.updated_at
          `).run(
            crypto.randomUUID(),
            ALSAFA_BIZ_ID,
            dbUser.id,
            dbUser.email.toLowerCase(),
            dbUser.full_name,
            session.accountSlot || (session.isOwner ? 'manager' : 'accountant'),
            now,
            now
          );
        }
      }

      return {
        id: dbUser.id,
        firebaseUid: dbUser.firebase_uid || dbUser.id,
        username: dbUser.username || session.username,
        email: dbUser.email.toLowerCase(),
        fullName: dbUser.full_name,
        isDemoUser: false,
        isPlatformSuperAdmin: Boolean(dbUser.is_platform_super_admin || session.isOwner),
        isOwner: Boolean(session.isOwner || dbUser.username === DEFAULT_ADMIN_USERNAME || dbUser.email.toLowerCase() === MASTER_OWNER_EMAIL),
      };
    }

    // Reconstruct user seamlessly if serverless SQLite cold-started after login
    const rebuilt = upsertUserFromAuth(db, {
      uid: session.sub,
      username: session.username,
      email: session.email,
      name: session.name,
    });
    const alsafaExists = db.prepare('SELECT id FROM businesses WHERE id = ?').get(ALSAFA_BIZ_ID);
    if (alsafaExists) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'business_admin', 'active', ?, ?)
        ON CONFLICT(business_id, invited_email) DO UPDATE SET
          user_id = excluded.user_id,
          status = 'active',
          role = 'business_admin',
          updated_at = excluded.updated_at
      `).run(
        crypto.randomUUID(),
        ALSAFA_BIZ_ID,
        rebuilt.id,
        rebuilt.email,
        rebuilt.fullName,
        session.accountSlot || 'accountant',
        now,
        now
      );
    }
    return rebuilt;
  }

  // 2. Fallback to injected TokenVerifier (used by automated acceptance test mocks)
  const verified = await verifier(token);
  return upsertUserFromAuth(db, verified);
}

export function createAuthMiddleware(db: SqlDb, verifier: TokenVerifier = defaultTokenVerifier) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      try {
        req.authUser = await resolveUserFromToken(db, token, verifier);
        return next();
      } catch {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token' });
      }
    }

    // Allow x-demo-session only in automated test environment
    if (process.env.NODE_ENV === 'test' && req.headers['x-demo-session'] === 'true') {
      req.authUser = {
        id: 'alsafa-owner-manager',
        firebaseUid: 'seed-uid-alsafa-owner-manager',
        username: DEFAULT_ADMIN_USERNAME,
        email: MASTER_OWNER_EMAIL,
        fullName: 'حساب المدير (المالك الرئيسي) | Manager (Owner)',
        isDemoUser: true,
        isPlatformSuperAdmin: true,
        isOwner: true,
      };
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  };
}

export function requireBusinessAccess(db: SqlDb, allowedRoles?: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const businessId = req.params.businessId || req.body?.businessId;
    if (!businessId || !req.authUser) {
      return res.status(400).json({ error: 'Missing business context' });
    }

    const business = db.prepare('SELECT id, is_demo FROM businesses WHERE id = ?').get(businessId) as
      | { id: string; is_demo: number }
      | undefined;
    if (!business) {
      return res.status(404).json({ error: 'Business workspace not found' });
    }

    // Strict Demo vs Production isolation (for automated tests)
    if (req.authUser.isDemoUser && business.is_demo !== 1) {
      return res.status(403).json({ error: 'Forbidden: Demo session cannot access production workspaces' });
    }

    if (req.authUser.isDemoUser && business.is_demo === 1) {
      const demoRoleHeader = req.headers['x-demo-role'] as Role | undefined;
      const effectiveRole: Role =
        demoRoleHeader && ['business_admin', 'manager', 'employee'].includes(demoRoleHeader)
          ? demoRoleHeader
          : 'business_admin';
      const demoUserIdHeader = req.headers['x-demo-user-id'] as string | undefined;
      if (effectiveRole === 'employee' && demoUserIdHeader) {
        req.authUser = { ...req.authUser, id: demoUserIdHeader };
      }
      if (allowedRoles && !allowedRoles.includes(effectiveRole)) {
        return res.status(403).json({ error: 'Forbidden: Insufficient role permissions' });
      }
      req.membership = {
        id: 'demo-membership',
        business_id: businessId,
        role: effectiveRole,
        status: 'active',
        account_slot: 'manager',
      };
      return next();
    }

    const membership = db
      .prepare(
        `SELECT id, business_id, role, status, account_slot FROM business_memberships
         WHERE business_id = ? AND user_id = ? AND status = 'active'`
      )
      .get(businessId, req.authUser.id) as
      | { id: string; business_id: string; role: Role; status: string; account_slot?: 'manager' | 'accountant' }
      | undefined;

    if (!membership) {
      if ((req.authUser.isOwner || req.authUser.username === DEFAULT_ADMIN_USERNAME) && business.id === ALSAFA_BIZ_ID) {
        req.membership = {
          id: 'owner-membership',
          business_id: businessId,
          role: 'business_admin',
          status: 'active',
          account_slot: 'manager',
        };
        return next();
      }
      if (req.authUser.isPlatformSuperAdmin && business.is_demo === 0) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this business workspace' });
      }
      if (business.is_demo === 1 && req.authUser.isOwner) {
        req.membership = {
          id: 'owner-demo-access',
          business_id: businessId,
          role: 'business_admin',
          status: 'active',
          account_slot: 'manager',
        };
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: Cross-tenant access denied' });
    }

    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions for this action' });
    }

    req.membership = membership;
    next();
  };
}

export function writeAuditLog(
  db: SqlDb,
  params: {
    businessId?: string | null;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }
) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id, details_json, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      params.businessId || null,
      params.actorUserId || null,
      params.action,
      params.entityType,
      params.entityId || null,
      JSON.stringify(params.details || {}),
      params.ipAddress || null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

export function createRateLimiter(maxRequests = 180, windowMs = 60_000) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'global';
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down and try again.' });
    }

    next();
  };
}
