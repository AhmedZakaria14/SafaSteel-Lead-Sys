export type Language = 'ar' | 'en';
export type ThemeMode = 'light' | 'dark';
export type Role = 'super_admin' | 'business_admin' | 'manager' | 'employee';
export type AccountSlot = 'manager' | 'accountant';

export interface FirestoreAuthorizedAccount {
  email: string;
  displayName?: string;
  accountType: AccountSlot;
  role: 'full_access';
  isOwner?: boolean;
  status: 'active' | 'inactive';
  grantedBy: string;
  updatedAt?: string;
}

export interface UserProfile {
  id: string;
  username?: string | null;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  default_language: Language;
  theme: ThemeMode;
  isOwner?: boolean;
  isPlatformSuperAdmin?: boolean;
}

export interface Business {
  id: string;
  name: string;
  industry: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  timezone: string;
  default_country_code: string;
  is_demo: number;
  round_robin_enabled: number;
  member_role: Role;
  account_slot?: AccountSlot;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  business_id: string;
  key: string;
  name_ar: string;
  name_en: string;
  color: string;
  sort_order: number;
  is_default: number;
  is_converted: number;
  is_lost: number;
}

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'phone'
  | 'email'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'multi_choice'
  | 'long_text';

export interface CustomField {
  id: string;
  business_id: string;
  field_key: string;
  label_ar: string;
  label_en: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: number;
  sort_order: number;
}

export interface Lead {
  id: string;
  lead_code: string;
  business_id: string;
  business_name?: string;
  full_name: string;
  phone?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  interested_service?: string | null;
  source: string;
  status_id: string | null;
  status_key?: string;
  status_name_ar?: string;
  status_name_en?: string;
  status_color?: string;
  assigned_to_user_id?: string | null;
  assigned_employee_name?: string | null;
  assigned_employee_email?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  ad_set_id?: string | null;
  ad_set_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  page_id?: string | null;
  meta_leadgen_id?: string | null;
  external_row_id?: string | null;
  original_answers_json: string;
  custom_values_json: string;
  notes_summary?: string | null;
  last_contact_at?: string | null;
  next_follow_up_at?: string | null;
  is_read?: number;
  read_at?: string | null;
  read_by_user_id?: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface FollowUpTask {
  id: string;
  business_id: string;
  lead_id: string;
  lead_name?: string;
  lead_code?: string;
  phone?: string | null;
  phone_e164?: string | null;
  assigned_to_user_id?: string | null;
  assigned_name?: string | null;
  title: string;
  notes?: string | null;
  due_at: string;
  status: 'pending' | 'completed' | 'cancelled';
  completed_at?: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  business_id: string;
  user_id?: string | null;
  username?: string | null;
  invited_email: string;
  display_name?: string | null;
  full_name?: string | null;
  account_slot?: AccountSlot;
  is_owner?: number | boolean;
  role: Role;
  status: 'active' | 'invited' | 'inactive';
  total_leads?: number;
  converted_leads?: number;
  created_at: string;
}

export interface AnalyticsResponse {
  summary: {
    total: number;
    new: number;
    contacted: number;
    qualified: number;
    followUp: number;
    converted: number;
    lost: number;
    conversionRate: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
    unreadLeads?: number;
    overdueFollowUps: number;
    upcomingFollowUps: number;
  };
  charts: {
    dailyTrend: Array<{ date: string; count: number; converted: number }>;
    weeklyTrend: Array<{ week: string; count: number }>;
    monthlyTrend: Array<{ month: string; count: number }>;
    statusDistribution: Array<{ key: string; nameAr: string; nameEn: string; color: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
    byCampaign: Array<{ name: string; total: number; qualified: number; converted: number; conversionRate: number }>;
    byAdSet: Array<{ name: string; campaign: string; total: number; converted: number }>;
    byAd: Array<{ name: string; campaign: string; total: number; converted: number }>;
    byForm: Array<{ name: string; total: number; converted: number }>;
    byEmployee: Array<{ name: string; total: number; contacted: number; converted: number }>;
    funnel: Array<{ stage: string; count: number }>;
  };
  metaInsightsConnected: boolean;
}

export interface IntegrationRecord {
  id: string;
  business_id: string;
  provider: 'meta' | 'google_sheets' | 'google_docs';
  status: 'disconnected' | 'connected' | 'error' | 'pending_config';
  display_name?: string;
  config: Record<string, any>;
  last_sync_at?: string | null;
  last_error?: string | null;
}

export interface SyncLog {
  id: string;
  direction: string;
  mode: string;
  status: 'success' | 'partial' | 'failed';
  processed_count: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  error_message?: string | null;
  started_at: string;
  finished_at?: string | null;
}

export interface NotificationItem {
  id: string;
  user_id?: string | null;
  type: string;
  title_ar: string;
  title_en: string;
  message_ar: string;
  message_en: string;
  link_path?: string | null;
  is_read: number;
  created_at: string;
}
