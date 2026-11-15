import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Plus,
  Download,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Phone,
  MessageSquare,
  SlidersHorizontal,
  ExternalLink,
  Eye,
  Copy,
  Check,
  Building2,
  Briefcase,
  Package,
  X,
  Megaphone,
  UserCheck,
  Calendar,
  ArrowUpRight,
  Mail,
  CheckCheck,
  EyeOff,
} from 'lucide-react';
import { CustomField, Language, Lead, PipelineStage, Role, TeamMember } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { formatCairoDateTime } from '../../lib/dateFormat';

interface LeadsViewProps {
  lang: Language;
  businessId: string;
  userRole: Role;
  stages: PipelineStage[];
  customFields: CustomField[];
  members: TeamMember[];
  onSelectLead: (leadId: string, lead?: Lead) => void;
  onAddLead: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
  onLeadReadChanged?: () => void;
  refreshTrigger: number;
}

const SKIPPED_TABLE_CUSTOM_KEYS = new Set([
  '_sheet_hash',
  'product_selection',
  'quantity_sizes',
  'company_name',
  'job_title',
  'inbox_url',
  'platform',
]);

function safeParseJson(jsonStr?: string | null): Record<string, any> {
  if (!jsonStr) return {};
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'L';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatSourceLabel(source: string, isAr: boolean): string {
  if (source === 'facebook_lead_ads') return 'Facebook';
  if (source === 'instagram_lead_ads') return 'Instagram';
  if (source === 'meta_lead_ads') return 'Meta Ads';
  if (source === 'google_sheets') return 'Google Sheets';
  if (source === 'manual') return isAr ? 'إدخال يدوي' : 'Manual';
  return source;
}

function getSourceColorClass(source: string): string {
  if (source === 'facebook_lead_ads' || source === 'meta_lead_ads') {
    return 'text-blue-700 dark:text-blue-400';
  }
  if (source === 'instagram_lead_ads') {
    return 'text-rose-600 dark:text-rose-400';
  }
  if (source === 'google_sheets') {
    return 'text-emerald-700 dark:text-emerald-400';
  }
  return 'text-slate-600 dark:text-slate-400';
}

export const LeadsView: React.FC<LeadsViewProps> = ({
  lang,
  businessId,
  userRole,
  stages,
  customFields,
  members,
  onSelectLead,
  onAddLead,
  onNotify,
  onLeadReadChanged,
  refreshTrigger,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const canManage = userRole !== 'employee';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [readState, setReadState] = useState<'' | 'unread' | 'read'>('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatusId, setBulkStatusId] = useState('');
  const [bulkAssignId, setBulkAssignId] = useState('');
  const [showColPicker, setShowColPicker] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [peekLead, setPeekLead] = useState<Lead | null>(null);

  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const isSyncingScrollRef = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    lead_code: true,
    full_name: true,
    phone: true,
    interested_service: true,
    status: true,
    assigned: true,
    source: true,
    campaign: true,
    created_at: true,
  });

  const colLabels: Record<string, string> = {
    lead_code: t.leadId,
    full_name: t.customerName,
    phone: `${t.phone} & ${t.email}`,
    interested_service: isAr ? 'المنتج والمقاسات' : 'Product & Specs',
    status: t.status,
    assigned: t.assignedEmployee,
    source: t.source,
    campaign: t.campaign,
    created_at: t.createdAt,
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!peekLead) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPeekLead(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [Boolean(peekLead)]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        sortBy,
        sortDir,
      });
      if (debouncedSearch) qs.set('q', debouncedSearch);
      if (statusFilter) qs.set('statusId', statusFilter);
      if (readState) qs.set('readState', readState);
      if (sourceFilter) qs.set('source', sourceFilter);
      if (assignedFilter) qs.set('assignedTo', assignedFilter);

      const res = await apiRequest<{ leads: Lead[]; total: number; totalPages: number; unreadCount?: number }>(
        `/businesses/${businessId}/leads?${qs.toString()}`
      );
      setLeads(res.leads);
      setTotal(res.total);
      setTotalPages(res.totalPages);
      if (typeof res.unreadCount === 'number') setUnreadCount(res.unreadCount);
      setSelectedIds([]);
      if (peekLead) {
        const refreshed = res.leads.find((l) => l.id === peekLead.id);
        if (refreshed) setPeekLead(refreshed);
      }
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [
    businessId,
    page,
    debouncedSearch,
    statusFilter,
    readState,
    sourceFilter,
    assignedFilter,
    sortBy,
    sortDir,
    refreshTrigger,
  ]);

  const measureTableScroll = useCallback(() => {
    const tableWrap = tableScrollRef.current;
    const tableEl = tableRef.current;
    if (!tableWrap || !tableEl) {
      setHasHorizontalOverflow(false);
      return;
    }
    const contentWidth = Math.max(tableEl.scrollWidth, tableWrap.scrollWidth);
    const clientWidth = tableWrap.clientWidth;
    setTableScrollWidth(contentWidth);
    setHasHorizontalOverflow(clientWidth > 0 && contentWidth > clientWidth + 2);
  }, []);

  useEffect(() => {
    measureTableScroll();
    const tableWrap = tableScrollRef.current;
    const tableEl = tableRef.current;
    if (!tableWrap || !tableEl) return;

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureTableScroll()) : null;
    ro?.observe(tableWrap);
    ro?.observe(tableEl);
    window.addEventListener('resize', measureTableScroll);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measureTableScroll);
    };
  }, [measureTableScroll, leads, visibleCols, lang, loading, customFields.length]);

  const handleTopScroll = () => {
    if (isSyncingScrollRef.current) return;
    const topEl = topScrollRef.current;
    const bodyEl = tableScrollRef.current;
    if (!topEl || !bodyEl) return;
    isSyncingScrollRef.current = true;
    bodyEl.scrollLeft = topEl.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  };

  const handleTableScroll = () => {
    if (isSyncingScrollRef.current) return;
    const topEl = topScrollRef.current;
    const bodyEl = tableScrollRef.current;
    if (!topEl || !bodyEl) return;
    isSyncingScrollRef.current = true;
    topEl.scrollLeft = bodyEl.scrollLeft;
    requestAnimationFrame(() => {
      isSyncingScrollRef.current = false;
    });
  };

  const handleCopy = async (key: string, value: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(key);
      setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const applyLeadReadStateLocally = (leadId: string, nextIsRead: boolean) => {
    let delta = 0;
    setLeads((prev) =>
      prev.map((l) => {
        if (l.id !== leadId) return l;
        const wasRead = Boolean(l.is_read);
        if (!wasRead && nextIsRead) delta = -1;
        else if (wasRead && !nextIsRead) delta = 1;
        return {
          ...l,
          is_read: nextIsRead ? 1 : 0,
          read_at: nextIsRead ? new Date().toISOString() : null,
        };
      })
    );
    if (delta !== 0) {
      setUnreadCount((c) => Math.max(0, c + delta));
    }
    setPeekLead((prev) =>
      prev && prev.id === leadId
        ? {
            ...prev,
            is_read: nextIsRead ? 1 : 0,
            read_at: nextIsRead ? new Date().toISOString() : null,
          }
        : prev
    );
  };

  const handleToggleLeadRead = async (leadId: string, nextIsRead: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const prevLead = leads.find((l) => l.id === leadId) || (peekLead?.id === leadId ? peekLead : undefined);
    const prevRead = Boolean(prevLead?.is_read);
    applyLeadReadStateLocally(leadId, nextIsRead);
    try {
      await apiRequest(`/businesses/${businessId}/leads/${encodeURIComponent(leadId)}/read`, {
        method: 'POST',
        body: JSON.stringify({
          isRead: nextIsRead,
          leadCode: prevLead?.lead_code,
          externalRowId: prevLead?.external_row_id,
          phone: prevLead?.phone_e164 || prevLead?.phone,
        }),
      });
      if (readState) {
        fetchLeads();
      }
      onLeadReadChanged?.();
      onNotify(
        nextIsRead
          ? isAr
            ? 'تم تمييز العميل كمقروء'
            : 'Marked as read'
          : isAr
            ? 'تمت إعادة العميل كغير مقروء (جديد)'
            : 'Marked as unread (new)',
        'info'
      );
    } catch (err: any) {
      applyLeadReadStateLocally(leadId, prevRead);
      onNotify(err.message, 'error');
    }
  };

  const handleMarkAllNewAsRead = async () => {
    if (markingAllRead || unreadCount <= 0) return;
    setMarkingAllRead(true);
    const prevCount = unreadCount;
    const nowIso = new Date().toISOString();
    setLeads((prev) => prev.map((l) => (l.is_read ? l : { ...l, is_read: 1, read_at: nowIso })));
    setUnreadCount(0);
    try {
      const res = await apiRequest<{ ok: boolean; updatedCount: number }>(
        `/businesses/${businessId}/leads/mark-all-read`,
        { method: 'POST' }
      );
      if (readState === 'unread') {
        setReadState('');
      } else {
        fetchLeads();
      }
      onLeadReadChanged?.();
      onNotify(
        isAr
          ? `تم تحويل ${res.updatedCount || prevCount} ليد جديدة إلى مقروءة (باللون الأخضر)`
          : `Marked ${res.updatedCount || prevCount} new leads as read`,
        'success'
      );
    } catch (err: any) {
      fetchLeads();
      onNotify(err.message, 'error');
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleOpenPeek = (lead: Lead, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPeekLead({ ...lead, is_read: 1, read_at: lead.read_at || new Date().toISOString() });
    if (!lead.is_read) {
      applyLeadReadStateLocally(lead.id, true);
      apiRequest(`/businesses/${businessId}/leads/${encodeURIComponent(lead.id)}/read`, {
        method: 'POST',
        body: JSON.stringify({
          isRead: true,
          leadCode: lead.lead_code,
          externalRowId: lead.external_row_id,
          phone: lead.phone_e164 || lead.phone,
        }),
      })
        .then(() => {
          onLeadReadChanged?.();
        })
        .catch(() => {
          // ignore background read mark failure
        });
    }
  };

  const handleQuickStatusUpdate = async (leadId: string, statusId: string) => {
    if (!statusId) return;
    setUpdatingLeadId(leadId);
    const targetBefore = leads.find((l) => l.id === leadId) || (peekLead?.id === leadId ? peekLead : undefined);
    try {
      await apiRequest(`/businesses/${businessId}/leads/${encodeURIComponent(leadId)}/status`, {
        method: 'POST',
        body: JSON.stringify({
          statusId,
          leadCode: targetBefore?.lead_code,
          externalRowId: targetBefore?.external_row_id,
          phone: targetBefore?.phone_e164 || targetBefore?.phone,
        }),
      });
      const stage = stages.find((s) => s.id === statusId);
      const wasUnread = targetBefore ? !targetBefore.is_read : false;
      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId
            ? {
                ...l,
                status_id: statusId,
                status_key: stage?.key,
                status_name_ar: stage?.name_ar,
                status_name_en: stage?.name_en,
                status_color: stage?.color,
                is_read: 1,
                read_at: l.read_at || new Date().toISOString(),
              }
            : l
        )
      );
      if (wasUnread) {
        setUnreadCount((c) => Math.max(0, c - 1));
        onLeadReadChanged?.();
      }
      setPeekLead((prev) =>
        prev && prev.id === leadId
          ? {
              ...prev,
              status_id: statusId,
              status_key: stage?.key,
              status_name_ar: stage?.name_ar,
              status_name_en: stage?.name_en,
              status_color: stage?.color,
              is_read: 1,
              read_at: prev.read_at || new Date().toISOString(),
            }
          : prev
      );
      onNotify(isAr ? 'تم تحديث حالة العميل' : 'Lead status updated', 'success');
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const handleBulkStatus = async () => {
    if (!bulkStatusId || selectedIds.length === 0) return;
    try {
      await apiRequest(`/businesses/${businessId}/leads/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leadIds: selectedIds, action: 'status', statusId: bulkStatusId }),
      });
      onNotify(isAr ? 'تم تحديث الحالات بنجاح' : 'Bulk status updated', 'success');
      setBulkStatusId('');
      fetchLeads();
      onLeadReadChanged?.();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleBulkAssign = async () => {
    if (selectedIds.length === 0) return;
    try {
      await apiRequest(`/businesses/${businessId}/leads/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leadIds: selectedIds, action: 'assign', assignedToUserId: bulkAssignId || null }),
      });
      onNotify(isAr ? 'تم تعيين الموظف للمحدد' : 'Bulk assignment completed', 'success');
      setBulkAssignId('');
      fetchLeads();
      onLeadReadChanged?.();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleBulkReadState = async (action: 'mark_read' | 'mark_unread') => {
    if (selectedIds.length === 0) return;
    try {
      await apiRequest(`/businesses/${businessId}/leads/bulk`, {
        method: 'POST',
        body: JSON.stringify({ leadIds: selectedIds, action }),
      });
      onNotify(
        action === 'mark_read'
          ? isAr
            ? 'تم تحديد العملاء كمقروء'
            : 'Selected leads marked as read'
          : isAr
            ? 'تم تحديد العملاء كغير مقروء'
            : 'Selected leads marked as unread',
        'success'
      );
      fetchLeads();
      onLeadReadChanged?.();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    try {
      const blob = await apiRequest<Blob>(`/businesses/${businessId}/leads/export?format=${format}`, {
        expectBlob: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(isAr ? `تم تصدير ملف ${format.toUpperCase()}` : `Exported ${format.toUpperCase()}`, 'success');
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const toggleAll = () => {
    if (selectedIds.length === leads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(leads.map((l) => l.id));
    }
  };

  const extraCustomCols = customFields
    .filter((cf) => !SKIPPED_TABLE_CUSTOM_KEYS.has(cf.field_key))
    .slice(0, 2);

  const peekCustomVals = peekLead ? safeParseJson(peekLead.custom_values_json) : {};
  const peekPhone = peekLead ? peekLead.phone_e164 || peekLead.phone || '' : '';
  const peekWhatsappInput = typeof peekCustomVals.whatsapp_input === 'string' ? peekCustomVals.whatsapp_input : '';
  const peekWhatsappDigits = (peekPhone || peekWhatsappInput).replace(/\D/g, '');
  const peekInboxUrl =
    typeof peekCustomVals.inbox_url === 'string' && peekCustomVals.inbox_url.startsWith('http')
      ? peekCustomVals.inbox_url
      : '';
  const peekCompany = typeof peekCustomVals.company_name === 'string' ? peekCustomVals.company_name.trim() : '';
  const peekJobTitle = typeof peekCustomVals.job_title === 'string' ? peekCustomVals.job_title.trim() : '';
  const peekSpecs =
    (typeof peekCustomVals.quantity_sizes === 'string' && peekCustomVals.quantity_sizes.trim()) ||
    peekLead?.notes_summary ||
    '';

  return (
    <div className="space-y-4 crm-animate-enter">
      {/* Toolbar & Stage Segmented Filter */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
          <div className="relative flex-1 lg:max-w-md">
            <Search className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t.searchLeads}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-9 pe-3 py-2 min-h-[44px] sm:min-h-[38px] text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-shadow"
            />
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 min-h-[42px] sm:min-h-[36px] text-base sm:text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <option value="">{t.allSources}</option>
              <option value="facebook_lead_ads">{isAr ? 'إعلانات فيسبوك (Facebook)' : 'Facebook Lead Ads'}</option>
              <option value="instagram_lead_ads">{isAr ? 'إعلانات إنستغرام (Instagram)' : 'Instagram Lead Ads'}</option>
              <option value="meta_lead_ads">Meta Lead Ads</option>
              <option value="google_sheets">Google Sheets</option>
              <option value="manual">{isAr ? 'إدخال يدوي' : 'Manual'}</option>
            </select>

            {canManage && (
              <select
                value={assignedFilter}
                onChange={(e) => {
                  setAssignedFilter(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 min-h-[42px] sm:min-h-[36px] text-base sm:text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="">{t.allEmployees}</option>
                <option value="unassigned">{t.unassigned}</option>
                {members
                  .filter((m) => m.user_id)
                  .map((m) => (
                    <option key={m.id} value={m.user_id!}>
                      {m.full_name || m.display_name || m.invited_email}
                    </option>
                  ))}
              </select>
            )}

            <div className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setShowColPicker((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>{isAr ? 'الأعمدة' : 'Columns'}</span>
              </button>
              {showColPicker && (
                <div className="absolute end-0 mt-2 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 z-20 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-100 dark:border-slate-800">
                    {isAr ? 'إظهار / إخفاء الأعمدة' : 'Visible Columns'}
                  </div>
                  {Object.keys(visibleCols).map((key) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-950 dark:hover:text-white"
                    >
                      <input
                        type="checkbox"
                        checked={visibleCols[key]}
                        onChange={(e) => setVisibleCols((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="rounded border-slate-300 dark:border-slate-700"
                      />
                      <span>{colLabels[key] || key}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleExport('csv')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 min-h-[42px] sm:min-h-[36px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 min-h-[42px] sm:min-h-[36px] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={onAddLead}
              className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-3.5 min-h-[44px] sm:min-h-[36px] text-xs font-semibold text-white transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.addLead}</span>
            </button>
          </div>
        </div>

        {/* Read-State Filter Tabs (New Red vs Read Green) */}
        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onClick={() => {
              setReadState('');
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
              readState === ''
                ? 'bg-[#0F1E3D] dark:bg-blue-600 text-white border-transparent shadow-xs'
                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isAr ? 'الكل (جديد ومقروء)' : 'All (New & Read)'}
          </button>

          <button
            type="button"
            onClick={() => {
              setReadState(readState === 'unread' ? '' : 'unread');
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              readState === 'unread'
                ? 'bg-red-600 text-white border-red-600 shadow-xs'
                : 'bg-red-50/75 dark:bg-red-950/25 border-red-200 dark:border-red-900/70 text-red-700 dark:text-red-300 hover:bg-red-100/80 dark:hover:bg-red-950/40'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${readState === 'unread' ? 'bg-white' : 'bg-red-600 animate-pulse'}`}
              aria-hidden="true"
            />
            <span>{isAr ? 'جديد · غير مقروء' : 'New · Unread'}</span>
            <span
              className={`font-mono text-[11px] px-1.5 py-0.5 rounded tabular-nums ${
                readState === 'unread'
                  ? 'bg-red-700 text-white'
                  : 'bg-red-100 dark:bg-red-900/60 text-red-800 dark:text-red-200'
              }`}
            >
              {unreadCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReadState(readState === 'read' ? '' : 'read');
              setPage(1);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              readState === 'read'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-emerald-50/75 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/70 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/40'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${readState === 'read' ? 'bg-white' : 'bg-emerald-600'}`}
              aria-hidden="true"
            />
            <span>{isAr ? 'مقروء (السابق)' : 'Read (Previous)'}</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              disabled={markingAllRead}
              onClick={handleMarkAllNewAsRead}
              className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-300 dark:border-emerald-800 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5 shrink-0" />
              <span>
                {isAr
                  ? `تحديد الجديد كمقروء (${unreadCount})`
                  : `Mark All New Read (${unreadCount})`}
              </span>
            </button>
          )}
        </div>

        {/* Quick Pipeline Stage Filter Tabs */}
        {stages.length > 0 && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => {
                setStatusFilter('');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 whitespace-nowrap ${
                statusFilter === ''
                  ? 'bg-[#0F1E3D] dark:bg-blue-600 text-white border-transparent shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.allStatuses}
            </button>
            {stages.map((stage) => {
              const active = statusFilter === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(active ? '' : stage.id);
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 whitespace-nowrap ${
                    active
                      ? 'shadow-xs font-semibold'
                      : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                  style={
                    active
                      ? {
                          color: stage.color,
                          backgroundColor: `${stage.color}16`,
                          borderColor: `${stage.color}55`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 rounded-[2px] shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                  <span>{isAr ? stage.name_ar : stage.name_en}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Bulk Action Bar */}
        {canManage && selectedIds.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
              {selectedIds.length} {t.selectedCount}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={bulkStatusId}
                onChange={(e) => setBulkStatusId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              >
                <option value="">{t.bulkUpdateStatus}</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.name_ar : s.name_en}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!bulkStatusId}
                onClick={handleBulkStatus}
                className="rounded-lg bg-slate-900 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {t.confirm}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={bulkAssignId}
                onChange={(e) => setBulkAssignId(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              >
                <option value="">{t.bulkAssign}</option>
                {members
                  .filter((m) => m.user_id)
                  .map((m) => (
                    <option key={m.id} value={m.user_id!}>
                      {m.full_name || m.display_name || m.invited_email}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleBulkAssign}
                className="rounded-lg bg-slate-900 dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                {t.confirm}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleBulkReadState('mark_read')}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>{isAr ? 'تحديد كمقروء' : 'Mark Read'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleBulkReadState('mark_unread')}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-100"
              >
                <EyeOff className="h-3.5 w-3.5" />
                <span>{isAr ? 'تحديد كغير مقروء' : 'Mark Unread'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Cards + Desktop Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-clip">
        {loading ? (
          <div className="p-4 sm:p-6 space-y-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 sm:h-12 rounded-lg bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="p-10 sm:p-12 text-center">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.noLeadsTitle}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.noLeadsDesc}</p>
          </div>
        ) : (
          <>
            {/* Mobile-Native Card List (No Sideways Table Scroll) */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
              {leads.map((lead) => {
                const customVals = safeParseJson(lead.custom_values_json);
                const primaryPhone = lead.phone_e164 || lead.phone || '';
                const whatsappNum = primaryPhone.replace(/\D/g, '');
                const companyName = typeof customVals.company_name === 'string' ? customVals.company_name.trim() : '';
                const specsPreview =
                  (typeof customVals.quantity_sizes === 'string' && customVals.quantity_sizes.trim()) ||
                  lead.notes_summary ||
                  '';
                const stageColor = lead.status_color || '#2563EB';
                const inboxUrl =
                  typeof customVals.inbox_url === 'string' && customVals.inbox_url.startsWith('http')
                    ? customVals.inbox_url
                    : '';
                const isUnread = !lead.is_read;

                return (
                  <div
                    key={lead.id}
                    onClick={() => onSelectLead(lead.id, lead)}
                    className={`p-3 space-y-2 border-s-4 transition-colors crm-cv-auto ${
                      isUnread
                        ? 'border-s-red-600 bg-red-50/60 dark:bg-red-950/20 active:bg-red-100/70 dark:active:bg-red-950/35'
                        : 'border-s-emerald-600 bg-emerald-50/30 dark:bg-emerald-950/15 active:bg-emerald-50/65 dark:active:bg-emerald-950/25'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {canManage && (
                          <label
                            className="flex items-center justify-center min-h-[32px] min-w-[24px] -ms-1 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(lead.id)}
                              onChange={(e) => {
                                setSelectedIds((prev) =>
                                  e.target.checked ? [...prev, lead.id] : prev.filter((id) => id !== lead.id)
                                );
                              }}
                              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
                            />
                          </label>
                        )}
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0 relative mt-0.5"
                          style={{ backgroundColor: stageColor }}
                        >
                          {getInitials(lead.full_name)}
                          <span
                            className={`absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                              isUnread ? 'bg-red-600' : 'bg-emerald-600'
                            }`}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                              {lead.full_name}
                            </h4>
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                                isUnread
                                  ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                                  : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {isUnread ? (isAr ? 'جديد' : 'New') : isAr ? 'مقروء' : 'Read'}
                            </span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                              {lead.lead_code}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className={`font-semibold truncate ${getSourceColorClass(lead.source)}`}>
                              {formatSourceLabel(lead.source, isAr)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums shrink-0" dir="ltr">
                              {formatCairoDateTime(lead.created_at, lang)}
                            </span>
                          </div>
                          {(lead.interested_service || specsPreview || companyName) && (
                            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                              {lead.interested_service && (
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {lead.interested_service}
                                </span>
                              )}
                              {lead.interested_service && (specsPreview || companyName) && <span> · </span>}
                              {specsPreview ? <span>{specsPreview}</span> : companyName ? <span>{companyName}</span> : null}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <select
                          aria-label={t.status}
                          value={lead.status_id || ''}
                          disabled={updatingLeadId === lead.id}
                          onChange={(e) => handleQuickStatusUpdate(lead.id, e.target.value)}
                          className="rounded-lg border px-2 py-1 min-h-[32px] text-[11px] font-semibold max-w-[108px] truncate"
                          style={{
                            color: stageColor,
                            backgroundColor: `${stageColor}14`,
                            borderColor: `${stageColor}45`,
                          }}
                        >
                          {stages.map((s) => (
                            <option
                              key={s.id}
                              value={s.id}
                              className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                            >
                              {isAr ? s.name_ar : s.name_en}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div
                      className="flex items-center justify-between gap-2 pt-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {primaryPhone ? (
                          <a
                            href={`tel:${primaryPhone}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-2 min-h-[34px] text-[11px] font-semibold"
                          >
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="font-mono tabular-nums truncate max-w-[110px]" dir="ltr">
                              {primaryPhone}
                            </span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                        {whatsappNum && (
                          <a
                            href={`https://wa.me/${whatsappNum}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 min-h-[34px] min-w-[34px]"
                            aria-label="WhatsApp"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {inboxUrl && (
                          <a
                            href={inboxUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 min-h-[34px] min-w-[34px]"
                            aria-label="Meta Inbox"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => handleOpenPeek(lead, e)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 min-h-[34px] text-[11px] font-semibold text-slate-700 dark:text-slate-200 active:scale-[0.98]"
                        >
                          <Eye className="h-3 w-3" />
                          <span>{isAr ? 'معاينة' : 'Peek'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleToggleLeadRead(lead.id, isUnread, e)}
                          className={`inline-flex items-center justify-center rounded-lg border min-h-[34px] min-w-[34px] ${
                            isUnread
                              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                              : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                          }`}
                          aria-label={isUnread ? (isAr ? 'تحديد كمقروء' : 'Mark Read') : isAr ? 'تحديد كغير مقروء' : 'Mark Unread'}
                          title={isUnread ? (isAr ? 'تحديد كمقروء' : 'Mark Read') : isAr ? 'تحديد كغير مقروء' : 'Mark Unread'}
                        >
                          {isUnread ? <CheckCheck className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectLead(lead.id, lead)}
                          className="inline-flex items-center justify-center rounded-lg bg-[#0F1E3D] dark:bg-blue-600 text-white min-h-[34px] min-w-[34px]"
                          aria-label={isAr ? 'فتح الملف' : 'Open profile'}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Top Horizontal Scrollbar (sticky at top of desktop table instead of bottom) */}
            {hasHorizontalOverflow && (
              <div className="hidden md:block sticky top-14 sm:top-16 z-20 border-b border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-xs">
                <div
                  ref={topScrollRef}
                  onScroll={handleTopScroll}
                  className="overflow-x-auto overflow-y-hidden crm-top-scrollbar"
                  aria-label={isAr ? 'شريط التمرير العرضي للجدول' : 'Horizontal table scrollbar'}
                >
                  <div style={{ width: `${tableScrollWidth}px`, height: '1px' }} />
                </div>
              </div>
            )}

            {/* Desktop Table (bottom scrollbar hidden; controlled by top bar + trackpad) */}
            <div
              ref={tableScrollRef}
              onScroll={handleTableScroll}
              className="hidden md:block overflow-x-auto no-scrollbar"
            >
              <table ref={tableRef} className="w-full text-start border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/70 text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                  {canManage && (
                    <th className="py-3 px-3 w-10">
                      <input
                        type="checkbox"
                        checked={leads.length > 0 && selectedIds.length === leads.length}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  {visibleCols.lead_code && (
                    <th className="py-3 px-3 text-start whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('lead_code')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200"
                      >
                        <span>{t.leadId}</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  )}
                  {visibleCols.full_name && (
                    <th className="py-3 px-3 text-start whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('full_name')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200"
                      >
                        <span>{t.customerName}</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  )}
                  {visibleCols.phone && (
                    <th className="py-3 px-3 text-start whitespace-nowrap">{isAr ? 'بيانات التواصل' : 'Contact'}</th>
                  )}
                  {visibleCols.interested_service && (
                    <th className="py-3 px-3 text-start whitespace-nowrap">
                      {isAr ? 'المنتج والمقاسات المطلوبة' : 'Products & Specifications'}
                    </th>
                  )}
                  {visibleCols.status && <th className="py-3 px-3 text-start whitespace-nowrap">{t.status}</th>}
                  {visibleCols.assigned && <th className="py-3 px-3 text-start whitespace-nowrap">{t.assignedEmployee}</th>}
                  {visibleCols.source && <th className="py-3 px-3 text-start whitespace-nowrap">{t.source}</th>}
                  {visibleCols.campaign && <th className="py-3 px-3 text-start whitespace-nowrap">{t.campaign}</th>}
                  {extraCustomCols.map((cf) => (
                    <th key={cf.id} className="py-3 px-3 text-start whitespace-nowrap">
                      {isAr ? cf.label_ar : cf.label_en}
                    </th>
                  ))}
                  {visibleCols.created_at && (
                    <th className="py-3 px-3 text-start whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('created_at')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-200"
                      >
                        <span>{t.createdAt}</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                  )}
                  <th className="py-3 px-3 text-end whitespace-nowrap">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/90 text-xs">
                {leads.map((lead) => {
                  const customVals = safeParseJson(lead.custom_values_json);
                  const primaryPhone = lead.phone_e164 || lead.phone || '';
                  const whatsappNum = primaryPhone.replace(/\D/g, '');
                  const companyName = typeof customVals.company_name === 'string' ? customVals.company_name.trim() : '';
                  const jobTitle = typeof customVals.job_title === 'string' ? customVals.job_title.trim() : '';
                  const specsPreview =
                    (typeof customVals.quantity_sizes === 'string' && customVals.quantity_sizes.trim()) ||
                    lead.notes_summary ||
                    '';
                  const stageColor = lead.status_color || '#2563EB';
                  const inboxUrl =
                    typeof customVals.inbox_url === 'string' && customVals.inbox_url.startsWith('http')
                      ? customVals.inbox_url
                      : '';
                  const isPeeking = peekLead?.id === lead.id;
                  const isUnread = !lead.is_read;

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => onSelectLead(lead.id, lead)}
                      className={`group cursor-pointer border-s-4 transition-colors duration-150 ${
                        isPeeking
                          ? 'border-s-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
                          : isUnread
                            ? 'border-s-red-600 bg-red-50/60 dark:bg-red-950/20 hover:bg-red-100/60 dark:hover:bg-red-950/35'
                            : 'border-s-emerald-600 bg-emerald-50/25 dark:bg-emerald-950/10 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/25'
                      }`}
                    >
                      {canManage && (
                        <td className="py-3 px-3 align-top" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(lead.id)}
                            onChange={(e) => {
                              setSelectedIds((prev) =>
                                e.target.checked ? [...prev, lead.id] : prev.filter((id) => id !== lead.id)
                              );
                            }}
                            className="mt-1 rounded border-slate-300 dark:border-slate-700"
                          />
                        </td>
                      )}

                      {visibleCols.lead_code && (
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <span className="inline-block font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/70 dark:border-slate-700/70 tabular-nums">
                            {lead.lead_code}
                          </span>
                        </td>
                      )}

                      {visibleCols.full_name && (
                        <td className="py-3 px-3 align-top min-w-[190px]">
                          <div className="flex items-start gap-2.5">
                            <div
                              className="h-8 w-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5 relative"
                              style={{ backgroundColor: stageColor }}
                            >
                              {getInitials(lead.full_name)}
                              <span
                                className={`absolute -top-1 -end-1 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                                  isUnread ? 'bg-red-600' : 'bg-emerald-600'
                                }`}
                                aria-hidden="true"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors truncate max-w-[180px]">
                                  {lead.full_name}
                                </span>
                                <span
                                  className={`text-[10px] font-bold shrink-0 ${
                                    isUnread ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                                  }`}
                                >
                                  {isUnread ? (isAr ? 'جديد' : 'New') : isAr ? 'مقروء' : 'Read'}
                                </span>
                              </div>
                              {(companyName || jobTitle) && (
                                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[210px]">
                                  {companyName && (
                                    <span className="inline-flex items-center gap-1 truncate">
                                      <Building2 className="h-3 w-3 shrink-0 text-slate-400" />
                                      <span className="truncate">{companyName}</span>
                                    </span>
                                  )}
                                  {companyName && jobTitle && <span aria-hidden="true">·</span>}
                                  {jobTitle && <span className="truncate">{jobTitle}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      )}

                      {visibleCols.phone && (
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="font-mono font-medium text-slate-800 dark:text-slate-200 tabular-nums"
                                dir="ltr"
                              >
                                {primaryPhone || '—'}
                              </span>
                              {primaryPhone && (
                                <button
                                  type="button"
                                  onClick={(e) => handleCopy(`phone-${lead.id}`, primaryPhone, e)}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-600 transition-all"
                                  title={isAr ? 'نسخ الرقم' : 'Copy phone'}
                                >
                                  {copiedId === `phone-${lead.id}` ? (
                                    <Check className="h-3 w-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>
                            {lead.email && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]" dir="ltr">
                                {lead.email}
                              </div>
                            )}
                          </div>
                        </td>
                      )}

                      {visibleCols.interested_service && (
                        <td className="py-3 px-3 align-top max-w-[260px]">
                          <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {lead.interested_service || '—'}
                          </div>
                          {specsPreview && (
                            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {specsPreview}
                            </div>
                          )}
                        </td>
                      )}

                      {visibleCols.status && (
                        <td className="py-3 px-3 align-top whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <select
                            aria-label={t.status}
                            value={lead.status_id || ''}
                            disabled={updatingLeadId === lead.id}
                            onChange={(e) => handleQuickStatusUpdate(lead.id, e.target.value)}
                            className="rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors disabled:opacity-50"
                            style={{
                              color: stageColor,
                              backgroundColor: `${stageColor}14`,
                              borderColor: `${stageColor}40`,
                            }}
                          >
                            {stages.map((s) => (
                              <option
                                key={s.id}
                                value={s.id}
                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                {isAr ? s.name_ar : s.name_en}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}

                      {visibleCols.assigned && (
                        <td className="py-3 px-3 align-top text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {lead.assigned_employee_name || <span className="text-slate-400">{t.unassigned}</span>}
                        </td>
                      )}

                      {visibleCols.source && (
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <span className={`font-semibold ${getSourceColorClass(lead.source)}`}>
                            {formatSourceLabel(lead.source, isAr)}
                          </span>
                        </td>
                      )}

                      {visibleCols.campaign && (
                        <td className="py-3 px-3 align-top max-w-[170px]">
                          <div className="text-slate-700 dark:text-slate-300 truncate">{lead.campaign_name || '—'}</div>
                          {lead.ad_name && (
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">{lead.ad_name}</div>
                          )}
                        </td>
                      )}

                      {extraCustomCols.map((cf) => (
                        <td key={cf.id} className="py-3 px-3 align-top text-slate-600 dark:text-slate-400 max-w-44 truncate">
                          {typeof customVals[cf.field_key] === 'boolean'
                            ? customVals[cf.field_key]
                              ? isAr
                                ? 'نعم'
                                : 'Yes'
                              : isAr
                                ? 'لا'
                                : 'No'
                            : customVals[cf.field_key] || '—'}
                        </td>
                      ))}

                      {visibleCols.created_at && (
                        <td className="py-3 px-3 align-top font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap" dir="ltr">
                          {formatCairoDateTime(lead.created_at, lang)}
                        </td>
                      )}

                      <td className="py-3 px-3 align-top text-end whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => handleOpenPeek(lead, e)}
                            className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            title={isAr ? 'معاينة سريعة' : 'Quick Peek'}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleToggleLeadRead(lead.id, isUnread, e)}
                            className={`p-1.5 rounded-md border transition-colors ${
                              isUnread
                                ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                                : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 hover:bg-red-100'
                            }`}
                            title={isUnread ? (isAr ? 'تحديد كمقروء' : 'Mark Read') : isAr ? 'تحديد كغير مقروء' : 'Mark Unread'}
                          >
                            {isUnread ? <CheckCheck className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          {primaryPhone && (
                            <a
                              href={`tel:${primaryPhone}`}
                              className="p-1.5 rounded-md text-slate-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title={t.callCustomer}
                            >
                              <Phone className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {whatsappNum && (
                            <a
                              href={`https://wa.me/${whatsappNum}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-md text-slate-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                              title={t.openWhatsApp}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {inboxUrl && (
                            <a
                              href={inboxUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-md text-slate-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                              title={isAr ? 'فتح محادثة Meta Inbox' : 'Open Meta Inbox'}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 sm:px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 text-xs text-slate-600 dark:text-slate-400">
          <div className="tabular-nums">
            {isAr ? `إجمالي السجلات: ${total}` : `Total records: ${total}`} ·{' '}
            {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 sm:p-1.5 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              aria-label="Previous page"
            >
              {isAr ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 sm:p-1.5 flex items-center justify-center disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              aria-label="Next page"
            >
              {isAr ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Smooth Bottom-Sheet (Mobile) / Slide-Over (Desktop) Lead Quick-View rendered in Portal */}
      {peekLead &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-end sm:items-stretch sm:justify-end" role="dialog" aria-modal="true">
            <div
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px] transition-opacity"
              onClick={() => setPeekLead(null)}
              aria-hidden="true"
            />

            <aside
              aria-label={peekLead.full_name}
              className="relative z-10 w-full sm:max-w-lg h-[90dvh] sm:h-full rounded-t-2xl sm:rounded-none bg-white dark:bg-slate-900 border-t sm:border-t-0 sm:border-s border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col crm-sheet-enter overflow-hidden"
            >
              {/* Mobile Sheet Drag Handle */}
              <div className="sm:hidden flex justify-center pt-2.5 pb-1 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
                <span className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden="true" />
              </div>

              {/* Drawer Header */}
              <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div
                      className="h-11 w-11 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-xs"
                      style={{ backgroundColor: peekLead.status_color || '#2563EB' }}
                    >
                      {getInitials(peekLead.full_name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            !peekLead.is_read
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${!peekLead.is_read ? 'bg-red-600' : 'bg-emerald-600'}`}
                            aria-hidden="true"
                          />
                          {!peekLead.is_read
                            ? isAr
                              ? 'جديد · غير مقروء'
                              : 'New · Unread'
                            : isAr
                              ? 'مقروء'
                              : 'Read'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                          {peekLead.lead_code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className={`font-semibold ${getSourceColorClass(peekLead.source)}`}>
                          {formatSourceLabel(peekLead.source, isAr)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatCairoDateTime(peekLead.created_at, lang)}
                        </span>
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 break-words">
                        {peekLead.full_name}
                      </h3>
                      {(peekCompany || peekJobTitle) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                          {peekCompany && (
                            <span className="inline-flex items-center gap-1 font-medium">
                              <Building2 className="h-3.5 w-3.5 text-slate-400" />
                              <span>{peekCompany}</span>
                            </span>
                          )}
                          {peekCompany && peekJobTitle && <span className="text-slate-300 dark:text-slate-700">·</span>}
                          {peekJobTitle && (
                            <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                              <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                              <span>{peekJobTitle}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleLeadRead(peekLead.id, !peekLead.is_read)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 min-h-[38px] text-[11px] font-semibold transition-colors ${
                        !peekLead.is_read
                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                          : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                      }`}
                      title={!peekLead.is_read ? (isAr ? 'تحديد كمقروء' : 'Mark Read') : isAr ? 'تحديد كغير مقروء' : 'Mark Unread'}
                    >
                      {!peekLead.is_read ? <CheckCheck className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      <span className="hidden sm:inline">
                        {!peekLead.is_read ? (isAr ? 'مقروء' : 'Mark Read') : isAr ? 'غير مقروء' : 'Mark Unread'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeekLead(null)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                      title={t.cancel}
                      aria-label={t.cancel}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-5">
              {/* Interactive Stage Selector */}
              <div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  {t.status}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stages.map((stage) => {
                    const active = stage.id === peekLead.status_id;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        disabled={updatingLeadId === peekLead.id}
                        onClick={() => handleQuickStatusUpdate(peekLead.id, stage.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 ${
                          active
                            ? 'text-white border-transparent shadow-xs'
                            : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                        style={active ? { backgroundColor: stage.color } : undefined}
                      >
                        {!active && (
                          <span
                            className="h-2 w-2 rounded-[2px] shrink-0"
                            style={{ backgroundColor: stage.color }}
                            aria-hidden="true"
                          />
                        )}
                        <span>{isAr ? stage.name_ar : stage.name_en}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Highlighted Contact Blocks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.phone}</div>
                    <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5 truncate" dir="ltr">
                      {peekPhone || '—'}
                    </div>
                  </div>
                  {peekPhone && (
                    <button
                      type="button"
                      onClick={() => handleCopy('drawer-phone', peekPhone)}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
                    >
                      {copiedId === 'drawer-phone' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.email}</div>
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 mt-0.5 truncate" dir="ltr">
                      {peekLead.email || '—'}
                    </div>
                  </div>
                  {peekLead.email && (
                    <button
                      type="button"
                      onClick={() => handleCopy('drawer-email', peekLead.email!)}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
                    >
                      {copiedId === 'drawer-email' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Requested Products & Full Specifications */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {isAr ? 'المنتجات المطلوبة والمقاسات' : 'Requested Products & Specs'}
                    </span>
                  </div>
                  {peekSpecs && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          'drawer-specs',
                          `${peekLead.interested_service ? peekLead.interested_service + '\n' : ''}${peekSpecs}`
                        )
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600"
                    >
                      {copiedId === 'drawer-specs' ? (
                        <Check className="h-3 w-3 text-emerald-600" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{copiedId === 'drawer-specs' ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ' : 'Copy'}</span>
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.interestedService}</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {peekLead.interested_service || '—'}
                    </div>
                  </div>
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                      {isAr ? 'الكمية والمقاسات المذكورة' : 'Quantities & Dimensions'}
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-3 text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {peekSpecs || (isAr ? 'لا توجد تفاصيل إضافية' : 'No extra specifications provided')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Campaign & Attribution Summary */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <Megaphone className="h-3.5 w-3.5" />
                    <span>{t.campaign}</span>
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100 text-end">
                    {peekLead.campaign_name || '—'}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{t.adSet}</span>
                  <span className="text-slate-800 dark:text-slate-200 text-end">{peekLead.ad_set_name || '—'}</span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{t.ad}</span>
                  <span className="text-slate-800 dark:text-slate-200 text-end">{peekLead.ad_name || '—'}</span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>{t.assignedEmployee}</span>
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {peekLead.assigned_employee_name || t.unassigned}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{t.createdAt}</span>
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">
                    {formatCairoDateTime(peekLead.created_at, lang)}
                  </span>
                </div>
              </div>
            </div>

            {/* Sticky Drawer Footer Actions */}
            <div className="p-3.5 sm:p-4 pb-safe border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {peekPhone && (
                  <a
                    href={`tel:${peekPhone}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-3 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>{isAr ? 'اتصال' : 'Call'}</span>
                  </a>
                )}
                {peekWhatsappDigits && (
                  <a
                    href={`https://wa.me/${peekWhatsappDigits}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-3 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>WhatsApp</span>
                  </a>
                )}
                {peekLead.email && (
                  <a
                    href={`mailto:${peekLead.email}`}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 min-h-[42px] min-w-[42px] sm:min-h-0 sm:min-w-0 sm:px-2.5 sm:py-2 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title={t.sendEmail}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </a>
                )}
                {peekInboxUrl && (
                  <a
                    href={peekInboxUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 min-h-[42px] min-w-[42px] sm:min-h-0 sm:min-w-0 sm:px-2.5 sm:py-2 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                    title="Meta Inbox"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const target = peekLead;
                  setPeekLead(null);
                  onSelectLead(target.id, target);
                }}
                className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-4 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold text-white transition-colors"
              >
                <span>{isAr ? 'فتح الملف الكامل' : 'Open Full Profile'}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </aside>
        </div>,
          document.body
        )}
    </div>
  );
};
