// Roller og rettigheder. Bruges af både serveren (håndhæver) og brugerfladen (skjuler knapper).
// Brugerfladen er kun et hjælpemiddel: det er altid serveren, der afgør, hvad en bruger må.

export type Role = 'reader' | 'editor' | 'approver' | 'admin';
export type Permission = 'read' | 'write' | 'decide';

export const ROLES: readonly Role[] = ['reader', 'editor', 'approver', 'admin'];

export const ROLE_LABELS: Record<Role, string> = {
  reader: 'Læser',
  editor: 'Redaktør',
  approver: 'Godkender',
  admin: 'Administrator',
};

// Rettigheder lægges sammen: en bruger med både editor og approver kan både uploade og godkende.
//   read   = se prompts, versioner, log og eksport
//   write  = uploade, arkivere/gendanne og bruge Roboref-integrationen
//   decide = godkende og afvise versioner
const GRANTS: Record<Role, readonly Permission[]> = {
  reader: ['read'],
  editor: ['read', 'write'],
  approver: ['read', 'decide'],
  admin: ['read', 'write', 'decide'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => GRANTS[role].includes(permission));
}
