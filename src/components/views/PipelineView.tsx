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
  onSelectLead: (leadId: string) => void;
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
            }
          : l
      )
    );
    try {
      await apiRequest(`/businesses/${businessId}/leads/${leadId}/status`, {
        method: 'POST',
        body: JSON.stringify({ statusId: toStatusId }),
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t.dragHint}</p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowStageEditor((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t.manageStages}</span>
          </button>
        )}
      </div>

      {showStageEditor && isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.manageStages}</h3>
          <div className="space-y-2">
            {stages.map((st, idx) => (
              <div key={st.id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                <input
                  type="color"
                  defaultValue={st.color}
                  onBlur={(e) => handleRenameStage(st.id, st.name_ar, st.name_en, e.target.value)}
                  className="h-7 w-9 rounded border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  defaultValue={st.name_ar}
                  onBlur={(e) => handleRenameStage(st.id, e.target.value, st.name_en, st.color)}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs"
                />
                <input
                  type="text"
                  defaultValue={st.name_en}
                  onBlur={(e) => handleRenameStage(st.id, st.name_ar, e.target.value, st.color)}
                  className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs"
                />
                <button type="button" onClick={() => handleReorder(idx, -1)} className="p-1 text-slate-500 hover:text-slate-800">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => handleReorder(idx, 1)} className="p-1 text-slate-500 hover:text-slate-800">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteStage(st.id)}
                  className="p-1 text-red-500 hover:text-red-700 ms-auto"
                  title={t.delete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddStage} className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-8 w-10 rounded border border-slate-200"
            />
            <input
              type="text"
              value={newNameAr}
              onChange={(e) => setNewNameAr(e.target.value)}
              placeholder={isAr ? 'الاسم بالعربية' : 'Arabic name'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            />
            <input
              type="text"
              value={newNameEn}
              onChange={(e) => setNewNameEn(e.target.value)}
              placeholder={isAr ? 'الاسم بالإنجليزية' : 'English name'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t.addStage}</span>
            </button>
          </form>
        </div>
      )}

      {/* Kanban Columns */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => {
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
              className="w-72 shrink-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60 flex flex-col max-h-[72vh]"
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
                {stageLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={() => setDraggingId(lead.id)}
                    onClick={() => onSelectLead(lead.id)}
                    className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 cursor-grab active:cursor-grabbing hover:border-blue-400 transition-colors"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono">{lead.lead_code}</span>
                      <span>{lead.source}</span>
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
                        className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-1.5 py-0.5 text-[11px]"
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
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
