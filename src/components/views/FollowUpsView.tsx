import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, AlertCircle, Clock, ArrowUpRight } from 'lucide-react';
import { FollowUpTask, Language } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { formatCairoDateTime } from '../../lib/dateFormat';

interface FollowUpsViewProps {
  lang: Language;
  businessId: string;
  onSelectLead: (leadId: string) => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const FollowUpsView: React.FC<FollowUpsViewProps> = ({
  lang,
  businessId,
  onSelectLead,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';

  const [filter, setFilter] = useState<'all' | 'overdue' | 'upcoming' | 'completed'>('all');
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ followUps: FollowUpTask[] }>(
        `/businesses/${businessId}/follow-ups?filter=${filter}`
      );
      setTasks(res.followUps);
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [businessId, filter]);

  const markComplete = async (taskId: string) => {
    try {
      await apiRequest(`/businesses/${businessId}/follow-ups/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
      onNotify(isAr ? 'تم إكمال المتابعة' : 'Follow-up marked completed', 'success');
      fetchTasks();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const nowIso = new Date().toISOString();

  return (
    <div className="space-y-4 crm-animate-enter">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-x-auto no-scrollbar max-w-full">
          {(['all', 'overdue', 'upcoming', 'completed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 min-h-[38px] rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === f
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {f === 'all'
                ? t.filterAll
                : f === 'overdue'
                  ? t.filterOverdue
                  : f === 'upcoming'
                    ? t.filterUpcoming
                    : t.filterCompleted}
            </button>
          ))}
        </div>
        <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {isAr
            ? 'إدارة مهام المتابعة المجدولة. (ملاحظة: لا يتم إرسال تذكيرات واتساب آلية بدون ربط WhatsApp Business API معتمد).'
            : 'Manage scheduled follow-ups. Automated WhatsApp reminders are never claimed without an authorized WhatsApp Business API.'}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400">{t.loading}</div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center">
            <Calendar className="h-8 w-8 mx-auto text-slate-300 dark:text-slate-600" />
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {isAr ? 'لا توجد متابعات ضمن هذا التصنيف' : 'No follow-ups in this view'}
            </p>
          </div>
        ) : (
          tasks.map((task) => {
            const isOverdue = task.status === 'pending' && task.due_at < nowIso;
            return (
              <div key={task.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 crm-cv-auto">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : isOverdue ? (
                      <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                    )}
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{task.title}</span>
                    {isOverdue && (
                      <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0">
                        · {isAr ? 'متأخرة' : 'Overdue'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onSelectLead(task.lead_id || task.lead_code || '')}
                      className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline min-h-[32px]"
                    >
                      <span>{task.lead_name} ({task.lead_code})</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                    <span>·</span>
                    <span className="font-mono tabular-nums" dir="ltr">{formatCairoDateTime(task.due_at, lang)}</span>
                    <span>·</span>
                    <span>{task.assigned_name || t.unassigned}</span>
                  </div>
                  {task.notes && <p className="text-xs text-slate-600 dark:text-slate-300">{task.notes}</p>}
                </div>

                {task.status !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => markComplete(task.id)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 px-3 min-h-[42px] sm:min-h-0 sm:py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 shrink-0"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{t.markComplete}</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
