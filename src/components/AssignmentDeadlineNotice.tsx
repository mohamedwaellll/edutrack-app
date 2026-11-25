import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { usePreferences } from '../contexts/preferencesState';
import { formatCairoDateTime } from '../services/portalPayloadValidation';

const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;

interface DeadlineEntry {
  id: string;
  title: string;
  due_at: string;
}

export function AssignmentDeadlineNotice({ assignments }: { assignments: readonly DeadlineEntry[] }) {
  const { t } = usePreferences();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlines = assignments
    .map((assignment) => ({ assignment, timestamp: Date.parse(assignment.due_at) }))
    .filter(({ timestamp }) => timestamp > now && timestamp <= now + REMINDER_WINDOW_MS)
    .sort((first, second) => first.timestamp - second.timestamp);

  if (deadlines.length === 0) return null;

  return (
    <section
      aria-label={t('assignmentDeadlineNoticeTitle')}
      className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <h3 className="flex items-center gap-2 font-bold">
        <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('assignmentDeadlineNoticeTitle')}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {deadlines.map(({ assignment }) => (
          <li key={assignment.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{assignment.title}</span>
            <time dateTime={assignment.due_at} dir="ltr" className="font-mono tabular-nums">
              {formatCairoDateTime(assignment.due_at)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
