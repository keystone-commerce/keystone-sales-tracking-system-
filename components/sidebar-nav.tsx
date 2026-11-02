'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import type {Icon} from '@tabler/icons-react';

type NavItem<Id extends string>={id:Id;label:string;group:string;icon:Icon};

export function SidebarNav<Id extends string>({items,activeId,onSelect,counts}:{
 items:NavItem<Id>[];
 activeId:Id;
 onSelect:(id:Id)=>void;
 counts:Partial<Record<Id,number>>;
}){
 const content=useRef<HTMLDivElement>(null);
 const [highlight,setHighlight]=useState<{top:number;height:number}|null>(null);
 const layoutKey=items.map(item=>item.id+':'+item.group).join('|');

 useLayoutEffect(()=>{
  const container=content.current;if(!container)return;
  const measure=()=>{
   const active=container.querySelector<HTMLElement>('[aria-current="page"]');
   if(!active){setHighlight(null);return;}
   const bounds=active.getBoundingClientRect(),parent=container.getBoundingClientRect();
   const next={top:bounds.top-parent.top,height:bounds.height};
   setHighlight(current=>current?.top===next.top&&current.height===next.height?current:next);
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(container);
  return()=>observer.disconnect();
 },[activeId,layoutKey]);

 return <nav aria-label="Main navigation" className={'sidebar-nav'+(highlight?' has-active-indicator':'')}>
  <div className="sidebar-nav-content" ref={content}>
   {highlight&&<span className="nav-active-indicator" aria-hidden="true" style={{height:highlight.height,transform:`translateY(${highlight.top}px)`}}/>}
   {items.map((item,index)=><div key={item.id}>
    {(index===0||item.group!==items[index-1].group)&&<div className="nav-group">{item.group}</div>}
    <button aria-label={item.label} aria-current={activeId===item.id?'page':undefined} className={'nav-item '+(activeId===item.id?'active':'')} onClick={()=>onSelect(item.id)}>
     <item.icon size={17} stroke={1.6}/><span>{item.label}</span>
     {(counts[item.id]??0)>0&&<span className={'nav-count'+(item.id==='quality'?' warn':'')}>{counts[item.id]}</span>}
    </button>
   </div>)}
  </div>
 </nav>;
}
