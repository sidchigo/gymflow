/**
 * @file src/lib/json-utils.ts
 *
 * Robust, fault-tolerant JSON parser designed for LLM completions.
 * Handles:
 * - Smart / curly quotes (“”, ‘’)
 * - Combining diacritical marks & unicode accents (\u0300-\u036F, etc.)
 * - Zero-width spaces & non-breaking spaces (\u200B, \uFEFF, \u00A0, etc.)
 * - Control characters
 * - Trailing commas before } and ]
 * - Unescaped newlines in JSON strings
 * - Malformed array object recovery
 */

export function cleanJSONString(str: string): string {
  return str
    .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb\u2039\u203a]/g, '"')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    // Strip all combining diacritical marks and accents across unicode blocks
    .replace(/[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g, "")
    // Strip modifier letters, acute/grave/primes
    .replace(/[\u00B4\u02B0-\u02FF\u2032\u2035\u0060]/g, "")
    // Strip zero-width and invisible characters
    .replace(/[\u200B-\u200F\uFEFF\u00AD\u2028\u2029\u2060\u180E]/g, "")
    // Replace non-breaking spaces with standard space
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    // Remove control characters (except tab, line feed, carriage return)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    // Remove trailing commas before } or ]
    .replace(/,\s*([}\]])/g, "$1");
}

export function extractArrayOfObjects(str: string): any[] {
  const objects: any[] = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        if (depth === 0) {
          startIdx = i;
        }
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          const objStr = str.substring(startIdx, i + 1);
          try {
            const parsed = safeParseJSON(objStr);
            if (parsed && typeof parsed === "object") {
              objects.push(parsed);
            }
          } catch {
            // Ignore chunk parse failure
          }
          startIdx = -1;
        }
      }
    }
  }
  return objects;
}

export function safeParseJSON(str: unknown): any {
  if (typeof str !== "string") return str;
  const trimmed = str.trim();
  if (!trimmed) return trimmed;

  // 1. Direct JSON.parse
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Cleaned JSON
  const cleaned = cleanJSONString(trimmed);
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 3. Fix unescaped newlines inside strings
  try {
    const sanitizedNewlines = cleaned.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
      return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    });
    return JSON.parse(sanitizedNewlines);
  } catch {}

  // 4. Recover array of objects if array parse failed
  if (trimmed.startsWith("[") || cleaned.startsWith("[")) {
    const extracted = extractArrayOfObjects(cleaned);
    if (extracted.length > 0) {
      return extracted;
    }
  }

  // 5. Truncated JSON auto-repair for streaming output
  try {
    let repaired = cleaned;
    // Count open quotes
    let quoteCount = 0;
    for (let i = 0; i < repaired.length; i++) {
      if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
        quoteCount++;
      }
    }
    // If odd number of quotes, close the open string
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }
    // Balance unclosed braces/brackets
    const stack: string[] = [];
    let inString = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (ch === '"' && (i === 0 || repaired[i - 1] !== '\\')) {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{' || ch === '[') {
          stack.push(ch);
        } else if (ch === '}' || ch === ']') {
          stack.pop();
        }
      }
    }
    while (stack.length > 0) {
      const open = stack.pop();
      if (open === '{') repaired += '}';
      if (open === '[') repaired += ']';
    }
    return JSON.parse(repaired);
  } catch {}

  // 6. Final fallback with relaxed quotes
  try {
    const relaxed = cleaned
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(relaxed);
  } catch {}

  // Final attempt: re-throw on cleaned
  return JSON.parse(cleaned);
}
