export const MASTER_OWNER_EMAIL = 'azeco77@gmail.com';
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const ALSAFA_WORKSPACE_ID = 'alsafa-steel-workspace';

export function isMasterOwnerEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === MASTER_OWNER_EMAIL);
}
