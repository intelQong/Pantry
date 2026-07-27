// Types shared between the Worker and the React client. Keep this file free of
// any runtime imports from either side so both bundles can use it.

export type RestockStatus = "ok" | "due_soon" | "due" | "overdue";
export type ListStatus = "pending" | "bought" | "skipped";
export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

export interface Member {
  id: string;
  name: string;
  accentColor: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Item {
  id: string;
  name: string;
  categoryId: string | null;
  unit: string;
  defaultQty: number;
  brand: string | null;
  notes: string | null;
  isStaple: boolean;
  restockIntervalDays: number;
  intervalLocked: boolean;
  lastPurchasedAt: number | null;
  archived: boolean;
}

/** An item with its live restock state, as computed by the restock engine. */
export interface ItemWithStatus extends Item {
  status: RestockStatus;
  /** Whole days since the last purchase; null if never purchased. */
  daysSince: number | null;
  /** Days until due. Negative means overdue by that many days. */
  daysUntilDue: number | null;
  /** True when this item already sits on the pending list, so we stop nagging. */
  onList: boolean;
}

export interface ListEntry {
  id: string;
  itemId: string | null;
  customName: string | null;
  /** Resolved display name: the item's name, or the free text that was typed. */
  displayName: string;
  categoryId: string | null;
  qty: number | null;
  note: string | null;
  addedBy: string | null;
  addedAt: number;
  status: ListStatus;
}

export interface Purchase {
  id: string;
  itemId: string;
  purchasedAt: number;
  qty: number;
  unit: string;
  /** Minor currency units (poisha). null = bought but price not recorded. */
  priceTotal: number | null;
  boughtBy: string | null;
  note: string | null;
}

export interface MemberSettings {
  /** ISO weekday numbers, 1=Mon..7=Sun. */
  notifyDays: number[];
  notifyHour: number;
  timezone: string;
  leadDays: number;
  quietStart: number;
  quietEnd: number;
  notifyOnPartnerAdd: boolean;
}

export interface HouseholdSettings {
  currency: string;
  theme: Theme;
  accent: string;
  density: Density;
}

export interface SessionInfo {
  householdId: string;
  memberId: string | null;
}

/** Uniform error body returned by every failing API route. */
export interface ApiError {
  error: string;
  message: string;
}
