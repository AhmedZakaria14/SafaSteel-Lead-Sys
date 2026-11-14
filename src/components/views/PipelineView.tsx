import React, { useEffect, useState } from 'react';
import { Settings2, Plus, Trash2, ArrowUp, ArrowDown, Phone } from 'lucide-react';
import { Language, Lead, PipelineStage, Role } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';

interface PipelineViewProps {
  lang: Language;
  businessId: string;
  userRole: Role;
  stages: PipelineStage[];
  onSelectLead: (leadId: string, lead?: Lead) => void;
  onStagesChanged: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const PipelineView: React.FC<PipelineViewProps> = ({
  lang,
  businessId,
  userRole,
  stages,
  onSelectLead,
  onStagesChanged,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showStageEditor, setShowStageEditor] = useState(false);

  const [newNameAr, setNewNameAr] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newColor, setNewColor] = useState('#2563EB');

  const fetchBoardLeads = async () => {
    try {
      const res = await apiRequest<{ leads: Lead[] }>(`/businesses/${businessId}/leads?pageSize=100`);
      setLeads(res.leads);
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  useEffect(() => {
    fetchBoardLeads();
  }, [businessId]);

  const moveLeadToStage = async (leadId: string, toStatusId: string) => {
    const prevLeads = [...leads];
    const targetLead = leads.find((l) => l.id === leadId);
    const targetStage = stages.find((s) => s.id === toStatusId);
    setLeads((curr) =>
      curr.map((l) =>
        l.id === leadId
          ? {
              ...l,
              status_id: toStatusId,
              status_name_ar: targetStage?.name_ar,
              status_name_en: targetStage?.name_en,
              status_color: targetStage?.color,
              is_read: 1,
            }
          : l
      )
    );
    try {
      await apiRequest(`/businesses/${businessId}/leads/${encodeURIComponent(leadId)}/status`, {
        method: 'POST',
        body: JSON.stringify({
          statusId: toStatusId,
          leadCode: targetLead?.lead_code,
          externalRowId: targetLead?.external_row_id,
          phone: targetLead?.phone_e164 || targetLead?.phone,
        }),
      });
      onNotify(isAr ? 'تم نقل العميل وتحديث سجل النشاط' : 'Lead moved and activity recorded', 'success');
    } catch (err: any) {
      setLeads(prevLeads);
      onNotify(err.message, 'error');
    }
  };

  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNameAr.trim() || !newNameEn.trim()) return;
    try {
      await apiRequest(`/businesses/${businessId}/stages`, {
        method: 'POST',
        body: JSON.stringify({ nameAr: newNameAr.trim(), nameEn: newNameEn.trim(), color: newColor }),
      });
      setNewNameAr('');
      setNewNameEn('');
      onStagesChanged();
      onNotify(isAr ? 'تمت إضافة المرحلة' : 'Stage created', 'success');
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleRenameStage = async (stageId: string, nameAr: string, nameEn: string, color: string) => {
    try {
      await apiRequest(`/businesses/${businessId}/stages/${stageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nameAr, nameEn, color }),
      });
      onStagesChanged();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    try {
      await apiRequest(`/businesses/${businessId}/stages/${stageId}`, { method: 'DELETE' });
      onStagesChanged();
      onNotify(isAr ? 'تم حذف المرحلة' : 'Stage deleted', 'success');
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleReorder = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const copy = [...stages];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    try {
      await apiRequest(`/businesses/${businessId}/stages/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: copy.map((s) => s.id) }),
      });
      onStagesChanged();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const [activeMobileStageId, setActiveMobileStageId] = useState<string>('');

  const displayedMobileStages =
    activeMobileStageId && stages.some((s) => s.id === activeMobileStageId)
      ? stages.filter((s) => s.id === activeMobileStageId)
      : stages;

  return (
    <div className="space-y-4 crm-animate-enter">
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 sm:px-4 py-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isAr ? 'اسحب البطاقة أو استخدم القائمة لاختيار المرحلة' : t.dragHint}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowStageEditor((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 min-h-[40px] sm:min-h-0 sm:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t.manageStages}</span>
          </button>
        )}
      </div>

      {/* Mobile Stage Quick-Filter Switcher */}
      {stages.length > 0 && (
        <div className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onClick={() => setActiveMobileStageId('')}
            className={`px-3 min-h-[38px] rounded-lg text-xs font-medium border whitespace-nowrap ${
              activeMobileStageId === ''
                ? 'bg-[#0F1E3D] dark:bg-blue-600 text-white border-transparent'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.allStatuses}
          </button>
          {stages.map((st) => {
            const active = activeMobileStageId === st.id;
            const count = leads.filter((l) => l.status_id === st.id).length;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setActiveMobileStageId(active ? '' : st.id)}
                className={`inline-flex items-center gap-1.5 px-3 min-h-[38px] rounded-lg text-xs font-medium border whitespace-nowrap ${
                  active
                    ? 'font-semibold shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
                style={
                  active
                    ? { color: st.color, backgroundColor: `${st.color}16`, borderColor: `${st.color}55` }
                    : undefined
                }
              >
                <span className="h-2 w-2 rounded-[2px] shrink-0" style={{ backgroundColor: st.color }} />
                <span>{isAr ? st.name_ar : st.name_en}</span>
                <span className="font-mono text-[11px] opacity-75 tabular-nums">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {showStageEditor && isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.manageStages}</h3>
          <div className="space-y-2">
            {stages.map((st, idx) => (
              <div key={st.id} className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                <input
                  type="color"
                  defaultValue={st.color}
                  onBlur={(e) => handleRenameStage(st.id, st.name_ar, st.name_en, e.target.value)}
                  className="h-8 w-9 rounded border border-slate-200 cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  defaultValue={st.name_ar}
                  onBlur={(e) => handleRenameStage(st.id, e.target.value, st.name_en, st.color)}
                  className="min-w-[120px] flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-base sm:text-xs"
                />
                <input
                  type="text"
                  defaultValue={st.name_en}
                  onBlur={(e) => handleRenameStage(st.id, st.name_ar, e.target.value, st.color)}
                  className="min-w-[120px] flex-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-base sm:text-xs"
                />
                <div className="flex items-center gap-1 ms-auto">
                  <button type="button" onClick={() => handleReorder(idx, -1)} className="p-2 text-slate-500 hover:text-slate-800">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => handleReorder(idx, 1)} className="p-2 text-slate-500 hover:text-slate-800">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteStage(st.id)}
                    className="p-2 text-red-500 hover:text-red-700"
                    title={t.delete}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddStage} className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-10 w-12 rounded border border-slate-200 shrink-0"
              />
              <input
                type="text"
                value={newNameAr}
                onChange={(e) => setNewNameAr(e.target.value)}
                placeholder={isAr ? 'الاسم بالعربية' : 'Arabic name'}
                className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-xs"
              />
            </div>
            <input
              type="text"
              value={newNameEn}
              onChange={(e) => setNewNameEn(e.target.value)}
              placeholder={isAr ? 'الاسم بالإنجليزية' : 'English name'}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-medium text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.addStage}</span>
            </button>
          </form>
        </div>
      )}

      {/* Kanban Columns (Snap-Scrolling on Mobile; Multi-Column Board on Desktop) */}
      <div
        className={`flex gap-3 sm:gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none ${
          activeMobileStageId ? 'flex-col md:flex-row' : ''
        }`}
      >
        {(typeof window !== 'undefined' && activeMobileStageId ? displayedMobileStages : stages).map((stage) => {
          const stageLeads = leads.filter((l) => l.status_id === stage.id);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingId) {
                  moveLeadToStage(draggingId, stage.id);
                  setDraggingId(null);
                }
              }}
              className={`${
                activeMobileStageId ? 'w-full md:w-72' : 'w-[84vw] sm:w-72 snap-center'
              } shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60 flex flex-col max-h-[70dvh] sm:max-h-[72vh]`}
            >
              <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-t-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-xs shrink-0" style={{ backgroundColor: stage.color }} />
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {isAr ? stage.name_ar : stage.name_en}
                  </span>
                </div>
                <span className="text-xs font-mono font-medium text-slate-500 tabular-nums">{stageLeads.length}</span>
              </div>

              <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                {stageLeads.map((lead) => {
                  const isUnread = !lead.is_read;
                  return (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDraggingId(lead.id)}
                      onClick={() => onSelectLead(lead.id, lead)}
                      className={`rounded-lg border border-s-4 p-3 cursor-grab active:cursor-grabbing transition-colors crm-cv-auto ${
                        isUnread
                          ? 'border-red-200 dark:border-red-900/70 border-s-red-600 bg-red-50/75 dark:bg-red-950/25 hover:border-red-400'
                          : 'border-emerald-200/80 dark:border-emerald-900/50 border-s-emerald-600 bg-white dark:bg-slate-900 hover:border-emerald-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${isUnread ? 'bg-red-600 animate-pulse' : 'bg-emerald-600'}`}
                            aria-hidden="true"
                          />
                          <span className="font-mono text-slate-600 dark:text-slate-300">{lead.lead_code}</span>
                          <span
                            className={`text-[10px] font-bold ${
                              isUnread ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {isUnread ? (isAr ? 'جديد' : 'New') : isAr ? 'مقروء' : 'Read'}
                          </span>
                        </div>
                        <span className="truncate">{lead.source}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {lead.full_name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {lead.interested_service || lead.campaign_name || '—'}
                      </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
                      <span className="text-slate-500 truncate">
                        {lead.assigned_employee_name || t.unassigned}
                      </span>
                      <select
                        value={lead.status_id || ''}
                        onChange={(e) => moveLeadToStage(lead.id, e.target.value)}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 min-h-[34px] sm:min-h-0 sm:py-0.5 text-xs sm:text-[11px]"
                        aria-label="Move lead stage"
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {isAr ? s.name_ar : s.name_en}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
