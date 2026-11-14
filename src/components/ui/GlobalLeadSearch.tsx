import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2, ArrowUpRight, Building2, Phone, Users } from 'lucide-react';
import { Language, Lead } from '../../types/crm';
import { apiRequest } from '../../lib/api';

interface GlobalLeadSearchProps {
  lang: Language;
  businessId: string;
  onSelectLead: (leadId: string, lead?: Lead) => void;
  onViewAllLeads?: () => void;
  variant?: 'dashboard' | 'topbar';
}

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'L';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function safeCustomValues(jsonStr?: string | null): Record<string, any> {
  if (!jsonStr) return {};
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

export const GlobalLeadSearch: React.FC<GlobalLeadSearchProps> = ({
  lang,
  businessId,
  onSelectLead,
  onViewAllLeads,
  variant = 'dashboard',
}) => {
  const isAr = lang === 'ar';
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Lead[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut Ctrl+K / Cmd+K for topbar search
  useEffect(() => {
    if (variant !== 'topbar') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [variant]);

  // Close on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Live debounced search against real backend API
  useEffect(() => {
    const trimmed = query.trim();
    if (!businessId || !trimmed) {
      setResults([]);
      setTotalMatches(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest<{ leads: Lead[]; total: number }>(
          `/businesses/${businessId}/leads?q=${encodeURIComponent(trimmed)}&page=1&pageSize=8`
        );
        if (cancelled) return;
        setResults(res.leads || []);
        setTotalMatches(res.total || 0);
        setActiveIndex(0);
        setOpen(true);
      } catch {
        if (!cancelled) {
          setResults([]);
          setTotalMatches(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [businessId, query]);

  const handleChooseLead = (lead: Lead) => {
    setOpen(false);
    setQuery('');
    onSelectLead(lead.id, lead);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === 'Escape') setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((idx) => (idx + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((idx) => (idx - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex] || results[0];
      if (target) handleChooseLead(target);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const placeholderText = isAr
    ? 'بحث حي عن أي عميل (الاسم، رقم الهاتف، الشركة، الكود LD-...، المنتج أو الحملة)...'
    : 'Live search any lead (name, phone, company, LD-code, product, or campaign)...';

  const isDashboard = variant === 'dashboard';

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={
          isDashboard
            ? 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 shadow-xs'
            : ''
        }
      >
        {isDashboard && (
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Search className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>{isAr ? 'البحث السريع المباشر عن العملاء' : 'Live Customer Quick Search'}</span>
            </div>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              {isAr ? 'اكتب للوصول الفوري لأي ملف عميل' : 'Type to jump directly to any lead profile'}
            </span>
          </div>
        )}

        <div className="relative flex items-center">
          <Search
            className={`h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 pointer-events-none ${
              isDashboard ? 'start-3.5' : 'start-3'
            }`}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => {
              if (query.trim()) setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) setOpen(false);
            }}
            onKeyDown={handleKeyDown}
            placeholder={isDashboard ? placeholderText : isAr ? 'بحث سريع عن عميل...' : 'Quick find lead...'}
            className={`w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white dark:focus:bg-slate-900 transition-all ${
              isDashboard ? 'ps-10 pe-10 py-2.5 min-h-[44px] text-base sm:text-sm' : 'ps-9 pe-9 py-2 min-h-[40px] sm:min-h-[36px] text-base sm:text-xs'
            }`}
          />
          <div className="absolute end-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {loading && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin me-1.5" />}
            {query && !loading && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setOpen(false);
                }}
                className="rounded p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live Search Dropdown */}
      {open && query.trim().length > 0 && (
        <div className="absolute start-0 end-0 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-40 overflow-hidden crm-animate-enter">
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span className="tabular-nums font-medium">
              {loading
                ? isAr
                  ? 'جاري البحث...'
                  : 'Searching...'
                : isAr
                  ? `تم العثور على ${totalMatches} نتيجة`
                  : `Found ${totalMatches} matches`}
            </span>
            {results.length > 0 && (
              <span className="hidden sm:inline">
                {isAr ? 'استخدم ↑↓ و Enter للفتح المباشر' : 'Use ↑↓ and Enter to open'}
              </span>
            )}
          </div>

          {results.length === 0 && !loading ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {isAr ? `لا توجد نتائج مطابقة لـ "${query.trim()}"` : `No leads found matching "${query.trim()}"`}
            </div>
          ) : (
            <div className="max-h-[60dvh] sm:max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {results.map((lead, idx) => {
                const customVals = safeCustomValues(lead.custom_values_json);
                const company = typeof customVals.company_name === 'string' ? customVals.company_name.trim() : '';
                const stageColor = lead.status_color || '#2563EB';
                const isSelected = idx === activeIndex;
                const isUnread = !lead.is_read;

                return (
                  <button
                    key={lead.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleChooseLead(lead)}
                    className={`w-full text-start px-3.5 sm:px-4 py-3 min-h-[52px] border-s-4 flex items-center justify-between gap-3 transition-colors ${
                      isUnread
                        ? 'border-s-red-600 ' +
                          (isSelected ? 'bg-red-50/90 dark:bg-red-950/35' : 'bg-red-50/50 dark:bg-red-950/15 hover:bg-red-50 dark:hover:bg-red-950/25')
                        : 'border-s-emerald-600 ' +
                          (isSelected ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : 'hover:bg-emerald-50/40 dark:hover:bg-emerald-950/15')
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className="h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 relative"
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {lead.full_name}
                          </span>
                          <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded tabular-nums">
                            {lead.lead_code}
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              isUnread ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {isUnread ? (isAr ? 'جديد' : 'New') : isAr ? 'مقروء' : 'Read'}
                          </span>
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: stageColor }}
                          >
                            {isAr ? lead.status_name_ar : lead.status_name_en}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {(lead.phone_e164 || lead.phone) && (
                            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-700 dark:text-slate-300" dir="ltr">
                              <Phone className="h-3 w-3 text-slate-400" />
                              {lead.phone_e164 || lead.phone}
                            </span>
                          )}
                          {company && (
                            <span className="inline-flex items-center gap-1 truncate max-w-[180px]">
                              <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">{company}</span>
                            </span>
                          )}
                          {lead.interested_service && (
                            <span className="truncate max-w-[220px] text-slate-600 dark:text-slate-300">
                              {lead.interested_service}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <ArrowUpRight className="h-4 w-4 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {totalMatches > results.length && onViewAllLeads && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewAllLeads();
              }}
              className="w-full px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Users className="h-3.5 w-3.5" />
              <span>
                {isAr
                  ? `عرض جميع النتائج (${totalMatches}) في صفحة العملاء`
                  : `View all ${totalMatches} results in Leads`}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
