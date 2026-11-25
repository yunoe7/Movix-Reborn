import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {API_BASE_URL} from '../config/api';
type Post={id:string;title:string;summary:string;date:string;changes:{text:string;category:string}[]};
const SEEN='movix-whats-new-seen';
const readSeen=()=>{try{return JSON.parse(localStorage.getItem(SEEN)||'[]') as string[]}catch{return []}};
export default function WhatsNewNotifier(){
 const [post,setPost]=useState<Post|null>(null);
 useEffect(()=>{let active=true;const check=async()=>{try{const r=await fetch(API_BASE_URL+'/api/whats-new',{cache:'no-store'});if(!r.ok)return;const j=await r.json();const posts=(j.posts||[]) as Post[];const seen=readSeen();const latest=posts.find(p=>!seen.includes(p.id));if(active&&latest)setPost(latest)}catch{}};
 void check();const timer=window.setInterval(check,180000);return()=>{active=false;window.clearInterval(timer)}},[]);
 const close=()=>{if(post){try{localStorage.setItem(SEEN,JSON.stringify([...readSeen(),post.id]))}catch{}setPost(null)}};
 if(!post)return null;
 return createPortal(<div className="fixed inset-0 z-[100001] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="whats-new-title" className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-2xl border border-[#cba66b]/40 bg-[#15130f] text-white shadow-2xl"><div className="max-h-[calc(88vh-76px)] overflow-y-auto p-6"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#d5b47e]">Du nouveau sur Movix</p><h2 id="whats-new-title" className="mt-2 text-xl font-extrabold">{post.title}</h2><p className="mt-3 text-sm leading-relaxed text-white/65">{post.summary}</p><ul className="mt-5 space-y-4">{post.changes.map((c,i)=><li key={i}><span className="rounded bg-[#cba66b]/15 px-2 py-1 text-[10px] font-bold text-[#e2bd82]">{c.category==='new'?'NOUVEAU':c.category==='modified'?'AMÉLIORATION':'CORRECTIF'}</span><p className="mt-2 text-sm leading-relaxed text-white/80">{c.text}</p></li>)}</ul></div><footer className="border-t border-white/10 p-4"><a href="/nouveautes" onClick={close} className="flex w-full items-center justify-center rounded-lg bg-[#cba66b] px-4 py-3 text-sm font-bold text-black">Voir toutes les nouveautés　→</a><button onClick={close} className="mt-3 w-full py-1 text-xs font-semibold text-white/50">Plus tard</button></footer></section></div>,document.body);
}