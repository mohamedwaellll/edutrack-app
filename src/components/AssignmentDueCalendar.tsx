import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { usePreferences } from '../contexts/preferencesState';
import { formatCairoDateTime } from '../services/portalPayloadValidation';

export interface CalendarAssignmentEntry {
  id: string;
  title: string;
  due_at: string;
  statusLabel: string;
  statusStyle: string;
}

interface AssignmentDueCalendarProps {
  assignments: CalendarAssignmentEntry[];
  testIdPrefix: string;
}

interface YearMonth {
  year: number;
  month: number; // 1-12
}

function getCairoDateKey(isoString: string): string | null {
  const formatted = formatCairoDateTime(isoString);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted) ? formatted.slice(0, 10) : null;
}

function parseYearMonth(dateKey: string): YearMonth {
  const [y, m] = dateKey.split('-').map(Number);
  return { year: y, month: m };
}

function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const d = new Date(Date.UTC(ym.year, ym.month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Compact monthly assignment due-date calendar rendered in Africa/Cairo time.
 * Reuses already-fetched assignment arrays without issuing any database queries.
 */
export const AssignmentDueCalendar: React.FC<AssignmentDueCalendarProps> = ({
  assignments,
  testIdPrefix,
}) => {
  const { language, t } = usePreferences();
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  const todayCairoKey = useMemo(() => {
    const now = new Date().toISOString();
    return getCairoDateKey(now) ?? now.slice(0, 10);
  }, []);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, CalendarAssignmentEntry[]>();
    for (const item of assignments) {
      const key = getCairoDateKey(item.due_at);
      if (!key) continue;
      const list = map.get(key);
      if (list) {
        list.push(item);
      } else {
        map.set(key, [item]);
      }
    }
    return map;
  }, [assignments]);

  const initialMonth = useMemo<YearMonth>(() => {
    const todayYm = parseYearMonth(todayCairoKey);
    const todayPrefix = `${todayYm.year}-${pad2(todayYm.month)}-`;
    for (const key of groupedByDate.keys()) {
      if (key.startsWith(todayPrefix)) {
        return todayYm;
      }
    }
    const firstKey = groupedByDate.keys().next().value;
    return firstKey ? parseYearMonth(firstKey) : todayYm;
  }, [groupedByDate, todayCairoKey]);

  const [displayMonth, setDisplayMonth] = useState<YearMonth>(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(displayMonth.year, displayMonth.month - 1, 1)));
  }, [locale, displayMonth]);

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, {
      weekday: 'narrow',
      timeZone: 'UTC',
    });
    // 2024-01-07 is a Sunday
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 7 + i))));
  }, [locale]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(
      Date.UTC(displayMonth.year, displayMonth.month - 1, 1)
    ).getUTCDay();
    const daysInMonth = new Date(
      Date.UTC(displayMonth.year, displayMonth.month, 0)
    ).getUTCDate();

    const cells: Array<{ dateKey: string; dayNumber: number } | null> = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${displayMonth.year}-${pad2(displayMonth.month)}-${pad2(day)}`;
      cells.push({ dateKey, dayNumber: day });
    }
    return cells;
  }, [displayMonth]);

  const selectedDayItems = selectedDate ? groupedByDate.get(selectedDate) ?? [] : [];

  const changeMonth = (offset: number) => {
    setDisplayMonth((current) => shiftMonth(current, offset));
    setSelectedDate(null);
  };

  return (
    <div
      data-testid={`${testIdPrefix}-due-calendar`}
      className="rounded-xl bg-[#F8F7F2] dark:bg-[#0D1520] border border-[#E6E8E2] dark:border-slate-800 p-3.5 sm:p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#174E50] dark:text-teal-300 shrink-0" />
          <h3 className="text-xs font-bold text-[#17213B] dark:text-white">
            {t('assignmentCalendarTitle')}
          </h3>
          <span className="text-[11px] text-[#64748B] dark:text-slate-400">
            ({t('assignmentCalendarCairoTime')})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid={`${testIdPrefix}-calendar-prev`}
            aria-label={t('assignmentCalendarPrevMonth')}
            onClick={() => changeMonth(-1)}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#174E50] dark:focus-visible:ring-teal-400 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
          <span
            data-testid={`${testIdPrefix}-calendar-month-label`}
            className="min-w-[112px] text-center text-xs font-bold text-[#17213B] dark:text-white"
          >
            {monthLabel}
          </span>
          <button
            type="button"
            data-testid={`${testIdPrefix}-calendar-next`}
            aria-label={t('assignmentCalendarNextMonth')}
            onClick={() => changeMonth(1)}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-[#E6E8E2] dark:border-slate-700 text-[#17213B] dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#174E50] dark:focus-visible:ring-teal-400 cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center" role="group" aria-label={monthLabel}>
        {weekdayLabels.map((label, idx) => (
          <div
            key={idx}
            className="text-[10px] font-semibold uppercase text-[#64748B] dark:text-slate-400 py-1"
          >
            {label}
          </div>
        ))}

        {calendarCells.map((cell, idx) => {
          if (!cell) {
            return <div key={`empty-${idx}`} className="h-8 sm:h-9" aria-hidden="true" />;
          }

          const dayItems = groupedByDate.get(cell.dateKey) ?? [];
          const hasDue = dayItems.length > 0;
          const isSelected = selectedDate === cell.dateKey;
          const isToday = cell.dateKey === todayCairoKey;

          return (
            <button
              key={cell.dateKey}
              type="button"
              data-testid={`${testIdPrefix}-calendar-day-${cell.dateKey}`}
              data-has-due={hasDue ? 'true' : 'false'}
              aria-pressed={isSelected}
              aria-label={
                hasDue
                  ? `${cell.dateKey} — ${t('assignmentCalendarDueCount', { count: dayItems.length })}`
                  : cell.dateKey
              }
              onClick={() => setSelectedDate(cell.dateKey)}
              className={`relative h-8 sm:h-9 rounded-lg text-xs font-semibold flex flex-col items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#174E50] dark:focus-visible:ring-teal-400 cursor-pointer ${
                isSelected
                  ? 'bg-[#174E50] text-white dark:bg-teal-600 dark:text-white'
                  : hasDue
                    ? 'bg-white dark:bg-[#131E2B] border border-[#174E50]/40 dark:border-teal-500/40 text-[#17213B] dark:text-white hover:bg-[#174E50]/10 dark:hover:bg-teal-900/30'
                    : 'bg-white/60 dark:bg-[#131E2B]/50 text-[#475569] dark:text-slate-300 hover:bg-white dark:hover:bg-[#131E2B]'
              } ${isToday && !isSelected ? 'ring-1 ring-[#174E50] dark:ring-teal-400' : ''}`}
            >
              <span className="leading-none tabular-nums">{cell.dayNumber}</span>
              {hasDue && (
                <span
                  data-testid={`${testIdPrefix}-calendar-marker-${cell.dateKey}`}
                  className={`mt-0.5 w-1.5 h-1.5 rounded-full ${
                    isSelected ? 'bg-amber-300' : 'bg-[#174E50] dark:bg-teal-400'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        data-testid={`${testIdPrefix}-calendar-day-details`}
        className="rounded-lg bg-white dark:bg-[#131E2B] border border-[#E6E8E2] dark:border-slate-800 px-3 py-2.5 text-xs"
      >
        {assignments.length === 0 && !selectedDate ? (
          <p className="text-[#64748B] dark:text-slate-400">
            {t('assignmentCalendarNoAssignments')}
          </p>
        ) : !selectedDate ? (
          <p className="text-[#64748B] dark:text-slate-400">
            {t('assignmentCalendarSelectDayHint')}
          </p>
        ) : selectedDayItems.length === 0 ? (
          <p className="text-[#64748B] dark:text-slate-400">
            {t('assignmentCalendarNoDayDeadlines', { date: selectedDate })}
          </p>
        ) : (
          <ul className="space-y-2">
            {selectedDayItems.map((item) => (
              <li
                key={item.id}
                data-testid={`${testIdPrefix}-calendar-item-${item.id}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-[#17213B] dark:text-white break-words">
                    {item.title}
                  </div>
                  <div
                    dir="ltr"
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-[#64748B] dark:text-slate-400"
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>{formatCairoDateTime(item.due_at)}</span>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold shrink-0 ${item.statusStyle}`}
                >
                  {item.statusLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
