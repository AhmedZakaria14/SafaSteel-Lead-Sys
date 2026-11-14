# LeadFlow CRM — Setup & Production Deployment Guide

## 1. Architecture Overview
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Recharts + XLSX (Arabic RTL default + English LTR switcher, Light & Dark modes).
- **Backend**: Node.js Express server (`server.ts`) exposing REST APIs, username/password authentication (`POST /api/auth/login`), Meta Lead Ads Graph API & Webhook handlers, and live Google Sheet CSV sync.
- **Database**: Relational SQL schema (`server/db.ts`) + PostgreSQL/Supabase migration (`migrations/001_initial_schema.sql`) with Row Level Security policies + Firebase Firestore schema & `firestore.rules`.

---

## 2. Environment Variables
Configure the following secrets in your hosting environment (never commit real secrets):
- `AUTH_SESSION_SECRET`: Secret key used to sign stateless HMAC-SHA256 session tokens (recommended for production/Vercel).
- `ADMIN_DEFAULT_PASSWORD`: Optional override for the seeded default account password (defaults to `SafaSteels2026`).
- `META_APP_SECRET`: Meta App Secret for verifying `X-Hub-Signature-256` on `POST /api/webhooks/meta`.
- `META_WEBHOOK_VERIFY_TOKEN`: Secret token for Meta webhook subscription handshake (`GET /api/webhooks/meta`).
- `INTEGRATION_ENCRYPTION_KEY`: 32+ character secret used for AES-256-GCM encryption of stored Meta credentials at rest.
- `DATABASE_PATH`: Persistent volume path for SQLite storage (or connect PostgreSQL using `migrations/001_initial_schema.sql`).

---

## 3. Meta Lead Ads Integration Setup
1. Create a Meta App in **Meta for Developers** (Business type).
2. Request & approve permissions via **Meta App Review**:
   - `leads_retrieval`
   - `pages_manage_metadata`
   - `pages_read_engagement`
   - `ads_read` (and Ads Insights permissions if campaign spend metrics are needed)
3. Configure **Webhooks** for the `Page` object and subscribe to `leadgen`:
   - **Callback URL**: `https://<YOUR_DOMAIN>/api/webhooks/meta`
   - **Verify Token**: Match the token configured in your workspace's Meta integration settings (or `META_WEBHOOK_VERIFY_TOKEN`).
4. In LeadFlow CRM -> **Integrations**, paste a valid System User / Page Access Token and App Secret. The platform verifies the token via a live `GET /me/accounts` request to the Meta Graph API before marking the integration as connected.

---

## 4. Traditional Username & Password Authentication
- Users sign in via `POST /api/auth/login` using username and password (no external Google OAuth popups or domain allowlists required, works cleanly on any Vercel/custom domain).
- Seeded Manager account (`admin`) and Accountant account (`accountant`) are automatically provisioned in the database with full access to `alsafa-steel-workspace`.
- Passwords are hashed with `scrypt` + per-user random salt, verified via `crypto.timingSafeEqual`.
- Signed stateless session tokens (`lf1.*`) survive serverless cold starts on Vercel seamlessly.

---

## 5. Production Security Checklist
- [x] Salted `scrypt` password hashing & signed HMAC-SHA256 Bearer tokens on all authenticated `/api/*` endpoints.
- [x] Strict tenant isolation (`requireBusinessAccess`) preventing cross-business data access.
- [x] Server-enforced RBAC (`super_admin`, `business_admin`, `manager`, `employee`).
- [x] Protected primary Manager (`admin`) account and two-account full-access architecture.
- [x] AES-256-GCM encryption at rest for Meta tokens (`integration_credentials` never returned to browser).
- [x] HMAC-SHA256 signature verification (`X-Hub-Signature-256`) on Meta webhooks.
- [x] API rate limiting & audit logging (`audit_logs`).
- [x] Validated `firestore.rules` deployed to project `reelvision`.

---

## 6. Running & Testing Locally
```bash
npm install
npm run test     # Runs automated acceptance tests
npm run lint     # TypeScript typecheck
npm run build    # Builds frontend bundle
npm run start    # Starts production server on port 3000
```
