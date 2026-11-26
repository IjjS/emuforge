export function parseTestHeaders(text: string): { headers: Record<string, string> } | { error: string } {
  const headers: [string, string][] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator === -1) return { error: 'Write each header as Name: value.' };
    headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return { headers: Object.fromEntries(headers) };
}
