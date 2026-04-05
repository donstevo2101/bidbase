import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReportSchedule {
  enabled: boolean;
  time: string; // HH:MM
  lastGenerated: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DailyReportPanel() {
  const queryClient = useQueryClient();

  // Local form state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Fetch current schedule
  const { data: scheduleRes, isLoading: scheduleLoading } = useQuery({
    queryKey: ['report-schedule'],
    queryFn: () => api.get<ReportSchedule>('/reports/daily/schedule'),
    refetchInterval: 60000,
  });

  const schedule: ReportSchedule | null =
    scheduleRes?.success ? (scheduleRes.data as ReportSchedule) : null;

  // Sync local state with fetched schedule (only on first load)
  const [initialised, setInitialised] = useState(false);
  if (schedule && !initialised) {
    setScheduleEnabled(schedule.enabled);
    setScheduleTime(schedule.time ?? '08:00');
    setInitialised(true);
  }

  // Save schedule mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      api.post('/reports/daily/schedule', {
        enabled: scheduleEnabled,
        time: scheduleTime,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-schedule'] });
    },
  });

  // Generate report (download PDF)
  async function handleGenerateReport() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const response = await fetch('/api/reports/daily', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${(await import('../../stores/session')).useSessionStore.getState().accessToken ?? ''}`,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        let msg = 'Failed to generate report';
        try {
          const parsed = JSON.parse(body);
          if (parsed.error?.message) msg = parsed.error.message;
        } catch { /* use default */ }
        throw new Error(msg);
      }

      // Trigger download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bidbase-daily-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Refresh schedule to get updated lastGenerated
      queryClient.invalidateQueries({ queryKey: ['report-schedule'] });
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 overflow-auto">
      <div className="flex-1 flex items-start justify-center px-6 py-8">
        <div className="w-full max-w-lg space-y-6">

          {/* ============================================================ */}
          {/* Header                                                        */}
          {/* ============================================================ */}
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Daily Report
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Generate a PDF summary of agent activity, pipeline status, and key metrics.
            </p>
          </div>

          {/* ============================================================ */}
          {/* Generate Now                                                  */}
          {/* ============================================================ */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">Generate Report</h3>
            <p className="text-xs text-slate-500 mb-4">
              Download a PDF report for today covering all agent conversations, pipeline progress, and outstanding tasks.
            </p>

            <button
              onClick={handleGenerateReport}
              disabled={downloading}
              className="px-5 py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Generate Report
                </>
              )}
            </button>

            {downloadError && (
              <div className="mt-3 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg flex items-center gap-2">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs text-red-300">{downloadError}</span>
              </div>
            )}

            {schedule?.lastGenerated && (
              <p className="text-[10px] text-slate-500 mt-3">
                Last generated: {new Date(schedule.lastGenerated).toLocaleString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
          </div>

          {/* ============================================================ */}
          {/* Schedule                                                      */}
          {/* ============================================================ */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">Scheduled Report</h3>
            <p className="text-xs text-slate-500 mb-4">
              Automatically generate and email the daily report at a set time each day.
            </p>

            {scheduleLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading schedule...
              </div>
            ) : (
              <div className="space-y-4">
                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Enable daily report</label>
                  <button
                    onClick={() => setScheduleEnabled(!scheduleEnabled)}
                    className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                      scheduleEnabled ? 'bg-teal-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                        scheduleEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Time picker */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 font-medium">Time (HH:MM)</label>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                {/* Save button */}
                <button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saveMutation.isPending ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    'Save Schedule'
                  )}
                </button>

                {saveMutation.isSuccess && (
                  <p className="text-[10px] text-emerald-400 text-center">Schedule saved successfully.</p>
                )}
                {saveMutation.isError && (
                  <p className="text-[10px] text-red-400 text-center">Failed to save schedule. Please try again.</p>
                )}

                {/* Current schedule display */}
                {schedule && (
                  <div className="pt-3 border-t border-slate-700/40">
                    <p className="text-[10px] text-slate-500">
                      Current schedule:{' '}
                      {schedule.enabled ? (
                        <span className="text-emerald-400">Active at {schedule.time} daily</span>
                      ) : (
                        <span className="text-slate-600">Disabled</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
