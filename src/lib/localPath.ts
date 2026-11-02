/** Resolve a local Markdown link on the document's own volume; Rust still enforces project scope. */
export function localDocumentPath(filePath:string, href:string):string {
  let source=filePath.replace(/\\/g,'/');
  source=source.replace(/^\/\/\?\/UNC\//i,'//').replace(/^\/\/\?\//,'');
  const target=decodeURIComponent(href.split(/[?#]/,1)[0]).replace(/\\/g,'/');
  if(!target||target.startsWith('//')||/^[a-z][a-z0-9+.-]*:/i.test(target))throw Error('不支持此本地链接');
  let prefix='';let body=source;
  const drive=source.match(/^[A-Za-z]:/);
  if(drive){prefix=drive[0];body=source.slice(2);}
  else if(source.startsWith('//')) {
    const parts=source.slice(2).split('/');if(parts.length<3)throw Error('无效共享路径');
    prefix='//'+parts.slice(0,2).join('/');body='/'+parts.slice(2).join('/');
  }
  if(!body.startsWith('/'))throw Error('文档路径必须为绝对路径');
  const joined=target.startsWith('/')?target:body.slice(0,body.lastIndexOf('/')+1)+target;
  const parts:string[]=[];
  for(const part of joined.split('/')) {
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw Error('链接超出文件系统根目录');parts.pop();}
    else{if(part.includes('\0')||part.includes(':'))throw Error('无效本地路径');parts.push(part);}
  }
  return prefix+'/'+parts.join('/');
}
