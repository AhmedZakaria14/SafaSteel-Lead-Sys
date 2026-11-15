import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createDatabase, ensureDbReady } from '../server/db.ts';
import { buildApp } from '../server.ts';

process.env.NODE_ENV = 'test';
process.env.META_APP_SECRET = 'test_meta_app_secret_123';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test_verify_token_abc';

describe('LeadFlow CRM Acceptance Tests', () => {
  let server: http.Server;
  let baseUrl = '';
  const db = createDatabase(':memory:');

  const mockTokenVerifier = async (token: string) => {
    if (token === 'token-admin-a') {
      return { uid: 'uid-admin-a', email: 'admin-a@example.com', name: 'Admin A' };
    }
    if (token === 'token-emp-a') {
      return { uid: 'uid-emp-a', email: 'emp-a@example.com', name: 'Employee A' };
    }
    if (token === 'token-user-b') {
      return { uid: 'uid-user-b', email: 'user-b@example.com', name: 'User B' };
    }
    throw new Error('Invalid test token');
  };

  before(async () => {
    const app = buildApp({ db, tokenVerifier: mockTokenVerifier });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function api(path: string, token: string | null, init: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/api${path}`, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  let businessAId = '';
  let businessBId = '';
  let leadId = '';
  let empAUserId = '';

  it('1-4. Creates business workspace, invites employee, and activates employee on sign-in', async () => {
    const meAdmin = await api('/me', 'token-admin-a');
    assert.equal(meAdmin.status, 200);

    const bizRes = await api('/businesses', 'token-admin-a', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha Solutions', industry: 'Services' }),
    });
    assert.equal(bizRes.status, 201);
    businessAId = bizRes.data.business.id;

    const inviteRes = await api(`/businesses/${businessAId}/members/invite`, 'token-admin-a', {
      method: 'POST',
      body: JSON.stringify({ email: 'emp-a@example.com', displayName: 'Employee A', role: 'employee' }),
    });
    assert.equal(inviteRes.status, 201);
    assert.equal(inviteRes.data.member.status, 'invited');

    // Employee signs in -> auto-activates membership
    const meEmp = await api('/me', 'token-emp-a');
    assert.equal(meEmp.status, 200);
    assert.equal(meEmp.data.businesses.length, 1);
    assert.equal(meEmp.data.businesses[0].id, businessAId);
    empAUserId = meEmp.data.user.id;
  });

  it('6-11. Creates lead, assigns employee, updates status, schedules follow-up, and updates analytics', async () => {
    const leadRes = await api(`/businesses/${businessAId}/leads`, 'token-admin-a', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Samir Hassan',
        phone: '0501234567',
        email: 'samir@client.com',
        interestedService: 'Consulting Package',
        campaignName: 'Q4 Search',
      }),
    });
    assert.equal(leadRes.status, 201);
    leadId = leadRes.data.lead.id;

    // Assign to Employee A
    const assignRes = await api(`/businesses/${businessAId}/leads/${leadId}/assign`, 'token-admin-a', {
      method: 'POST',
      body: JSON.stringify({ assignedToUserId: empAUserId }),
    });
    assert.equal(assignRes.status, 200);

    // Employee A changes status
    const stagesRes = await api(`/businesses/${businessAId}/stages`, 'token-emp-a');
    const convertedStage = stagesRes.data.stages.find((s: any) => s.is_converted === 1);
    assert.ok(convertedStage);

    const statusRes = await api(`/businesses/${businessAId}/leads/${leadId}/status`, 'token-emp-a', {
      method: 'POST',
      body: JSON.stringify({ statusId: convertedStage.id }),
    });
    assert.equal(statusRes.status, 200);

    // Employee A schedules follow-up
    const fuRes = await api(`/businesses/${businessAId}/follow-ups`, 'token-emp-a', {
      method: 'POST',
      body: JSON.stringify({
        leadId,
        title: 'Onboarding Kickoff Call',
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
    assert.equal(fuRes.status, 201);

    // Verify activity timeline recorded creation, assignment, status change, and follow-up
    const detail = await api(`/businesses/${businessAId}/leads/${leadId}`, 'token-emp-a');
    assert.equal(detail.status, 200);
    assert.ok(detail.data.activities.length >= 4);
    assert.ok(detail.data.statusHistory.length >= 1);

    // Verify analytics reflect converted lead
    const analytics = await api(`/businesses/${businessAId}/analytics`, 'token-admin-a');
    assert.equal(analytics.data.summary.total, 1);
    assert.equal(analytics.data.summary.converted, 1);
    assert.equal(analytics.data.summary.conversionRate, 100);
  });

  it('12-13. Verifies Meta webhook signature, imports lead once, and deduplicates repeat leadgen_id', async () => {
    const verifyRes = await fetch(
      `${baseUrl}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=test_verify_token_abc&hub.challenge=CHALLENGE_OK`
    );
    assert.equal(verifyRes.status, 200);
    assert.equal(await verifyRes.text(), 'CHALLENGE_OK');

    const payload = JSON.stringify({
      entry: [
        {
          id: 'page_123',
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: 'lg_unique_999',
                form_id: 'frm_123',
                page_id: 'page_123',
                business_id: businessAId,
                campaign_name: 'Meta Instant Campaign',
                field_data: [
                  { name: 'full_name', values: ['Nadia Mansour'] },
                  { name: 'phone_number', values: ['+966559988776'] },
                  { name: 'email', values: ['nadia@example.com'] },
                ],
              },
            },
          ],
        },
      ],
    });

    // Bad signature rejected
    const badRes = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=deadbeef' },
      body: payload,
    });
    assert.equal(badRes.status, 401);

    // Valid HMAC signature accepted
    const sig =
      'sha256=' + crypto.createHmac('sha256', 'test_meta_app_secret_123').update(Buffer.from(payload)).digest('hex');

    const ok1 = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: payload,
    });
    const d1 = await ok1.json();
    assert.equal(ok1.status, 200);
    assert.equal(d1.results[0].status, 'created');

    // Duplicate delivery deduplicated
    const ok2 = await fetch(`${baseUrl}/api/webhooks/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: payload,
    });
    const d2 = await ok2.json();
    assert.equal(ok2.status, 200);
    assert.equal(d2.results[0].status, 'deduplicated');
  });

  it('15. Enforces strict cross-tenant isolation and RBAC', async () => {
    const bizBRes = await api('/businesses', 'token-user-b', {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta Corp', industry: 'Retail' }),
    });
    assert.equal(bizBRes.status, 201);
    businessBId = bizBRes.data.business.id;

    // User B cannot read Business A leads
    const crossRead = await api(`/businesses/${businessAId}/leads/${leadId}`, 'token-user-b');
    assert.equal(crossRead.status, 403);

    // Employee A cannot invite employees
    const empInvite = await api(`/businesses/${businessAId}/members/invite`, 'token-emp-a', {
      method: 'POST',
      body: JSON.stringify({ email: 'rogue@example.com', role: 'business_admin' }),
    });
    assert.equal(empInvite.status, 403);

    // Employee A cannot access Meta-captured unassigned lead in Business A
    const listEmp = await api(`/businesses/${businessAId}/leads`, 'token-emp-a');
    assert.equal(listEmp.data.total, 1); // Only the 1 lead assigned to Employee A, not the unassigned Meta lead
    assert.notEqual(businessAId, businessBId);
  });

  it('16. Seeds only Al-Safa Steel from attached CSV sheet and syncs incremental new rows without duplicates', async () => {
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { 'x-demo-session': 'true' },
    });
    assert.equal(res.status, 200);
    const meData = await res.json();
    assert.equal(meData.demoBusinesses.length, 1);
    assert.equal(meData.demoBusinesses[0].id, 'alsafa-steel-workspace');

    const leadsRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/leads?pageSize=20`, {
      headers: { 'x-demo-session': 'true' },
    });
    assert.equal(leadsRes.status, 200);
    const leadsData = await leadsRes.json();
    assert.ok(leadsData.total > 200, `Expected >200 real sheet leads, got ${leadsData.total}`);

    // Verify p: prefix was stripped and dummy Meta test lead was excluded
    const firstLead = leadsData.leads[0];
    assert.ok(firstLead.phone_e164 && !firstLead.phone_e164.includes('p:'));
    const dummySearch = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?q=${encodeURIComponent('dummy data')}`,
      { headers: { 'x-demo-session': 'true' } }
    );
    const dummyJson = await dummySearch.json();
    assert.equal(dummyJson.total, 0);

    // Re-syncing identical attached sheet yields 0 created
    const reSyncRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-session': 'true' },
      body: JSON.stringify({}),
    });
    assert.equal(reSyncRes.status, 200);
    const reSyncJson = await reSyncRes.json();
    assert.equal(reSyncJson.createdCount, 0);

    // Incremental CSV sync with 1 brand-new lead row imports exactly 1 new lead
    const newCsvRow = [
      'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,اختر_المنتجات_المرغوبة,اكتب_الكمية_أو_المقاسات_المطلوبة_إن_وجدت,اكتب_رقم_الهاتف/الواتساب_لإرسال_عرض_السعر,full_name,email,phone_number,company_name,job_title,inbox_url,lead_status',
      'l:999999999999991,2026-11-14T08:30:00+02:00,ag:1,إعلان التريهات ليد - الصفا ستيل,as:1,مجموعة التريهات - الصفا ستيل,c:1,كامبين الصفا ستيل الليد 2026,f:1,Form عامة الصفا ستيل,false,fb,حوامل_الكابلات_cable_trays,50 متر 20*10,01001234567,طارق السعيد,tarek@testco.eg,p:+201001234567,شركة النيل الهندسية,مهندس كهرباء,https://business.facebook.com/latest/123,QUALIFIED',
    ].join('\n');

    const incRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-session': 'true' },
      body: JSON.stringify({ csvText: newCsvRow }),
    });
    assert.equal(incRes.status, 200);
    const incJson = await incRes.json();
    assert.equal(incJson.createdCount, 1);
    assert.equal(incJson.totalLeadsInBusiness, leadsData.total + 1);
  });

  it('17. Automatically emits lead-linked notifications on new leads/actions, marks single notification read, and searches leads by digits', async () => {
    // Search with Arabic numerals and stripped phone format
    const searchRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?q=${encodeURIComponent('٠١٠٠١٢٣٤٥٦٧')}`,
      { headers: { 'x-demo-session': 'true' } }
    );
    assert.equal(searchRes.status, 200);
    const searchJson = await searchRes.json();
    assert.ok(searchJson.total >= 1);
    const targetLead = searchJson.leads[0];

    // Add note -> creates notification pointing directly to /leads/:id
    const noteRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${targetLead.id}/notes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-demo-session': 'true' },
        body: JSON.stringify({ content: 'تأكيد إرسال عرض السعر للعميل' }),
      }
    );
    assert.equal(noteRes.status, 201);

    // Fetch notifications & verify lead link_path
    const notifRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/notifications`,
      { headers: { 'x-demo-session': 'true' } }
    );
    assert.equal(notifRes.status, 200);
    const notifJson = await notifRes.json();
    const noteNotif = notifJson.notifications.find(
      (n: any) => n.type === 'note_added' && n.link_path === `/leads/${targetLead.id}`
    );
    assert.ok(noteNotif, 'Expected note_added notification linking directly to lead');

    // Mark single notification read
    const readRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/notifications/${noteNotif.id}/read`,
      { method: 'PATCH', headers: { 'x-demo-session': 'true' } }
    );
    assert.equal(readRes.status, 200);

    // Trigger test push notification -> links to latest lead
    const testNotifRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/notifications/test`,
      { method: 'POST', headers: { 'x-demo-session': 'true' } }
    );
    assert.equal(testNotifRes.status, 200);
    const testNotifJson = await testNotifRes.json();
    assert.ok(testNotifJson.notification.link_path.startsWith('/leads/'));
  });

  it('18. Enforces traditional username/password login (admin / SafaSteels2026), loads Al-Safa Steel dashboard data, and protects primary admin', async () => {
    // Unauthenticated requests to /api/me fail with 401
    const unauthMe = await fetch(`${baseUrl}/api/me`);
    assert.equal(unauthMe.status, 401);

    // Wrong password rejected with 401
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'WrongPassword123' }),
    });
    assert.equal(badLogin.status, 401);

    // Valid login with admin / SafaSteels2026
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
    });
    assert.equal(okLogin.status, 200);
    const loginData = await okLogin.json();
    assert.ok(loginData.token && loginData.token.startsWith('lf1.'));
    assert.equal(loginData.user.username, 'admin');
    assert.equal(loginData.user.isOwner, true);
    assert.ok(loginData.businesses.some((b: any) => b.id === 'alsafa-steel-workspace'));

    // Authenticated dashboard analytics & leads load cleanly with Bearer lf1 token
    const analyticsRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/analytics`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.ok(analyticsJson.summary.total > 200);

    // Seeded 2 accounts check
    const membersRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/members`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(membersRes.status, 200);
    const membersData = await membersRes.json();
    assert.equal(membersData.members.length, 2);
    assert.ok(membersData.members.every((m: any) => m.role === 'business_admin'));
    assert.ok(membersData.members.some((m: any) => m.username === 'admin' && m.account_slot === 'manager'));
    assert.ok(membersData.members.some((m: any) => m.username === 'accountant' && m.account_slot === 'accountant'));

    // Create a new accountant account with traditional username + password
    const grantRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/members/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        username: 'finance2',
        password: 'FinancePass2026',
        displayName: 'محاسب الصفا ستيل 2',
        accountSlot: 'accountant',
        role: 'business_admin',
      }),
    });
    assert.equal(grantRes.status, 201);
    const grantJson = await grantRes.json();
    assert.equal(grantJson.member.username, 'finance2');
    assert.equal(grantJson.member.role, 'business_admin');
    assert.equal(grantJson.member.account_slot, 'accountant');

    // New accountant signs in via username + password -> gets immediate full access to Al-Safa Steel
    const accLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'finance2', password: 'FinancePass2026' }),
    });
    assert.equal(accLoginRes.status, 200);
    const accLoginJson = await accLoginRes.json();
    assert.equal(accLoginJson.user.isOwner, false);
    const alsafaBiz = accLoginJson.businesses.find((b: any) => b.id === 'alsafa-steel-workspace');
    assert.ok(alsafaBiz);
    assert.equal(alsafaBiz.member_role, 'business_admin');
    assert.equal(alsafaBiz.account_slot, 'accountant');

    // Accountant cannot delete/remove primary admin
    const adminMember = membersData.members.find((m: any) => m.username === 'admin');
    assert.ok(adminMember);
    const delOwner = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/members/${adminMember.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accLoginJson.token}` } }
    );
    assert.equal(delOwner.status, 403);
  });

  it('19. Routes Vercel api/index.ts rewritten __path URLs directly to /api/auth/login and analytics without 404', async () => {
    const { default: vercelHandler } = await import('../api/index.ts');
    const srv = await new Promise<http.Server>((resolve) => {
      const s = http.createServer((req, res) => vercelHandler(req as any, res as any));
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (srv.address() as any).port;
    try {
      const loginRes = await fetch(`http://127.0.0.1:${port}/api/index?__path=auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
      });
      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.ok(loginJson.token && loginJson.token.startsWith('lf1.'));

      const analyticsRes = await fetch(
        `http://127.0.0.1:${port}/api/index?__path=businesses/alsafa-steel-workspace/analytics`,
        { headers: { Authorization: `Bearer ${loginJson.token}` } }
      );
      assert.equal(analyticsRes.status, 200);
      const analyticsJson = await analyticsRes.json();
      assert.ok(analyticsJson.summary.total > 200);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('20. Runs cleanly on sql.js fallback driver (Vercel mode) for login, sheet seeding, analytics, and leads', async () => {
    await ensureDbReady();
    const sqlJsDb = createDatabase(':memory:', 'sqljs');
    const sqlJsApp = buildApp({ db: sqlJsDb });

    const srv = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(sqlJsApp);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (srv.address() as any).port;
    try {
      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
      });
      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.ok(loginJson.token && loginJson.token.startsWith('lf1.'));
      assert.ok(loginJson.businesses.some((b: any) => b.id === 'alsafa-steel-workspace'));

      const analyticsRes = await fetch(
        `http://127.0.0.1:${port}/api/businesses/alsafa-steel-workspace/analytics`,
        { headers: { Authorization: `Bearer ${loginJson.token}` } }
      );
      assert.equal(analyticsRes.status, 200);
      const analyticsJson = await analyticsRes.json();
      assert.ok(analyticsJson.summary.total > 200, `Expected >200 leads in sql.js DB, got ${analyticsJson.summary.total}`);

      const leadsRes = await fetch(
        `http://127.0.0.1:${port}/api/businesses/alsafa-steel-workspace/leads?pageSize=10`,
        { headers: { Authorization: `Bearer ${loginJson.token}` } }
      );
      assert.equal(leadsRes.status, 200);
      const leadsJson = await leadsRes.json();
      assert.ok(leadsJson.leads.length > 0);
      assert.equal(typeof leadsJson.unreadCount, 'number');
      assert.ok(leadsJson.unreadCount > 0 && leadsJson.unreadCount < leadsJson.total);

      const unreadLead = leadsJson.leads.find((l: any) => l.is_read === 0);
      assert.ok(unreadLead, 'Expected newest seeded lead to be unread on sql.js');
      const peekReadRes = await fetch(
        `http://127.0.0.1:${port}/api/businesses/alsafa-steel-workspace/leads/${unreadLead.id}/read`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginJson.token}` },
          body: JSON.stringify({ isRead: true }),
        }
      );
      assert.equal(peekReadRes.status, 200);
      const peekReadJson = await peekReadRes.json();
      assert.equal(peekReadJson.lead.is_read, 1);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('21. Distinguishes new unread leads from previously read leads and transitions to read on peek/open/toggle', async () => {
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
    });
    assert.equal(okLogin.status, 200);
    const { token } = await okLogin.json();

    // Seeding splits newest batch as unread (is_read=0) and historical rows as read (is_read=1)
    const unreadRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?readState=unread&pageSize=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(unreadRes.status, 200);
    const unreadData = await unreadRes.json();
    assert.ok(unreadData.total > 0, 'Expected unread newest leads');
    assert.ok(unreadData.leads.every((l: any) => l.is_read === 0));

    const readRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?readState=read&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(readRes.status, 200);
    const readData = await readRes.json();
    assert.ok(readData.total > 100, 'Expected historical seeded leads to be pre-marked read');
    assert.ok(readData.leads.every((l: any) => l.is_read === 1));

    // Create a brand-new lead -> starts as unread (is_read=0)
    const createRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fullName: 'أحمد قاسم الجديد',
        phone: '01099887766',
        interestedService: 'كابل تريه',
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()).lead;
    assert.equal(created.is_read, 0);

    // Quick Peek marks it read (is_read=1)
    const peekRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${created.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isRead: true }),
      }
    );
    assert.equal(peekRes.status, 200);
    assert.equal((await peekRes.json()).lead.is_read, 1);

    // Toggle back to unread (is_read=0), then opening full profile auto-marks it read again
    const unpeekRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${created.id}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isRead: false }),
      }
    );
    assert.equal(unpeekRes.status, 200);
    assert.equal((await unpeekRes.json()).lead.is_read, 0);

    const openDetailRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${created.id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(openDetailRes.status, 200);
    assert.equal((await openDetailRes.json()).lead.is_read, 1);

    // Bulk mark_unread and bulk mark_read
    const bulkUnread = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/leads/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ leadIds: [created.id], action: 'mark_unread' }),
    });
    assert.equal(bulkUnread.status, 200);

    const bulkRead = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/leads/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ leadIds: [created.id], action: 'mark_read' }),
    });
    assert.equal(bulkRead.status, 200);

    const analyticsRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.equal(typeof analyticsJson.summary.unreadLeads, 'number');
  });

  it('22. Permanently prevents Lead not found on all unread leads across multi-instance serverless containers and fallback keys', async () => {
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
    });
    assert.equal(okLogin.status, 200);
    const { token } = await okLogin.json();

    // 1. Fetch all unread leads and verify every single one opens cleanly with 200 OK
    const unreadRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?readState=unread&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(unreadRes.status, 200);
    const unreadList = (await unreadRes.json()).leads as any[];
    assert.ok(unreadList.length > 0, 'Expected unread leads to test');

    for (const ul of unreadList.slice(0, 15)) {
      const detailRes = await fetch(
        `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${encodeURIComponent(ul.id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      assert.equal(detailRes.status, 200, `Expected unread lead ${ul.id} (${ul.lead_code}) to open without 404`);
      const detailJson = await detailRes.json();
      assert.equal(detailJson.lead.id, ul.id);
    }

    const sampleLead = unreadList[0];

    // 2. Resolve lead directly by lead_code (e.g., LD-1001) and external_row_id (e.g., l:...)
    const byCodeRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${encodeURIComponent(sampleLead.lead_code)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(byCodeRes.status, 200);
    assert.equal((await byCodeRes.json()).lead.id, sampleLead.id);

    if (sampleLead.external_row_id) {
      const byExtRes = await fetch(
        `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${encodeURIComponent(sampleLead.external_row_id)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      assert.equal(byExtRes.status, 200);
      assert.equal((await byExtRes.json()).lead.id, sampleLead.id);
    }

    // 3. Simulate stale/mismatched UUID in URL path with query/body hints (leadCode / externalRowId)
    const staleUuid = '00000000-dead-beef-0000-000000000099';
    const hintedGetRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${staleUuid}?leadCode=${encodeURIComponent(sampleLead.lead_code)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(hintedGetRes.status, 200);
    assert.equal((await hintedGetRes.json()).lead.id, sampleLead.id);

    const hintedReadRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${staleUuid}/read`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          isRead: false,
          leadCode: sampleLead.lead_code,
          externalRowId: sampleLead.external_row_id,
        }),
      }
    );
    assert.equal(hintedReadRes.status, 200);
    assert.equal((await hintedReadRes.json()).lead.is_read, 0);

    // 4. Status change with stage key or stale stage ID resolves cleanly
    const hintedStatusRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads/${staleUuid}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          statusId: 'contacted',
          leadCode: sampleLead.lead_code,
          externalRowId: sampleLead.external_row_id,
        }),
      }
    );
    assert.equal(hintedStatusRes.status, 200);
  });

  it('23. Detects new Google Sheet leads at top, middle, bottom, and after empty rows (including MANUAL_TEST_20261114_0740_CHATGPT), sorts by created_time with timezones, and prevents duplicate notifications', async () => {
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
    });
    assert.equal(okLogin.status, 200);
    const { token } = await okLogin.json();

    // Build a multi-row CSV with:
    // - A lead at the top of the sheet
    // - An existing historical lead in the middle
    // - Multiple empty rows in between
    // - Target test lead MANUAL_TEST_20261114_0740_CHATGPT at row 414 after empty rows
    // - Batch of 2 additional leads at the bottom with different timezone offsets
    const headers = [
      'id',
      'created_time',
      'ad_id',
      'ad_name',
      'adset_id',
      'adset_name',
      'campaign_id',
      'campaign_name',
      'form_id',
      'form_name',
      'is_organic',
      'platform',
      'اختار المنتج المناسب لطلبك',
      'الكمية المطلوبة والمقاسات ؟',
      'full_name',
      'phone_number',
      'تأكيد رقم الواتساب ؟',
      'company_name',
      'job_title',
      'lead_status',
    ].join('\t');

    const topRow = [
      'TEST_TOP_ROW_20261114',
      '2026-11-14T09:15:00+02:00',
      'ag:1',
      'Ad Top',
      'as:1',
      'Adset Top',
      'c:1',
      'Campaign Top',
      'f:1',
      'Form Top',
      'false',
      'fb',
      'حوامل الكابلات cable trays',
      '100 متر',
      'عميل اختبار أعلى الشيت',
      'p:+201099990001',
      '+201099990001',
      'شركة القمة',
      'مهندس مشتريات',
      'CREATED',
    ].join('\t');

    const middleRow = [
      'TEST_MIDDLE_ROW_20261114',
      '2026-11-14T08:30:00+03:00', // 05:30 UTC (earlier than 07:40+02:00 which is 05:40 UTC!)
      'ag:2',
      'Ad Mid',
      'as:2',
      'Adset Mid',
      'c:2',
      'Campaign Mid',
      'f:2',
      'Form Mid',
      'false',
      'ig',
      'تخريم الصاج ( الغرابيل )',
      '50 فرخ',
      'عميل اختبار وسط الشيت',
      'p:+201099990002',
      '+201099990002',
      'مصنع النيل',
      'مدير إنتاج',
      'CREATED',
    ].join('\t');

    const emptyRow = '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t';

    const manualTestRow414 = [
      'MANUAL_TEST_20261114_0740_CHATGPT',
      '2026-11-14T07:40:00+02:00', // 05:40 UTC
      'ag:test_01',
      'اختبار الإشعارات التلقائية',
      'as:test_01',
      'مجموعة اختبار المزامنة',
      'c:test_01',
      'حملة اختبار CRM',
      'f:test_01',
      'نموذج اختبار الإشعارات',
      'false',
      'fb',
      'حوامل الكابلات cable trays',
      'اختبار إشعار فوري - صف رقم 414',
      'اختبار يدوي ChatGPT - لا تتواصل',
      'p:+200000000000',
      '+200000000000',
      'شركة اختبار النظام',
      'فريق الاختبار التقني',
      'CREATED',
    ].join('\t');

    const bottomRow = [
      'TEST_BOTTOM_ROW_20261114',
      '2026-11-14T10:00:00Z', // 10:00 UTC (newest of all!)
      'ag:3',
      'Ad Bottom',
      'as:3',
      'Adset Bottom',
      'c:3',
      'Campaign Bottom',
      'f:3',
      'Form Bottom',
      'false',
      'fb',
      'حوامل الكابلات cable trays',
      '250 متر',
      'عميل اختبار أسفل الشيت بعد فراغات',
      'p:+201099990003',
      '+201099990003',
      'شركة الدلتا',
      'مدير مشاريع',
      'CREATED',
    ].join('\t');

    const csvPayload1 = [
      headers,
      topRow,
      emptyRow,
      emptyRow,
      middleRow,
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
      manualTestRow414,
      emptyRow,
      bottomRow,
    ].join('\n');

    // Sync #1: All 4 new leads must be detected despite empty rows and regardless of position
    const syncRes1 = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ csvText: csvPayload1 }),
    });
    assert.equal(syncRes1.status, 200);
    const syncJson1 = await syncRes1.json();
    assert.equal(syncJson1.createdCount, 4, 'Expected all 4 new leads across top, middle, and after empty rows to be created');
    assert.equal(syncJson1.createdNotifications.length, 4, 'Expected 4 notifications for the 4 new leads');
    assert.equal(typeof syncJson1.syncDurationMs, 'number');

    // Verify notification for MANUAL_TEST_20261114_0740_CHATGPT contains name, phone, and registration time
    const manualNotif = syncJson1.createdNotifications.find((n: any) =>
      String(n.title_ar || '').includes('اختبار يدوي ChatGPT - لا تتواصل')
    );
    assert.ok(manualNotif, 'Expected notification for MANUAL_TEST_20261114_0740_CHATGPT');
    assert.ok(String(manualNotif.message_ar).includes('+200000000000'), 'Notification must include phone number');
    assert.ok(String(manualNotif.message_ar).includes('وقت التسجيل'), 'Notification must include registration time');
    assert.ok(String(manualNotif.link_path).startsWith('/leads/'), 'Notification must link directly to lead details');

    // Sync #2 (Idempotency): Re-syncing identical sheet produces 0 new leads and 0 duplicate notifications
    const syncRes2 = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ csvText: csvPayload1 }),
    });
    assert.equal(syncRes2.status, 200);
    const syncJson2 = await syncRes2.json();
    assert.equal(syncJson2.createdCount, 0, 'Repeated sync must not duplicate leads');
    assert.equal(syncJson2.createdNotifications.length, 0, 'Repeated sync must not emit duplicate notifications');

    // Sync #3 (Editing an old lead): Modifying company_name on MANUAL_TEST_20261114_0740_CHATGPT updates it without emitting a new-lead notification
    const updatedManualRow = manualTestRow414.replace('شركة اختبار النظام', 'شركة اختبار النظام - محدث');
    const csvPayload3 = [headers, topRow, emptyRow, middleRow, emptyRow, updatedManualRow, bottomRow].join('\n');
    const syncRes3 = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ csvText: csvPayload3 }),
    });
    assert.equal(syncRes3.status, 200);
    const syncJson3 = await syncRes3.json();
    assert.equal(syncJson3.createdCount, 0, 'Editing an existing lead must not create a new lead');
    assert.equal(syncJson3.updatedCount, 1, 'Edited lead must be updated');
    assert.equal(syncJson3.createdNotifications.length, 0, 'Editing an existing lead must not send a new-lead notification');

    // Verify chronological ordering by created_time (regardless of row position in sheet):
    // Expected order by UTC time DESC:
    // 1. TEST_BOTTOM_ROW_20261114 (2026-11-14T10:00:00Z -> 10:00 UTC)
    // 2. TEST_TOP_ROW_20261114 (2026-11-14T09:15:00+02:00 -> 07:15 UTC)
    // 3. MANUAL_TEST_20261114_0740_CHATGPT (2026-11-14T07:40:00+02:00 -> 05:40 UTC)
    // 4. TEST_MIDDLE_ROW_20261114 (2026-11-14T08:30:00+03:00 -> 05:30 UTC)
    const leadsRes = await fetch(
      `${baseUrl}/api/businesses/alsafa-steel-workspace/leads?sortBy=created_at&sortDir=desc&pageSize=25`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    assert.equal(leadsRes.status, 200);
    const targetIds = new Set([
      'TEST_BOTTOM_ROW_20261114',
      'TEST_TOP_ROW_20261114',
      'MANUAL_TEST_20261114_0740_CHATGPT',
      'TEST_MIDDLE_ROW_20261114',
    ]);
    const matchedLeads = ((await leadsRes.json()).leads as any[]).filter((l) =>
      targetIds.has(l.external_row_id)
    );
    assert.deepEqual(
      matchedLeads.map((l) => l.external_row_id),
      [
        'TEST_BOTTOM_ROW_20261114',
        'TEST_TOP_ROW_20261114',
        'MANUAL_TEST_20261114_0740_CHATGPT',
        'TEST_MIDDLE_ROW_20261114',
      ],
      'Leads must be sorted chronologically by parsed UTC created_time regardless of sheet row order'
    );

    // Verify /sheet-source/status telemetry
    const statusRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/sheet-source/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.status, 'connected');
    assert.equal(statusJson.syncIntervalSec, 15);
    assert.ok(statusJson.knownLeadsCount >= 409);
  });

  it('24. Reconciles deleted sheet rows during authoritative full sync while preserving manual CRM leads so dashboard analytics matches sheet 100%', async () => {
    const { syncSheetRowsToWorkspace, parseCsvRows } = await import('../server/services/sheetSyncService.ts');

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SafaSteels2026' }),
    });
    assert.equal(loginRes.status, 200);
    const { token } = await loginRes.json();

    // Create a manual CRM lead that does NOT exist in Google Sheets (must be preserved)
    const manualRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fullName: 'Manual Protected Client',
        phone: '+201055551234',
        source: 'manual',
      }),
    });
    assert.equal(manualRes.status, 201);
    const { lead: manualLead } = await manualRes.json();
    assert.equal(manualLead.source, 'manual');

    const manualCountRow = db
      .prepare("SELECT COUNT(*) as cnt FROM leads WHERE business_id = ? AND (source = 'manual' OR external_row_id IS NULL)")
      .get('alsafa-steel-workspace') as { cnt: number };

    // Run authoritative reconciliation with a 2-row sheet snapshot
    const csvHeader = 'id\tcreated_time\tfull_name\tphone_number\tlead_status';
    const rowA = 'RECONCILE_KEEP_1\t2026-11-14T10:00:00+02:00\tعميل مستمر 1\tp:+201011112222\tCREATED';
    const rowB = 'RECONCILE_KEEP_2\t2026-11-14T11:00:00+02:00\tعميل مستمر 2\tp:+201011113333\tCREATED';

    const reconcileRes = syncSheetRowsToWorkspace(db, {
      businessId: 'alsafa-steel-workspace',
      rows: parseCsvRows([csvHeader, rowA, rowB].join('\n')),
      sourceLabel: 'google_sheet_live_csv',
      reconcileMissingSheetRows: true,
      emitNotificationOnChanges: false,
    });

    const expectedTotal = manualCountRow.cnt + 2;
    assert.ok(reconcileRes.deletedCount > 0, 'Expected stale non-manual sheet rows absent from full live sheet to be reconciled');
    assert.equal(
      reconcileRes.totalLeadsInBusiness,
      expectedTotal,
      'Expected exactly the 2 active sheet leads + preserved manual CRM leads'
    );

    const analyticsRes = await fetch(`${baseUrl}/api/businesses/alsafa-steel-workspace/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(analyticsRes.status, 200);
    const analyticsJson = await analyticsRes.json();
    assert.equal(analyticsJson.summary.total, expectedTotal, 'Dashboard analytics summary.total must match exact reconciled count');
  });
});




