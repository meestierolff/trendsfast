export type DashboardApiKeyView = {
  id: string;
  name: string;
  visiblePrefix: string;
  scopes: string[];
  environment: "test" | "live";
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type DashboardApiKeyMutation = {
  key?: DashboardApiKeyView;
  replacedKey?: { id: string; status: "REVOKED" };
};

export function reconcileDashboardKeys(
  current: DashboardApiKeyView[],
  payload: DashboardApiKeyMutation,
): DashboardApiKeyView[] {
  if (!payload.key) return current;
  return [
    payload.key,
    ...current
      .filter((key) => key.id !== payload.key!.id)
      .map((key): DashboardApiKeyView =>
        key.id === payload.replacedKey?.id ? { ...key, status: payload.replacedKey.status } : key,
      ),
  ];
}
