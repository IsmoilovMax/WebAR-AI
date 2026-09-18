export const ROLES = ["owner", "manager", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "camera:read",
  "camera:write",
  "event:read",
  "event:acknowledge",
  "event:label",
  "alert:read",
  "alert:write",
  "analytics:read",
  "user:read",
  "user:write",
  "billing:read",
  "billing:write",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OPERATOR_PERMISSIONS: Permission[] = [
  "camera:read",
  "event:read",
  "event:acknowledge",
  "event:label",
  "alert:read",
  "analytics:read",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...OPERATOR_PERMISSIONS,
  "camera:write",
  "alert:write",
  "user:read",
  "audit:read",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ["camera:read", "event:read", "analytics:read", "alert:read"],
  operator: OPERATOR_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  owner: [...PERMISSIONS],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "소유자",
  manager: "관리자",
  operator: "운영자",
  viewer: "시청자",
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** Obuna kamera soniga bog'langan - billing shu yerdan hisoblanadi. */
  cameraLimit: number;
  plan: "trial" | "starter" | "business" | "enterprise";
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: Role;
}
