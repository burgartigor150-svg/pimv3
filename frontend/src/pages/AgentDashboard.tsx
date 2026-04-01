import React, { useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRow {
  task_id: string;
  type: string;
  status: "completed" | "failed" | "running" | "queued";
  duration_ms: number;
  tokens: number;
  created_at: string;
}

interface HourlyBucket {
  hour: string; // ISO string or "HH:00"
  count: number;
}

interface ToolStat {
  name: string;
  calls: number;
}

interface AgentMetrics {
  total_tasks: number;
  success_rate_pct: number;
  avg_tokens: number;
  avg_duration_ms: number;
  recent_tasks: TaskRow[];
  hourly_activity: HourlyBucket[];
  top_tools: ToolStat[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n = 12): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const STATUS_CLASSES: Record<TaskRow["status"], string> = {
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  running: "bg-yellow-100 text-yellow-800",
  queued: "bg-gray-100 text-gray-700",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  value: string | number;
  sub?: string;
}

function SummaryCard({ label, value, sub }: SummaryCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-5 flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      <span className="text-3xl font-bold text-gray-900">{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

interface StatusBadgeProps {
  status: TaskRow["status"];
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgentDashboard() {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<AgentMetrics>("/agent/metrics");
      setMetrics(data);
      setLastRefresh(new Date());
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load metrics";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + 30-second auto-refresh
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Max bar height in the hourly chart (px equivalent via percentage)
  const maxHourlyCount =
    metrics && metrics.hourly_activity.length > 0
      ? Math.max(...metrics.hourly_activity.map((b) => b.count), 1)
      : 1;

  const maxToolCalls =
    metrics && metrics.top_tools.length > 0
      ? Math.max(...metrics.top_tools.map((t) => t.calls), 1)
      : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-500 rounded-sm" />
          <h1 className="text-xl font-semibold tracking-tight">
            Agent Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {lastRefresh && (
            <span className="text-xs text-gray-400">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium px-4 py-2 rounded transition-colors"
          >
            {loading ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Refreshing…
              </>
            ) : (
              "Refresh"
            )}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-5 py-4 text-sm">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading skeleton overlay */}
        {loading && !metrics && (
          <div className="flex justify-center items-center py-24">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {metrics && (
          <>
            {/* Summary cards */}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <SummaryCard
                  label="Total Tasks"
                  value={metrics.total_tasks.toLocaleString()}
                />
                <SummaryCard
                  label="Success Rate"
                  value={`${metrics.success_rate_pct.toFixed(1)}%`}
                  sub="completed / total"
                />
                <SummaryCard
                  label="Avg Tokens"
                  value={metrics.avg_tokens.toLocaleString()}
                  sub="per task"
                />
                <SummaryCard
                  label="Avg Duration"
                  value={fmtDuration(metrics.avg_duration_ms)}
                  sub="per task"
                />
              </div>
            </section>

            {/* Hourly activity chart */}
            <section className="bg-white rounded-lg shadow p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">
                Hourly Activity — Last 24 Hours
              </h2>
              <div className="flex items-end gap-1 h-32">
                {metrics.hourly_activity.map((bucket, idx) => {
                  const heightPct = (bucket.count / maxHourlyCount) * 100;
                  return (
                    <div
                      key={idx}
                      className="flex-1 flex flex-col items-center gap-1"
                      title={`${bucket.hour}: ${bucket.count} tasks`}
                    >
                      <div className="w-full flex flex-col justify-end h-28">
                        <div
                          className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors"
                          style={{ height: `${heightPct}%`, minHeight: bucket.count > 0 ? "4px" : "0" }}
                        />
                      </div>
                      {/* Show label every 4 hours to avoid clutter */}
                      {idx % 4 === 0 && (
                        <span className="text-xs text-gray-400 truncate w-full text-center">
                          {bucket.hour}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Two-column section: recent tasks + top tools */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Recent tasks table */}
              <section className="lg:col-span-2 bg-white rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Recent Tasks
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3 text-left font-medium">Task ID</th>
                        <th className="px-4 py-3 text-left font-medium">Type</th>
                        <th className="px-4 py-3 text-left font-medium">Status</th>
                        <th className="px-4 py-3 text-right font-medium">Duration</th>
                        <th className="px-4 py-3 text-right font-medium">Tokens</th>
                        <th className="px-4 py-3 text-left font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {metrics.recent_tasks.slice(0, 10).map((task) => (
                        <tr
                          key={task.task_id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">
                            {truncate(task.task_id, 14)}
                          </td>
                          <td className="px-4 py-3 text-gray-700">{task.type}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={task.status} />
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {fmtDuration(task.duration_ms)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {task.tokens.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                            {fmtDate(task.created_at)}
                          </td>
                        </tr>
                      ))}
                      {metrics.recent_tasks.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-gray-400"
                          >
                            No tasks yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Top tools */}
              <section className="bg-white rounded-lg shadow p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">
                  Top Tools Used
                </h2>
                <div className="space-y-3">
                  {metrics.top_tools.length === 0 && (
                    <p className="text-sm text-gray-400">No tool data.</p>
                  )}
                  {metrics.top_tools.map((tool) => {
                    const widthPct = (tool.calls / maxToolCalls) * 100;
                    return (
                      <div key={tool.name}>
                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                          <span className="font-medium truncate">{tool.name}</span>
                          <span className="ml-2 text-gray-400 shrink-0">
                            {tool.calls.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full transition-all"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
