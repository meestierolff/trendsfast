export function isSameOriginDashboardRedirect(origin: URL, location: string | null): boolean {
  if (!location) return false;
  try {
    const redirect = new URL(location, origin);
    return (
      redirect.origin === origin.origin &&
      redirect.pathname === "/login" &&
      redirect.searchParams.get("next") === "/dashboard"
    );
  } catch {
    return false;
  }
}
