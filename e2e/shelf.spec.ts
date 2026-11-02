import { test, expect, type Page } from '@playwright/test';
async function boot(page:Page){
 await page.addInitScript(()=>{
  const w=window as any;let next=1;const callbacks=new Map();const events=new Map();
  w.shelfTest={folders:[{id:'a',name:'Agent 工程',path:'/projects/a',added_at:'1'},{id:'b',name:'设计项目',path:'/projects/b',added_at:'2'}],docs:{'/projects/a/README.md':{path:'/projects/a/README.md',content:'# 项目介绍\n\n这是第一篇文档。\n\n| 事项 | 状态 |\n|---|---|\n| 阅读 | 就绪 |',hash:'a1',modified_ms:100},'/projects/b/设计.md':{path:'/projects/b/设计.md',content:'# 设计笔记\n\n最近更新的文档。',hash:'b1',modified_ms:200}},confirm:true};
  w.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
  w.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:(fn:any)=>{const id=next++;callbacks.set(id,fn);return id;},unregisterCallback:(id:any)=>callbacks.delete(id),invoke:async(cmd:string,args:any={})=>{
   const s=w.shelfTest;
   if(cmd==='plugin:event|listen'){events.set(next,{event:args.event,handler:args.handler});return next++;}
   if(cmd==='plugin:event|unlisten')return;
   if(cmd==='get_initial_target')return {kind:'none'};
   if(cmd==='load_preferences')return {};
   if(cmd==='save_preferences')return;
   if(cmd==='list_folders')return s.folders;
   if(cmd==='list_reading_marks'){const marks=JSON.parse(localStorage.getItem('test-reading-marks')||'[]');return marks.map((m:any)=>({...m,state:!s.docs[m.path]?'unavailable':s.docs[m.path].hash===m.hash?'confirmed':'needsReview'}));}
   if(cmd==='update_reading_mark'){const d=s.docs[args.path];if(!d||d.hash!==args.expectedHash)throw Error('文档已变化，请先重新阅读');const marks=JSON.parse(localStorage.getItem('test-reading-marks')||'[]').filter((m:any)=>m.path!==args.path||m.folder_id!==args.folderId);if(args.action!=='remove')marks.push({folder_id:args.folderId,path:args.path,hash:d.hash});localStorage.setItem('test-reading-marks',JSON.stringify(marks));return;}
   if(cmd==='list_documents')return Object.values(s.docs).map((d:any)=>{const folder=s.folders.find((f:any)=>d.path.startsWith(f.path+'/'));return folder?{folder_id:folder.id,folder_name:folder.name,absolute_path:d.path,relative_path:d.path.slice(folder.path.length+1),modified_ms:d.modified_ms}:null;}).filter(Boolean);
   if(cmd==='read_document'){if(!s.docs[args.path])throw Error('missing document');return {...s.docs[args.path]};}
   if(cmd==='save_document'){const d=s.docs[args.path];if(!d||d.hash!==args.expectedHash)throw Error('文件已被外部修改');d.content=args.content;d.hash+='x';d.modified_ms=Date.now();return {...d};}
   if(cmd==='create_document'){const folder=s.folders.find((f:any)=>f.id===args.folderId);const path=folder.path+'/'+args.name;if(s.docs[path])throw Error('同名文件已存在');return s.docs[path]={path,content:'# '+args.name.replace(/\.md$/,'')+'\n\n',hash:'new',modified_ms:Date.now()};}
   if(cmd==='plugin:dialog|confirm')return s.confirm;
   if(cmd==='plugin:dialog|message')return s.confirm;
   if(cmd==='remove_folder'){s.folders=s.folders.filter((f:any)=>f.id!==args.id);return;}
   if(cmd==='plugin:opener|open_url')return;
   throw Error('Unexpected IPC '+cmd);
  }};
 });
 await page.goto('/');await expect(page.getByRole('button',{name:/设计/})).toBeVisible();
}
test('two-column shelf sorts across projects and filters by path',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
 const docs=page.getByRole('navigation',{name:'文档列表'}).getByRole('button');
 await expect(docs.first()).toContainText('设计');await page.getByLabel('项目筛选').selectOption('a');await expect(docs).toHaveCount(1);
 await docs.first().click();await expect(page.locator('article h1')).toContainText('项目介绍');await expect(page.locator('article table')).toBeVisible();
 await page.getByLabel('搜索文档',{exact:true}).fill('not-found');await expect(docs).toHaveCount(0);expect(errors).toEqual([]);
});
test('edits and saves original, and opens it as rendered Markdown',async({page})=>{
 await boot(page);await page.getByRole('button',{name:/设计/}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();
 await page.getByLabel('Markdown 编辑器').fill('# 修改后的标题\n\n真实的草稿');await page.getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.locator('article h1')).toContainText('修改后的标题');expect(await page.evaluate(()=>(window as any).shelfTest.docs['/projects/b/设计.md'].content)).toContain('真实的草稿');
});
test('creates a new Markdown without overwriting an existing document',async({page})=>{
 await boot(page);await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByLabel('新文档所属项目').selectOption('b');await page.getByLabel('文档名称').fill('写作笔记');await page.getByRole('button',{name:'创建文档'}).click();
 await expect(page.getByLabel('Markdown 编辑器')).toHaveValue('# 写作笔记\n\n');await page.getByLabel('Markdown 编辑器').fill('# 写作笔记\n\n开始写作。');await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByLabel('文档名称').fill('写作笔记');await page.getByRole('button',{name:'创建文档'}).click();await expect(page.getByRole('alert')).toContainText('同名文件已存在');
});
test('preserves draft across navigation, reload and an external Agent edit',async({page})=>{
 await boot(page);await page.getByRole('button',{name:/设计/}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByLabel('Markdown 编辑器').fill('# 我的未保存草稿');
 await page.getByRole('button',{name:/README/}).click();await page.getByRole('button',{name:/设计/}).click();await expect(page.getByLabel('Markdown 编辑器')).toHaveValue('# 我的未保存草稿');
 await page.reload();await expect(page.getByLabel('Markdown 编辑器')).toHaveValue('# 我的未保存草稿');
 await page.evaluate(()=>{const d=(window as any).shelfTest.docs['/projects/b/设计.md'];d.content='# Agent 的修改';d.hash='b2';d.modified_ms=Date.now();});
 await expect(page.getByRole('status')).toContainText('原文件已变化',{timeout:10000});await expect(page.getByRole('button',{name:'保存',exact:true})).toBeDisabled();await expect(page.getByLabel('Markdown 编辑器')).toHaveValue('# 我的未保存草稿');
 expect(await page.evaluate(()=>(window as any).shelfTest.docs['/projects/b/设计.md'].content)).toBe('# Agent 的修改');
});
test('refreshes external changes in reading mode and keeps the selected document',async({page})=>{
 await boot(page);await page.getByRole('button',{name:/README/}).click();
 await page.evaluate(()=>{const d=(window as any).shelfTest.docs['/projects/a/README.md'];d.content='# 外部新版本';d.hash='a2';d.modified_ms=Date.now();});
 await expect(page.locator('article h1')).toContainText('外部新版本',{timeout:10000});
 await expect(page.getByRole('navigation',{name:'文档列表'}).getByRole('button').first()).toContainText('README');
});

test('manual required reading persists; opening never selects or confirms; external edits require review',async({page})=>{
 await boot(page);
 await page.getByRole('button',{name:'项目必读',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'文档列表'}).getByRole('button')).toHaveCount(0);
 await page.getByRole('button',{name:'全部',exact:true}).click();
 await page.getByRole('navigation',{name:'文档列表'}).getByRole('button').filter({hasText:'设计'}).click();
 await expect(page.getByRole('button',{name:'设为项目必读'})).toBeVisible();
 await page.getByRole('button',{name:'设为项目必读'}).click();
 await page.getByRole('button',{name:'项目必读',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'文档列表'}).getByRole('button')).toHaveCount(1);
 await page.reload();await expect(page.getByRole('button',{name:'移出必读'})).toBeVisible();
 await page.evaluate(()=>{const d=(window as any).shelfTest.docs['/projects/b/设计.md'];d.content='# 更新后需要重新阅读';d.hash='b2';d.modified_ms=Date.now();});
 await expect(page.locator('article h1')).toContainText('更新后需要重新阅读',{timeout:10000});
 await expect(page.getByRole('button',{name:'确认更新',exact:true})).toBeVisible();
 await expect(page.locator('.reading-badge')).toHaveText('待复核');
 await page.getByRole('navigation',{name:'文档列表'}).getByRole('button').filter({hasText:'README'}).click();
 await page.getByRole('navigation',{name:'文档列表'}).getByRole('button').filter({hasText:'设计'}).click();
 await expect(page.getByRole('button',{name:'确认更新',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'确认更新',exact:true}).click();
 await expect(page.locator('.reading-badge')).toHaveText('必读');
 await page.getByRole('button',{name:'编辑',exact:true}).click();
 await expect(page.getByRole('button',{name:'确认更新',exact:true})).toHaveCount(0);
 await page.getByLabel('Markdown 编辑器').fill('# 自己修改也需要复核');
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await expect(page.getByRole('button',{name:'确认更新',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'移出必读'}).click();
 await page.getByRole('button',{name:'项目必读',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'文档列表'}).getByRole('button')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).shelfTest.docs['/projects/b/设计.md'].content)).toBe('# 自己修改也需要复核');
});
