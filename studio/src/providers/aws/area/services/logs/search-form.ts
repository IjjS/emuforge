export interface SearchTime {
  date: string;
  time: string;
}

export interface SearchForm {
  group: string | undefined;
  stream: string | undefined;
  pattern: string;
  start: SearchTime;
  end: SearchTime;
}

export interface SearchRequest {
  logGroupName: string;
  logStreamNames?: [string];
  filterPattern?: string;
  startTime?: number;
  endTime?: number;
}

type SearchValidation = { request: SearchRequest } | { field: 'group' | 'start' | 'end'; error: string };

function localTime({ date, time }: SearchTime): number | undefined {
  if (date === '' && time === '') return undefined;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (day === null || clock === null) return NaN;

  const [, year, month, dayOfMonth] = day.map(Number);
  const [, hour, minute, second = 0] = clock.map((part) => Number(part ?? 0));
  const value = new Date(`${date}T${time}`);
  // Do not accept dates or local clock times that Date silently rolls forward.
  if (
    value.getFullYear() !== year ||
    value.getMonth() + 1 !== month ||
    value.getDate() !== dayOfMonth ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute ||
    value.getSeconds() !== second
  ) {
    return NaN;
  }
  return value.getTime();
}

export function searchRequest({ group, stream, pattern, start, end }: SearchForm): SearchValidation {
  if (!group) return { field: 'group', error: 'Choose a log group.' };

  const startTime = localTime(start);
  const endTime = localTime(end);
  if (Number.isNaN(startTime)) return { field: 'start', error: 'Enter a valid start date and time.' };
  if (Number.isNaN(endTime)) return { field: 'end', error: 'Enter a valid end date and time.' };
  if (startTime !== undefined && endTime !== undefined && endTime < startTime) {
    return { field: 'end', error: 'End time must be at or after start time.' };
  }

  return {
    request: {
      logGroupName: group,
      ...(stream ? { logStreamNames: [stream] } : {}),
      ...(pattern === '' ? {} : { filterPattern: pattern }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime }),
    },
  };
}
