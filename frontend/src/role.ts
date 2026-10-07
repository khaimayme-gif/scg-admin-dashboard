import { createContext, useContext } from 'react';

export type Role = 'superadmin' | 'japan';

// Which pages each role can open. The server enforces the same limits on the data itself; this
// only decides what the menu shows and which page loads first.
export const ROLE_PAGES: Record<Role, string[]> = {
  superadmin: ['dashboard', 'board', 'quotation', 'items', 'qr', 'orders', 'templates', 'expenses', 'settings'],
  japan: ['board', 'orders', 'quotation', 'qr'],
};

export const ROLE_HOME: Record<Role, string> = { superadmin: 'dashboard', japan: 'board' };

export const ROLE_LABELS: Record<Role, string> = { superadmin: 'Super admin', japan: 'Japan admin' };

export const RoleContext = createContext<Role>('superadmin');

export const useRole = () => useContext(RoleContext);
