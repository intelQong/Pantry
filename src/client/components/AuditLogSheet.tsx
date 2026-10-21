import { useState, useEffect, useCallback } from "react";
import type { AuditLogEntry, Member } from "@shared/types";
import * as api from "../api";
import { BottomSheet } from "./BottomSheet";
import { Icon } from "./Icon";
import { Avatar } from "./Avatar";

function formatTimestamp(epochSecs: number): string {
  const d = new Date(epochSecs * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return `Today, ${timeStr}`;
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${timeStr}`;
}

function getActionBadge(action: string) {
  switch (action) {
    case "delete_purchase":
      return {
        label: "Deleted Purchase",
        classes: "bg-danger-bg text-danger border-danger/20",
      };
    case "delete_item":
      return {
        label: "Deleted Item",
        classes: "bg-amber-500/10 text-amber-500 border-amber-500/20",
      };
    case "delete_list_entry":
      return {
        label: "Removed from List",
        classes: "bg-surface-raised text-text-secondary border-border",
      };
    default:
      return {
        label: action.replace(/_/g, " "),
        classes: "bg-surface-raised text-text-secondary border-border",
      };
  }
}

export function AuditLogSheet({
  open,
  onClose,
  members = [],
}: {
  open: boolean;
  onClose: () => void;
  members?: Member[];
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAuditLog(150);
      setLogs(data);
    } catch {
      setError("Failed to load activity logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open, fetchLogs]);

  return (
    <BottomSheet open={open} onClose={onClose} title="Activity & System Log">
      <div className="space-y-4">
        {/* Banner about undeletable audit trail */}
        <div className="rounded-xl border border-accent-400/30 bg-accent-400/10 p-3.5 flex items-start gap-3">
          <div className="p-1 rounded-lg bg-accent-400/20 text-accent-text shrink-0 mt-0.5">
            <Icon name="shield" className="w-4 h-4" />
          </div>
          <div className="text-xs space-y-1">
            <p className="font-semibold text-text flex items-center gap-1.5">
              <span>Immutable Audit Trail</span>
              <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-bold bg-accent-500 text-white tracking-wide uppercase">
                Undeletable
              </span>
            </p>
            <p className="text-text-secondary leading-relaxed">
              Every deletion of purchases, items, and records across the household is logged here.
              These logs cannot be altered or deleted by any user or device.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium text-text-tertiary">
            {logs.length} {logs.length === 1 ? "entry" : "entries"} recorded
          </span>
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1 text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
          >
            <Icon name="refresh" className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>

        {loading && logs.length === 0 ? (
          <div className="py-12 text-center text-text-tertiary text-sm">
            Loading activity log…
          </div>
        ) : error ? (
          <div className="py-8 text-center text-danger text-sm">
            {error}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-surface-sunken text-text-tertiary">
              <Icon name="shield" className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-text">No deletions yet</p>
            <p className="text-xs text-text-tertiary max-w-xs mx-auto">
              Whenever a household member deletes a purchase or item, the record and who did it will appear here permanently.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle/60 border border-border rounded-2xl overflow-hidden bg-surface">
            {logs.map((entry) => {
              const badge = getActionBadge(entry.action);
              const member = members.find((m) => m.id === entry.memberId);
              const isExpanded = expandedId === entry.id;

              return (
                <div key={entry.id} className="p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {member ? (
                        <Avatar seed={member.id} color={member.accentColor} className="w-7 h-7" />
                      ) : (
                        <Avatar seed={entry.memberName} color="#6366f1" className="w-7 h-7" />
                      )}
                      <div>
                        <span className="text-xs font-semibold text-text block leading-tight">
                          {entry.memberName}
                        </span>
                        <span className="text-[0.6875rem] text-text-tertiary">
                          {formatTimestamp(entry.createdAt)}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold border shrink-0 ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="text-sm text-text font-medium leading-snug">
                    {entry.summary}
                  </p>

                  {entry.details && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        className="text-[0.6875rem] font-medium text-accent-text hover:underline flex items-center gap-1"
                      >
                        <Icon
                          name="chevron"
                          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                        <span>{isExpanded ? "Hide snapshot details" : "View snapshot details"}</span>
                      </button>

                      {isExpanded && (
                        <pre className="mt-2 p-2.5 rounded-lg bg-surface-sunken text-[0.6875rem] text-text-secondary font-mono overflow-x-auto border border-border-subtle">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(entry.details), null, 2);
                            } catch {
                              return entry.details;
                            }
                          })()}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
