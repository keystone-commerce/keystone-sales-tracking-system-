'use client';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {IconPlus,IconSearch} from '@tabler/icons-react';
import {api,type Actor} from '@/lib/data';
import {can,prerequisites,type AccessOverview,type AccessRole,type AccessTeam,type AccessUser} from '@/lib/access';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';

type Kind='users'|'roles'|'teams';
type Subject={kind:Kind;user?:AccessUser;role?:AccessRole;team?:AccessTeam};
export function AdminAccess({actor,onSaved}:{actor:Actor;onSaved:(message:string)=>void}){
 const [tab,setTab]=useState<Kind>('users'),[search,setSearch]=useState(''),[editing,setEditing]=useState<Subject|null>(null);
 const query=useQuery({queryKey:['access'],queryFn:()=>api<AccessOverview>('/access'),refetchInterval:15000});
 const manage=can(actor,'access.manage');
 if(query.isPending)return <div className="empty-state">Loading access…</div>;
 if(query.error)return <div className="error-box" role="alert">{query.error.message}<Button variant="outline" onClick={()=>void query.refetch()}>Retry</Button></div>;
 const data=query.data!;
 const matches=(values:unknown[])=>values.some(value=>String(value).toLowerCase().includes(search.toLowerCase()));
 const roleNames=(ids:string[])=>ids.map(id=>data.roles.find(r=>r.id===id)?.name||'—').join(', ')||'—';
 return <><section className="surface"><div className="access-toolbar"><div className="access-tabs" role="tablist" aria-label="Access sections">{(['users','roles','teams'] as Kind[]).map(kind=><button role="tab" aria-selected={tab===kind} className={tab===kind?'selected':''} key={kind} onClick={()=>{setTab(kind);setSearch('');}}>{kind[0].toUpperCase()+kind.slice(1)}<span>{data[kind].length}</span></button>)}</div>{manage&&<Button size="sm" onClick={()=>setEditing({kind:tab})}><IconPlus size={14}/>New {tab==='users'?'user':tab==='roles'?'role':'team'}</Button>}</div><div className="register-toolbar"><div className="search-input"><IconSearch size={15}/><Input aria-label="Search access" placeholder={`Search ${tab}…`} value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
 <div className="table-scroll"><table><thead><tr>{tab==='users'?<><th>User</th><th>Roles</th><th>Teams</th><th>Permissions</th><th>Status</th></>:tab==='roles'?<><th>Role</th><th>Type</th><th>Permissions</th><th>Members</th></>:<><th>Team</th><th>Roles</th><th>Direct grants</th><th>Members</th></>}<th>Action</th></tr></thead><tbody>
 {tab==='users'&&data.users.filter(u=>matches([u.name,u.email,roleNames(u.role_ids),...u.effective_permissions])).map(u=><tr key={u.id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td>{u.is_super_admin?<span className="status green">Platform administrator</span>:roleNames(u.role_ids)}</td><td>{u.team_ids.map(id=>data.teams.find(t=>t.id===id)?.name).join(', ')||'—'}</td><td>{u.effective_permissions.length}</td><td><span className={'status '+(u.active?'green':'neutral')}>{u.active?'Active':'Inactive'}</span></td><td><Button variant="ghost" size="sm" disabled={u.is_super_admin&&!actor.is_super_admin} onClick={()=>setEditing({kind:'users',user:u})}>{manage?'Edit access':'View access'}</Button></td></tr>)}
 {tab==='roles'&&data.roles.filter(r=>matches([r.name,...r.permissions])).map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.is_system?'System':'Custom'}</td><td>{r.permissions.length}</td><td>{data.users.filter(u=>u.role_ids.includes(r.id)||u.team_ids.some(id=>data.teams.find(t=>t.id===id)?.role_ids.includes(r.id))).length}</td><td><Button variant="ghost" size="sm" onClick={()=>setEditing({kind:'roles',role:r})}>{r.is_system||!manage?'View permissions':'Edit role'}</Button></td></tr>)}
 {tab==='teams'&&data.teams.filter(t=>matches([t.name,roleNames(t.role_ids)])).map(t=><tr key={t.id}><td><strong>{t.name}</strong></td><td>{roleNames(t.role_ids)}</td><td>{t.permissions.length}</td><td>{t.member_ids.length}</td><td><Button variant="ghost" size="sm" onClick={()=>setEditing({kind:'teams',team:t})}>{manage?'Edit team':'View team'}</Button></td></tr>)}
 </tbody></table>{data[tab].length===0&&<div className="empty-state">No {tab} yet</div>}</div></section>
 {editing&&<AccessEditor key={editing.kind+(editing.user?.id||editing.role?.id||editing.team?.id||'new')} subject={editing} data={data} actor={actor} onClose={()=>setEditing(null)} onSaved={onSaved}/>}</>;
}

function AccessEditor({subject,data,actor,onClose,onSaved}:{subject:Subject;data:AccessOverview;actor:Actor;onClose:()=>void;onSaved:(message:string)=>void}){
 const {kind,user,role,team}=subject,id=user?.id||role?.id||team?.id,existing=user||role||team;
 const readOnly=!can(actor,'access.manage')||role?.is_system===true;
 const [name,setName]=useState(existing?.name||''),[email,setEmail]=useState(user?.email||'');
 const [roles,setRoles]=useState<string[]>(user?.role_ids||team?.role_ids||[]),[grants,setGrants]=useState<string[]>(existing?.permissions||[]),[teams,setTeams]=useState<string[]>(user?.team_ids||[]),[members,setMembers]=useState<string[]>(team?.member_ids||[]),[active,setActive]=useState(user?.active??true),[dirty,setDirty]=useState(false),[filter,setFilter]=useState('');
 const qc=useQueryClient();
 const inherited=new Set<string>();
 for(const r of data.roles)if(roles.includes(r.id)||data.teams.some(t=>teams.includes(t.id)&&t.role_ids.includes(r.id)))for(const p of r.permissions)inherited.add(p);
 for(const t of data.teams)if(teams.includes(t.id))for(const p of t.permissions)inherited.add(p);
 if(user?.is_super_admin)for(const p of data.permissions)inherited.add(p.key);
 const permitted=(keys:string[])=>keys.every(key=>can(actor,key));
 const teamPermissions=(t:AccessTeam)=>[...t.permissions,...data.roles.filter(r=>t.role_ids.includes(r.id)).flatMap(r=>r.permissions)];
 function toggle(values:string[],id:string){return values.includes(id)?values.filter(v=>v!==id):[...values,id];}
 function permissionKeys(key:string){const [entity,action]=key.split('.');return ['customers','orders','sourcing','dispatches','invoices','receipts','tasks'].includes(entity)?prerequisites(entity as Parameters<typeof prerequisites>[0],action):key==='access.manage'?['access.manage','access.users.read']:[key];}
 function toggleGrant(key:string){setDirty(true);setGrants(old=>old.includes(key)?old.filter(k=>k!==key):[...new Set([...old,...permissionKeys(key)])]);}
 const mutation=useMutation({mutationFn:async()=>{
  const body=kind==='users'?{...(id?{version:user!.access_version,active}:{name,email}),role_ids:roles,permissions:grants,team_ids:teams}:kind==='roles'?{name,permissions:grants,...(id?{version:role!.version}:{})}:{name,role_ids:roles,permissions:grants,member_ids:members,...(id?{version:team!.version}:{})};
  return api(`/access/${kind}${id?'/'+id:''}`,{method:id?'PUT':'POST',body:JSON.stringify(body)});
 },onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:['access']}),qc.invalidateQueries({queryKey:['actor']}),qc.invalidateQueries({queryKey:['workspace']})]);onSaved('Access saved');onClose();}});
 function close(){if(mutation.isPending)return;if(!dirty||window.confirm('Discard unsaved changes?'))onClose();}
 const groups=[...new Set(data.permissions.map(p=>p.group))];
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="sm:max-w-[880px] max-h-[90dvh] overflow-y-auto" onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>{readOnly?'View':id?'Edit':'New'} {kind==='users'?'user access':kind==='roles'?'role':'team'}</DialogTitle><DialogDescription className="sr-only">Roles and permissions</DialogDescription></DialogHeader><form className="record-form" onSubmit={e=>{e.preventDefault();mutation.mutate();}}>
 <div className="field-grid"><label><span>Name *</span><Input aria-label="Access name" required minLength={2} maxLength={100} disabled={readOnly||kind==='users'&&!!id} value={name} onChange={e=>{setDirty(true);setName(e.target.value);}}/></label>{kind==='users'&&<><label><span>Email *</span><Input aria-label="Access email" type="email" required disabled={readOnly||!!id} value={email} onChange={e=>{setDirty(true);setEmail(e.target.value);}}/></label>{id&&<label><span>Status</span><select aria-label="Account status" value={active?'active':'inactive'} disabled={readOnly||id===actor.id} onChange={e=>{setDirty(true);setActive(e.target.value==='active');}}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}</>}</div>
 {kind!=='roles'&&<section className="access-section"><h3>Roles</h3><div className="access-choices">{data.roles.map(r=><label key={r.id}><input type="checkbox" aria-label={'Role: '+r.name} checked={roles.includes(r.id)} disabled={readOnly||user?.is_super_admin||!permitted(r.permissions)} onChange={()=>{setDirty(true);setRoles(old=>toggle(old,r.id));}}/><span>{r.name}<small>{r.permissions.length} permissions</small></span></label>)}</div></section>}
 {kind==='users'&&data.teams.length>0&&<section className="access-section"><h3>Teams</h3><div className="access-choices">{data.teams.map(t=><label key={t.id}><input type="checkbox" aria-label={'Team: '+t.name} checked={teams.includes(t.id)} disabled={readOnly||user?.is_super_admin||!permitted(teamPermissions(t))} onChange={()=>{setDirty(true);setTeams(old=>toggle(old,t.id));}}/>{t.name}</label>)}</div></section>}
 {kind==='teams'&&<section className="access-section"><h3>Members</h3><div className="access-choices">{data.users.map(u=><label key={u.id}><input type="checkbox" aria-label={'Member: '+u.email} checked={members.includes(u.id)} disabled={readOnly} onChange={()=>{setDirty(true);setMembers(old=>toggle(old,u.id));}}/><span>{u.name}<small>{u.email}</small></span></label>)}</div></section>}
 <section className="access-section"><div className="sku-heading"><h3>{kind==='roles'?'Permissions':'Direct permissions'}</h3><Input className="permission-search" aria-label="Search permissions" placeholder="Find permission…" value={filter} onChange={e=>setFilter(e.target.value)}/></div><div className="permission-groups">{groups.map(group=>{const list=data.permissions.filter(p=>p.group===group&&(`${group} ${p.label} ${p.key}`).toLowerCase().includes(filter.toLowerCase()));return list.length?<fieldset key={group}><legend>{group}</legend>{list.map(p=><label key={p.key}><input type="checkbox" aria-label={'Permission: '+p.key} checked={grants.includes(p.key)||inherited.has(p.key)} disabled={readOnly||inherited.has(p.key)||!permitted(permissionKeys(p.key))} onChange={()=>toggleGrant(p.key)}/><span>{p.label}</span>{inherited.has(p.key)&&<small>Inherited</small>}</label>)}</fieldset>:null;})}</div></section>
 {mutation.error&&<div className="error-box" role="alert">{mutation.error.message}</div>}<div className="form-footer"><Button type="button" variant="outline" onClick={close}>{readOnly?'Close':'Cancel'}</Button>{!readOnly&&<Button type="submit" disabled={mutation.isPending}>{mutation.isPending?'Saving…':'Save access'}</Button>}</div></form></DialogContent></Dialog>;
}
