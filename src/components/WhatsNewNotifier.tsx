import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {API_BASE_URL} from '../config/api';

type Post={id:string;title:string;summary:string;date:string;changes:{text:string;category:string}[]};
const SEEN='movix-whats-new-seen';
const readSeen=()=>{try{return JSON.parse(localStorage.getItem(SEEN)||'[]') as string[]}catch{return []}};
const formatDate=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric'}).format(date)};
const categoryLabel=(category:string)=>category==='new'?'NOUVEAU':category==='modified'?'AMÉLIORATION':'CORRECTIF';

export default function WhatsNewNotifier(){
 const [post,setPost]=useState<Post|null>(null);
 useEffect(()=>{let active=true;const check=async()=>{try{const r=await fetch(API_BASE_URL+'/api/whats-new',{cache:'no-store'});if(!r.ok)return;const j=await r.json();const posts=(j.posts||[]) as Post[];const seen=readSeen();const latest=posts.find(p=>!seen.includes(p.id));if(active&&latest)setPost(latest)}catch{}};
 void check();const timer=window.setInterval(check,180000);return()=>{active=false;window.clearInterval(timer)}},[]);
 const close=()=>{if(post){try{localStorage.setItem(SEEN,JSON.stringify([...readSeen(),post.id]))}catch{}setPost(null)}};
 if(!post)return null;
 const changes=Array.isArray(post.changes)?post.changes:[];
 return createPortal(
  <div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
   <section role="dialog" aria-modal="true" aria-labelledby="whats-new-title" className="relative flex max-h-[88vh] w-full max-w-[540px] flex-col overflow-hidden rounded-[22px] border border-[#cba66b]/35 bg-[#171511] text-white shadow-[0_28px_100px_rgba(0,0,0,.72),0_0_45px_rgba(203,166,107,.08)]">
    <div className="h-[3px] w-full shrink-0 bg-gradient-to-r from-[#8f6937] via-[#e2c18b] to-[#8f6937]"/>
    <div className="flex items-start gap-4 px-6 pb-5 pt-6 sm:px-7 sm:pt-7">
     <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#cba66b]/25 bg-[#cba66b]/10 text-[23px] text-[#e4c38d] shadow-inner" aria-hidden="true">✦</div>
     <div className="min-w-0 flex-1 pt-0.5">
      <div className="flex flex-wrap items-center gap-2">
       <span className="text-[10px] font-extrabold uppercase tracking-[.2em] text-[#d8b477]">Du nouveau sur Movix</span>
       <span className="h-1 w-1 rounded-full bg-[#cba66b]"/>
       {formatDate(post.date)&&<span className="text-[11px] text-white/40">{formatDate(post.date)}</span>}
      </div>
      <h2 id="whats-new-title" className="mt-2 text-[22px] font-extrabold leading-[1.2] tracking-[-.035em] text-white sm:text-[25px]">{post.title}</h2>
     </div>
     <button type="button" onClick={close} aria-label="Fermer" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl leading-none text-white/40 transition hover:bg-white/[.07] hover:text-white">×</button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-7">
     <p className="max-w-[58ch] text-[14px] leading-[1.75] text-[#b9b3a8]">{post.summary}</p>
     {changes.length>0&&<div className="mt-6 space-y-4 border-t border-white/[.08] pt-5">{changes.map((change,i)=><div key={i} className="flex items-start gap-3"><span className="mt-0.5 shrink-0 rounded-md border border-[#cba66b]/15 bg-[#cba66b]/10 px-2 py-1 text-[9px] font-extrabold tracking-[.08em] text-[#e0bd82]">{categoryLabel(change.category)}</span><p className="text-[13px] leading-[1.7] text-white/80">{change.text}</p></div>)}</div>}
    </div>
    <footer className="shrink-0 border-t border-white/[.08] bg-black/10 px-5 pb-5 pt-4 sm:px-7 sm:pb-6">
     <a href="/nouveautes" onClick={close} className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#d9b77e] to-[#c49a5c] px-4 py-3.5 text-[13px] font-extrabold text-[#17120a] shadow-[0_5px_18px_rgba(203,166,107,.16)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#e4c38d] focus-visible:ring-offset-2 focus-visible:ring-offset-[#171511]">Voir toutes les nouveautés <span className="transition-transform group-hover:translate-x-1">→</span></a>
     <button type="button" onClick={close} className="mt-3 w-full rounded-lg py-1.5 text-[12px] font-semibold text-white/45 transition hover:text-white/80">Plus tard</button>
    </footer>
   </section>
  </div>,document.body);
}