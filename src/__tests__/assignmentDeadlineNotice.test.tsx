// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssignmentDeadlineNotice } from '../components/AssignmentDeadlineNotice';

describe('AssignmentDeadlineNotice', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows only upcoming deadlines within 48 hours in Cairo time', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    render(
      <AssignmentDeadlineNotice
        assignments={[
          { id: '1', title: 'Tomorrow', due_at: '2026-11-25T17:15:00Z' },
          { id: '2', title: 'Already ended', due_at: '2026-11-24T11:59:00Z' },
          { id: '3', title: 'Later this week', due_at: '2026-11-26T12:01:00Z' },
          { id: '4', title: 'Tonight', due_at: '2026-11-24T16:30:00Z' },
        ]}
      />
    );

    const reminders = screen.getByRole('region', { name: /due within 48 hours/i });
    const published = within(reminders).getAllByRole('listitem');
    expect(published.map((item) => item.textContent)).toEqual([
      'Tonight2026-11-24 18:30',
      'Tomorrow2026-11-25 19:15',
    ]);
  });
});
