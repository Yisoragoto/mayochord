/** 让浏览器下载一段文本（导出数据、监视页的实测记录） */
export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 文件名里用的时间戳：2026-10-15T08-30-00-000Z */
export const fileStamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');
