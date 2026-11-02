import {describe,it,expect} from 'vitest';
import {localDocumentPath} from './localPath';
describe('local links across supported desktop paths',()=>{
 it('resolves Unix paths without interpreting characters in the source as URLs',()=>{
  expect(localDocumentPath('/projects/a#b/docs/README.md','../设计%20说明.md#section')).toBe('/projects/a#b/设计 说明.md');
 });
 it('resolves canonical Windows drive and UNC paths',()=>{
  expect(localDocumentPath('\\\\?\\C:\\Project\\docs\\README.md','../images/pic.png')).toBe('C:/Project/images/pic.png');
  expect(localDocumentPath('C:\\Project\\README.md','docs/计划.md')).toBe('C:/Project/docs/计划.md');
  expect(localDocumentPath('\\\\?\\UNC\\server\\share\\docs\\a.md','../b.md')).toBe('//server/share/b.md');
 });
 it('rejects protocols, remote targets, alternate streams and root escapes',()=>{
  for(const target of ['https://example.com','//server/a','%2f%2fserver/a','file:secret','x%3Astream','../../../b.md'])expect(()=>localDocumentPath('/a/b.md',target)).toThrow();
 });
});
