import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { SqlDb } from './db.ts';

if (!getApps().length && firebaseConfig?.projectId && firebaseConfig.projectId !== 'remixed-project-id') {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const MASTER_OWNER_EMAIL = 'azeco77@gmail.com';
const ALSAFA_BIZ_ID = 'alsafa-steel-workspace';

async function syncAuthorizedEmailFromFirestore(
  db: SqlDb,
  user: AuthUser,
  idToken?: string
): Promise<void> {
  if (user.isOwner || user.isDemoUser) return;
  const projectId = firebaseConfig?.projectId;
  const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
  if (!projectId || !dbId) return;

  try {
    const existing = db
      .prepare("SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ? AND status = 'active'")
      .get(ALSAFA_BIZ_ID, user.id);
    if (existing) return;

    let displayName: string | undefined;
    let accountType: 'manager' | 'accountant' = 'accountant';
    let isActiveInFirestore = false;

    // 1. Try Firestore REST API using the user's own verified Firebase ID Token (enforces firestore.rules natively)
    if (idToken) {
      const normalized = user.email.toLowerCase();
      const restUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents/authorized_emails/${encodeURIComponent(normalized)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      try {
        const resp = await fetch(restUrl, {
          headers: { Authorization: `Bearer ${idToken}` },
          signal: controller.signal,
        });
        if (resp.ok) {
          const docJson = (await resp.json()) as { fields?: Record<string, { stringValue?: string }> };
          const statusVal = docJson.fields?.status?.stringValue || 'active';
          if (statusVal !== 'inactive') {
            isActiveInFirestore = true;
            displayName = docJson.fields?.displayName?.stringValue;
            accountType = docJson.fields?.accountType?.stringValue === 'manager' ? 'manager' : 'accountant';
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // 2. Fallback to Admin SDK when GCP credentials are present
    if (!isActiveInFirestore && getApps().length) {
      const adminFs = getAdminFirestore(getApps()[0], dbId);
      const snap = await Promise.race([
        adminFs.collection('authorized_emails').doc(user.email.toLowerCase()).get(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (snap && snap.exists) {
        const data = snap.data() as Record<string, any> | undefined;
        if (data && data.status !== 'inactive') {
          isActiveInFirestore = true;
          displayName = data.displayName;
          accountType = data.accountType === 'manager' ? 'manager' : 'accountant';
        }
      }
    }

    if (!isActiveInFirestore) return;

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'business_admin', 'active', ?, ?)
      ON CONFLICT(business_id, invited_email) DO UPDATE SET
        user_id = excluded.user_id,
        account_slot = excluded.account_slot,
        role = 'business_admin',
        status = 'active',
        updated_at = excluded.updated_at
    `).run(
      crypto.randomUUID(),
      ALSAFA_BIZ_ID,
      user.id,
      user.email.toLowerCase(),
      displayName || user.fullName,
      accountType,
      now,
      now
    );
  } catch {
    // Ignore transient network errors; local DB / client sync handles fallback
  }
}

export type Role = 'super_admin' | 'business_admin' | 'manager' | 'employee';

export interface AuthUser {
  id: string;
  firebaseUid: string;
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
  const adminAuth = getAuth();
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
  payload: { uid: string; email: string; name?: string; picture?: string }
): AuthUser {
  const now = new Date().toISOString();
  const normalizedEmail = payload.email.toLowerCase().trim();
  const isOwner = normalizedEmail === MASTER_OWNER_EMAIL;
  const existingByUid = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(payload.uid) as any;
  const existingByEmail = !existingByUid
    ? (db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail) as any)
    : null;
  const existing = existingByUid || existingByEmail;

  let userId: string;
  let isPlatformSuperAdmin = isOwner ? 1 : 0;

  if (existing) {
    userId = existing.id;
    isPlatformSuperAdmin = isOwner ? 1 : existing.is_platform_super_admin || 0;
    db.prepare(`
      UPDATE users
      SET firebase_uid = ?, email = ?, full_name = COALESCE(NULLIF(?, ''), full_name), avatar_url = COALESCE(?, avatar_url),
          is_platform_super_admin = ?, updated_at = ?
      WHERE id = ?
    `).run(payload.uid, normalizedEmail, payload.name || '', payload.picture || null, isPlatformSuperAdmin, now, userId);
  } else {
    userId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, firebase_uid, email, full_name, avatar_url, default_language, theme, is_platform_super_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ar', 'light', ?, ?, ?)
    `).run(
      userId,
      payload.uid,
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

  // Guarantee Master Owner (azeco77@gmail.com) always has full business_admin Manager membership on Al-Safa Steel
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
        MASTER_OWNER_EMAIL,
        payload.name || 'المدير (المالك الرئيسي) | Manager (Owner)',
        now,
        now
      );
    }
  }

  return {
    id: userId,
    firebaseUid: payload.uid,
    email: normalizedEmail,
    fullName: payload.name || existing?.full_name || normalizedEmail.split('@')[0],
    isDemoUser: false,
    isPlatformSuperAdmin: Boolean(isPlatformSuperAdmin),
    isOwner,
  };
}

export function createAuthMiddleware(db: SqlDb, verifier: TokenVerifier = defaultTokenVerifier) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const isDemoHeader = req.headers['x-demo-session'] === 'true';
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      try {
        const verified = await verifier(token);
        const user = upsertUserFromAuth(db, verified);
        await syncAuthorizedEmailFromFirestore(db, user, token);
        req.authUser = user;
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token' });
      }
    }

    if (isDemoHeader) {
      req.authUser = {
        id: 'alsafa-owner-manager',
        firebaseUid: 'demo-uid-alsafa-owner-manager',
        email: MASTER_OWNER_EMAIL,
        fullName: 'المدير (المالك الرئيسي) | Manager (Owner)',
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

    // Strict Demo vs Production isolation
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
      if (req.authUser.isOwner && business.id === ALSAFA_BIZ_ID) {
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
        // Super admins still require explicit membership unless managing platform; keep strict tenant boundary unless member
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
