import { extractEmail } from "./index";

// Turns a pasted or uploaded CSV (e.g. a ManyChat export) into username/email
// pairs. Tolerant on purpose: comma, semicolon or tab separators, quoted cells,
// a header row naming the columns, or no header at all (username, email).

function splitRow(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectSeparator(line: string): string {
  const counts = [",", ";", "\t"].map((s) => [s, line.split(s).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

export function normalizeUsername(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "")
    .toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(cleaned) ? cleaned : null;
}

export function parseKnownContactsCsv(text: string): {
  contacts: { igUsername: string; email: string }[];
  skipped: number;
} {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { contacts: [], skipped: 0 };
  const separator = detectSeparator(lines[0]);
  const header = splitRow(lines[0], separator).map((h) => h.toLowerCase());

  let userCol = header.findIndex((h) => /instagram|username|user name|handle|pseudo/.test(h));
  let emailCol = header.findIndex((h) => /e-?mail|courriel/.test(h));
  let start = 1;
  if (userCol === -1 || emailCol === -1) {
    // No usable header: assume "username, email" and keep the first line.
    userCol = 0;
    emailCol = 1;
    start = extractEmail(lines[0]) ? 0 : 1;
  }

  const byUsername = new Map<string, string>();
  let skipped = 0;
  for (const line of lines.slice(start)) {
    const cells = splitRow(line, separator);
    const username = normalizeUsername(cells[userCol] ?? "");
    const email = extractEmail(cells[emailCol] ?? "");
    if (!username || !email) {
      skipped++;
      continue;
    }
    byUsername.set(username, email);
  }
  return {
    contacts: [...byUsername].map(([igUsername, email]) => ({ igUsername, email })),
    skipped,
  };
}
