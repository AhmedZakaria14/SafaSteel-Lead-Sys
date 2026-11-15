import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
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
  Search,
  MoreHorizontal,
  AlertCircle,
} from 'lucide-react';
import {
  AnalyticsResponse,
  Business,
  CustomField,
  Language,
  Lead,
  NotificationItem,
  PipelineStage,
  Role,
  TeamMember,
  ThemeMode,
  UserProfile,
} from './types/crm';
import { getT } from './i18n/translations';
import { ALSAFA_WORKSPACE_ID, DEFAULT_ADMIN_USERNAME, MASTER_OWNER_EMAIL } from './lib/constants';
import { apiRequest, getAuthToken, onUnauthorized, setAuthToken } from './lib/api';
import { formatCairoDateTime, formatCairoTimeOnly } from './lib/dateFormat';
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
import { LoginScreen } from './components/ui/LoginScreen';
import { GlobalLeadSearch } from './components/ui/GlobalLeadSearch';

const WorkspaceWizardModal = lazy(() =>
  import('./components/modals/WorkspaceWizardModal').then((m) => ({ default: m.WorkspaceWizardModal }))
);
const CreateLeadModal = lazy(() =>
  import('./components/modals/CreateLeadModal').then((m) => ({ default: m.CreateLeadModal }))
);
const DashboardView = lazy(() =>
  import('./components/views/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const LeadsView = lazy(() =>
  import('./components/views/LeadsView').then((m) => ({ default: m.LeadsView }))
);
const LeadDetailView = lazy(() =>
  import('./components/views/LeadDetailView').then((m) => ({ default: m.LeadDetailView }))
);
const PipelineView = lazy(() =>
  import('./components/views/PipelineView').then((m) => ({ default: m.PipelineView }))
);
const FollowUpsView = lazy(() =>
  import('./components/views/FollowUpsView').then((m) => ({ default: m.FollowUpsView }))
);
const CampaignsView = lazy(() =>
  import('./components/views/CampaignsView').then((m) => ({ default: m.CampaignsView }))
);
const TeamView = lazy(() =>
  import('./components/views/TeamView').then((m) => ({ default: m.TeamView }))
);
const IntegrationsView = lazy(() =>
  import('./components/views/IntegrationsView').then((m) => ({ default: m.IntegrationsView }))
);
const SettingsView = lazy(() =>
  import('./components/views/SettingsView').then((m) => ({ default: m.SettingsView }))
);

const ViewSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-24 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
      ))}
    </div>
    <div className="h-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
  </div>
);

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
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [authUser, setAuthUser] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [prodBusinesses, setProdBusinesses] = useState<Business[]>([]);
  const [demoBusinesses, setDemoBusinesses] = useState<Business[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string>('');

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadPreview, setSelectedLeadPreview] = useState<Lead | null>(null);

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
    status?: string;
    attachedSheetName?: string;
    lastSyncAt?: string | null;
    lastAttemptAt?: string | null;
    lastSyncDurationMs?: number | null;
    lastError?: string | null;
    isSyncing?: boolean;
    consecutiveFailures?: number;
    lastCreatedCount?: number;
    lastUpdatedCount?: number;
    lastNewLeads?: Array<{ id: string; sheetLeadId: string; fullName: string; phone: string; createdTime: string }>;
    spreadsheetId?: string | null;
    spreadsheetName?: string | null;
    publicCsvUrl?: string | null;
    sheetUrl?: string | null;
    autoScheduled?: boolean;
    syncIntervalSec?: number;
    totalLeads?: number;
    knownLeadsCount?: number;
  } | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastDetectedNewCount, setLastDetectedNewCount] = useState<number>(0);

  const notifMenuRef = useRef<HTMLDivElement>(null);
  const prevBusinessIdRef = useRef<string>('');
  const pendingDeepLinkRef = useRef<{ leadId: string | null; businessId: string | null } | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const syncInFlightRef = useRef<boolean>(false);
  const consecutiveSyncFailuresRef = useRef<number>(0);
  const refreshDebounceTimerRef = useRef<number | null>(null);
  const sseBatchBufferRef = useRef<NotificationItem[]>([]);
  const sseBatchTimerRef = useRef<number | null>(null);

  const requestWorkspaceRefresh = () => {
    if (refreshDebounceTimerRef.current !== null) {
      window.clearTimeout(refreshDebounceTimerRef.current);
    }
    refreshDebounceTimerRef.current = window.setTimeout(() => {
      refreshDebounceTimerRef.current = null;
      setRefreshCounter((c) => c + 1);
    }, 250);
  };

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

  const selectPreferredWorkspace = (prodList: Business[], demoList: Business[]) => {
    const merged = new Map<string, Business>();
    for (const b of [...prodList, ...demoList]) {
      if (!merged.has(b.id)) merged.set(b.id, b);
    }
    const pool = Array.from(merged.values());
    const requestedBiz = pendingDeepLinkRef.current?.businessId;
    if (pool.length > 0) {
      const alsafa = pool.find((b) => b.id === ALSAFA_WORKSPACE_ID);
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
  };

  const loadSessionAndWorkspaces = async () => {
    const token = getAuthToken();
    if (!token) {
      setAuthUser(null);
      setAuthReady(true);
      return;
    }

    try {
      const res = await apiRequest<{
        user?: UserProfile;
        businesses?: Business[];
        demoBusinesses?: Business[];
      }>('/me');

      const prodList = Array.isArray(res?.businesses) ? res.businesses : [];
      const demoList = Array.isArray(res?.demoBusinesses) ? res.demoBusinesses : [];

      setAuthUser(res?.user || null);
      setCurrentUserId(res?.user?.id || null);
      setProdBusinesses(prodList);
      setDemoBusinesses(demoList);
      selectPreferredWorkspace(prodList, demoList);
    } catch {
      setAuthToken(null);
      setAuthUser(null);
      setProdBusinesses([]);
      setDemoBusinesses([]);
      setActiveBusinessId('');
    } finally {
      setAuthReady(true);
    }
  };

  useEffect(() => {
    onUnauthorized(() => {
      setAuthUser(null);
      setCurrentUserId(null);
      setProdBusinesses([]);
      setDemoBusinesses([]);
      setActiveBusinessId('');
      setSelectedLeadId(null);
    });
    loadSessionAndWorkspaces();
  }, []);

  const allBusinesses = Array.from(
    new Map([...prodBusinesses, ...demoBusinesses].map((b) => [b.id, b])).values()
  );
  const activeBusiness = allBusinesses.find((b) => b.id === activeBusinessId) || null;
  const effectiveRole: Role = activeBusiness?.member_role || 'business_admin';

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
      const loadedNotifs = Array.isArray(notifRes?.notifications) ? notifRes.notifications : [];
      for (const n of loadedNotifs) {
        if (n?.id) seenNotificationIdsRef.current.add(n.id);
      }
      setStages(Array.isArray(stagesRes?.stages) ? stagesRes.stages : []);
      setCustomFields(Array.isArray(fieldsRes?.fields) ? fieldsRes.fields : []);
      setMembers(Array.isArray(membersRes?.members) ? membersRes.members : []);
      setAnalytics(analyticsRes || null);
      setNotifications(loadedNotifs);
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

  const navigateToLead = (leadId: string, targetBusinessId?: string | null, initialLead?: Lead | null) => {
    if (targetBusinessId && allBusinesses.some((b) => b.id === targetBusinessId) && targetBusinessId !== activeBusinessId) {
      pendingDeepLinkRef.current = { leadId, businessId: targetBusinessId };
      setActiveBusinessId(targetBusinessId);
    }
    setActiveTab('leads');
    setSelectedLeadPreview(initialLead || null);
    setSelectedLeadId(leadId);
    setShowNotifMenu(false);
    syncLeadUrl(leadId);
  };

  const handleCloseLeadDetail = () => {
    setSelectedLeadId(null);
    setSelectedLeadPreview(null);
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
    explicitLeadId?: string | null,
    notifMessageHint?: string | null
  ) => {
    if (notifId) {
      markSingleNotificationRead(notifId);
    }
    const codeMatch = notifMessageHint ? notifMessageHint.match(/\b(LD-\d+)\b/i) : null;
    const leadId = explicitLeadId || extractLeadIdFromLinkPath(linkPath) || (codeMatch ? codeMatch[1].toUpperCase() : null);
    if (leadId) {
      navigateToLead(leadId, targetBusinessId, null);
      return;
    }
    setSelectedLeadId(null);
    setSelectedLeadPreview(null);
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

  const syncIntervalSecRef = useRef<number>(15);
  syncIntervalSecRef.current = sheetStatus?.syncIntervalSec || 15;

  const analyticsTotalRef = useRef<number | null>(null);
  analyticsTotalRef.current = typeof analytics?.summary?.total === 'number' ? analytics.summary.total : null;

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
  }, [activeBusinessId]);

  // Refresh metrics without resetting selectedLeadId on live sync ticks
  useEffect(() => {
    if (activeBusinessId && refreshCounter > 0) {
      loadWorkspaceData(activeBusinessId);
    }
  }, [refreshCounter]);

  const emitIncomingNotificationsBatch = (incomingList: NotificationItem[]) => {
    if (!Array.isArray(incomingList) || incomingList.length === 0) return;

    const accepted: NotificationItem[] = [];
    for (const notif of incomingList) {
      if (!notif || !notif.id) continue;
      if (
        effectiveRoleRef.current === 'employee' &&
        notif.user_id &&
        currentUserIdRef.current &&
        notif.user_id !== currentUserIdRef.current
      ) {
        continue;
      }
      if (seenNotificationIdsRef.current.has(notif.id)) {
        continue;
      }
      seenNotificationIdsRef.current.add(notif.id);
      accepted.push(notif);
    }

    if (accepted.length === 0) return;

    setNotifications((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const fresh = accepted.filter((item) => !existingIds.has(item.id));
      if (fresh.length === 0) return prev;
      setUnreadCount((c) => c + fresh.length);
      return [...fresh, ...prev].slice(0, 50);
    });

    const liveIsAr = langRef.current === 'ar';
    const first = accepted[0];

    playNotificationSound(classifyNotificationSoundKind(first.type), first.id);

    if (accepted.length === 1) {
      const title = liveIsAr ? first.title_ar : first.title_en;
      const body = liveIsAr ? first.message_ar : first.message_en;
      const linkPath = first.link_path || '/leads';
      const hasLeadLink = Boolean(extractLeadIdFromLinkPath(linkPath));

      notify(body ? `${title} — ${body}` : title, first.type === 'integration_failed' ? 'error' : 'info', {
        actionLabel: hasLeadLink ? (liveIsAr ? 'فتح العميل' : 'Open Lead') : undefined,
        onAction: hasLeadLink
          ? () => navigateToLinkPathRef.current(linkPath, activeBusinessId, first.id)
          : undefined,
      });

      showBrowserPushNotification({
        id: first.id,
        title,
        body,
        linkPath,
        businessId: activeBusinessId,
        onNavigate: (lp, lid, bid, nid) => {
          navigateToLinkPathRef.current(lp, bid, nid, lid);
        },
      });
    } else {
      // Coalesce a batch of new leads into ONE compact summary toast so mobile screen is never covered
      const latestTitle = (liveIsAr ? first.title_ar : first.title_en)
        .replace(/^ليد جديدة:\s*/i, '')
        .replace(/^New Lead:\s*/i, '')
        .trim();
      const summaryTitle = liveIsAr
        ? `وصلت ${accepted.length} ليدز جديدة من الشيت`
        : `${accepted.length} new leads arrived from Sheet`;
      const summaryBody = latestTitle
        ? liveIsAr
          ? `${summaryTitle} (أحدثهم: ${latestTitle})`
          : `${summaryTitle} (Latest: ${latestTitle})`
        : summaryTitle;

      notify(summaryBody, 'info', {
        actionLabel: liveIsAr ? 'استعراض الجديد' : 'View New',
        onAction: () => {
          setSelectedLeadId(null);
          setSelectedLeadPreview(null);
          syncLeadUrl(null);
          setActiveTab('leads');
        },
      });

      showBrowserPushNotification({
        id: first.id,
        title: summaryTitle,
        body: latestTitle
          ? liveIsAr
            ? `أحدث عميل: ${latestTitle} (+${accepted.length - 1} آخرين)`
            : `Latest: ${latestTitle} (+${accepted.length - 1} more)`
          : summaryTitle,
        linkPath: '/leads',
        businessId: activeBusinessId,
        onNavigate: (lp, lid, bid, nid) => {
          navigateToLinkPathRef.current(lp, bid, nid, lid);
        },
      });
    }
  };

  const emitIncomingNotificationsBatchRef = useRef(emitIncomingNotificationsBatch);
  emitIncomingNotificationsBatchRef.current = emitIncomingNotificationsBatch;

  const queueSseNotification = (notif: NotificationItem) => {
    if (!notif || !notif.id) return;
    if (seenNotificationIdsRef.current.has(notif.id)) return;
    sseBatchBufferRef.current.push(notif);
    if (sseBatchTimerRef.current !== null) {
      window.clearTimeout(sseBatchTimerRef.current);
    }
    sseBatchTimerRef.current = window.setTimeout(() => {
      sseBatchTimerRef.current = null;
      const batch = sseBatchBufferRef.current.splice(0, sseBatchBufferRef.current.length);
      if (batch.length > 0) {
        emitIncomingNotificationsBatchRef.current(batch);
      }
    }, 350);
  };

  const queueSseNotificationRef = useRef(queueSseNotification);
  queueSseNotificationRef.current = queueSseNotification;

  // Real-time Server-Sent Events (SSE) subscription for live notifications, leads & sheet updates
  useEffect(() => {
    if (!activeBusinessId || !activeBusiness || !authUser) return;
    let closed = false;
    let es: EventSource | null = null;

    const connectSse = async () => {
      try {
        const token = getAuthToken();
        const url = `/api/businesses/${encodeURIComponent(activeBusinessId)}/events${
          token ? `?token=${encodeURIComponent(token)}` : ''
        }`;
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
            queueSseNotificationRef.current(notif);
          } catch {
            // ignore malformed notification payload
          }
        });
        es.addEventListener('sheet_synced', () => {
          requestWorkspaceRefresh();
        });
        es.addEventListener('lead_updated', () => {
          requestWorkspaceRefresh();
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
      if (sseBatchTimerRef.current !== null) {
        window.clearTimeout(sseBatchTimerRef.current);
        sseBatchTimerRef.current = null;
      }
      es?.close();
    };
  }, [activeBusinessId, authUser?.id]);

  // Execute Google Sheet synchronization (manual or background 15s polling) with deduplication & backoff
  const triggerSheetSync = async (options?: { manual?: boolean; signal?: AbortSignal }) => {
    const bizId = activeBusinessId;
    if (!bizId || !authUser) return;
    if (syncInFlightRef.current) return;
    if (!options?.manual && typeof navigator !== 'undefined' && !navigator.onLine) return;

    syncInFlightRef.current = true;
    setSyncingNow(true);
    setSheetStatus((prev) => (prev ? { ...prev, isSyncing: true, lastError: options?.manual ? null : prev.lastError } : prev));

    try {
      const res = await apiRequest<{
        createdCount: number;
        updatedCount: number;
        deletedCount?: number;
        skippedCount: number;
        totalLeadsInBusiness: number;
        syncDurationMs?: number;
        lastSuccessAt?: string;
        createdNotifications?: NotificationItem[];
        newLeads?: Array<{ id: string; sheetLeadId: string; fullName: string; phone: string; createdTime: string }>;
      }>(`/businesses/${bizId}/sheet-source/sync`, {
        method: 'POST',
        body: JSON.stringify({ silent: !options?.manual }),
        signal: options?.signal,
      });

      consecutiveSyncFailuresRef.current = 0;
      const nowIso = res.lastSuccessAt || new Date().toISOString();

      setSheetStatus((prev) => ({
        ...(prev || {}),
        status: 'connected',
        isSyncing: false,
        lastSyncAt: nowIso,
        lastSyncDurationMs: res.syncDurationMs ?? prev?.lastSyncDurationMs ?? null,
        lastError: null,
        consecutiveFailures: 0,
        totalLeads: res.totalLeadsInBusiness ?? prev?.totalLeads,
        lastCreatedCount: res.createdCount,
        lastUpdatedCount: res.updatedCount,
        lastDeletedCount: res.deletedCount ?? 0,
        lastNewLeads: res.newLeads || prev?.lastNewLeads || [],
      }));

      if (Array.isArray(res.createdNotifications) && res.createdNotifications.length > 0) {
        emitIncomingNotificationsBatchRef.current(res.createdNotifications);
      }

      if (res.createdCount > 0) {
        setLastDetectedNewCount(res.createdCount);
      }

      if (options?.manual && (!res.createdNotifications || res.createdNotifications.length === 0)) {
        notify(
          langRef.current === 'ar'
            ? `تمت مزامنة Google Sheets (${res.totalLeadsInBusiness} عميل) — متطابق 100% مع الشيت (${res.syncDurationMs || 0}ms)`
            : `Google Sheets synced (${res.totalLeadsInBusiness} leads) — 100% in sync (${res.syncDurationMs || 0}ms)`,
          'success'
        );
      }

      const countDiffersFromDashboard =
        analyticsTotalRef.current !== null && analyticsTotalRef.current !== res.totalLeadsInBusiness;

      if (
        options?.manual ||
        res.createdCount > 0 ||
        res.updatedCount > 0 ||
        (res.deletedCount || 0) > 0 ||
        countDiffersFromDashboard
      ) {
        requestWorkspaceRefresh();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      consecutiveSyncFailuresRef.current += 1;
      const errMsg = err?.message || 'Sheet sync failed';
      setSheetStatus((prev) => ({
        ...(prev || {}),
        status: 'error',
        isSyncing: false,
        lastError: errMsg,
        consecutiveFailures: consecutiveSyncFailuresRef.current,
      }));
      if (options?.manual) {
        notify(errMsg, 'error');
      }
    } finally {
      syncInFlightRef.current = false;
      setSyncingNow(false);
    }
  };

  const triggerSheetSyncRef = useRef(triggerSheetSync);
  triggerSheetSyncRef.current = triggerSheetSync;

  // Adaptive 15-second automatic polling + immediate sync on open, tab visibility, and network online recovery
  useEffect(() => {
    if (!activeBusinessId || !authUser) return;
    let cancelled = false;
    let timerId: number | null = null;
    const abortController = new AbortController();

    const getBaseIntervalMs = () =>
      Math.max(10_000, Math.min(120_000, (syncIntervalSecRef.current || 15) * 1000));

    const scheduleNextTick = () => {
      if (cancelled) return;
      if (timerId !== null) window.clearTimeout(timerId);
      const failures = consecutiveSyncFailuresRef.current;
      const backoffMultiplier = failures > 0 ? Math.min(8, Math.pow(2, failures)) : 1;
      const delayMs = Math.min(120_000, getBaseIntervalMs() * backoffMultiplier);
      timerId = window.setTimeout(async () => {
        if (cancelled) return;
        if (document.visibilityState === 'visible' && navigator.onLine) {
          await triggerSheetSyncRef.current({ manual: false, signal: abortController.signal });
        }
        scheduleNextTick();
      }, delayMs);
    };

    // Immediate check on workspace open
    void triggerSheetSyncRef.current({ manual: false, signal: abortController.signal });
    scheduleNextTick();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && !cancelled) {
        void triggerSheetSyncRef.current({ manual: false, signal: abortController.signal });
        scheduleNextTick();
      }
    };

    const onOnline = () => {
      setBrowserOnline(true);
      consecutiveSyncFailuresRef.current = 0;
      if (!cancelled) {
        void triggerSheetSyncRef.current({ manual: false, signal: abortController.signal });
        scheduleNextTick();
      }
    };

    const onOffline = () => {
      setBrowserOnline(false);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      abortController.abort();
      if (timerId !== null) window.clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [activeBusinessId, authUser?.id]);

  const handleLoginSuccess = (data: {
    token: string;
    user: UserProfile;
    businesses: Business[];
    demoBusinesses: Business[];
  }) => {
    const prodList = Array.isArray(data?.businesses) ? data.businesses : [];
    const demoList = Array.isArray(data?.demoBusinesses) ? data.demoBusinesses : [];
    setAuthUser(data.user);
    setCurrentUserId(data.user.id);
    setProdBusinesses(prodList);
    setDemoBusinesses(demoList);
    selectPreferredWorkspace(prodList, demoList);
    setAuthReady(true);
    notify(isAr ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully', 'success');
  };

  const handleLogout = () => {
    setAuthToken(null);
    setAuthUser(null);
    setCurrentUserId(null);
    setProdBusinesses([]);
    setDemoBusinesses([]);
    setActiveBusinessId('');
    setSelectedLeadId(null);
    setNotifications([]);
    setUnreadCount(0);
    setAnalytics(null);
    notify(isAr ? 'تم تسجيل الخروج' : 'Signed out', 'info');
  };

  const handleCreateWorkspace = async (payload: any) => {
    const res = await apiRequest<{ business: Business }>('/businesses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
    await triggerSheetSync({ manual: true });
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
        title: isAr ? 'إشعارات الصفا ستيل مفعلة' : 'Al-Safa Steel Push Enabled',
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

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#090E1A] text-slate-500 text-xs">
        {t.loading}
      </div>
    );
  }

  if (!authUser) {
    return (
      <LoginScreen
        lang={lang}
        theme={theme}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        onToggleTheme={() => setTheme((m) => (m === 'light' ? 'dark' : 'light'))}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#090E1A] text-slate-900 dark:text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:flex flex-col sticky top-0 h-screen border-e border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-all duration-200 shrink-0 z-20 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div
          className={`h-16 flex items-center border-b border-slate-200 dark:border-slate-800 shrink-0 ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3.5 gap-2'
          }`}
        >
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1 flex items-center overflow-hidden">
              <img
                src="/alsafa-logo.png"
                alt="Al-Safa Steel"
                className="h-10 w-auto max-w-[164px] object-contain select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/70 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white active:scale-[0.97] transition-all"
            aria-label={sidebarCollapsed ? (isAr ? 'توسيع القائمة الجانبية' : 'Expand sidebar') : isAr ? 'تصغير القائمة الجانبية' : 'Collapse sidebar'}
            title={sidebarCollapsed ? (isAr ? 'توسيع القائمة الجانبية' : 'Expand sidebar') : isAr ? 'تصغير القائمة الجانبية' : 'Collapse sidebar'}
          >
            <Menu className="h-4.5 w-4.5" />
          </button>
        </div>

        {sidebarCollapsed && (
          <div className="py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-center shrink-0">
            <img
              src="/favicon.png"
              alt="Al-Safa Steel"
              className="h-8 w-8 object-contain select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
            />
          </div>
        )}

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
                  onChange={(e) => setActiveBusinessId(e.target.value)}
                  className="w-full bg-transparent text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none truncate cursor-pointer"
                >
                  {allBusinesses.map((b) => (
                    <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900">
                      {b.name}
                    </option>
                  ))}
                </select>
                {activeBusiness && (
                  <div className="text-[11px] text-slate-400 truncate">{activeBusiness.industry}</div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowWorkspaceModal(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.createWorkspace}</span>
            </button>
          </div>
        )}

        {/* Nav Links */}
        <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id && !selectedLeadId;
            const unreadLeadsBadge =
              item.id === 'leads' && typeof analytics?.summary?.unreadLeads === 'number'
                ? analytics.summary.unreadLeads
                : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSelectedLeadId(null);
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0F1E3D] text-white dark:bg-blue-600'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </span>
                {!sidebarCollapsed && unreadLeadsBadge > 0 && (
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white tabular-nums shrink-0">
                    {unreadLeadsBadge > 99 ? '99+' : unreadLeadsBadge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="w-[84vw] max-w-xs bg-white dark:bg-slate-900 border-e border-slate-200 dark:border-slate-800 h-full flex flex-col pt-safe pb-safe crm-drawer-enter shadow-2xl">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0 flex flex-col gap-0.5">
                <img
                  src="/alsafa-logo.png"
                  alt="Al-Safa Steel"
                  className="h-11 w-auto max-w-[160px] object-contain object-start select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
                />
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono" dir="ltr">
                  {authUser.username || authUser.full_name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 space-y-2.5">
              <select
                value={activeBusinessId}
                onChange={(e) => setActiveBusinessId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 min-h-[44px] text-base sm:text-xs font-semibold"
              >
                {allBusinesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setShowWorkspaceModal(true);
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 min-h-[42px] text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t.createWorkspace}</span>
              </button>
            </div>

            <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id && !selectedLeadId;
                const unreadLeadsBadge =
                  item.id === 'leads' && typeof analytics?.summary?.unreadLeads === 'number'
                    ? analytics.summary.unreadLeads
                    : 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setSelectedLeadId(null);
                      syncLeadUrl(null);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-3.5 min-h-[44px] text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[#0F1E3D] text-white dark:bg-blue-600'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {unreadLeadsBadge > 0 && (
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white tabular-nums shrink-0">
                        {unreadLeadsBadge > 99 ? '99+' : unreadLeadsBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Quick Mobile Preferences & Logout */}
            <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[42px] text-xs font-medium"
                >
                  <Languages className="h-3.5 w-3.5" />
                  <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme((m) => (m === 'light' ? 'dark' : 'light'))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[42px] text-xs font-medium"
                >
                  {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  <span>{theme === 'light' ? (isAr ? 'داكن' : 'Dark') : isAr ? 'فاتح' : 'Light'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`inline-flex items-center justify-center gap-1 rounded-lg border min-h-[42px] text-xs font-medium ${
                    soundEnabled
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  <span>{soundEnabled ? (isAr ? 'الصوت' : 'Sound') : isAr ? 'مكتوم' : 'Muted'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 min-h-[44px] text-xs font-semibold text-red-700 dark:text-red-300"
              >
                <LogOut className="h-4 w-4" />
                <span>{t.signOut}</span>
              </button>
            </div>
          </div>
          <div className="flex-1 bg-slate-950/50 backdrop-blur-[1px]" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Compact Sticky on Mobile <= 56px) */}
        <header className="sticky top-0 z-30 h-14 sm:h-16 px-3 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden min-h-[42px] min-w-[42px] flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src="/alsafa-logo.png"
              alt="Al-Safa Steel"
              className="md:hidden h-9 w-auto max-w-[118px] object-contain shrink-0 select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
            />
            {activeBusiness ? (
              <div className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {activeBusiness.name}
              </div>
            ) : (
              <img
                src="/alsafa-logo.png"
                alt="Al-Safa Steel"
                className="hidden md:block h-9 w-auto object-contain select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
              />
            )}
          </div>

          {/* Global Live Customer Search in Desktop Topbar */}
          {activeBusiness && (
            <div className="hidden lg:block flex-1 max-w-md mx-auto">
              <GlobalLeadSearch
                lang={lang}
                businessId={activeBusiness.id}
                variant="topbar"
                onSelectLead={(id, lead) => navigateToLead(id, activeBusiness.id, lead)}
                onViewAllLeads={() => {
                  setSelectedLeadId(null);
                  setSelectedLeadPreview(null);
                  syncLeadUrl(null);
                  setActiveTab('leads');
                }}
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Mobile Quick Search Toggle */}
            {activeBusiness && (
              <button
                type="button"
                onClick={() => setMobileSearchOpen((v) => !v)}
                className={`lg:hidden min-h-[42px] min-w-[42px] flex items-center justify-center rounded-lg border transition-colors ${
                  mobileSearchOpen
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
                aria-label={isAr ? 'بحث سريع' : 'Quick search'}
              >
                {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              title="Switch language"
            >
              <Languages className="h-3.5 w-3.5" />
              <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((m) => (m === 'light' ? 'dark' : 'light'))}
              className="hidden sm:flex rounded-lg border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            {/* Notification Sound Toggle (Desktop/Tablet header; mobile also inside menu & bell popover) */}
            <button
              type="button"
              onClick={handleToggleSound}
              className={`hidden sm:flex rounded-lg border p-2 transition-colors ${
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
                className="relative min-h-[42px] min-w-[42px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 sm:p-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
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
                <div className="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:end-0 sm:top-auto sm:mt-2 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-50 overflow-hidden crm-animate-enter">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{t.notifications}</span>
                      {unreadCount > 0 && (
                        <span className="font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                          ({unreadCount})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
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
                        <span>{soundEnabled ? (isAr ? 'الصوت' : 'Sound') : isAr ? 'مكتوم' : 'Muted'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleMarkNotificationsRead}
                        className="text-blue-600 dark:text-blue-400 font-medium hover:underline px-1"
                      >
                        {t.markAllRead}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNotifMenu(false)}
                        className="rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        aria-label="Close notifications"
                      >
                        <X className="h-3.5 w-3.5" />
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

                  <div className="max-h-[60dvh] sm:max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">{t.noNotifications}</div>
                    ) : (
                      notifications.map((n) => {
                        const hasLink = Boolean(n.link_path);
                        return (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() =>
                              navigateToLinkPath(
                                n.link_path || '/leads',
                                activeBusinessId,
                                n.id,
                                null,
                                `${n.title_ar || ''} ${n.message_ar || ''} ${n.message_en || ''}`
                              )
                            }
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
                                <div className="font-mono text-[10px] text-slate-400 mt-1 tabular-nums" dir="ltr">
                                  {formatCairoDateTime(n.created_at, lang)}
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

            <div className="flex items-center gap-2">
              {(authUser.isOwner || authUser.username === DEFAULT_ADMIN_USERNAME || authUser.email?.toLowerCase() === MASTER_OWNER_EMAIL) && (
                <span className="hidden md:inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-200">
                  <Crown className="h-3 w-3" />
                  <span>{isAr ? 'المدير الرئيسي' : 'Owner'}</span>
                </span>
              )}
              <span className="hidden sm:inline font-mono text-xs font-semibold text-slate-700 dark:text-slate-300 max-w-40 truncate" dir="ltr">
                {authUser.username || authUser.full_name}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[42px] min-w-[42px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 sm:p-2 text-slate-500 hover:text-red-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                title={t.signOut}
                aria-label={t.signOut}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Expandable Mobile/Tablet Search Panel */}
        {mobileSearchOpen && activeBusiness && (
          <div className="lg:hidden px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 crm-animate-enter">
            <GlobalLeadSearch
              lang={lang}
              businessId={activeBusiness.id}
              variant="topbar"
              onSelectLead={(id, lead) => {
                setMobileSearchOpen(false);
                navigateToLead(id, activeBusiness.id, lead);
              }}
              onViewAllLeads={() => {
                setMobileSearchOpen(false);
                setSelectedLeadId(null);
                setSelectedLeadPreview(null);
                syncLeadUrl(null);
                setActiveTab('leads');
              }}
            />
          </div>
        )}

        {/* Google Sheets Sync Status Indicator Bar (Compact single-line on mobile) */}
        {activeBusiness && (
          <div
            className={`border-b px-3 sm:px-6 py-1 sm:py-1.5 flex items-center justify-between gap-2 text-[11px] sm:text-xs transition-colors ${
              !browserOnline || sheetStatus?.lastError
                ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900/60 text-red-950 dark:text-red-200'
                : 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-hidden">
              <FileSpreadsheet
                className={`h-3.5 w-3.5 shrink-0 ${
                  !browserOnline || sheetStatus?.lastError
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              />
              <span className="font-semibold truncate max-w-[110px] sm:max-w-[240px]">
                {sheetStatus?.spreadsheetName || sheetStatus?.attachedSheetName || activeBusiness.name}
              </span>

              {/* Connection & Sync State Badge */}
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                  !browserOnline
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'
                    : sheetStatus?.lastError
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'
                    : syncingNow || sheetStatus?.isSyncing
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    !browserOnline || sheetStatus?.lastError
                      ? 'bg-red-600'
                      : syncingNow || sheetStatus?.isSyncing
                      ? 'bg-amber-500 animate-ping'
                      : 'bg-emerald-600'
                  }`}
                />
                <span className="whitespace-nowrap">
                  {!browserOnline
                    ? isAr
                      ? 'غير متصل'
                      : 'Offline'
                    : sheetStatus?.lastError
                    ? isAr
                      ? 'خطأ مزامنة'
                      : 'Sync Error'
                    : syncingNow || sheetStatus?.isSyncing
                    ? isAr
                      ? 'يزامن...'
                      : 'Syncing...'
                    : isAr
                    ? `تلقائي ${sheetStatus?.syncIntervalSec || 15}ث`
                    : `Auto ${sheetStatus?.syncIntervalSec || 15}s`}
                </span>
              </span>

              {/* Clickable Unread / New Leads Chip */}
              {(typeof analytics?.summary?.unreadLeads === 'number' && analytics.summary.unreadLeads > 0) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLeadId(null);
                    setSelectedLeadPreview(null);
                    syncLeadUrl(null);
                    setActiveTab('leads');
                  }}
                  className="inline-flex items-center gap-1 rounded bg-red-600 hover:bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shrink-0 transition-colors"
                >
                  <span>
                    {analytics.summary.unreadLeads} {isAr ? 'جديد' : 'New'}
                  </span>
                </button>
              ) : (lastDetectedNewCount > 0 || (sheetStatus?.lastCreatedCount || 0) > 0) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedLeadId(null);
                    setSelectedLeadPreview(null);
                    syncLeadUrl(null);
                    setActiveTab('leads');
                  }}
                  className="inline-flex items-center gap-1 rounded bg-red-600 hover:bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shrink-0 transition-colors"
                >
                  +{lastDetectedNewCount || sheetStatus?.lastCreatedCount}{' '}
                  {isAr ? 'جديد' : 'New'}
                </button>
              ) : null}

              {/* Last Successful Sync & Duration */}
              {sheetStatus?.lastSyncAt && !sheetStatus?.lastError && (
                <span className="font-mono text-[11px] text-emerald-800/80 dark:text-emerald-300/80 tabular-nums hidden md:inline shrink-0" dir="ltr">
                  · {formatCairoTimeOnly(sheetStatus.lastSyncAt, lang)}
                  {typeof sheetStatus.lastSyncDurationMs === 'number'
                    ? ` (${sheetStatus.lastSyncDurationMs}ms)`
                    : ''}
                </span>
              )}

              {/* Error Message Display */}
              {sheetStatus?.lastError && (
                <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300 font-medium truncate max-w-[180px] sm:max-w-[380px]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{sheetStatus.lastError}</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleManualSheetSync}
                disabled={syncingNow}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 min-h-[26px] text-[11px] font-semibold disabled:opacity-50 ${
                  sheetStatus?.lastError
                    ? 'border-red-300 dark:border-red-800 bg-red-600 text-white hover:bg-red-700'
                    : 'border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40'
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${syncingNow ? 'animate-spin' : ''}`} />
                <span>{sheetStatus?.lastError ? (isAr ? 'إعادة' : 'Retry') : t.syncNow}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('integrations')}
                className="hidden sm:inline-flex items-center gap-1 font-semibold underline hover:opacity-85"
              >
                <span>{isAr ? 'إعدادات الشيت' : 'Sheet Source'}</span>
              </button>
              {activeBusiness.is_demo === 1 && (
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="hidden sm:inline-flex items-center gap-1 opacity-80 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{t.resetDemo}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-3 sm:p-6 pb-24 md:pb-6 max-w-[1440px] w-full mx-auto">
          <Suspense fallback={<ViewSkeleton />}>
            {!activeBusiness ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 sm:p-12 text-center max-w-lg mx-auto mt-6 sm:mt-10">
                <img
                  src="/alsafa-logo.png"
                  alt="Al-Safa Steel"
                  className="h-20 w-auto mx-auto object-contain select-none dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]"
                />
                <h2 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-100">
                  {isAr ? 'مرحباً بك في نظام إدارة العملاء' : 'Welcome to Al-Safa Steel CRM'}
                </h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  {isAr
                    ? 'أنشئ مساحة عمل لنشاطك التجاري أو تواصل مع المدير لتفعيل مساحة الصفا ستيل.'
                    : 'Create a business workspace to start capturing, organizing, and converting leads.'}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowWorkspaceModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-5 min-h-[44px] text-sm font-medium text-white"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{t.createWorkspace}</span>
                  </button>
                </div>
              </div>
            ) : selectedLeadId ? (
              <LeadDetailView
                lang={lang}
                businessId={activeBusiness.id}
                leadId={selectedLeadId}
                initialLead={selectedLeadPreview}
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
                sheetStatus={sheetStatus}
                syncingNow={syncingNow}
                onSyncNow={handleManualSheetSync}
                onSelectLead={(id, lead) => navigateToLead(id, activeBusiness.id, lead)}
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
                onSelectLead={(id, lead) => navigateToLead(id, activeBusiness.id, lead)}
                onAddLead={() => setShowCreateLeadModal(true)}
                onNotify={notify}
                onLeadReadChanged={() => setRefreshCounter((c) => c + 1)}
                refreshTrigger={refreshCounter}
              />
            ) : activeTab === 'pipeline' ? (
              <PipelineView
                lang={lang}
                businessId={activeBusiness.id}
                userRole={effectiveRole}
                stages={stages}
                onSelectLead={(id, lead) => navigateToLead(id, activeBusiness.id, lead)}
                onStagesChanged={() => setRefreshCounter((c) => c + 1)}
                onNotify={notify}
              />
            ) : activeTab === 'followups' ? (
              <FollowUpsView
                lang={lang}
                businessId={activeBusiness.id}
                onSelectLead={(id) => navigateToLead(id, activeBusiness.id, null)}
                onNotify={notify}
              />
            ) : activeTab === 'campaigns' ? (
              <CampaignsView lang={lang} analytics={analytics} />
            ) : activeTab === 'team' ? (
              <TeamView
                lang={lang}
                business={activeBusiness}
                userRole={effectiveRole}
                currentUser={authUser}
                members={members}
                onRefresh={() => setRefreshCounter((c) => c + 1)}
                onNotify={notify}
              />
            ) : activeTab === 'integrations' ? (
              <IntegrationsView
                lang={lang}
                businessId={activeBusiness.id}
                userRole={effectiveRole}
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
          </Suspense>
        </main>
      </div>

      {/* Mobile Thumb-Zone Bottom Tab Bar */}
      <nav
        aria-label={isAr ? 'التنقل السريع' : 'Mobile navigation'}
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-5 h-14">
          {[
            { id: 'dashboard' as NavTab, label: isAr ? 'الرئيسية' : 'Home', icon: LayoutDashboard },
            { id: 'leads' as NavTab, label: isAr ? 'العملاء' : 'Leads', icon: Users },
            { id: 'pipeline' as NavTab, label: isAr ? 'المراحل' : 'Pipeline', icon: Kanban },
            { id: 'followups' as NavTab, label: isAr ? 'المتابعات' : 'Tasks', icon: CalendarClock },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id && !selectedLeadId;
            const unreadLeadsBadge =
              item.id === 'leads' && typeof analytics?.summary?.unreadLeads === 'number'
                ? analytics.summary.unreadLeads
                : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSelectedLeadId(null);
                  syncLeadUrl(null);
                }}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'text-[#0F1E3D] dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <div className="relative">
                  <Icon className={`h-5 w-5 ${active ? 'stroke-[2.25]' : ''}`} />
                  {unreadLeadsBadge > 0 && (
                    <span className="absolute -top-1 -end-2.5 h-4 min-w-4 px-1 rounded-full bg-red-600 text-[9px] font-bold text-white flex items-center justify-center tabular-nums">
                      {unreadLeadsBadge > 99 ? '99+' : unreadLeadsBadge}
                    </span>
                  )}
                </div>
                <span className="truncate max-w-full px-1">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
              ['campaigns', 'team', 'integrations', 'settings'].includes(activeTab) && !selectedLeadId
                ? 'text-[#0F1E3D] dark:text-blue-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span className="truncate max-w-full px-1">{isAr ? 'المزيد' : 'More'}</span>
          </button>
        </div>
      </nav>

      <Suspense fallback={null}>
        {showWorkspaceModal && (
          <WorkspaceWizardModal
            open={showWorkspaceModal}
            lang={lang}
            onClose={() => setShowWorkspaceModal(false)}
            onCreate={handleCreateWorkspace}
          />
        )}

        {activeBusiness && showCreateLeadModal && (
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
      </Suspense>
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
