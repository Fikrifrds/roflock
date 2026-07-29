/**
 * Cursor write events are one giant NDJSON line. When a partial line was once
 * dumped into liveOutput, the pane showed literal `\n` instead of newlines.
 * Decode that shape so the readable view stays usable for older streams too.
 */
export function normalizeLiveOutput(output: string): string {
  const escapedNewlines = (output.match(/\\n/g) ?? []).length;
  const realNewlines = (output.match(/\n/g) ?? []).length;
  if (escapedNewlines < 3 || escapedNewlines <= realNewlines * 2) return output;
  return output
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
