/**
 * codegen.ts — Convert a parsed runbook into idiomatic HTTP client code
 * for C#, JavaScript (fetch), and Java (java.net.http).
 */

import { HttpBlock } from './parser';

/**
 * Convert a runbook {{varName}} template string into language-appropriate
 * string interpolation / concatenation.
 */
function interpolate(template: string, lang: 'csharp' | 'javascript' | 'java'): string {
  if (!template.includes('{{')) {
    return quoteString(template, lang);
  }

  const parts: Array<{ type: 'lit' | 'var'; value: string }> = [];
  let last = 0;

  for (const m of template.matchAll(/\{\{(.*?)\}\}/g)) {
    if (m.index! > last) {
      parts.push({ type: 'lit', value: template.slice(last, m.index) });
    }
    parts.push({ type: 'var', value: m[1].trim() });
    last = m.index! + m[0].length;
  }

  if (last < template.length) {
    parts.push({ type: 'lit', value: template.slice(last) });
  }

  if (lang === 'csharp') {
    const inner = parts
      .map((p) => (p.type === 'lit' ? escapeCSharp(p.value) : `{${p.value}}`))
      .join('');
    return `$"${inner}"`;
  }

  if (lang === 'javascript') {
    const inner = parts
      .map((p) => (p.type === 'lit' ? escapeJS(p.value) : `\${${p.value}}`))
      .join('');
    return `\`${inner}\``;
  }

  if (lang === 'java') {
    const segments = parts.map((p) =>
      p.type === 'lit' ? `"${escapeJava(p.value)}"` : p.value
    );
    return segments.join(' + ');
  }

  return JSON.stringify(template);
}

function quoteString(value: string, lang: 'csharp' | 'javascript' | 'java'): string {
  if (lang === 'javascript') return `"${escapeJS(value)}"`;
  if (lang === 'csharp') return `"${escapeCSharp(value)}"`;
  return `"${escapeJava(value)}"`;
}

function escapeCSharp(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function escapeJS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function escapeJava(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function toCamelVar(name: string, suffix: string = ''): string {
  const base = name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase()) || 'request';
  return base + suffix;
}

function titleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ── C# generator ──────────────────────────────────────────────────────────

function generateCSharp(globalVars: Record<string, string>, blocks: HttpBlock[]): string {
  const lines: string[] = [];

  lines.push('using System.Net.Http;');
  lines.push('using System.Net.Http.Headers;');
  lines.push('using System.Text;');
  lines.push('using System.Text.Json;');
  lines.push('using System.Threading.Tasks;');
  lines.push('');
  lines.push('var client = new HttpClient();');

  if (Object.keys(globalVars).length > 0) {
    lines.push('');
    lines.push('// Global variables');
    for (const [k, v] of Object.entries(globalVars)) {
      lines.push(`var ${k} = ${quoteString(v, 'csharp')};`);
    }
  }

  for (const block of blocks) {
    lines.push('');
    lines.push(`// ── ${block.name} ─────────────────────────────────────────`);

    if (block.preVars && Object.keys(block.preVars).length > 0) {
      for (const [k, v] of Object.entries(block.preVars)) {
        lines.push(`var ${k} = ${quoteString(v, 'csharp')};`);
      }
    }

    const respVar = toCamelVar(block.name, 'Response');
    const msgVar = toCamelVar(block.name, 'Request');
    const method = block.method;
    const urlExpr = interpolate(block.url, 'csharp');

    lines.push(`var ${msgVar} = new HttpRequestMessage(HttpMethod.${titleCase(method)}, ${urlExpr});`);

    for (const [hk, hv] of Object.entries(block.headers ?? {})) {
      const lk = hk.toLowerCase();
      if (lk === 'content-type') continue;
      if (lk === 'authorization') {
        lines.push(`${msgVar}.Headers.TryAddWithoutValidation("Authorization", ${interpolate(hv, 'csharp')});`);
      } else {
        lines.push(
          `${msgVar}.Headers.TryAddWithoutValidation(${quoteString(hk, 'csharp')}, ${interpolate(hv, 'csharp')});`
        );
      }
    }

    if (block.body) {
      const ct =
        Object.entries(block.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? 'application/json';
      const bodyLines = block.body.split('\n');
      if (bodyLines.length === 1) {
        lines.push(
          `${msgVar}.Content = new StringContent(${interpolate(block.body, 'csharp')}, Encoding.UTF8, ${quoteString(ct, 'csharp')});`
        );
      } else {
        lines.push(`var ${toCamelVar(block.name, 'Body')} = ${interpolate(block.body, 'csharp')};`);
        lines.push(
          `${msgVar}.Content = new StringContent(${toCamelVar(block.name, 'Body')}, Encoding.UTF8, ${quoteString(ct, 'csharp')});`
        );
      }
    }

    lines.push(`var ${respVar} = await client.SendAsync(${msgVar});`);
    lines.push(`var ${toCamelVar(block.name, 'Body_')}Content = await ${respVar}.Content.ReadAsStringAsync();`);

    if (block.captures && block.captures.length > 0) {
      lines.push(`var ${toCamelVar(block.name, 'Json')} = JsonDocument.Parse(${toCamelVar(block.name, 'Body_')}Content).RootElement;`);
      for (const cap of block.captures) {
        const pathSegments = cap.path.split('.');
        const jsonPath = pathSegments
          .map((s) => {
            const n = parseInt(s, 10);
            return isNaN(n) ? `.GetProperty("${s}")` : `[${n}]`;
          })
          .join('');
        lines.push(`var ${cap.key} = ${toCamelVar(block.name, 'Json')}${jsonPath}.GetString();`);
      }
    }
  }

  return lines.join('\n');
}

// ── JavaScript generator ──────────────────────────────────────────────────

function generateJavaScript(globalVars: Record<string, string>, blocks: HttpBlock[]): string {
  const lines: string[] = [];

  if (Object.keys(globalVars).length > 0) {
    lines.push('// Global variables');
    for (const [k, v] of Object.entries(globalVars)) {
      lines.push(`let ${k} = ${quoteString(v, 'javascript')};`);
    }
    lines.push('');
  }

  lines.push('// Wrap in an async function or use top-level await');
  lines.push('(async () => {');

  for (const block of blocks) {
    lines.push('');
    lines.push(`  // ── ${block.name} ─────────────────────────────────────────`);

    if (block.preVars && Object.keys(block.preVars).length > 0) {
      for (const [k, v] of Object.entries(block.preVars)) {
        lines.push(`  let ${k} = ${quoteString(v, 'javascript')};`);
      }
    }

    const respVar = toCamelVar(block.name, 'Res');
    const optsLines: string[] = [];

    if (block.method !== 'GET') {
      optsLines.push(`    method: '${block.method}',`);
    }

    const headerEntries = Object.entries(block.headers ?? {});
    if (headerEntries.length > 0) {
      optsLines.push('    headers: {');
      for (const [hk, hv] of headerEntries) {
        optsLines.push(`      ${quoteString(hk, 'javascript')}: ${interpolate(hv, 'javascript')},`);
      }
      optsLines.push('    },');
    }

    if (block.body) {
      optsLines.push(`    body: ${interpolate(block.body, 'javascript')},`);
    }

    const urlExpr = interpolate(block.url, 'javascript');
    if (optsLines.length > 0) {
      lines.push(`  const ${respVar} = await fetch(${urlExpr}, {`);
      lines.push(...optsLines);
      lines.push('  });');
    } else {
      lines.push(`  const ${respVar} = await fetch(${urlExpr});`);
    }

    if (block.captures && block.captures.length > 0) {
      const dataVar = toCamelVar(block.name, 'Data');
      lines.push(`  const ${dataVar} = await ${respVar}.json();`);
      for (const cap of block.captures) {
        const accessor = cap.path
          .split('.')
          .map((s) => (isNaN(parseInt(s, 10)) ? `.${s}` : `[${s}]`))
          .join('');
        lines.push(`  let ${cap.key} = ${dataVar}${accessor};`);
      }
    } else {
      lines.push(`  const ${toCamelVar(block.name, 'Data')} = await ${respVar}.json();`);
    }
  }

  lines.push('');
  lines.push('})();');

  return lines.join('\n');
}

// ── Java generator ─────────────────────────────────────────────────────────

function generateJava(globalVars: Record<string, string>, blocks: HttpBlock[]): string {
  const lines: string[] = [];

  lines.push('import java.net.URI;');
  lines.push('import java.net.http.HttpClient;');
  lines.push('import java.net.http.HttpRequest;');
  lines.push('import java.net.http.HttpRequest.BodyPublishers;');
  lines.push('import java.net.http.HttpResponse;');
  lines.push('import java.net.http.HttpResponse.BodyHandlers;');
  lines.push('');
  lines.push('public class Runbook {');
  lines.push('    public static void main(String[] args) throws Exception {');
  lines.push('        var client = HttpClient.newHttpClient();');

  if (Object.keys(globalVars).length > 0) {
    lines.push('');
    lines.push('        // Global variables');
    for (const [k, v] of Object.entries(globalVars)) {
      lines.push(`        var ${k} = ${quoteString(v, 'java')};`);
    }
  }

  for (const block of blocks) {
    lines.push('');
    lines.push(`        // ── ${block.name} ─────────────────────────────────────────`);

    if (block.preVars && Object.keys(block.preVars).length > 0) {
      for (const [k, v] of Object.entries(block.preVars)) {
        lines.push(`        var ${k} = ${quoteString(v, 'java')};`);
      }
    }

    const reqVar = toCamelVar(block.name, 'Request');
    const respVar = toCamelVar(block.name, 'Response');

    lines.push(`        var ${reqVar} = HttpRequest.newBuilder()`);
    lines.push(`            .uri(URI.create(${interpolate(block.url, 'java')}))`);

    for (const [hk, hv] of Object.entries(block.headers ?? {})) {
      lines.push(`            .header(${quoteString(hk, 'java')}, ${interpolate(hv, 'java')})`);
    }

    const method = block.method;
    if (block.body) {
      lines.push(`            .${method}(BodyPublishers.ofString(${interpolate(block.body, 'java')}))`);
    } else if (method === 'GET') {
      lines.push('            .GET()');
    } else if (method === 'DELETE') {
      lines.push('            .DELETE()');
    } else {
      lines.push(`            .method("${method}", BodyPublishers.noBody())`);
    }

    lines.push('            .build();');
    lines.push(`        var ${respVar} = client.send(${reqVar}, BodyHandlers.ofString());`);
    lines.push(`        var ${toCamelVar(block.name, 'Body')} = ${respVar}.body();`);

    if (block.captures && block.captures.length > 0) {
      lines.push(`        // TODO: parse ${toCamelVar(block.name, 'Body')} JSON and extract captures:`);
      for (const cap of block.captures) {
        lines.push(`        //   ${cap.key} = ${cap.path}`);
      }
    }
  }

  lines.push('    }');
  lines.push('}');

  return lines.join('\n');
}

/**
 * Generate HTTP client code for the given language.
 */
export function generateCode(
  language: 'csharp' | 'javascript' | 'java',
  globalVars: Record<string, string>,
  blocks: HttpBlock[]
): string {
  switch (language) {
    case 'csharp':
      return generateCSharp(globalVars, blocks);
    case 'javascript':
      return generateJavaScript(globalVars, blocks);
    case 'java':
      return generateJava(globalVars, blocks);
    default:
      return '';
  }
}
