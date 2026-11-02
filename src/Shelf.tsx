import { useCallback, useEffect, useRef, useState } from 'react';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { BookOpen, Plus, FolderPlus, Search, PenLine, ArrowLeft, Check, X } from 'lucide-react';
import { ThemeProvider } from '@/lib/theme';
import { PreferencesProvider } from '@/lib/preferences';
import { Viewer } from '@/components/Viewer';
import { Button } from '@/components/ui/button';
import { tauri, onFolderChanged, onFileChanged, type Folder, type IndexedFile, type DocumentSnapshot, type ReadingMark } from '@/lib/tauri';
import { clearDraft, documentTitle, readDraft, relativeTime, visibleDocuments, writeDraft } from '@/lib/shelf';
import '@/styles/shelf.css';
import { localDocumentPath } from '@/lib/localPath';

interface Session { doc: DocumentSnapshot; draft: string; editing: boolean; conflict: boolean; }
function Shelf() {
  const [folders,setFolders]=useState<Folder[]>([]);
  const [files,setFiles]=useState<IndexedFile[]>([]);
  const [project,setProject]=useState('');
  const [query,setQuery]=useState('');
  const [requiredOnly,setRequiredOnly]=useState(false);
  const [marks,setMarks]=useState<ReadingMark[]>([]);
  const [session,setSessionState]=useState<Session|null>(null);
  const current=useRef<Session|null>(null);
  const setSession=useCallback((value: Session|null)=>{current.current=value;setSessionState(value);},[]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [hint,setHint]=useState('');
  const [creating,setCreating]=useState(false);
  const [newProject,setNewProject]=useState('');
  const [newName,setNewName]=useState('');
  const request=useRef(0);
  const searchRef=useRef<HTMLInputElement>(null);
  const refreshSerial=useRef(0);

  const refresh=useCallback(async()=>{
    const serial=++refreshSerial.current;
    const [nextFolders,nextFiles,nextMarks]=await Promise.all([tauri.listFolders(),tauri.listDocuments(),tauri.listReadingMarks().catch(e=>{setError(String(e));return null;})]);
    if(serial===refreshSerial.current){setFolders(nextFolders);setFiles(nextFiles);if(nextMarks)setMarks(nextMarks);}
  },[]);
  const preserve=useCallback(()=>{
    const s=current.current;
    if(!s||s.draft===s.doc.content)return true;
    try{writeDraft(s.doc.path,{text:s.draft,baseHash:s.doc.hash});return true;}
    catch{setError('无法保存本机草稿，请先复制正文或保存原文件，再离开。');return false;}
  },[]);
  const openDocument=useCallback(async(path:string)=>{
    if(!preserve())return;
    const serial=++request.current;
    setError('');setHint('');
    try{
      const doc=await tauri.readDocument(path);
      if(serial!==request.current)return;
      const recovered=readDraft(doc.path);
      const pending=recovered&&recovered.text!==doc.content?recovered:null;
      setSession({doc:pending?{...doc,hash:pending.baseHash}:doc,draft:pending?.text??doc.content,editing:!!pending,conflict:!!pending&&pending.baseHash!==doc.hash});
      setCreating(false);
      if(pending)setHint('已恢复本机草稿，原文件尚未改变。');
      localStorage.setItem('markdown-shelf:last-file',doc.path);
    }catch(e){if(serial===request.current)setError(String(e));}
  },[preserve,setSession]);
  useEffect(()=>{
    let disposed=false;
    void(async()=>{
      try{
        const initial=await tauri.getInitialTarget();
        await refresh();if(disposed)return;
        const last=initial.kind==='file'?initial.path:localStorage.getItem('markdown-shelf:last-file');
        if(last)void openDocument(last);
      }catch(e){if(!disposed)setError(String(e));}
    })();
    return()=>{disposed=true;};
  },[refresh,openDocument]);
  useEffect(()=>{
    const sync=async()=>{
      try{
        await refresh();const before=current.current;if(!before)return;
        const doc=await tauri.readDocument(before.doc.path);
        if(current.current!==before||doc.hash===before.doc.hash)return;
        if(before.editing&&before.draft!==before.doc.content)setSession({...before,conflict:true});
        else{setSession({...before,doc,draft:doc.content,conflict:false});setHint('已同步外部更新');}
      }catch(e){
        const s=current.current;if(s)setSession({...s,conflict:true});
        setError('文件读取失败或已被移除；草稿保留。'+String(e));
      }
    };
    const listeners=[onFolderChanged(()=>{void sync();}),onFileChanged(()=>{void sync();})];
    const onFocus=()=>{void sync();};window.addEventListener('focus',onFocus);
    const timer=window.setInterval(()=>{void sync();},5000);
    return()=>{listeners.forEach(p=>{void p.then(off=>off());});window.removeEventListener('focus',onFocus);clearInterval(timer);};
  },[refresh,setSession]);
  useEffect(()=>{
    const listener=getCurrentWindow().onCloseRequested(e=>{if(!preserve())e.preventDefault();});
    return()=>{void listener.then(off=>off());};
  },[preserve]);
  async function addProject(){
    try{const path=await open({directory:true,multiple:false,title:'添加项目文件夹'});
      if(typeof path==='string'){await tauri.addFolder(path);await refresh();setError('');}
    }catch(e){setError(String(e));}
  }
  async function removeProject(){
    const folder=folders.find(f=>f.id===project);if(!folder||!preserve())return;
    if(!await confirm(`从书架移除“${folder.name}”？原文件和本机草稿都会保留。`,{title:'移除项目',kind:'warning'}))return;
    try{await tauri.removeFolder(folder.id);setProject('');await refresh();}catch(e){setError(String(e));}
  }
  async function save(){
    const s=current.current;if(!s||busy||s.conflict)return;
    setBusy(true);setError('');
    try{const doc=await tauri.saveDocument(s.doc.path,s.draft,s.doc.hash);
      setSession({doc,draft:doc.content,editing:false,conflict:false});clearDraft(doc.path);
      setHint('已保存到原文件');await refresh();
    }catch(e){preserve();setSession({...s,conflict:true});setError(String(e));}
    finally{setBusy(false);}
  }
  async function discard(){
    const s=current.current;if(!s)return;
    if(s.draft!==s.doc.content&&!await confirm('放弃本机草稿，重新读取原文件？',{title:'重新读取',kind:'warning'}))return;
    try{const doc=await tauri.readDocument(s.doc.path);clearDraft(doc.path);
      setSession({doc,draft:doc.content,editing:false,conflict:false});setError('');setHint('已重新读取原文件');
    }catch(e){setError(String(e));}
  }
  function beginCreate(){
    if(!preserve())return;++request.current;setNewProject(project||folders[0]?.id||'');setNewName('');setCreating(true);setError('');
  }
  async function create(){
    if(busy)return;setBusy(true);setError('');
    try{const name=/\.(md|markdown|mdx)$/i.test(newName)?newName:newName+'.md';
      const doc=await tauri.createDocument(newProject,name);
      setSession({doc,draft:doc.content,editing:true,conflict:false});setCreating(false);setProject(newProject);setQuery('');
      localStorage.setItem('markdown-shelf:last-file',doc.path);setHint('已新建，直接开始写作');await refresh();
    }catch(e){setError(String(e));}finally{setBusy(false);}
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(!(e.metaKey||e.ctrlKey))return;
      if(e.key.toLowerCase()==='s'){e.preventDefault();void save();}
      if(e.key.toLowerCase()==='n'){e.preventDefault();beginCreate();}
      if(e.key.toLowerCase()==='k'){e.preventDefault();searchRef.current?.focus();}
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  });
  const markFor=(f:IndexedFile)=>marks.find(m=>m.folder_id===f.folder_id&&m.path===f.absolute_path);
  const documents=visibleDocuments(files,project,query).filter(f=>!requiredOnly||markFor(f));
  const selectedFile=files.find(f=>f.absolute_path===session?.doc.path);
  const dirty=!!session&&session.draft!==session.doc.content;
  const selectedMark=selectedFile?markFor(selectedFile):undefined;
  async function changeReading(action:'set'|'confirm'|'remove') {
    const before=current.current;
    if(!before||!selectedFile||before.editing||before.conflict||busy)return;
    setBusy(true);setError('');
    try {await tauri.updateReadingMark(selectedFile.folder_id,before.doc.path,before.doc.hash,action);await refresh();setHint(action==='remove'?'已移出项目必读，原文件保留':'已确认此版本为项目必读');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  }
  return <div className="shelf">
    <aside className="shelf-sidebar" aria-label="文档书架">
      <header className="shelf-brand"><span className="shelf-mark"><BookOpen size={19}/></span><div><h1>文架</h1><p>让文档，好好归位。</p></div><Button variant="ghost" size="icon-sm" aria-label="添加项目" title="添加项目文件夹" onClick={()=>void addProject()}><FolderPlus size={18}/></Button></header>
      <div className="shelf-controls">
        <label className="shelf-search"><Search size={16}/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索文档或路径" aria-label="搜索文档"/><kbd>⌘K</kbd></label>
        <div className="shelf-project-row"><select aria-label="项目筛选" value={project} onChange={e=>setProject(e.target.value)}><option value="">全部项目 · {folders.length}</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>{project&&<Button variant="ghost" size="icon-xs" title="从书架移除项目，保留原文件" aria-label="移除项目" onClick={()=>void removeProject()}><X size={14}/></Button>}<Button variant="ghost" size="sm" onClick={beginCreate} disabled={!folders.length||busy}><Plus size={15}/>新建</Button></div>
      </div>
      <div className="shelf-reading-filter" role="group" aria-label="阅读范围"><button aria-pressed={!requiredOnly} onClick={()=>setRequiredOnly(false)}>全部</button><button aria-pressed={requiredOnly} onClick={()=>setRequiredOnly(true)}>项目必读</button></div>
      <div className="shelf-list-heading"><span>{requiredOnly?"项目必读":"最近更新"}</span><span>{documents.length} 篇</span></div>
      <nav className="shelf-list" aria-label="文档列表">{documents.map(f=><button key={f.absolute_path} disabled={busy} className={'shelf-document '+(session?.doc.path===f.absolute_path?'is-active':'')} onClick={()=>void openDocument(f.absolute_path)} title={`${f.folder_name}/${f.relative_path}`}><div className="shelf-document-title">{documentTitle(f.relative_path)}{markFor(f)&&<small className="reading-badge">{markFor(f)?.state==="confirmed"?"必读":"待复核"}</small>}{session?.doc.path===f.absolute_path&&dirty&&<span className="draft-dot" title="未保存草稿"/>}</div><div className="shelf-document-meta"><span>{f.folder_name}</span><time dateTime={new Date(f.modified_ms).toISOString()}>{relativeTime(f.modified_ms)}</time></div><div className="shelf-document-path">{f.relative_path}</div></button>)}{!documents.length&&<div className="shelf-list-empty">{folders.length?(requiredOnly?'阅读文档后，点击“设为项目必读”。':'没有找到文档，试试其他项目或关键词。'):'添加项目文件夹，自动收集其中的 Markdown。'}</div>}</nav>
      <footer className="shelf-sidebar-footer"><span className="shelf-live-dot"/>本地文件 · 自动更新</footer>
    </aside>
    <main className="shelf-main" aria-label="文档正文">
      {error&&<div className="shelf-message error" role="alert">{error}<button aria-label="关闭提示" onClick={()=>setError('')}>×</button></div>}
      {creating?<section className="shelf-new"><span className="shelf-eyebrow">开始一篇新文档</span><h2>把想法写下来。</h2><p>保存为普通 Markdown，与你的项目放在一起。</p><form onSubmit={e=>{e.preventDefault();void create();}}><label>保存到项目<select value={newProject} onChange={e=>setNewProject(e.target.value)} aria-label="新文档所属项目">{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>文档名称<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} placeholder="例如：设计笔记.md" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="文档名称" maxLength={160}/></label><div className="shelf-new-actions"><Button type="button" variant="ghost" onClick={()=>setCreating(false)}>取消</Button><Button disabled={!newProject||!newName.trim()||busy} type="submit">创建文档</Button></div></form></section>
      :session?<>
        <header className="shelf-reader-header"><div className="shelf-reader-location"><span>{selectedFile?.folder_name||'本地项目'}</span><span>/</span><span title={session.doc.path}>{selectedFile?.relative_path||session.doc.path.split('/').pop()}</span></div><div className="shelf-reader-actions">{session.editing?<><span className="shelf-save-state">{dirty?'草稿 · 原文件未改变':'未修改'}</span><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void discard()}><ArrowLeft size={14}/>返回阅读</Button><Button size="sm" disabled={busy||session.conflict||!dirty} onClick={()=>void save()}><Check size={14}/>{busy?'保存中…':'保存'}</Button></>:<>{selectedMark?<><span className="shelf-save-state">{selectedMark.state==='confirmed'?'项目必读':'内容已更新，待复核'}</span>{selectedMark.state!=='confirmed'&&<Button variant="ghost" size="sm" disabled={busy||session.conflict||!selectedFile} onClick={()=>void changeReading('confirm')}>确认更新</Button>}<Button variant="ghost" size="sm" disabled={busy||!selectedFile} onClick={()=>void changeReading('remove')}>移出必读</Button></>:<Button variant="ghost" size="sm" disabled={busy||session.conflict||!selectedFile} onClick={()=>void changeReading('set')}>设为项目必读</Button>}<Button variant="ghost" size="sm" disabled={busy} onClick={()=>{setSession({...session,editing:true});setHint('');}}><PenLine size={15}/>编辑</Button></>}</div></header>
        {session.conflict&&<div className="shelf-message conflict" role="status">原文件已变化或无法读取。你的草稿保留，暂不覆盖。<Button variant="outline" size="sm" disabled={busy} onClick={()=>void discard()}>重新读取</Button></div>}
        <div className="shelf-document-body" onClick={e=>{
          const a=(e.target as HTMLElement).closest('a');if(!a)return;
          const href=a.getAttribute('href')||'';if(href.startsWith('#'))return;e.preventDefault();
          if(/^https?:\/\//i.test(href))void openUrl(href).catch(e=>setError(String(e)));
          else if(!/^[a-z][a-z0-9+.-]*:/i.test(href)){try{void openDocument(localDocumentPath(session.doc.path,href));}catch(e){setError(String(e));}}
        }}>{session.editing?<textarea className="shelf-editor" aria-label="Markdown 编辑器" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={busy} value={session.draft} onChange={e=>{
          const value={...session,draft:e.target.value};setSession(value);setHint('');
          try{writeDraft(value.doc.path,{text:value.draft,baseHash:value.doc.hash});}catch{setError('本机草稿保存失败，请及时保存或复制正文。');}
        }}/>:<Viewer key={session.doc.path} source={session.doc.content} filePath={session.doc.path}/>}</div>
        <footer className="shelf-reader-footer"><span>{session.editing?'Markdown · UTF-8 · ⌘S 保存':hint||'原文件阅读 · 点击编辑开始写作'}</span><span>{(session.editing?session.draft:session.doc.content).length.toLocaleString()} 字符</span></footer>
      </>:<section className="shelf-welcome"><span className="shelf-eyebrow">你的本地文档书架</span><h2>散落的文档，<br/>在这里相遇。</h2><p>添加项目，看见最近更新。<br/>读一篇文档，或开始写下新的想法。</p><Button onClick={()=>void addProject()}><FolderPlus size={16}/>{folders.length?"添加项目文件夹":"添加第一个项目"}</Button><div className="shelf-welcome-note">文件留在原处 · 没有账号 · 无需模型</div></section>}
    </main>
  </div>;
}
export default function App(){return <ThemeProvider><PreferencesProvider><Shelf/></PreferencesProvider></ThemeProvider>;}
