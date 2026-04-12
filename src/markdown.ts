/**
 * markdown.ts — Convert HTTP request results to a Markdown report.
 */

import { RequestResult } from './requester';

/**
 * Build a Markdown report from a completed run.
 *
 * @param title - Report title (usually the file stem)
 * @param results - Result objects from the execution
 * @param variables - Final variable store snapshot
 * @returns Markdown text
 */
export function buildMarkdownReport(
  title: string,
  results: RequestResult[],
  variables: Record<string, unknown>
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`_Generated: ${new Date().toLocaleString()}_`);
  lines.push('');

  if (results.length === 0) {
    lines.push('_No results to export._');
    return lines.join('\n') + '\n';
  }

  for (const r of results) {
    const statusLabel = r.status ?? 'ERR';
    lines.push(`## ${r.name}`);
    lines.push('');
    lines.push(`**${r.method}** \`${r.url}\` — **${statusLabel}** — ${r.duration}ms`);
    lines.push('');

    if (r.error) {
      lines.push(`**Error:** ${r.error}`);
    } else {
      const bodyText =
        typeof r.data === 'object'
          ? JSON.stringify(r.data, null, 2)
          : String(r.data ?? '');

      if (bodyText) {
        const lang = isJson(bodyText) ? 'json' : '';
        lines.push(`\`\`\`${lang}`);
        lines.push(bodyText);
        lines.push('```');
      }
    }

    if (Object.keys(r.captures ?? {}).length > 0) {
      lines.push('');
      lines.push('**Captures:**');
      for (const [k, v] of Object.entries(r.captures ?? {})) {
        lines.push(`- \`@${k}\` = \`${String(v)}\``);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (Object.keys(variables).length > 0) {
    lines.push('## Variables');
    lines.push('');
    for (const [k, v] of Object.entries(variables)) {
      lines.push(`- \`@${k}\` = \`${String(v)}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
