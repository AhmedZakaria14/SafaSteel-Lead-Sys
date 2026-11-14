import React, { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Kanban,
  CalendarClock,
  BarChart3,
  UserCog,
  Plug,
  Settings,
  Bell,
  BellRing,
  Sun,
  Moon,
  Languages,
  Menu,
  X,
  Plus,
  Building2,
  RotateCcw,
  LogOut,
  RefreshCw,
  FileSpreadsheet,
  ArrowUpRight,
  CheckCircle2,
  Sparkles,
  Volume2,
  VolumeX,
  Crown,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  AccountSlot,
  AnalyticsResponse,
  Business,
  CustomField,
  FirestoreAuthorizedAccount,
  Language,
  NotificationItem,
  PipelineStage,
  Role,
  TeamMember,
  ThemeMode,
} from './types/crm';
import { getT } from './i18n/translations';
import {
  formatFirebaseAuthError,
  getGoogleWorkspaceAccessToken,
  initFirebaseAuth,
  isMasterOwnerEmail,
  logoutFirebase,
  signInWithGoogleWorkspace,
  subscribeFirestoreAuthorizedAccounts,
  syncSignedInUserToFirestore,
} from './lib/firebase';
import { apiRequest, setApiContext } from './lib/api';
import {
  BrowserNotificationSupport,
  ensureNotificationServiceWorker,
  extractLeadIdFromLinkPath,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showBrowserPushNotification,
} from './lib/notifications';
import {
  attachAudioUnlockListeners,
  classifyNotificationSoundKind,
  isNotificationSoundEnabled,
  playNotificationSound,
  setNotificationSoundEnabled,
} from './lib/sound';
import { ToastProvider, useToast } from './components/ui/ToastProvider';
import { GoogleSignInButton } from './components/ui/GoogleSignInButton';
import { GlobalLeadSearch } from './components/ui/GlobalLeadSearch';
import { WorkspaceWizardModal } from './components/modals/WorkspaceWizardModal';
import { CreateLeadModal } from './components/modals/CreateLeadModal';
import { DashboardView } from './components/views/DashboardView';
import { LeadsView } from './components/views/LeadsView';
import { LeadDetailView } from './components/views/LeadDetailView';
import { PipelineView } from './components/views/PipelineView';
import { FollowUpsView } from './components/views/FollowUpsView';
import { CampaignsView } from './components/views/CampaignsView';
import { TeamView } from './components/views/TeamView';
import { IntegrationsView } from './components/views/IntegrationsView';
import { SettingsView } from './components/views/SettingsView';

type NavTab =
  | 'dashboard'
  | 'leads'
  | 'pipeline'
  | 'followups'
  | 'campaigns'
  | 'team'
  | 'integrations'
  | 'settings';

function LeadFlowAppInner() {
  const { notify } = useToast();

  const [lang, setLang] = useState<Language>('ar');
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [demoRole, setDemoRole] = useState<Role>('business_admin');
  const [demoAccountSlot, setDemoAccountSlot] = useState<AccountSlot>('manager');
  const [firestoreAccounts, setFirestoreAccounts] = useState<FirestoreAuthorizedAccount[]>([]);

  const [prodBusinesses, setProdBusinesses] = useState<Business[]>([]);
  const [demoBusinesses, setDemoBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string>('');

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const [pushPermission, setPushPermission] = useState<BrowserNotificationSupport>(() =>
    getBrowserNotificationPermission()
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isNotificationSoundEnabled());

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [showCreateLeadModal, setShowCreateLeadModal] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [sheetStatus, setSheetStatus] = useState<{
    attachedSheetName?: string;
    lastSyncAt?: string | null;
    spreadsheetId?: string | null;
    spreadsheetName?: string | null;
    publicCsvUrl?: string | null;
    autoScheduled?: boolean;
    syncIntervalSec?: number;
    totalLeads?: number;
  } | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);

  const notifMenuRef = useRef<HTMLDivElement>(null);
  const prevBusinessIdRef = useRef<string>('');
  const pendingDeepLinkRef = useRef<{ leadId: string | null; businessId: string | null } | null>(null);

  const t = getT(lang);
  const isAr = lang === 'ar';

  // Sync HTML dir, lang & dark class
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    setApiContext({ isDemoMode: !firebaseUser || isDemoMode, demoRole });
  }, [firebaseUser, isDemoMode, demoRole]);

  // Parse deep-link lead/business query parameters or hash on initial load
  useEffect(() => {
    const parseUrlDeepLink = () => {
      const params = new URLSearchParams(window.location.search);
      const qLead = params.get('lead');
      const qBiz = params.get('business');
      const hashMatch = window.location.hash.match(/^#\/leads\/([^/?#]+)/);
      const leadId = qLead || (hashMatch ? decodeURIComponent(hashMatch[1]) : null);
      if (leadId) {
        pendingDeepLinkRef.current = { leadId, businessId: qBiz };
        setActiveTab('leads');
        setSelectedLeadId(leadId);
        if (qBiz) setActiveBusinessId(qBiz);
      }
    };
    parseUrlDeepLink();

    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const leadId = params.get('lead');
      if (leadId) {
        setActiveTab('leads');
        setSelectedLeadId(leadId);
      } else {
        setSelectedLeadId(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Register Service Worker, attach audio unlock listeners, and handle SW messages
  useEffect(() => {
    attachAudioUnlockListeners();
    ensureNotificationServiceWorker();
    setPushPermission(getBrowserNotificationPermission());

    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'LEADFLOW_NAVIGATE') {
        navigateToLinkPathRef.current(
          data.linkPath || '/',
          data.businessId || null,
          data.notifId || null,
          data.leadId || null
        );
      } else if (data.type === 'LEADFLOW_PLAY_SOUND') {
        playNotificationSound(
          classifyNotificationSoundKind(data.notifType),
          data.notifId || undefined
        );
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, []);

  // Close notification menu when clicking outside
  useEffect(() => {
    if (!showNotifMenu) return;
    const onOutside = (e: MouseEvent) => {
      if (notifMenuRef.current && !notifMenuRef.current.contains(e.target as Node)) {
        setShowNotifMenu(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showNotifMenu]);

  // Listen to Firebase Auth state & sync Master Owner / authorized accounts with Cloud Firestore
  useEffect(() => {
    const unsub = initFirebaseAuth((user) => {
      setFirebaseUser(user);
      setIsDemoMode(!user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!firebaseUser?.email) {
      setFirestoreAccounts([]);
      return;
    }

    let cancelled = false;
    syncSignedInUserToFirestore(firebaseUser).catch((err) => {
      console.warn('Firestore user sync warning:', err);
    });

    const unsubSnap = subscribeFirestoreAuthorizedAccounts(
      firebaseUser.email,
      (accounts) => {
        if (cancelled) return;
        setFirestoreAccounts(accounts);
      },
      (err) => {
        console.warn('Firestore authorized_emails subscription warning:', err);
      }
    );

    return () => {
      cancelled = true;
      unsubSnap();
    };
  }, [firebaseUser?.uid, firebaseUser?.email]);

  useEffect(() => {
    if (!firebaseUser || !activeBusinessId || firestoreAccounts.length === 0) return;
    if (!isMasterOwnerEmail(firebaseUser.email)) return;

    apiRequest(`/businesses/${activeBusinessId}/access-accounts/sync`, {
      method: 'POST',
      body: JSON.stringify({ accounts: firestoreAccounts }),
    })
      .then(() => {
        setRefreshCounter((c) => c + 1);
      })
      .catch(() => {
        // ignore background sync retry
      });
  }, [firebaseUser?.uid, activeBusinessId, firestoreAccounts.length]);

  const loadSessionAndWorkspaces = async () => {
    try {
      setApiContext({ isDemoMode: !firebaseUser || isDemoMode, demoRole });
      const res = await apiRequest<{
        user?: { id?: string };
        businesses?: Business[];
        demoBusinesses?: Business[];
      }>('/me');

      const prodList = Array.isArray(res?.businesses) ? res.businesses : [];
      const demoList = Array.isArray(res?.demoBusinesses) ? res.demoBusinesses : [];

      setCurrentUserId(res?.user?.id || null);
      setProdBusinesses(prodList);
      setDemoBusinesses(demoList);

      const pool =
        firebaseUser && !isDemoMode
          ? prodList.length > 0
            ? prodList
            : demoList
          : demoList;
      const requestedBiz = pendingDeepLinkRef.current?.businessId;
      if (pool.length > 0) {
        const alsafa = pool.find((b) => b.id === 'alsafa-steel-workspace');
        if (requestedBiz && pool.some((b) => b.id === requestedBiz)) {
          setActiveBusinessId(requestedBiz);
        } else {
          setActiveBusinessId((curr) =>
            curr && pool.some((b) => b.id === curr) ? curr : (alsafa || pool[0]).id
          );
        }
        setRefreshCounter((c) => c + 1);
      } else {
        setActiveBusinessId('');
      }
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  useEffect(() => {
    if (!authReady) return;
    loadSessionAndWorkspaces();
  }, [authReady, firebaseUser, isDemoMode]);

  const allBusinesses = [...prodBusinesses, ...demoBusinesses];
  const activeBusiness = allBusinesses.find((b) => b.id === activeBusinessId) || null;
  const effectiveRole: Role = activeBusiness
    ? activeBusiness.is_demo && !firebaseUser
      ? demoRole
      : activeBusiness.member_role || 'business_admin'
    : 'business_admin';

  const loadWorkspaceData = async (bizId: string) => {
    if (!bizId) return;
    setAnalyticsLoading(true);
    try {
      const [stagesRes, fieldsRes, membersRes, analyticsRes, notifRes, sheetRes] = await Promise.all([
        apiRequest<{ stages?: PipelineStage[] }>(`/businesses/${bizId}/stages`),
        apiRequest<{ fields?: CustomField[] }>(`/businesses/${bizId}/custom-fields`),
        apiRequest<{ members?: TeamMember[] }>(`/businesses/${bizId}/members`),
        apiRequest<AnalyticsResponse>(`/businesses/${bizId}/analytics`),
        apiRequest<{ notifications?: NotificationItem[]; unreadCount?: number }>(`/businesses/${bizId}/notifications`),
        apiRequest<any>(`/businesses/${bizId}/sheet-source/status`).catch(() => null),
      ]);
      setStages(Array.isArray(stagesRes?.stages) ? stagesRes.stages : []);
      setCustomFields(Array.isArray(fieldsRes?.fields) ? fieldsRes.fields : []);
      setMembers(Array.isArray(membersRes?.members) ? membersRes.members : []);
      setAnalytics(analyticsRes || null);
      setNotifications(Array.isArray(notifRes?.notifications) ? notifRes.notifications : []);
      setUnreadCount(typeof notifRes?.unreadCount === 'number' ? notifRes.unreadCount : 0);
      if (sheetRes) setSheetStatus(sheetRes);
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const syncLeadUrl = (leadId: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (leadId) {
        url.searchParams.set('lead', leadId);
        if (activeBusinessId) url.searchParams.set('business', activeBusinessId);
      } else {
        url.searchParams.delete('lead');
        url.searchParams.delete('business');
      }
      window.history.replaceState({}, '', url.pathname + url.search);
    } catch {
      // ignore URL update errors
    }
  };

  const navigateToLead = (leadId: string, targetBusinessId?: string | null) => {
    if (targetBusinessId && allBusinesses.some((b) => b.id === targetBusinessId) && targetBusinessId !== activeBusinessId) {
      pendingDeepLinkRef.current = { leadId, businessId: targetBusinessId };
      setActiveBusinessId(targetBusinessId);
    }
    setActiveTab('leads');
    setSelectedLeadId(leadId);
    setShowNotifMenu(false);
    syncLeadUrl(leadId);
  };

  const handleCloseLeadDetail = () => {
    setSelectedLeadId(null);
    syncLeadUrl(null);
  };

  const markSingleNotificationRead = async (notifId: string) => {
    if (!activeBusinessId) return;
    setNotifications((prev) =>
      prev.map((item) => (item.id === notifId ? { ...item, is_read: 1 } : item))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiRequest(`/businesses/${activeBusinessId}/notifications/${notifId}/read`, { method: 'PATCH' });
    } catch {
      // ignore background read failure
    }
  };

  const navigateToLinkPath = (
    linkPath: string,
    targetBusinessId?: string | null,
    notifId?: string | null,
    explicitLeadId?: string | null
  ) => {
    if (notifId) {
      markSingleNotificationRead(notifId);
    }
    const leadId = explicitLeadId || extractLeadIdFromLinkPath(linkPath);
    if (leadId) {
      navigateToLead(leadId, targetBusinessId);
      return;
    }
    setSelectedLeadId(null);
    syncLeadUrl(null);
    setShowNotifMenu(false);
    if (linkPath.startsWith('/integrations')) setActiveTab('integrations');
    else if (linkPath.startsWith('/followups')) setActiveTab('followups');
    else if (linkPath.startsWith('/pipeline')) setActiveTab('pipeline');
    else if (linkPath.startsWith('/leads')) setActiveTab('leads');
    else setActiveTab('dashboard');
  };

  const navigateToLinkPathRef = useRef(navigateToLinkPath);
  navigateToLinkPathRef.current = navigateToLinkPath;

  const langRef = useRef(lang);
  langRef.current = lang;

  const effectiveRoleRef = useRef(effectiveRole);
  effectiveRoleRef.current = effectiveRole;

  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    if (!activeBusinessId) return;
    const prevBiz = prevBusinessIdRef.current;
    prevBusinessIdRef.current = activeBusinessId;

    if (prevBiz && prevBiz !== activeBusinessId) {
      const pending = pendingDeepLinkRef.current;
      if (pending && (!pending.businessId || pending.businessId === activeBusinessId) && pending.leadId) {
        setSelectedLeadId(pending.leadId);
        setActiveTab('leads');
        pendingDeepLinkRef.current = null;
      } else {
        setSelectedLeadId(null);
        syncLeadUrl(null);
      }
    } else if (pendingDeepLinkRef.current?.leadId) {
      setSelectedLeadId(pendingDeepLinkRef.current.leadId);
      setActiveTab('leads');
      pendingDeepLinkRef.current = null;
    }
    loadWorkspaceData(activeBusinessId);
  }, [activeBusinessId, demoRole]);

  // Refresh metrics without resetting selectedLeadId on live sync ticks
  useEffect(() => {
    if (activeBusinessId && refreshCounter > 0) {
      loadWorkspaceData(activeBusinessId);
    }
  }, [refreshCounter]);

  // Real-time Server-Sent Events (SSE) subscription for live notifications, leads & sheet updates
  useEffect(() => {
    if (!activeBusinessId || !activeBusiness) return;
    let closed = false;
    let es: EventSource | null = null;

    const connectSse = async () => {
      try {
        let url = `/api/businesses/${encodeURIComponent(activeBusinessId)}/events`;
        if (activeBusiness.is_demo !== 1 && firebaseUser) {
          const token = await firebaseUser.getIdToken();
          url += `?token=${encodeURIComponent(token)}`;
        }
        if (closed) return;
        es = new EventSource(url);
        es.addEventListener('connected', () => {
          setSseConnected(true);
        });
        es.addEventListener('notification', (evt) => {
          try {
            const payload = JSON.parse((evt as MessageEvent).data || '{}');
            const notif: NotificationItem | undefined = payload.notification;
            if (!notif) return;

            if (
              effectiveRoleRef.current === 'employee' &&
              notif.user_id &&
              currentUserIdRef.current &&
              notif.user_id !== currentUserIdRef.current
            ) {
              return;
            }

            setNotifications((prev) => {
              if (prev.some((p) => p.id === notif.id)) return prev;
              setUnreadCount((c) => c + 1);
              return [notif, ...prev].slice(0, 50);
            });

            const liveIsAr = langRef.current === 'ar';
            const title = liveIsAr ? notif.title_ar : notif.title_en;
            const body = liveIsAr ? notif.message_ar : notif.message_en;
            const linkPath = notif.link_path || '/leads';
            const hasLeadLink = Boolean(extractLeadIdFromLinkPath(linkPath));

            playNotificationSound(classifyNotificationSoundKind(notif.type), notif.id);

            notify(title, notif.type === 'integration_failed' ? 'error' : 'info', {
              actionLabel: hasLeadLink ? (liveIsAr ? 'فتح العميل' : 'Open Lead') : undefined,
              onAction: hasLeadLink
                ? () => navigateToLinkPathRef.current(linkPath, activeBusinessId, notif.id)
                : undefined,
            });

            showBrowserPushNotification({
              id: notif.id,
              title,
              body,
              linkPath,
              businessId: activeBusinessId,
              onNavigate: (lp, lid, bid, nid) => {
                navigateToLinkPathRef.current(lp, bid, nid, lid);
              },
            });
          } catch {
            // ignore malformed notification payload
          }
        });
        es.addEventListener('sheet_synced', () => {
          setRefreshCounter((c) => c + 1);
        });
        es.addEventListener('lead_updated', () => {
          setRefreshCounter((c) => c + 1);
        });
        es.onerror = () => {
          setSseConnected(false);
        };
      } catch {
        setSseConnected(false);
      }
    };

    connectSse();
    return () => {
      closed = true;
      setSseConnected(false);
      es?.close();
    };
  }, [activeBusinessId, activeBusiness?.is_demo, firebaseUser]);

  // Continuous live polling when connected to a Google Drive Sheet via OAuth token
  useEffect(() => {
    if (!activeBusinessId || !sheetStatus?.spreadsheetId || sheetStatus.autoScheduled === false) return;
    const token = getGoogleWorkspaceAccessToken();
    if (!token) return;

    const intervalMs = Math.max(10_000, (sheetStatus.syncIntervalSec || 15) * 1000);
    const timer = setInterval(async () => {
      const liveToken = getGoogleWorkspaceAccessToken();
      if (!liveToken) return;
      try {
        const res = await apiRequest<{ createdCount: number; updatedCount: number }>(
          `/businesses/${activeBusinessId}/google/sheets/sync`,
          {
            method: 'POST',
            includeGoogleToken: true,
            body: JSON.stringify({ direction: 'inbound', silent: true }),
          }
        );
        if (res.createdCount > 0 || res.updatedCount > 0) {
          setRefreshCounter((c) => c + 1);
        }
      } catch {
        // silent background retry
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [activeBusinessId, sheetStatus?.spreadsheetId, sheetStatus?.autoScheduled, sheetStatus?.syncIntervalSec, firebaseUser]);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogleWorkspace();
      setIsDemoMode(false);
      notify(isAr ? 'تم تسجيل الدخول بنجاح' : 'Signed in with Google Workspace', 'success');
    } catch (err: unknown) {
      notify(formatFirebaseAuthError(err, isAr), 'error');
    }
  };

  const handleLogout = async () => {
    await logoutFirebase();
    setIsDemoMode(true);
    notify(isAr ? 'تم تسجيل الخروج' : 'Signed out', 'info');
  };

  const handleCreateWorkspace = async (payload: any) => {
    const res = await apiRequest<{ business: Business }>('/businesses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setIsDemoMode(false);
    await loadSessionAndWorkspaces();
    setActiveBusinessId(res.business.id);
    notify(isAr ? 'تم إنشاء مساحة العمل بنجاح' : 'Workspace created', 'success');
  };

  const handleCreateLead = async (payload: Record<string, any>) => {
    if (!activeBusinessId) return;
    const res = await apiRequest<{ duplicates?: any[] }>(`/businesses/${activeBusinessId}/leads`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.duplicates && res.duplicates.length > 0) {
      notify(t.duplicateWarning, 'info');
    } else {
      notify(isAr ? 'تم إضافة العميل المحتمل بنجاح' : 'Lead created', 'success');
    }
    setRefreshCounter((c) => c + 1);
  };

  const handleResetDemo = async () => {
    try {
      await apiRequest('/demo/reset', { method: 'POST' });
      setRefreshCounter((c) => c + 1);
      notify(isAr ? 'تمت إعادة مزامنة بيانات الشيت بنجاح' : 'Sheet data re-synced successfully', 'success');
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleManualSheetSync = async () => {
    if (!activeBusinessId || syncingNow) return;
    setSyncingNow(true);
    try {
      const googleToken = getGoogleWorkspaceAccessToken();
      if (sheetStatus?.spreadsheetId && googleToken) {
        const res = await apiRequest<{ createdCount: number; updatedCount: number }>(
          `/businesses/${activeBusinessId}/google/sheets/sync`,
          {
            method: 'POST',
            includeGoogleToken: true,
            body: JSON.stringify({ direction: 'inbound' }),
          }
        );
        notify(
          isAr
            ? `تمت المزامنة: +${res.createdCount} جديد، ${res.updatedCount} محدث`
            : `Synced: +${res.createdCount} created, ${res.updatedCount} updated`,
          'success'
        );
      } else {
        const res = await apiRequest<{ createdCount: number; updatedCount: number; totalLeadsInBusiness: number }>(
          `/businesses/${activeBusinessId}/sheet-source/sync`,
          { method: 'POST', body: JSON.stringify({}) }
        );
        notify(
          isAr
            ? `مزامنة الشيت مكتملة (${res.totalLeadsInBusiness} عميل) — +${res.createdCount} جديد`
            : `Sheet synced (${res.totalLeadsInBusiness} leads) — +${res.createdCount} new`,
          'success'
        );
      }
      setRefreshCounter((c) => c + 1);
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setSyncingNow(false);
    }
  };

  const handleMarkNotificationsRead = async () => {
    if (!activeBusinessId) return;
    await apiRequest(`/businesses/${activeBusinessId}/notifications/read-all`, { method: 'POST' });
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const handleEnablePushNotifications = async () => {
    const result = await requestBrowserNotificationPermission();
    setPushPermission(result);
    if (result === 'granted') {
      playNotificationSound('action');
      notify(
        isAr ? 'تم تفعيل إشعارات المتصفح الفورية بنجاح' : 'Browser push notifications enabled',
        'success'
      );
      showBrowserPushNotification({
        id: `push-enabled-${Date.now()}`,
        title: isAr ? 'إشعارات LeadFlow CRM مفعلة' : 'LeadFlow CRM Push Enabled',
        body: isAr
          ? 'سيتم إرسال تنبيه فوري بصوت مميز عند وصول أي عميل جديد أو تنفيذ إجراء.'
          : 'You will now receive instant audio & push alerts for new leads and updates.',
        linkPath: '/leads',
        businessId: activeBusinessId,
        onNavigate: (lp, lid, bid, nid) => navigateToLinkPath(lp, bid, nid, lid),
      });
    } else if (result === 'denied') {
      notify(
        isAr
          ? 'المتصفح أو الإطار المدمج يمنع الإشعارات — افتح التطبيق في تبويب مستقل أو فعّل الإذن من إعدادات المتصفح'
          : 'Browser notifications blocked in settings or embedded iframe — allow permission or open in a standalone tab',
        'info'
      );
    } else {
      notify(
        isAr ? 'المتصفح لا يدعم إشعارات Push' : 'Browser does not support push notifications',
        'info'
      );
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setNotificationSoundEnabled(next);
    if (next) {
      playNotificationSound('new_lead');
      notify(
        isAr ? 'تم تفعيل الصوت المميز للإشعارات' : 'Notification sounds enabled',
        'success'
      );
    } else {
      notify(
        isAr ? 'تم كتم صوت الإشعارات' : 'Notification sounds muted',
        'info'
      );
    }
  };

  const handleTestPushNotification = async () => {
    if (!activeBusinessId || testingPush) return;
    setTestingPush(true);
    try {
      await apiRequest(`/businesses/${activeBusinessId}/notifications/test`, { method: 'POST' });
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setTestingPush(false);
    }
  };

  const navItems: Array<{ id: NavTab; label: string; icon: any }> = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard },
    { id: 'leads', label: t.navLeads, icon: Users },
    { id: 'pipeline', label: t.navPipeline, icon: Kanban },
    { id: 'followups', label: t.navFollowUps, icon: CalendarClock },
    { id: 'campaigns', label: t.navCampaigns, icon: BarChart3 },
    { id: 'team', label: t.navTeam, icon: UserCog },
    { id: 'integrations', label: t.navIntegrations, icon: Plug },
    { id: 'settings', label: t.navSettings, icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#090E1A] text-slate-900 dark:text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:flex flex-col border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-200 shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          {!sidebarCollapsed && (
            <span className="text-base font-bold tracking-tight text-[#0F1E3D] dark:text-white whitespace-nowrap">
              {t.brandName}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace Switcher */}
        {!sidebarCollapsed && (
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-2">
              {activeBusiness?.logo_url ? (
                <img
                  src={activeBusiness.logo_url}
                  alt={activeBusiness.name}
                  referrerPolicy="no-referrer"
                  className="h-8 w-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-[#0F1E3D] text-white flex items-center justify-center shrink-0">
                  <Building2 className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <select
                  value={activeBusinessId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const chosen = allBusinesses.find((b) => b.id === id);
                    if (chosen) setIsDemoMode(Boolean(chosen.is_demo));
                    setActiveBusinessId(id);
                  }}
                  className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none truncate cursor-pointer"
                >
                  {prodBusinesses.length > 0 && (
                    <optgroup label={t.productionWorkspaces}>
                      {prodBusinesses.map((b) => (
                        <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900">
                          {b.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={t.demoWorkspaces}>
                    {demoBusinesses.map((b) => (
                      <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900">
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {activeBusiness && (
                  <div className="text-[11px] text-slate-400 truncate">{activeBusiness.industry}</div>
                )}
              </div>
            </div>

            {firebaseUser && (
              <button
                type="button"
                onClick={() => setShowWorkspaceModal(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t.createWorkspace}</span>
              </button>
            )}
          </div>
        )}

        {/* Nav Links */}
        <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id && !selectedLeadId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSelectedLeadId(null);
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0F1E3D] text-white dark:bg-blue-600'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-72 bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 h-full flex flex-col p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#0F1E3D] dark:text-white">{t.brandName}</span>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-1.5">
                <X className="h-5 w-5" />
              </button>
            </div>
            <select
              value={activeBusinessId}
              onChange={(e) => {
                const chosen = allBusinesses.find((b) => b.id === e.target.value);
                if (chosen) setIsDemoMode(Boolean(chosen.is_demo));
                setActiveBusinessId(e.target.value);
              }}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold"
            >
              {allBusinesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <nav className="space-y-1 flex-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setSelectedLeadId(null);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      activeTab === item.id
                        ? 'bg-[#0F1E3D] text-white dark:bg-blue-600'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex-1 bg-slate-950/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
              {activeBusiness ? activeBusiness.name : t.brandName}
            </div>
          </div>

          {/* Global Live Customer Search in Topbar */}
          {activeBusiness && (
            <div className="hidden lg:block flex-1 max-w-md mx-auto">
              <GlobalLeadSearch
                lang={lang}
                businessId={activeBusiness.id}
                variant="topbar"
                onSelectLead={(id) => navigateToLead(id)}
                onViewAllLeads={() => {
                  setSelectedLeadId(null);
                  syncLeadUrl(null);
                  setActiveTab('leads');
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              title="Switch language"
            >
              <Languages className="h-3.5 w-3.5" />
              <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((m) => (m === 'light' ? 'dark' : 'light'))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            {/* Notification Sound Toggle */}
            <button
              type="button"
              onClick={handleToggleSound}
              className={`rounded-lg border p-2 transition-colors ${
                soundEnabled
                  ? 'border-blue-200 dark:border-blue-800/80 bg-blue-50/70 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100/70 dark:hover:bg-blue-950/50'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title={
                soundEnabled
                  ? isAr
                    ? 'صوت الإشعارات مفعل (اضغط للكتم)'
                    : 'Notification sound on (click to mute)'
                  : isAr
                    ? 'صوت الإشعارات مكتوم (اضغط للتفعيل)'
                    : 'Notification sound muted (click to enable)'
              }
              aria-label={isAr ? 'تبديل صوت الإشعارات' : 'Toggle notification sound'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            {/* Notifications & Browser Push Controls */}
            <div className="relative" ref={notifMenuRef}>
              <button
                type="button"
                onClick={() => setShowNotifMenu((v) => !v)}
                className="relative rounded-lg border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                aria-label={t.notifications}
              >
                {unreadCount > 0 ? <BellRing className="h-4 w-4 text-blue-600 dark:text-blue-400" /> : <Bell className="h-4 w-4" />}
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -end-1 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>

              {showNotifMenu && (
                <div className="absolute end-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-40 overflow-hidden crm-animate-enter">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{t.notifications}</span>
                      {unreadCount > 0 && (
                        <span className="font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                          ({unreadCount})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleToggleSound}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${
                          soundEnabled
                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/70'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >
                        {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                        <span>{soundEnabled ? (isAr ? 'الصوت مفعل' : 'Sound On') : isAr ? 'مكتوم' : 'Muted'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleMarkNotificationsRead}
                        className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                      >
                        {t.markAllRead}
                      </button>
                    </div>
                  </div>

                  {/* Browser Push Notification Bar */}
                  <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                    {pushPermission === 'granted' ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          <span>{isAr ? 'إشعارات المتصفح مفعلة' : 'Browser Push Active'}</span>
                        </span>
                        <button
                          type="button"
                          disabled={testingPush}
                          onClick={handleTestPushNotification}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                        >
                          <Sparkles className="h-3 w-3" />
                          <span>{isAr ? 'اختبار إشعار' : 'Test Push'}</span>
                        </button>
                      </>
                    ) : pushPermission === 'default' ? (
                      <>
                        <span className="text-slate-600 dark:text-slate-300">
                          {isAr ? 'فعّل إشعارات المتصفح للتنبيه الفوري' : 'Enable browser push alerts'}
                        </span>
                        <button
                          type="button"
                          onClick={handleEnablePushNotifications}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 font-semibold transition-colors whitespace-nowrap"
                        >
                          <BellRing className="h-3 w-3" />
                          <span>{isAr ? 'تفعيل الإشعارات' : 'Enable Push'}</span>
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className="text-amber-700 dark:text-amber-400">
                          {pushPermission === 'denied'
                            ? isAr
                              ? 'إذن المتصفح محظور — فعّله من إعدادات المتصفح'
                              : 'Browser push blocked in browser settings'
                            : isAr
                              ? 'المتصفح لا يدعم Push — الإشعارات الداخلية مفعلة'
                              : 'In-app live notifications active'}
                        </span>
                        <button
                          type="button"
                          disabled={testingPush}
                          onClick={handleTestPushNotification}
                          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-medium text-slate-700 dark:text-slate-200 shrink-0"
                        >
                          {isAr ? 'اختبار' : 'Test'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">{t.noNotifications}</div>
                    ) : (
                      notifications.map((n) => {
                        const hasLink = Boolean(n.link_path);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() => navigateToLinkPath(n.link_path || '/leads', activeBusinessId, n.id)}
                            className={`w-full text-start p-3.5 text-xs flex items-start justify-between gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                              n.is_read ? 'opacity-70' : 'bg-blue-50/45 dark:bg-blue-950/25'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <span
                                className={`mt-1.5 h-2 w-2 rounded-[2px] shrink-0 ${
                                  n.is_read ? 'bg-slate-300 dark:bg-slate-700' : 'bg-blue-600'
                                }`}
                                aria-hidden="true"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                                  {isAr ? n.title_ar : n.title_en}
                                </div>
                                <div className="text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed break-words">
                                  {isAr ? n.message_ar : n.message_en}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-1 tabular-nums">
                                  {new Date(n.created_at).toLocaleString(isAr ? 'ar-EG' : 'en-US', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}
                                </div>
                              </div>
                            </div>
                            {hasLink && <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-1" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {firebaseUser ? (
              <div className="flex items-center gap-2">
                {isMasterOwnerEmail(firebaseUser.email) && (
                  <span className="hidden md:inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-200">
                    <Crown className="h-3 w-3" />
                    <span>{isAr ? 'المالك' : 'Owner'}</span>
                  </span>
                )}
                <span className="hidden sm:inline text-xs font-medium text-slate-700 dark:text-slate-300 max-w-40 truncate">
                  {firebaseUser.displayName || firebaseUser.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-500 hover:text-red-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title={t.signOut}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <GoogleSignInButton label={t.signInGoogle} onClick={handleGoogleSignIn} />
            )}
          </div>
        </header>

        {/* Live Sheet Sync Status Bar */}
        {activeBusiness && (
          <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border-b border-emerald-200/80 dark:border-emerald-900/60 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-950 dark:text-emerald-200">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold truncate">
                {sheetStatus?.spreadsheetName || sheetStatus?.attachedSheetName || activeBusiness.name}
              </span>
              <span className="text-emerald-700/80 dark:text-emerald-300/80">·</span>
              <span className="tabular-nums">
                {sseConnected
                  ? isAr ? 'مزامنة لحظية مفعلة' : 'Live Sync Active'
                  : isAr ? 'جاري الاتصال بالمزامنة...' : 'Connecting live sync...'}
              </span>
              {sheetStatus?.lastSyncAt && (
                <>
                  <span className="text-emerald-700/80 dark:text-emerald-300/80 hidden sm:inline">·</span>
                  <span className="text-emerald-800/80 dark:text-emerald-300/80 tabular-nums hidden sm:inline">
                    {isAr ? 'آخر تحديث:' : 'Last sync:'}{' '}
                    {new Date(sheetStatus.lastSyncAt).toLocaleTimeString(isAr ? 'ar-EG' : 'en-US')}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!firebaseUser && (
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-800/80 dark:text-emerald-300/80">{t.demoRolePreview}</span>
                  <select
                    value={demoAccountSlot}
                    onChange={(e) => {
                      const slot = e.target.value as AccountSlot;
                      setDemoAccountSlot(slot);
                      setDemoRole('business_admin');
                    }}
                    className="rounded border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2 py-0.5 text-xs font-medium"
                  >
                    <option value="manager">
                      {isAr ? 'حساب المدير (صلاحية كاملة)' : 'Manager (Full Access)'}
                    </option>
                    <option value="accountant">
                      {isAr ? 'حساب المحاسب (صلاحية كاملة)' : 'Accountant (Full Access)'}
                    </option>
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={handleManualSheetSync}
                disabled={syncingNow}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${syncingNow ? 'animate-spin' : ''}`} />
                <span>{t.syncNow}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('integrations')}
                className="inline-flex items-center gap-1 font-semibold underline hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                <span>{isAr ? 'إعدادات الشيت' : 'Sheet Source'}</span>
              </button>
              {activeBusiness.is_demo === 1 && (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="inline-flex items-center gap-1 text-emerald-800/80 dark:text-emerald-300/80 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{t.resetDemo}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {!activeBusiness ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center max-w-lg mx-auto mt-10">
              <Building2 className="h-10 w-10 mx-auto text-[#0F1E3D] dark:text-blue-400" />
              <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">
                {isAr ? 'مرحباً بك في LeadFlow CRM' : 'Welcome to LeadFlow CRM'}
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {isAr
                  ? firebaseUser
                    ? `هذا الحساب (${firebaseUser.email}) غير مفوض حالياً للوصول إلى مساحة عمل الصفا ستيل. اطلب من المالك الرئيسي (azeco77@gmail.com) منحه الإذن الكامل من تبويب الحسابات والصلاحيات، أو أنشئ مساحة عمل مستقلة خاصة بك.`
                    : 'أنشئ مساحة عمل مستقلة لنشاطك التجاري للبدء في استقبال العملاء وإدارتهم.'
                  : firebaseUser
                    ? `This email (${firebaseUser.email}) is not yet authorized for Al-Safa Steel. Ask the Master Owner (azeco77@gmail.com) to grant full access from Accounts & Access, or create your own workspace.`
                    : 'Create an isolated business workspace to start capturing, organizing, and converting leads.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowWorkspaceModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"
                >
                  <Plus className="h-4 w-4" />
                  <span>{t.createWorkspace}</span>
                </button>
                {demoBusinesses.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsDemoMode(true);
                      if (demoBusinesses[0]) setActiveBusinessId(demoBusinesses[0].id);
                    }}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-medium"
                  >
                    {isAr ? 'استعراض البيانات التجريبية' : 'Explore Demo Workspaces'}
                  </button>
                )}
              </div>
            </div>
          ) : selectedLeadId ? (
            <LeadDetailView
              lang={lang}
              businessId={activeBusiness.id}
              leadId={selectedLeadId}
              userRole={effectiveRole}
              stages={stages}
              customFields={customFields}
              members={members}
              onBack={handleCloseLeadDetail}
              onUpdated={() => setRefreshCounter((c) => c + 1)}
              onNotify={notify}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardView
              lang={lang}
              businessId={activeBusiness.id}
              analytics={analytics}
              loading={analyticsLoading}
              onSelectLead={(id) => navigateToLead(id)}
              onNavigateLeads={() => setActiveTab('leads')}
              onNavigateFollowUps={() => setActiveTab('followups')}
              onAddLead={() => setShowCreateLeadModal(true)}
            />
          ) : activeTab === 'leads' ? (
            <LeadsView
              lang={lang}
              businessId={activeBusiness.id}
              userRole={effectiveRole}
              stages={stages}
              customFields={customFields}
              members={members}
              onSelectLead={(id) => navigateToLead(id)}
              onAddLead={() => setShowCreateLeadModal(true)}
              onNotify={notify}
              refreshTrigger={refreshCounter}
            />
          ) : activeTab === 'pipeline' ? (
            <PipelineView
              lang={lang}
              businessId={activeBusiness.id}
              userRole={effectiveRole}
              stages={stages}
              onSelectLead={(id) => navigateToLead(id)}
              onStagesChanged={() => setRefreshCounter((c) => c + 1)}
              onNotify={notify}
            />
          ) : activeTab === 'followups' ? (
            <FollowUpsView
              lang={lang}
              businessId={activeBusiness.id}
              onSelectLead={(id) => navigateToLead(id)}
              onNotify={notify}
            />
          ) : activeTab === 'campaigns' ? (
            <CampaignsView lang={lang} analytics={analytics} />
          ) : activeTab === 'team' ? (
            <TeamView
              lang={lang}
              business={activeBusiness}
              userRole={effectiveRole}
              firebaseUser={firebaseUser}
              members={members}
              firestoreAccounts={firestoreAccounts}
              onRefresh={() => setRefreshCounter((c) => c + 1)}
              onGoogleSignIn={handleGoogleSignIn}
              onNotify={notify}
            />
          ) : activeTab === 'integrations' ? (
            <IntegrationsView
              lang={lang}
              businessId={activeBusiness.id}
              userRole={effectiveRole}
              onGoogleSignIn={handleGoogleSignIn}
              onLeadsUpdated={() => setRefreshCounter((c) => c + 1)}
              onNotify={notify}
            />
          ) : (
            <SettingsView
              lang={lang}
              business={activeBusiness}
              userRole={effectiveRole}
              customFields={customFields}
              onRefreshBusiness={() => loadSessionAndWorkspaces()}
              onRefreshFields={() => setRefreshCounter((c) => c + 1)}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      <WorkspaceWizardModal
        open={showWorkspaceModal}
        lang={lang}
        onClose={() => setShowWorkspaceModal(false)}
        onCreate={handleCreateWorkspace}
      />

      {activeBusiness && (
        <CreateLeadModal
          open={showCreateLeadModal}
          lang={lang}
          stages={stages}
          customFields={customFields}
          members={members}
          userRole={effectiveRole}
          onClose={() => setShowCreateLeadModal(false)}
          onSubmit={handleCreateLead}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <LeadFlowAppInner />
    </ToastProvider>
  );
}
