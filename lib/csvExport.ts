/** CSV 1 セルをエスケープ（RFC 4180 風） */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 2 次元配列を CSV 文字列に（各行はセル配列） */
export function rowsToCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/** ファイル名に使えない文字を置換 */
export function sanitizeFilenamePart(part: string): string {
  return part.replace(/[/\\?%*:|"<>]/g, "_").trim() || "unknown";
}

/** UTF-8 BOM 付き CSV をブラウザからダウンロード（Excel 向け） */
export function downloadCsv(filename: string, csvBody: string): void {
  const blob = new Blob(["\uFEFF", csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
