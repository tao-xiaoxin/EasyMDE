export function markdownLineStarts(markdown: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < markdown.length; offset += 1) {
    if ('\r' === markdown[offset]) {
      if ('\n' === markdown[offset + 1]) offset += 1;
      starts.push(offset + 1);
    } else if ('\n' === markdown[offset]) {
      starts.push(offset + 1);
    }
  }
  return starts;
}

export function isMarkdownTerminalWhitespaceSuffix(suffix: string): boolean {
  return /^[ \t\r\n]*$/u.test(suffix);
}
