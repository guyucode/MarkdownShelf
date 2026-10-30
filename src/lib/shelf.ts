import type { IndexedFile } from './tauri';
export interface Draft { text: string; baseHash: string; }
const prefix = 'markdown-shelf:draft:';
export function visibleDocuments(files: IndexedFile[], project: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return files.filter(f => (!project || f.folder_id === project) &&
    (!needle || `${f.folder_name}/${f.relative_path}`.toLocaleLowerCase().includes(needle)))
    .sort((a,b) => b.modified_ms-a.modified_ms || a.absolute_path.localeCompare(b.absolute_path));
}
export function documentTitle(path: string) { return (path.split('/').pop() || path).replace(/\.(md|markdown|mdx)$/i,''); }
export function relativeTime(ms: number, now = Date.now()) {
  if (!ms) return '时间未知';
  const minutes = Math.floor(Math.max(0,now-ms)/60000);
  if (minutes < 1) return '刚刚更新';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes/60)} 小时前`;
  if (minutes < 10080) return `${Math.floor(minutes/1440)} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}
export function writeDraft(path: string, draft: Draft) { localStorage.setItem(prefix+path,JSON.stringify(draft)); }
export function readDraft(path: string): Draft | null {
  const raw=localStorage.getItem(prefix+path); if(!raw)return null;
  const value=JSON.parse(raw);
  if(typeof value.text!=='string'||typeof value.baseHash!=='string')throw new Error('本机草稿损坏，请保留应用数据后排查');
  return value;
}
export function clearDraft(path: string) { localStorage.removeItem(prefix+path); }
