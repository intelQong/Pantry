import type {
  Member,
  Category,
  Item,
  ItemWithStatus,
  ListEntry,
  Purchase,
  PurchaseWithItem,
  ApiError,
  InsightsResponse,
  AuditLogEntry,
} from "@shared/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message);
    this.name = "ApiRequestError";
  }
}

function options(body?: unknown): RequestInit {
  return {
    method: "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, { ...options(body), method });
  const data = await res.json();
  if (!res.ok) throw new ApiRequestError(res.status, data as ApiError);
  return data as T;
}

export interface RawResult {
  /** The HTTP status, or null when the request never reached a server at all. */
  status: number | null;
  body: unknown;
}

/**
 * Like `request`, but reports the outcome instead of throwing.
 *
 * The offline queue has to tell "the server rejected this" from "there was no
 * server", because the first means drop the operation and the second means keep
 * it and try again later. A thrown error flattens that distinction at exactly
 * the moment it matters, so the queue sends through this instead.
 */
export async function rawRequest(method: string, path: string, body?: unknown): Promise<RawResult> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options(body), method });
  } catch {
    return { status: null, body: null };
  }

  // A 204, or an error page from something in front of the Worker, is not JSON.
  // The status is what the queue acts on, so a missing body is not a failure.
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  return { status: res.status, body: parsed };
}

/* ------------------------------------------------------------------ */
/* Session / Auth                                                      */
/* ------------------------------------------------------------------ */

export interface SessionResponse {
  needsSetup: boolean;
  authenticated: boolean;
  householdName?: string;
  householdId?: string;
  memberId?: string | null;
  members?: Member[];
}

export const getSession = () => request<SessionResponse>("GET", "/session");

export const setup = (
  householdName: string,
  passcode: string,
  memberNames: string[],
  adminPasscode?: string,
) =>
  request<{ ok: true; householdId: string }>("POST", "/setup", {
    householdName,
    passcode,
    memberNames,
    adminPasscode,
  });

export const login = (passcode: string) =>
  request<{ ok: true }>("POST", "/login", { passcode });

/** `adminPasscode` is required only for profiles that have one set. */
export const pickProfile = (memberId: string, adminPasscode?: string) =>
  request<{ ok: true }>("POST", "/profile", { memberId, adminPasscode });

/** Sets, changes, or (with an empty passcode) removes the caller's profile lock. */
export const setProfilePasscode = (passcode: string | null, currentPasscode?: string) =>
  request<{ ok: true; hasAdminPasscode: boolean }>("POST", "/profile/passcode", {
    passcode,
    currentPasscode,
  });

export const getInsights = () => request<InsightsResponse>("GET", "/insights");

export const logout = () => request<{ ok: true }>("POST", "/logout");

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const getItems = () => request<ItemWithStatus[]>("GET", "/items");

export const getToday = () => request<ItemWithStatus[]>("GET", "/today");

export const getCategories = () => request<Category[]>("GET", "/categories");

export const createItem = (data: {
  name: string;
  categoryId?: string | null;
  unit?: string;
  defaultQty?: number;
  brand?: string | null;
  notes?: string | null;
  isStaple?: boolean;
  defaultPrice?: number | null;
  restockIntervalDays?: number;
  intervalLocked?: boolean;
}) => request<Item>("POST", "/items", data);

export const updateItem = (id: string, data: Partial<{
  name: string;
  categoryId: string | null;
  unit: string;
  defaultQty: number;
  brand: string | null;
  notes: string | null;
  isStaple: boolean;
  defaultPrice: number | null;
  restockIntervalDays: number;
  intervalLocked: boolean;
}>) => request<Item>("PATCH", `/items/${id}`, data);

export const deleteItem = (id: string) => request<{ ok: true }>("DELETE", `/items/${id}`);

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

export const getList = () => request<ListEntry[]>("GET", "/list");

export const addToList = (data: {
  itemId?: string;
  customName?: string;
  qty?: number | null;
  note?: string | null;
}) => request<ListEntry>("POST", "/list", data);

export const updateListEntry = (id: string, data: { qty?: number | null; note?: string | null }) =>
  request<ListEntry>("PATCH", `/list/${id}`, data);

export const deleteListEntry = (id: string) => request<{ ok: true }>("DELETE", `/list/${id}`);

export const skipListEntry = (id: string) => request<ListEntry>("POST", `/list/${id}/skip`);

export const buyListEntry = (id: string, data?: { qty?: number; priceTotal?: number | null; note?: string | null }) =>
  request<{ ok: true; purchaseId: string | null; alreadyResolved: boolean }>("POST", `/list/${id}/bought`, data ?? {});

/* ------------------------------------------------------------------ */
/* Purchases                                                           */
/* ------------------------------------------------------------------ */

export const addPurchase = (data: {
  itemId?: string;
  itemName?: string;
  /** Epoch seconds. Clamped to never future, never >30 days back. */
  purchasedAt?: number;
  qty?: number;
  unit?: string;
  priceTotal?: number | null;
  note?: string | null;
}) => request<Purchase>("POST", "/purchases", data);

export const getItemPurchases = (itemId: string) =>
  request<Purchase[]>("GET", `/items/${itemId}/purchases`);

/** Everything the household has bought, newest first. Pass { all: true } to include utilities. */
export const getPurchases = (options?: { all?: boolean }) => {
  const query = options?.all ? "?all=1" : "";
  return request<PurchaseWithItem[]>("GET", `/purchases${query}`);
};

/**
 * Corrects quantities and prices on purchases already logged.
 *
 * Batched because splitting a receipt total rewrites a whole day at once, and
 * the server applies the batch as one transaction.
 */
export const updatePurchases = (
  updates: Array<{ id: string; qty?: number; priceTotal?: number | null }>,
) => request<{ ok: true; updated: number }>("PATCH", "/purchases", { updates });

export const deletePurchase = (id: string) =>
  request<{ ok: true }>("DELETE", `/purchases/${id}`);

/* ------------------------------------------------------------------ */
/* Push                                                                */
/* ------------------------------------------------------------------ */

export const getVapidKey = () => request<{ key: string }>("GET", "/push/key");

export const subscribePush = (subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}) => request<{ ok: true }>("POST", "/push/subscribe", subscription);

export const testPush = () =>
  request<{ ok: true; sent: number; failed: number }>("POST", "/push/test");

/* ------------------------------------------------------------------ */
/* Audit Log                                                           */
/* ------------------------------------------------------------------ */

export const getAuditLog = (limit?: number) => {
  const query = limit ? `?limit=${limit}` : "";
  return request<AuditLogEntry[]>("GET", `/audit-log${query}`);
};

export { ApiRequestError };
