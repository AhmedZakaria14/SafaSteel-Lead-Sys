import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Users, UserPlus, CheckCircle2, TrendingUp, AlertCircle, Plus, ArrowUpRight } from 'lucide-react';
import { AnalyticsResponse, Language, Lead } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { GlobalLeadSearch } from '../ui/GlobalLeadSearch';

interface DashboardViewProps {
  lang: Language;
  businessId: string;
  analytics: AnalyticsResponse | null;
  loading: boolean;
  onSelectLead: (leadId: string, lead?: Lead) => void;
  onNavigateLeads: () => void;
  onNavigateFollowUps: () => void;
  onAddLead: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  lang,
  businessId,
  analytics,
  loading,
  onSelectLead,
  onNavigateLeads,
  onNavigateFollowUps,
  onAddLead,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const [trendMode, setTrendMode] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-80 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="h-80 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        </div>
      </div>
    );
  }

  if (!analytics || analytics.summary.total === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          <Users className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t.noLeadsTitle}</h3>
        <p className="mt-2 max-w-md mx-auto text-sm text-slate-500 dark:text-slate-400">{t.noLeadsDesc}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAddLead}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>{t.addLead}</span>
          </button>
        </div>
      </div>
    );
  }

  const s = analytics.summary;

  const unreadSuffix =
    typeof s.unreadLeads === 'number'
      ? ` · ${isAr ? `غير مقروء: ${s.unreadLeads}` : `Unread: ${s.unreadLeads}`}`
      : '';

  const primaryKpis = [
    { label: t.totalLeads, value: s.total, sub: `${t.receivedToday}: ${s.today} · ${t.receivedWeek}: ${s.thisWeek}`, icon: Users, tone: 'text-[#0F1E3D] dark:text-blue-400' },
    { label: t.newLeads, value: s.new, sub: `${t.receivedMonth}: ${s.thisMonth}${unreadSuffix}`, icon: UserPlus, tone: typeof s.unreadLeads === 'number' && s.unreadLeads > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400' },
    { label: t.qualifiedLeads, value: s.qualified, sub: `${t.contactedLeads}: ${s.contacted}`, icon: TrendingUp, tone: 'text-teal-600 dark:text-teal-400' },
    { label: t.convertedLeads, value: s.converted, sub: `${t.conversionRate}: ${s.conversionRate}%`, icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
  ];

  const secondaryKpis = [
    { label: t.followUpLeads, value: s.followUp },
    { label: t.lostLeads, value: s.lost },
    { label: t.upcomingFollowUps, value: s.upcomingFollowUps },
    { label: t.overdueFollowUps, value: s.overdueFollowUps, alert: s.overdueFollowUps > 0 },
  ];

  const trendData =
    trendMode === 'daily'
      ? analytics.charts.dailyTrend.map((d) => ({ label: d.date, count: d.count }))
      : trendMode === 'weekly'
        ? analytics.charts.weeklyTrend.map((d) => ({ label: d.week, count: d.count }))
        : analytics.charts.monthlyTrend.map((d) => ({ label: d.month, count: d.count }));

  return (
    <div className="space-y-4 sm:space-y-6 crm-animate-enter">
      {/* Live Global Lead Search Bar in Dashboard */}
      {businessId && (
        <GlobalLeadSearch
          lang={lang}
          businessId={businessId}
          variant="dashboard"
          onSelectLead={onSelectLead}
          onViewAllLeads={onNavigateLeads}
        />
      )}

      {/* Primary KPI Row (2 columns on phones for compact above-the-fold layout) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {primaryKpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                  {kpi.label}
                </span>
                <Icon className={`h-4 w-4 shrink-0 ${kpi.tone}`} />
              </div>
              <div className="mt-1.5 sm:mt-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {kpi.value.toLocaleString()}
              </div>
              <div className="mt-1 sm:mt-1.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 tabular-nums line-clamp-1">
                {kpi.sub}
              </div>
            </div>
          );
        })}
      </div>

      {/* Secondary Operational Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {secondaryKpis.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.label === t.upcomingFollowUps || item.label === t.overdueFollowUps ? onNavigateFollowUps : onNavigateLeads}
            className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 sm:px-4 py-3 min-h-[60px] text-start hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
          >
            <div className="min-w-0">
              <div className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">{item.label}</div>
              <div
                className={`mt-1 text-base sm:text-lg font-semibold tabular-nums ${
                  item.alert ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {item.value.toLocaleString()}
              </div>
            </div>
            {item.alert ? (
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-slate-400 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Acquisition Trend & Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 crm-cv-auto">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {trendMode === 'daily' ? t.dailyAcquisition : trendMode === 'weekly' ? t.weeklyTrends : t.monthlyTrends}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'محسوب مباشرة من سجلات قاعدة البيانات' : 'Calculated directly from persisted database records'}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['daily', 'weekly', 'monthly'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTrendMode(mode)}
                  className={`px-3 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    trendMode === mode
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {mode === 'daily' ? (isAr ? 'يومي' : 'Daily') : mode === 'weekly' ? (isAr ? 'أسبوعي' : 'Weekly') : isAr ? 'شهري' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>

          <div className="h-52 sm:h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748B' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#2563EB" strokeWidth={2} fill="url(#leadAreaGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3 sm:mb-4">{t.statusDistribution}</h3>
          <div className="h-44 sm:h-48 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={analytics.charts.statusDistribution}
                  dataKey="count"
                  nameKey={isAr ? 'nameAr' : 'nameEn'}
                  cx="50%"
                  cy="50%"
                  innerRadius={44}
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {analytics.charts.statusDistribution.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 space-y-1.5">
            {analytics.charts.statusDistribution.map((item) => (
              <div key={item.key} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-xs shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate text-slate-700 dark:text-slate-300">{isAr ? item.nameAr : item.nameEn}</span>
                </div>
                <span className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel, Campaign Performance, Employee Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 crm-cv-auto">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">{t.conversionFunnel}</h3>
          <div className="space-y-3">
            {analytics.charts.funnel.map((step) => {
              const pct = s.total > 0 ? Math.round((step.count / s.total) * 100) : 0;
              return (
                <div key={step.stage}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{step.stage}</span>
                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                      {step.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-[#0F1E3D] dark:bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">{t.leadsBySource}</h4>
            <div className="space-y-2">
              {analytics.charts.bySource.map((src) => (
                <div key={src.source} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">{src.source}</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100 tabular-nums">{src.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">{t.campaignPerformance}</h3>
          <div className="h-56 sm:h-60 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.charts.byCampaign.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" strokeOpacity={0.4} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 10, fill: '#64748B' }} />
                <Tooltip />
                <Bar dataKey="total" fill="#2563EB" radius={[0, 4, 4, 0]} />
                <Bar dataKey="converted" fill="#059669" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">{t.employeePerformance}</h3>
          <div className="space-y-3">
            {analytics.charts.byEmployee.map((emp) => {
              const rate = emp.total > 0 ? Math.round((emp.converted / emp.total) * 100) : 0;
              return (
                <div
                  key={emp.name}
                  className="flex items-center justify-between py-2 border-b last:border-none border-slate-100 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{emp.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {isAr ? 'تواصل:' : 'Contacted:'} {emp.contacted} / {emp.total}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {emp.converted} {isAr ? 'تحويل' : 'conv.'}
                    </div>
                    <div className="text-xs text-slate-400 tabular-nums">{rate}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
