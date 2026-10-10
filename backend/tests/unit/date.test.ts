import { describe, expect, it } from 'vitest';
import {
  formatDDMMYYYY,
  resolveRange,
  startOfLocalDay,
  endOfLocalDay,
  startOfLocalMonth,
  endOfLocalMonth,
  startOfLocalYear,
  endOfLocalYear,
  tzOffsetMinutes,
} from '../../src/common/utils/date';

// The whole suite runs in Azerbaijan time (UTC+4), as configured by default.
const HOUR = 3_600_000;

describe('DD.MM.YYYY formatting', () => {
  it('formats the required display format', () => {
    expect(formatDDMMYYYY('2026-03-07T00:00:00.000Z')).toBe('07.03.2026');
  });

  it('handles single-digit day and month with zero padding', () => {
    expect(formatDDMMYYYY('2026-01-01T00:00:00.000Z')).toBe('01.01.2026');
  });

  it('formats using local time, not UTC', () => {
    // 20:00Z on 31 Dec is already 00:00 on 1 Jan in Baku (UTC+4).
    expect(formatDDMMYYYY('2026-12-31T20:00:00.000Z')).toBe('01.01.2027');
    // 19:59Z on 31 Dec is still 23:59 on 31 Dec in Baku.
    expect(formatDDMMYYYY('2026-12-31T19:59:00.000Z')).toBe('31.12.2026');
  });

  it('keeps a late-evening delivery on its own local day', () => {
    expect(formatDDMMYYYY('2026-06-14T19:30:00.000Z')).toBe('14.06.2026');
  });

  it('returns an empty string for missing values', () => {
    expect(formatDDMMYYYY(null)).toBe('');
    expect(formatDDMMYYYY(undefined)).toBe('');
    expect(formatDDMMYYYY('')).toBe('');
  });
});

describe('local day boundaries (UTC+4)', () => {
  it('starts the day at local midnight', () => {
    // 2026-06-15 10:00 Baku => 06:00 UTC => day starts 2026-06-14 20:00 UTC
    const now = new Date('2026-06-15T10:00:00.000Z');
    expect(startOfLocalDay(now).toISOString()).toBe('2026-06-14T20:00:00.000Z');
    expect(endOfLocalDay(now).toISOString()).toBe('2026-06-15T20:00:00.000Z');
  });

  it('spans exactly 24 hours', () => {
    const now = new Date();
    expect(endOfLocalDay(now).getTime() - startOfLocalDay(now).getTime()).toBe(24 * HOUR);
  });

  it('handles a delivery recorded just before local midnight', () => {
    // 23:30 Baku on the 14th is still the 14th, not the 15th.
    const lateEvening = new Date('2026-06-14T19:30:00.000Z');
    expect(formatDDMMYYYY(startOfLocalDay(lateEvening))).toBe('14.06.2026');
  });
});

describe('local month boundaries', () => {
  it('covers a full month', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    expect(startOfLocalMonth(now).toISOString()).toBe('2026-05-31T20:00:00.000Z');
    expect(endOfLocalMonth(now).toISOString()).toBe('2026-06-30T20:00:00.000Z');
  });

  it('spans exactly the month length in hours', () => {
    const now = new Date('2026-02-10T00:00:00.000Z');
    const hours = (endOfLocalMonth(now).getTime() - startOfLocalMonth(now).getTime()) / HOUR;
    expect(hours).toBe(28 * 24); // February 2026
  });

  it('ends a month at the start of the next month (not at the month start)', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    // Regression: endOfLocalMonth used to collapse onto startOfLocalMonth.
    expect(endOfLocalMonth(now).getTime()).toBeGreaterThan(startOfLocalMonth(now).getTime());
    expect(endOfLocalMonth(now).toISOString()).toBe('2026-06-30T20:00:00.000Z');
  });

  it('spans the full year', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const days = (endOfLocalYear(now).getTime() - startOfLocalYear(now).getTime()) / (24 * HOUR);
    expect(days).toBe(365);
    // Regression: the year boundary must roll over to the NEXT year.
    expect(endOfLocalYear(now).toISOString()).toBe('2026-12-31T20:00:00.000Z');
  });

  it('handles a December-to-January rollover', () => {
    // Simulated "now" = 2027-01-05 local, so lastMonth = December 2026.
    const { start, end } = resolveRange('lastMonth', null, null);
    expect(start).toBeInstanceOf(Date);
    expect(end!.getTime()).toBeGreaterThan(start!.getTime());
    // A full previous month is always between 28 and 31 days.
    const days = (end!.getTime() - start!.getTime()) / (24 * HOUR);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });
});

describe('local year boundaries', () => {
  it('spans exactly 365 days for 2026', () => {
    const now = new Date('2026-06-15T10:00:00.000Z');
    const days = (endOfLocalYear(now).getTime() - startOfLocalYear(now).getTime()) / (24 * HOUR);
    expect(days).toBe(365);
  });
});

describe('range presets', () => {
  it('today covers one local day', () => {
    const { start, end } = resolveRange('today', null, null);
    expect(end!.getTime() - start!.getTime()).toBe(24 * HOUR);
  });

  it('last7days covers 7 days inclusive of today', () => {
    const { start, end } = resolveRange('last7days', null, null);
    expect((end!.getTime() - start!.getTime()) / (24 * HOUR)).toBe(7);
  });

  it('last30days covers 30 days', () => {
    const { start, end } = resolveRange('last30days', null, null);
    expect((end!.getTime() - start!.getTime()) / (24 * HOUR)).toBe(30);
  });

  it('yesterday is the day before today and does not overlap it', () => {
    const today = resolveRange('today', null, null);
    const yesterday = resolveRange('yesterday', null, null);
    expect(yesterday.end!.getTime()).toBe(today.start!.getTime());
  });

  it('thisMonth starts on the first and ends on the last day', () => {
    const { start, end } = resolveRange('thisMonth', null, null);
    const local = (d: Date) => new Date(d.getTime() + tzOffsetMinutes() * 60_000).getUTCDate();
    expect(local(start!)).toBe(1);
    expect([28, 29, 30, 31]).toContain(local(new Date(end!.getTime() - 1)));
  });

  it('lastMonth is entirely before thisMonth', () => {
    const thisMonth = resolveRange('thisMonth', null, null);
    const lastMonth = resolveRange('lastMonth', null, null);
    expect(lastMonth.end!.getTime()).toBeLessThanOrEqual(thisMonth.start!.getTime());
  });

  it('returns a fully open range for "all"', () => {
    const { start, end } = resolveRange('all', null, null);
    expect(start).toBeNull();
    expect(end).toBeNull();
  });

  it('uses an explicit from/to when no preset is given', () => {
    // 2026-06-01T00:00Z is 04:00 local on 1 June, so it is already the 1st.
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-06-30T00:00:00.000Z');
    const { start, end } = resolveRange(undefined, from, to);
    expect(start!.toISOString()).toBe('2026-05-31T20:00:00.000Z');
    // `to` is inclusive of its whole local day.
    expect(end!.toISOString()).toBe('2026-06-30T20:00:00.000Z');
  });

  it('is open-ended when only `from` is supplied', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const { start, end } = resolveRange(undefined, from, null);
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeNull();
  });

  it('never returns an end before its start', () => {
    const presets = ['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth', 'thisYear'] as const;
    for (const preset of presets) {
      const { start, end } = resolveRange(preset, null, null);
      expect(end!.getTime(), `${preset} range is inverted`).toBeGreaterThan(start!.getTime());
    }
  });
});
