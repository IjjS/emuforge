// Counts in S2's sentences, singular at 1 (issue 481, final critique r2 P3).

/** "1 time", "{n} times". */
export function times(count: number): string {
  return count === 1 ? '1 time' : `${String(count)} times`;
}

/** "1 more read", "{n} more reads". */
export function moreReads(count: number): string {
  return count === 1 ? '1 more read' : `${String(count)} more reads`;
}

/** "1 receive", "{n} receives". */
export function receives(count: number): string {
  return count === 1 ? '1 receive' : `${String(count)} receives`;
}

/** "1 message", "{n} messages". */
export function messages(count: number): string {
  return count === 1 ? '1 message' : `${String(count)} messages`;
}
