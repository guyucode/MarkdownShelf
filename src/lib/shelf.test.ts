import { beforeEach, describe, expect, it } from 'vitest';
import { visibleDocuments, documentTitle, relativeTime, readDraft, writeDraft, clearDraft } from './shelf';
import type { IndexedFile } from './tauri';
const file=(project:string,path:string,time:number):IndexedFile=>({folder_id:project,folder_name:project,absolute_path:`/${project}/${path}`,relative_path:path,modified_ms:time});
describe('document shelf',()=>{
  beforeEach(()=>localStorage.clear());
  it('orders documents across projects by modification, not name or opening order',()=>{
    const files=[file('a','z.md',10),file('b','a.md',30),file('a','b.md',20)];
    expect(visibleDocuments(files,'','').map(f=>f.modified_ms)).toEqual([30,20,10]);
    expect(visibleDocuments(files,'a','').map(f=>f.modified_ms)).toEqual([20,10]);
  });
  it('finds a document by project and relative path',()=>{
    expect(visibleDocuments([file('项目甲','设计/接口.md',1)],'','接口')).toHaveLength(1);
    expect(visibleDocuments([file('项目甲','设计/接口.md',1)],'','项目甲')).toHaveLength(1);
  });
  it('keeps drafts separate by full path and preserves their original version',()=>{
    writeDraft('/a/README.md',{text:'my edit',baseHash:'old'});
    writeDraft('/b/README.md',{text:'other',baseHash:'different'});
    expect(readDraft('/a/README.md')).toEqual({text:'my edit',baseHash:'old'});
    clearDraft('/a/README.md');expect(readDraft('/a/README.md')).toBeNull();
    expect(readDraft('/b/README.md')?.text).toBe('other');
  });
  it('labels unknown and future modification times without negative ages',()=>{
    expect(relativeTime(0,100)).toBe('时间未知');expect(relativeTime(200,100)).toBe('刚刚更新');
    expect(documentTitle('docs/你好.MD')).toBe('你好');
  });
});
