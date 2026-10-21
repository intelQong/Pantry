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
  /** Superadmin profiles require a second passcode to switch into. */
  isAdmin: boolean;
  /** True once that second passcode has actually been set. */
  hasAdminPasscode: boolean;
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
  /** What it usually costs, in minor units (poisha). null = never recorded. */
  defaultPrice: number | null;
  restockIntervalDays: number;
  intervalLocked: boolean;
  lastPurchasedAt: number | null;
  archived: boolean;
  /**
   * True for anything in the Utilities category -- gas, electricity, wifi.
   *
   * They are ordinary items so they can ride the purchase loop, the restock
   * learner and the push digest, but they are not groceries: they must not
   * appear on Today, in the pantry browse, or in the shop list's quick-add.
   * The server decides this once so no screen has to re-derive it from
   * category names.
   */
  isUtility: boolean;
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
  /**
   * The id the adding client generated, when it had one. Set only for entries
   * that went through the offline queue; it is what lets a retried add find the
   * row a lost response already created, and what lets the client match a
   * queued add to the entry it became.
   */
  clientId: string | null;
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

/** A purchase carrying what was bought, for the shopping history's flat list. */
export interface PurchaseWithItem extends Purchase {
  itemName: string;
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

/* -------------------------------------------------------------------------- */
/* Insights                                                                    */
/* -------------------------------------------------------------------------- */

/** How much of one item the household actually gets through. */
export interface ItemUsage {
  itemId: string;
  name: string;
  unit: string;
  categoryId: string | null;
  /** Number of times bought. */
  purchases: number;
  /** Total quantity bought, in the item's own unit. */
  totalQty: number;
  /** Total recorded spend in minor units; 0 when no purchase carried a price. */
  totalSpend: number;
  firstPurchaseAt: number;
  lastPurchaseAt: number;
  /** Quantity per 30 days, once there is enough history to divide by. */
  qtyPerMonth: number | null;
  /** Median days between purchases; null until there are 3 purchases. */
  medianGapDays: number | null;
}

export interface CategorySpend {
  categoryId: string | null;
  name: string;
  color: string;
  spend: number;
  purchases: number;
}

/** One bar in the spend chart, at whichever cadence is selected. */
export interface SpendBucket {
  /** 'YYYY-MM' for months, or the Monday's 'YYYY-MM-DD' for weeks. */
  key: string;
  /** Short label for the axis, e.g. 'Jul' or '21 Jul'. */
  label: string;
  spend: number;
  purchases: number;
}

export interface InsightsResponse {
  /** Whether any purchase has ever been recorded. */
  hasData: boolean;
  totalPurchases: number;
  /** Purchases that carried a price; the rest are excluded from spend totals. */
  pricedPurchases: number;
  totalSpend: number;
  spendLast30: number;
  purchasesLast30: number;
  byCategory: CategorySpend[];
  byMonth: SpendBucket[];
  byWeek: SpendBucket[];
  byDay: SpendBucket[];
  topItems: ItemUsage[];
}

/* -------------------------------------------------------------------------- */
/* Audit Log                                                                  */
/* -------------------------------------------------------------------------- */

export interface AuditLogEntry {
  id: string;
  householdId: string;
  memberId: string | null;
  memberName: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details: string | null;
  createdAt: number;
}

