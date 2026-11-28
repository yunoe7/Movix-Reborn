import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MAIN_API } from '../config/runtime';
import { useAdminConfirm } from './admin/AdminConfirmProvider';

type Post = { id:string; title:string; summary:string; date:string; status:'draft'|'published'; changes:{text:string;category:'new'|'modified'|'fix'}[] };
const empty = { title:'', summary:'', status:'draft' as const, changes:[] as {text:string;category:'new'|'modified'|'fix'}[] };
const cls='w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-amber-300/50';
const headers=()=>({Authorization:'Bearer '+(localStorage.getItem('auth_token')||''),'Content-Type':'application/json'});

export default function AdminWhatsNew(){
  const { t } = useTranslation();
  const { confirm } = useAdminConfirm();
  const [posts,setPosts]=useState<Post[]>([]),[draft,setDraft]=useState<typeof empty>(empty),[line,setLine]=useState(''),[category,setCategory]=useState<'new'|'modified'|'fix'>('new'),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const load=useCallback(async()=>{try{const r=await fetch(MAIN_API+'/api/admin/whats-new',{headers:headers(),cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error);setPosts(j.posts||[]);}catch(e){toast.error(e instanceof Error?e.message:t('adminComms.loadError'))}},[t]);
  useEffect(()=>{void load()},[load]);
  const reset=()=>{setDraft(empty);setEditing(null);setLine('')};
  const save=async(status:'draft'|'published')=>{setBusy(true);try{const payload={...draft,status};const r=await fetch(MAIN_API+'/api/admin/whats-new'+(editing?'/'+editing:''),{method:editing?'PUT':'POST',headers:headers(),body:JSON.stringify(payload)});const j=await r.json();if(!r.ok)throw Error(j.error);toast.success(status==='published'?t('adminComms.publishedToast'):t('adminComms.draftToast'));reset();await load()}catch(e){toast.error(e instanceof Error?e.message:t('adminComms.saveError'))}finally{setBusy(false)}};
  const edit=(p:Post)=>{setEditing(p.id);setDraft({title:p.title,summary:p.summary,status:p.status,changes:p.changes||[]})};
  const remove=async(id:string)=>{
    const ok=await confirm({
      title:t('adminComms.deleteTitle'),
      message:t('adminComms.deleteMessage'),
      confirmLabel:t('adminComms.delete'),
      destructive:true,
    });
    if(!ok)return;
    try{const r=await fetch(MAIN_API+'/api/admin/whats-new/'+id,{method:'DELETE',headers:headers()});if(!r.ok)throw Error();toast.success(t('adminComms.deletedToast'));await load()}catch{toast.error(t('adminComms.deleteError'))}
  };
  const changeLabel = (value: 'new'|'modified'|'fix') => (
    value === 'new' ? t('adminComms.changeNew')
      : value === 'modified' ? t('adminComms.changeModified') : t('adminComms.changeFix')
  );
  return <div className="mx-auto max-w-5xl space-y-6 text-white">
   <header><p className="text-[10px] font-bold uppercase tracking-[.2em] text-white/40">{t('adminComms.eyebrow')}</p><h2 className="mt-1 text-2xl font-bold">{t('adminComms.title')}</h2><p className="mt-1 text-sm text-white/55">{t('adminComms.intro')}</p></header>
   <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[.025] p-5">
    <div className="flex items-center justify-between"><h3 className="font-semibold">{editing?t('adminComms.editPost'):t('adminComms.newPost')}</h3>{editing&&<button onClick={reset} className="text-xs text-white/50">{t('common.cancel', 'Annuler')}</button>}</div>
    <input className={cls} placeholder={t('adminComms.titlePlaceholder')} maxLength={160} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/>
    <textarea className={cls+' min-h-24'} placeholder={t('adminComms.postSummaryPlaceholder')} maxLength={600} value={draft.summary} onChange={e=>setDraft({...draft,summary:e.target.value})}/>
    <div className="flex flex-wrap gap-2">{draft.changes.map((c,i)=><div key={i} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs"><span className="text-amber-200">{changeLabel(c.category)}</span><span>{c.text}</span><button onClick={()=>setDraft({...draft,changes:draft.changes.filter((_,n)=>n!==i)})} aria-label={t('adminComms.remove')}>×</button></div>)}</div>
    <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]"><input className={cls} placeholder={t('adminComms.changePlaceholder')} value={line} onChange={e=>setLine(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(line.trim()){setDraft({...draft,changes:[...draft.changes,{text:line.trim(),category}]});setLine('')}}}}/><select className={cls} value={category} onChange={e=>setCategory(e.target.value as 'new'|'modified'|'fix')}><option value="new">{t('adminComms.optionNew')}</option><option value="modified">{t('adminComms.optionModified')}</option><option value="fix">{t('adminComms.optionFix')}</option></select><button className="rounded-xl border border-white/15 px-4 text-sm" onClick={()=>{if(line.trim()){setDraft({...draft,changes:[...draft.changes,{text:line.trim(),category}]});setLine('')}}}>{t('adminComms.add')}</button></div>
    <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={()=>void save('draft')} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm">{t('adminComms.saveDraft')}</button><button disabled={busy} onClick={()=>void save('published')} className="rounded-xl bg-[#cba66b] px-5 py-2.5 text-sm font-bold text-black">{busy?t('adminComms.saving'):t('adminComms.publishNow')}</button></div>
   </section>
   <section className="space-y-3"><h3 className="font-semibold">{t('adminComms.postsTitle')}</h3>{posts.length===0&&<p className="rounded-xl border border-white/10 p-5 text-sm text-white/45">{t('adminComms.noPosts')}</p>}{posts.map(p=><article key={p.id} className="flex flex-col gap-3 rounded-xl border border-white/10 p-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={'rounded px-2 py-1 text-[10px] font-bold '+(p.status==='published'?'bg-emerald-400/15 text-emerald-200':'bg-white/10 text-white/55')}>{p.status==='published'?t('adminComms.published'):t('adminComms.draft')}</span><span className="text-xs text-white/40">{new Date(p.date).toLocaleDateString('fr-FR')}</span></div><h4 className="mt-2 font-semibold">{p.title}</h4><p className="line-clamp-2 text-sm text-white/55">{p.summary}</p></div><div className="flex gap-2"><button onClick={()=>edit(p)} className="rounded-lg border border-white/15 px-3 py-2 text-xs">{t('adminComms.edit')}</button><button onClick={()=>void remove(p.id)} className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-200">{t('adminComms.delete')}</button></div></article>)}</section>
  </div>;
}
