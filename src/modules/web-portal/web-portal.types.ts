export type WebRole = 'system_admin' | 'organization_manager' | 'organization_responder';
export type OrganizationStatus = 'active' | 'suspended';
export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'needs_info';

export interface WebMembership {
  uid: string;
  organizationId: string;
  role: Exclude<WebRole, 'system_admin'>;
  status: 'active' | 'suspended';
}
