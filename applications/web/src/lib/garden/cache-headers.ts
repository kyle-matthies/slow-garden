export const PRIVATE_NO_STORE = "private, no-store";

export function applyPrivateCacheHeaders<T extends { headers: Headers }>(
  response: T,
): T {
  response.headers.set("Cache-Control", PRIVATE_NO_STORE);
  return response;
}
