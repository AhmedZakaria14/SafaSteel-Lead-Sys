import React from 'react';
import { BarChart3, Info } from 'lucide-react';
import { AnalyticsResponse, Language } from '../../types/crm';
import { getT } from '../../i18n/translations';

interface CampaignsViewProps {
  lang: Language;
  analytics: AnalyticsResponse | null;
}

export const CampaignsView: React.FC<CampaignsViewProps> = ({ lang, analytics }) => {
  const t = getT(lang);
  const isAr = lang === 'ar';

  if (!analytics || analytics.charts.byCampaign.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <BarChart3 className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
        <p className="mt-3 text-sm text-slate-500">{t.emptyData}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Honest Meta Ads Insights Notice */}
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {isAr ? 'حالة بيانات الإنفاق الإعلاني (Meta Ads Insights): ' : 'Ad Spend Data Status: '}
          </span>
          <span>{t.spendNotConnected}</span>
        </div>
      </div>

      {/* Campaign Attribution Table + Mobile Cards */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.campaignPerformance}</h3>
        </div>

        {/* Mobile Campaign Cards */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {analytics.charts.byCampaign.map((c) => (
            <div key={c.name} className="p-4 space-y-2.5 text-xs crm-cv-auto">
              <div className="font-bold text-sm text-slate-900 dark:text-slate-100 break-words">{c.name}</div>
              <div className="grid grid-cols-4 gap-2 text-center rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800 p-2.5">
                <div>
                  <div className="text-[10px] text-slate-400">{t.totalLeads}</div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">{c.total}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">{t.qualifiedLeads}</div>
                  <div className="font-bold text-teal-600 tabular-nums mt-0.5">{c.qualified}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">{t.convertedLeads}</div>
                  <div className="font-bold text-emerald-600 tabular-nums mt-0.5">{c.converted}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">{t.conversionRate}</div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">{c.conversionRate}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                <th className="py-3 px-4 text-start">{t.campaign}</th>
                <th className="py-3 px-4 text-end">{t.totalLeads}</th>
                <th className="py-3 px-4 text-end">{t.qualifiedLeads}</th>
                <th className="py-3 px-4 text-end">{t.convertedLeads}</th>
                <th className="py-3 px-4 text-end">{t.conversionRate}</th>
                <th className="py-3 px-4 text-end">{t.campaignSpend}</th>
                <th className="py-3 px-4 text-end">{t.costPerLead}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {analytics.charts.byCampaign.map((c) => (
                <tr key={c.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{c.name}</td>
                  <td className="py-3 px-4 text-end tabular-nums">{c.total}</td>
                  <td className="py-3 px-4 text-end tabular-nums text-teal-600">{c.qualified}</td>
                  <td className="py-3 px-4 text-end tabular-nums text-emerald-600 font-semibold">{c.converted}</td>
                  <td className="py-3 px-4 text-end tabular-nums">{c.conversionRate}%</td>
                  <td className="py-3 px-4 text-end text-slate-400">
                    {analytics.metaInsightsConnected ? '—' : isAr ? 'غير متصل' : 'Not connected'}
                  </td>
                  <td className="py-3 px-4 text-end text-slate-400">
                    {analytics.metaInsightsConnected ? '—' : isAr ? 'غير متصل' : 'Not connected'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ad Sets, Ads & Forms Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{t.adSet}</h4>
          <div className="space-y-2.5 text-xs">
            {analytics.charts.byAdSet.map((item) => (
              <div key={item.name} className="flex items-center justify-between py-1.5 border-b last:border-none border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</div>
                  <div className="text-slate-400 truncate">{item.campaign}</div>
                </div>
                <span className="font-mono tabular-nums font-semibold">{item.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{t.ad}</h4>
          <div className="space-y-2.5 text-xs">
            {analytics.charts.byAd.map((item) => (
              <div key={item.name} className="flex items-center justify-between py-1.5 border-b last:border-none border-slate-100 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</div>
                  <div className="text-slate-400 truncate">{item.campaign}</div>
                </div>
                <span className="font-mono tabular-nums font-semibold">{item.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{isAr ? 'نماذج العملاء' : 'Lead Forms'}</h4>
          <div className="space-y-2.5 text-xs">
            {analytics.charts.byForm.map((item) => (
              <div key={item.name} className="flex items-center justify-between py-1.5 border-b last:border-none border-slate-100 dark:border-slate-800">
                <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</span>
                <span className="font-mono tabular-nums font-semibold">{item.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
