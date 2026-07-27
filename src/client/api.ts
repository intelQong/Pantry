import type {
  Member,
  Category,
  Item,
  ItemWithStatus,
  ListEntry,
  Purchase,
  ApiError,
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new ApiRequestError(res.status, data as ApiError);
  return data as T;
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

export const setup = (householdName: string, passcode: string, memberNames: string[]) =>
  request<{ ok: true; householdId: string }>("POST", "/setup", { householdName, passcode, memberNames });

export const login = (passcode: string) =>
  request<{ ok: true }>("POST", "/login", { passcode });

export const pickProfile = (memberId: string) =>
  request<{ ok: true }>("POST", "/profile", { memberId });

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
  itemId: string;
  qty?: number;
  unit?: string;
  priceTotal?: number | null;
  note?: string | null;
}) => request<Purchase>("POST", "/purchases", data);

export const getItemPurchases = (itemId: string) =>
  request<Purchase[]>("GET", `/items/${itemId}/purchases`);

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

export { ApiRequestError };
