import { expect, it } from 'vitest';

import { searchRequest, type SearchForm } from './search-form';

const empty = { date: '', time: '' };
const start = { date: '2026-11-26', time: '12:34:56' };
const end = { date: '2026-11-26', time: '12:35:57' };
const startTime = new Date(2026, 10, 26, 12, 34, 56).getTime();
const endTime = new Date(2026, 10, 26, 12, 35, 57).getTime();
const form: SearchForm = { group: '/example', stream: undefined, pattern: '', start: empty, end: empty };

it('reads both ends in the browser zone and sends their times in milliseconds', () => {
  expect(searchRequest({ ...form, start, end })).toEqual({ request: { logGroupName: '/example', startTime, endTime } });
  expect(searchRequest({ ...form, start, end: start })).toEqual({
    request: { logGroupName: '/example', startTime, endTime: startTime },
  });
});

it('reports a reversed range on the end field', () => {
  expect(searchRequest({ ...form, start: end, end: start })).toEqual({
    field: 'end',
    error: 'End time must be at or after start time.',
  });
});

it('omits the unset end of a one-sided range', () => {
  expect(searchRequest({ ...form, start })).toEqual({ request: { logGroupName: '/example', startTime } });
  expect(searchRequest({ ...form, end })).toEqual({ request: { logGroupName: '/example', endTime } });
});

it('sends the group and includes the pattern and stream only when given', () => {
  expect(searchRequest(form)).toEqual({ request: { logGroupName: '/example' } });
  expect(searchRequest({ ...form, pattern: ' "error two" ', stream: 'web' })).toEqual({
    request: { logGroupName: '/example', filterPattern: ' "error two" ', logStreamNames: ['web'] },
  });
  expect(searchRequest({ ...form, group: undefined })).toEqual({ field: 'group', error: 'Choose a log group.' });
});

it('reports incomplete or invalid dates and times on their respective fields', () => {
  expect(searchRequest({ ...form, start: { ...start, time: '' } })).toMatchObject({ field: 'start' });
  expect(searchRequest({ ...form, end: { ...end, date: '2026-02-30' } })).toMatchObject({ field: 'end' });
});
