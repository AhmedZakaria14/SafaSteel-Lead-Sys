import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { SqlDb } from './db.ts';

if (!getApps().length && firebaseConfig?.projectId && firebaseConfig.projectId !== 'remixed-project-id') {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export type Role = 'super_admin' | 'business_admin' | 'manager' | 'employee';

export interface AuthUser {
  id: string;
  firebaseUid: string;
  email: string;
  fullName: string;
  isDemoUser: boolean;
  isPlatformSuperAdmin: boolean;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
  membership?: {
    id: string;
    business_id: string;
    role: Role;
    status: string;
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
  const existingByUid = db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(payload.uid) as any;
  const existingByEmail = !existingByUid
    ? (db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail) as any)
    : null;
  const existing = existingByUid || existingByEmail;

  let userId: string;
  let isPlatformSuperAdmin = 0;

  if (existing) {
    userId = existing.id;
    isPlatformSuperAdmin = existing.is_platform_super_admin || 0;
    db.prepare(`
      UPDATE users
      SET firebase_uid = ?, email = ?, full_name = COALESCE(NULLIF(?, ''), full_name), avatar_url = COALESCE(?, avatar_url), updated_at = ?
      WHERE id = ?
    `).run(payload.uid, normalizedEmail, payload.name || '', payload.picture || null, now, userId);
  } else {
    userId = crypto.randomUUID();
    isPlatformSuperAdmin = normalizedEmail === 'azeco77@gmail.com' ? 1 : 0;
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

  // Activate any pending workspace invitations for this email
  db.prepare(`
    UPDATE business_memberships
    SET user_id = ?, status = 'active', updated_at = ?
    WHERE LOWER(invited_email) = ? AND status = 'invited'
  `).run(userId, now, normalizedEmail);

  return {
    id: userId,
    firebaseUid: payload.uid,
    email: normalizedEmail,
    fullName: payload.name || existing?.full_name || normalizedEmail.split('@')[0],
    isDemoUser: false,
    isPlatformSuperAdmin: Boolean(isPlatformSuperAdmin),
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
        req.authUser = upsertUserFromAuth(db, verified);
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token' });
      }
    }

    if (isDemoHeader) {
      req.authUser = {
        id: 'demo-user-admin',
        firebaseUid: 'demo-uid-demo-user-admin',
        email: 'demo-admin@leadflow.local',
        fullName: 'أحمد العتيبي / Ahmed Al-Otaibi',
        isDemoUser: true,
        isPlatformSuperAdmin: false,
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
      };
      return next();
    }

    const membership = db
      .prepare(
        `SELECT id, business_id, role, status FROM business_memberships
         WHERE business_id = ? AND user_id = ? AND status = 'active'`
      )
      .get(businessId, req.authUser.id) as
      | { id: string; business_id: string; role: Role; status: string }
      | undefined;

    if (!membership) {
      if (req.authUser.isPlatformSuperAdmin && business.is_demo === 0) {
        // Super admins still require explicit membership unless managing platform; keep strict tenant boundary unless member
        return res.status(403).json({ error: 'Forbidden: You do not have access to this business workspace' });
      }
      if (business.is_demo === 1) {
        // Authenticated users can preview isolated demo workspaces as business_admin
        req.membership = {
          id: 'demo-preview',
          business_id: businessId,
          role: 'business_admin',
          status: 'active',
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
