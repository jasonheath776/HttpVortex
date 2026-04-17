/**
 * Parser for HTTP runbook files (.http, .rest)
 * Compatible with VS Code REST Client conventions with response capture extensions
 */

export interface HttpBlock {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  preVars: Record<string, string>;
  preDebugs: Array<{ expr: string }>;
  captures: Array<{ key: string; path: string }>;
  debugs: Array<{ expr: string }>;
}

/**
 * Join lines that end with a backslash continuation character onto the next line.
 * Leading whitespace on the continuation line is stripped.
 */
function joinContinuationLines(text: string): string {
  return text.replace(/\\\r?\n[ \t]*/g, '');
}

/**
 * Parse variable declarations (@key = value) from the text before the first ### block.
 * Capture rules (res.* values) are excluded.
 */
export function parseGlobalVars(text: string): Record<string, string> {
  text = joinContinuationLines(text);
  const globalVars: Record<string, string> = {};
  const preamble = text.split(/^###/m)[0];
  
  for (const line of preamble.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('@') || !trimmed.includes('=')) {
      continue;
    }
    
    const eqIdx = trimmed.indexOf('=');
    const key = trimmed.slice(1, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    
    if (key && !val.startsWith('res.')) {
      globalVars[key] = val;
    }
  }
  
  return globalVars;
}

/**
 * Split the document by ### and parse each block into a structured object
 */
export function parseBlocks(text: string): HttpBlock[] {
  text = joinContinuationLines(text);
  const rawBlocks = text.split(/^###\s*/m).filter((b) => b.trim());
  
  return rawBlocks
    .map((block): HttpBlock | null => {
      const lines = block.split('\n');
      const name = lines[0].trim() || 'Request';
      const rest = lines.slice(1);

      const preVars: Record<string, string> = {};
      const preDebugs: Array<{ expr: string }> = [];
      let methodLine: string | null = null;
      let methodLineIdx = -1;

      // Find pre-request @var declarations, > debug() calls, and the METHOD URL line
      for (let i = 0; i < rest.length; i++) {
        const line = rest[i].trim();
        if (!line || line.startsWith('#')) {
          continue;
        }

        if (line.startsWith('@') && line.includes('=')) {
          const eqIdx = line.indexOf('=');
          const key = line.slice(1, eqIdx).trim();
          const val = line.slice(eqIdx + 1).trim();
          if (key && !val.startsWith('res.')) {
            preVars[key] = val;
          }
          continue;
        }

        if (line.startsWith('> debug(') && line.endsWith(')')) {
          preDebugs.push({ expr: line.slice(8, -1).trim() });
          continue;
        }

        if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/i.test(line)) {
          methodLine = line;
          methodLineIdx = i;
          break;
        }
      }

      if (!methodLine) {
        return null;
      }

      const parts = methodLine.split(/\s+/);
      const method = parts[0] || '';
      const url = parts[1] || '';
      
      if (!url) {
        console.warn(`Request "${name}" has no URL`);
        return null;
      }
      
      const afterMethod = rest.slice(methodLineIdx + 1);

      // Parse headers up to the first blank line or first > directive line
      const headers: Record<string, string> = {};
      let bodyStartIdx = -1;
      for (let i = 0; i < afterMethod.length; i++) {
        const line = afterMethod[i];
        if (line.trim() === '') {
          bodyStartIdx = i + 1;
          break;
        }
        if (line.trim().startsWith('#')) {
          continue;
        }
        // Debug directives (> ...) signal the start of the post-request section
        if (line.trim().startsWith('>')) {
          bodyStartIdx = i;
          break;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          headers[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
        }
      }

      // Parse body, response capture directives, and > debug() calls
      const captures: Array<{ key: string; path: string }> = [];
      const debugs: Array<{ expr: string }> = [];
      let body: string | null = null;
      
      if (bodyStartIdx !== -1) {
        const bodyLines: string[] = [];
        for (let i = bodyStartIdx; i < afterMethod.length; i++) {
          const line = afterMethod[i];
          const trimmed = line.trim();
          
          if (trimmed.startsWith('@') && trimmed.includes('=')) {
            const eqIdx = trimmed.indexOf('=');
            const key = trimmed.slice(1, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (key && val.startsWith('res.')) {
              captures.push({ key, path: val.slice(4) });
              continue;
            }
          }
          
          if (trimmed.startsWith('> debug(') && trimmed.endsWith(')')) {
            debugs.push({ expr: trimmed.slice(8, -1).trim() });
            continue;
          }


          if (!trimmed.startsWith('#')) {
            bodyLines.push(line);
          }
        }
        
        const bodyStr = bodyLines.join('\n').trim();
        if (bodyStr) {
          body = bodyStr;
        }
      }

      return {
        name,
        method: method.toUpperCase(),
        url,
        headers,
        body,
        preVars,
        preDebugs,
        captures,
        debugs,
      };
    })
    .filter((block): block is HttpBlock => block !== null);
}
