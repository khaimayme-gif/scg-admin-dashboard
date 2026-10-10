import { createContext, useContext } from 'react';

export type Role = 'superadmin' | 'thai' | 'japan';

// Which pages each role can open. The server enforces the same limits on the data itself; this
// only decides what the menu shows and which page loads first.
export const ROLE_PAGES: Record<Role, string[]> = {
  superadmin: ['dashboard', 'board', 'quotation', 'items-thailand', 'items-japan', 'qr', 'orders', 'templates', 'expenses', 'settings'],
  thai: ['dashboard', 'board', 'orders', 'quotation', 'items-thailand', 'qr'],
  japan: ['dashboard', 'board', 'orders', 'quotation', 'items-japan', 'qr'],
};

export const ROLE_HOME: Record<Role, string> = { superadmin: 'dashboard', thai: 'dashboard', japan: 'dashboard' };

export const ROLE_LABELS: Record<Role, string> = { superadmin: 'Super admin', thai: 'Thai admin', japan: 'Japan admin' };

export const ROLES: Role[] = ['superadmin', 'thai', 'japan'];

export const isRole = (value: unknown): value is Role => value === 'superadmin' || value === 'thai' || value === 'japan';

// The one country a Thai or Japan admin is held to (the server enforces it too); null = no limit.
export const lockedCountryOf = (role: Role): 'Thailand' | 'Japan' | null =>
  role === 'thai' ? 'Thailand' : role === 'japan' ? 'Japan' : null;

export const RoleContext = createContext<Role>('superadmin');

export const useRole = () => useContext(RoleContext);
