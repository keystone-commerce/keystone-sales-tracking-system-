'use client';
import {Login} from '@/components/login';
import {useEffect,useState,type ReactNode} from 'react';
import {QueryClient,QueryClientProvider,useQuery,useQueryClient} from '@tanstack/react-query';
import {IconLayoutDashboard,IconShoppingBag,IconArrowsExchange,IconTruckDelivery,IconFileInvoice,IconReceiptRupee,IconCheckbox,IconUsers,IconShieldCheck,IconSettings,IconSearch,IconPlus,IconDownload,IconArrowUpRight,IconChevronRight,IconChevronLeft,IconRefresh,IconSun,IconMoon,IconDeviceDesktop,IconLogout,IconMenu2,IconX,IconArrowRight,IconCircleCheck,IconClock,IconAlertTriangle,IconPackage,IconBuildingStore,IconExternalLink} from '@tabler/icons-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {OrderItems,LineDetails,type LineDetail} from '@/components/line-details';
import {AdminAccess} from '@/components/admin-access';
import {OrderAmendment} from '@/components/order-amendment';
import {OrderWorkflow} from '@/components/order-workflow';
import {OrderHistory} from '@/components/order-history';
import {SidebarNav} from '@/components/sidebar-nav';
import {can as hasPermission,canAct} from '@/lib/access';
import {RecordForm,type FormRequest} from '@/components/record-form';
import {vendorStatusLabel,api,currentActor,day,empty,exportRegister,formatDate,money,names,num,orderCode,singular,today,type Actor,type Integration,type Register,type Row,type Workspace} from '@/lib/data';
type Page=Register|'overview'|'quality'|'settings'|'access';
const nav:{id:Page;label:string;icon:typeof IconUsers;group:string}[]=[
 {id:'access',label:'Admin access',icon:IconShieldCheck,group:'Administration'},
 {id:'overview',label:'Overview',icon:IconLayoutDashboard,group:'Workspace'},
 {id:'orders',label:'Sales orders',icon:IconShoppingBag,group:'Operations'},
 {id:'sourcing',label:'Sourcing handoff',icon:IconArrowsExchange,group:'Operations'},
 {id:'dispatches',label:'Dispatch & delivery',icon:IconTruckDelivery,group:'Operations'},
 {id:'invoices',label:'Invoices',icon:IconFileInvoice,group:'Operations'},
 {id:'receipts',label:'Payment receipts',icon:IconReceiptRupee,group:'Operations'},
 {id:'tasks',label:'Team follow-ups',icon:IconCheckbox,group:'Operations'},
 {id:'customers',label:'Customers',icon:IconUsers,group:'Directory'},
 {id:'quality',label:'Control checks',icon:IconShieldCheck,group:'Administration'},
 {id:'settings',label:'Workspace settings',icon:IconSettings,group:'Administration'}
];
function Badge({children}:{children:ReactNode}){const s=String(children);const tone=/overdue|blocked|cancel|return/i.test(s)?'red':/draft|transit|partial|sourcing|requested|progress|open|high|pending|hold/i.test(s)?'amber':/confirm|deliver|paid|ready|complete/i.test(s)?'green':'neutral';return <span className={'status '+tone}>{children}</span>;}
function State({title,children}:{title:string;children:ReactNode}){return <div className="empty-state"><IconPackage size={26} stroke={1.3}/><strong>{title}</strong></div>;}
function ErrorState({message,retry}:{message:string;retry:()=>void}){return <div className="error-box" role="alert">{message}<Button variant="outline" size="sm" onClick={retry}>Try again</Button></div>;}
export function SalesApp(){const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15000,refetchOnWindowFocus:true}}}));return <QueryClientProvider client={client}><WorkspaceApp/></QueryClientProvider>;}
function WorkspaceApp(){
 const qc=useQueryClient();const [page,setPage]=useState<Page>('overview');const [search,setSearch]=useState('');const [status,setStatus]=useState('All statuses');const [form,setForm]=useState<FormRequest|null>(null);const [detail,setDetail]=useState<Row|null>(null);const [createdOrderId,setCreatedOrderId]=useState<string|null>(null);const [amendment,setAmendment]=useState<Row|null>(null);const [lineDetail,setLineDetail]=useState<LineDetail|null>(null);const [mobile,setMobile]=useState(false);const [notice,setNotice]=useState('');const [theme,setTheme]=useState('system');const [pageIndex,setPageIndex]=useState(0);
 const actor=useQuery({queryKey:['actor'],queryFn:currentActor,refetchInterval:q=>q.state.data?15000:false,refetchOnWindowFocus:q=>!!q.state.data,refetchOnReconnect:q=>!!q.state.data});
 const data=useQuery({queryKey:['workspace',actor.data?.id,actor.data?.permissions.join('|')],queryFn:()=>api<Workspace>('/workspace'),enabled:!!actor.data,refetchInterval:30000});
 useEffect(()=>{if(createdOrderId&&data.data){const row=data.data.orders.find(r=>r.id===createdOrderId);if(row){setDetail(row);setCreatedOrderId(null);}}else if(data.data)setDetail(current=>current?data.data!.orders.find(r=>r.id===current.id)||current:null);},[data.data,createdOrderId]);
 const integration=useQuery({queryKey:['integrations'],queryFn:()=>api<Integration>('/integrations'),enabled:!!actor.data});
 useEffect(()=>{setForm(null);setDetail(null);setLineDetail(null);setAmendment(null);},[actor.data?.permissions.join('|')]);
 useEffect(()=>{const expired=()=>{qc.clear();void actor.refetch();};window.addEventListener('sales-ops:unauthorized',expired);return()=>window.removeEventListener('sales-ops:unauthorized',expired);},[qc]);
 useEffect(()=>{const stored=localStorage.getItem('theme');if(stored&&['light','dark','system'].includes(stored))setTheme(stored);},[]);
 useEffect(()=>{const mq=matchMedia('(prefers-color-scheme: dark)');const apply=()=>document.documentElement.classList.toggle('dark',theme==='dark'||(theme==='system'&&mq.matches));apply();mq.addEventListener('change',apply);localStorage.setItem('theme',theme);return()=>mq.removeEventListener('change',apply);},[theme]);
 useEffect(()=>{const fn=(e:KeyboardEvent)=>{const el=e.target as HTMLElement;if(e.key.toLowerCase()==='d'&&!e.ctrlKey&&!e.metaKey&&!el.closest('input,textarea,select,[contenteditable="true"]'))setTheme(t=>t==='dark'?'light':'dark');};window.addEventListener('keydown',fn);return()=>window.removeEventListener('keydown',fn);},[]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);},[notice]);
 function go(p:Page){setPage(p);setSearch('');setStatus('All statuses');setPageIndex(0);setMobile(false);}
 async function logout(){try{await api('/auth/logout',{method:'POST'});qc.clear();setForm(null);setDetail(null);setLineDetail(null);go('overview');void actor.refetch();}catch(e){setNotice((e as Error).message);}}
 if(actor.isPending)return <div className="loading-screen"><span className="brand-icon"><IconBuildingStore/></span>Opening Sales Operations…</div>;
 if(!actor.data)return <Login onLogin={()=>{void qc.invalidateQueries({queryKey:['actor']});}}/>;
 const user=actor.data,w=data.data||empty;
 const isRegister=(p:Page):p is Register=>Object.hasOwn(names,p);
 const deferred=new Set(['dispatches','invoices','receipts']);
 if(integration.data?.sourcing.mode!=='manual-reference')deferred.add('sourcing');
 const has=(key:string)=>!deferred.has(key.split('.')[0])&&hasPermission(user,key);
 const can=(entity:Register,action='create')=>!deferred.has(entity)&&canAct(user,entity,action);
 const canViewTeamFollowUps=has('access.users.read')&&has('tasks.read');
 const canPage=(p:Page)=>!deferred.has(p)&&(p==='overview'||p==='settings'||(p==='tasks'||p==='quality'?canViewTeamFollowUps:has(p==='access'?'access.users.read':p+'.read')));
 const visibleNav=nav.filter(item=>canPage(item.id));
 const create=(entity:Register,orderId?:string)=>{setForm({entity,orderId});setDetail(null);};
 const current=nav.find(n=>n.id===page)!;
 const rows=isRegister(page)?w[page]:[];
 const statuses=[...new Set(rows.map(r=>String(page==='orders'?String(r.stage):page==='invoices'?num(r.outstanding_paise)===0?'Paid':day(r.due_date)<today()?'Overdue':'Open':r.status||'')).filter(Boolean))];
 const filtered=rows.filter(r=>[...Object.values(r),...(page==='orders'?w.order_items.filter(i=>i.order_id===r.id).flatMap(i=>[i.sku,i.description]):page==='invoices'?w.invoice_items.filter(i=>i.invoice_id===r.id).flatMap(i=>[i.sku,i.description]):page==='dispatches'?w.dispatch_items.filter(i=>i.dispatch_id===r.id).flatMap(i=>[i.sku,i.description]):[])].some(v=>String(v??'').toLowerCase().includes(search.toLowerCase()))&&(status==='All statuses'||(page==='orders'?String(r.stage):page==='invoices'?num(r.outstanding_paise)===0?'Paid':day(r.due_date)<today()?'Overdue':'Open':r.status)===status));
 const orderFor=(id:unknown)=>w.orders.find(o=>o.id===id);
 const customerFor=(id:unknown)=>w.customers.find(c=>c.id===id)?.name||'—';
 const columns:Record<Register,{label:string;render:(r:Row)=>ReactNode}[]>={
  orders:[{label:'Order / customer',render:r=><><strong className="mono">{orderCode(r)}</strong><small>{r.customer_name}</small></>},{label:'Product / SKUs',render:r=><><span className="truncate" title={String(r.description)}>{r.description}</span><small className="mono truncate">{r.item_count} SKU{num(r.item_count)===1?'':'s'} · {w.order_items.filter(i=>i.order_id===r.id).map(i=>i.sku||'Legacy SKU').join(', ')}</small></>},{label:'Order value · ex GST',render:r=>money(r.subtotal_paise)},{label:'Quantity',render:r=>`${r.qty} units`},{label:'Target delivery',render:r=><span className={day(r.target_date)<today()&&num(r.delivered)<num(r.qty)&&r.stage==='Confirmed'?'text-danger':''}>{formatDate(r.target_date)}</span>},{label:'Owner',render:r=>r.owner},{label:'Status',render:r=><Badge>{String(r.stage)}</Badge>}],
  customers:[{label:'Customer',render:r=><strong>{r.name}</strong>},{label:'Contact',render:r=><><strong>{r.contact_name||'—'}</strong>{r.phone&&<small>{r.phone}</small>}{r.email&&<small>{r.email}</small>}</>},{label:'GSTIN',render:r=><span className="mono">{r.gstin||'—'}</span>},{label:'Billing address',render:r=><span className="truncate" title={String(r.billing_address||'')}>{r.billing_address||'—'}</span>},{label:'Shipping address',render:r=><span className="truncate" title={String(r.shipping_address||'')}>{r.shipping_address||'—'}</span>},{label:'City / state / PIN',render:r=>[r.city,r.state,r.pin_code].filter(Boolean).join(', ')||'—'},{label:'Credit terms',render:r=>`${r.terms} days`},{label:'Customer notes',render:r=><span className="truncate" title={String(r.customer_notes||'')}>{r.customer_notes||'—'}</span>}],
  sourcing:[{label:'External reference',render:r=><strong className="mono">{r.external_ref||"—"}</strong>},{label:'Sales order',render:r=>orderCode(orderFor(r.order_id))},{label:'SKU',render:r=><span className="mono">{r.sku||'Legacy SKU'}</span>},{label:'Vendor',render:r=><div><div>{r.supplier||'Awaiting selection'}</div>{[r.vendor_gstin,r.vendor_phone,r.vendor_email].filter(Boolean).map((detail,index)=><div key={index} className='text-xs text-muted-foreground'>{detail}</div>)}</div>},{label:'Expected supply',render:r=>formatDate(r.eta)},{label:'Status',render:r=><Badge>{vendorStatusLabel(String(r.status))}</Badge>},{label:'Notes',render:r=><span className="truncate">{r.notes||'—'}</span>}],
  dispatches:[{label:'Order / customer',render:r=><><strong className="mono">{orderCode(orderFor(r.order_id))}</strong><small>{orderFor(r.order_id)?.customer_name}</small></>},{label:'Carrier / tracking',render:r=><>{r.carrier}<small className="mono">{r.tracking}</small></>},{label:'Dispatched',render:r=><>{r.qty} units<small>{r.item_count} SKU lines</small></>},{label:'Delivered / returned',render:r=>`${r.delivered_qty} / ${r.returned_qty}`},{label:'Expected delivery',render:r=>formatDate(r.expected_date)},{label:'Status',render:r=><Badge>{r.status}</Badge>}],
  invoices:[{label:'Invoice',render:r=><><strong className="mono">{r.number}</strong><small>{r.item_count} SKU lines</small></>},{label:'Order / customer',render:r=><>{orderCode(orderFor(r.order_id))}<small>{orderFor(r.order_id)?.customer_name}</small></>},{label:'Invoice total · incl GST',render:r=>money(r.total_paise)},{label:'Received',render:r=>money(r.paid_paise)},{label:'Outstanding',render:r=><strong>{money(r.outstanding_paise)}</strong>},{label:'Due date',render:r=>formatDate(r.due_date)},{label:'Status',render:r=><Badge>{num(r.outstanding_paise)===0?'Paid':day(r.due_date)<today()?'Overdue':'Open'}</Badge>}],
  receipts:[{label:'Invoice',render:r=><strong className="mono">{r.invoice_number}</strong>},{label:'Amount received',render:r=><strong>{money(r.amount_paise)}</strong>},{label:'Bank / UTR reference',render:r=><span className="mono">{r.reference}</span>},{label:'Method',render:r=>r.mode},{label:'Receipt date',render:r=>formatDate(r.receipt_date)}],
  tasks:[{label:'Required action',render:r=><strong className="truncate">{r.title}</strong>},{label:'Linked order',render:r=>orderCode(orderFor(r.order_id))},{label:'Owner',render:r=>r.owner},{label:'Due date',render:r=><span className={day(r.due_date)<today()&&r.status!=='Completed'?'text-danger':''}>{formatDate(r.due_date)}</span>},{label:'Priority',render:r=><Badge>{r.priority}</Badge>},{label:'Status',render:r=><Badge>{r.status}</Badge>}]
 };
 const issues:{title:string;detail:string;page:Page}[]=[];
 if(canViewTeamFollowUps)w.tasks.filter(t=>t.status!=='Completed'&&day(t.due_date)<today()).forEach(t=>issues.push({title:'Follow-up overdue',detail:`${t.owner} · ${t.title}`,page:'tasks'}));
 const confirmed=w.orders.filter(o=>['Confirmed','PO received','Ready for sourcing'].includes(String(o.stage)));
 const assignedTasks=w.tasks.filter(task=>task.assignee_id===user.id&&task.status!=='Completed');
 const due=w.tasks.filter(t=>t.status!=='Completed'&&day(t.due_date)<=today());
 const stages=['Enquiry','Pricing','Quoted','Draft','Awaiting revised PO','PO received','Ready for sourcing','Confirmed','On hold','Cancelled'];
 const metrics=[{title:'Accepted order value',value:money(confirmed.reduce((n,o)=>n+num(o.subtotal_paise),0)),foot:`${confirmed.length} accepted orders · excluding GST`,icon:IconShoppingBag,target:'orders' as Page},{title:'Enquiries & drafts',value:String(w.orders.filter(o=>['Draft','Enquiry','Pricing','Quoted','Awaiting revised PO'].includes(String(o.stage))).length),foot:'Pricing or confirmation pending',icon:IconShoppingBag,target:'orders' as Page},{title:'Customers',value:String(w.customers.length),foot:'Customer directory',icon:IconUsers,target:'customers' as Page},{title:'Follow-ups due',value:String(due.length),foot:'Due today or overdue',icon:IconCheckbox,target:'tasks' as Page}];
 return <div className="workspace-shell">
 {mobile&&<button className="mobile-backdrop" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
 <aside className={'app-sidebar '+(mobile?'mobile-open':'')}><div className="sidebar-brand"><span className="brand-icon"><IconBuildingStore size={20}/></span><div><strong>KEYSTONE</strong><small>Sales Operations</small></div><button className="mobile-close" aria-label="Close menu" onClick={()=>setMobile(false)}><IconX size={18}/></button></div><div className="workspace-switch"><span className="workspace-avatar">KC</span><div><strong>Keystone Commerce</strong><small>B2B workspace</small></div><span className="workspace-dot"/></div><SidebarNav items={visibleNav} activeId={page} onSelect={go} counts={{tasks:due.length,quality:issues.length}}/><div className="sidebar-bottom"><div className="account-row"><span className="avatar">{user.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><div><strong>{user.name}</strong><small>{user.is_super_admin?'Platform administrator':user.roles.map(r=>r.name).join(', ')||'No roles'}</small></div><Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={logout}><IconLogout size={16}/></Button></div></div></aside>
 <div className="main-frame"><header className="app-header"><div className="breadcrumbs"><Button className="mobile-menu" variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={()=>setMobile(true)}><IconMenu2 size={18}/></Button><span>Sales Operations</span><IconChevronRight size={13}/><strong>{current.label}</strong></div><div className="header-tools"><span className="environment"><i/>{integration.data?.environment==='production'?'Company workspace':'Local development'}</span><Button variant="ghost" size="icon-sm" aria-label="Cycle color theme" title={`Theme: ${theme}`} onClick={()=>setTheme(theme==='light'?'dark':theme==='dark'?'system':'light')}>{theme==='light'?<IconSun size={17}/>:theme==='dark'?<IconMoon size={17}/>:<IconDeviceDesktop size={17}/>}</Button><span className="header-avatar">{user.name[0]}</span></div></header>
 <main className="page-content"><div className="page-heading"><div><h1>{page==='overview'?'Operations overview':current.label}</h1></div><div className="page-actions"><Button variant="outline" size="sm" aria-label="Refresh workspace" onClick={()=>void data.refetch()} disabled={data.isFetching}><IconRefresh size={14} className={data.isFetching?'spin':''}/><span>Refresh</span></Button>{page==='overview'&&can('orders')&&<Button size="sm" onClick={()=>create('orders')}><IconPlus size={14}/>New request</Button>}{isRegister(page)&&can(page)&&<Button size="sm" onClick={()=>create(page)}><IconPlus size={14}/>New {page==='orders'?'request':singular[page]}</Button>}</div></div>
 {!canPage(page)?<State title="Access denied">Ask an administrator.</State>:data.isPending?<State title="Loading your workspace">Reading saved operational records…</State>:data.error?<ErrorState message={data.error.message} retry={()=>void data.refetch()}/>:<>
 {page==='overview'&&<><div className="overview-date"><span><i className="live-dot"/> Workspace summary</span><span>{formatDate(today())} · Updated {new Date(data.dataUpdatedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span></div>{has('tasks.read')&&<section className="surface mb-4" aria-label="My follow-ups">
 <div className="surface-heading">
  <h2>My follow-ups</h2>
  <span className="subtle-tag">{assignedTasks.length} open</span>
 </div>
 {assignedTasks.map(task=>{
  const order=orderFor(task.order_id);
  return <div key={String(task.id)} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 last:border-b-0">
   <div className="min-w-0 break-words">
    <strong>{task.title}</strong>
    <p className="text-xs text-muted-foreground">Due {formatDate(task.due_date)}{order&&<> · {orderCode(order)}</>}</p>
   </div>
   <div className="flex flex-wrap items-center gap-2">
    <Badge>{task.status}</Badge>
    {can('tasks','update')&&<Button size="sm" variant="outline" onClick={()=>setForm({entity:'tasks',record:task})}>Update status</Button>}
   </div>
  </div>;
 })}
 {!assignedTasks.length&&<p className="px-4 py-3 text-sm text-muted-foreground">No open follow-ups assigned to you.</p>}
</section>}<section className="metric-grid">{metrics.filter(m=>canPage(m.target)).map(m=><button className="metric-card" key={m.title} onClick={()=>go(m.target)}><div><span>{m.title}</span><m.icon size={17} stroke={1.5}/></div><strong>{m.value}</strong><footer>{m.foot}<IconArrowUpRight size={14}/></footer></button>)}</section>
 <div className="dashboard-grid">{has('orders.read')&&<section className="surface pipeline-panel"><div className="surface-heading"><div><h2>Order approval pipeline</h2></div><span className="subtle-tag">{w.orders.length} orders</span></div><div className="pipeline-bars">{stages.map((s,i)=>{const count=w.orders.filter(o=>o.stage===s).length;return <button key={s} onClick={()=>{go('orders');setStatus(s);}} className="pipeline-row"><span className="stage-index">{String(i+1).padStart(2,'0')}</span><span>{s}</span><div className="pipeline-track"><i style={{width:`${w.orders.length?count/w.orders.length*100:0}%`,opacity:.4+i*.12}}/></div><strong>{count}</strong></button>;})}</div></section>}
 {canViewTeamFollowUps&&<section className="surface"><div className="surface-heading"><div><h2>Needs attention</h2></div><span className="subtle-tag">{issues.length} checks</span></div>{issues.length?<div className="attention-list">{issues.slice(0,4).map((issue,i)=><button key={i} onClick={()=>go(issue.page)}><span className="attention-icon"><IconAlertTriangle size={16}/></span><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><IconChevronRight size={14}/></button>)}</div>:<div className="all-clear"><span><IconCircleCheck size={24}/></span><strong>No exceptions</strong></div>}<button className="panel-link" onClick={()=>go('quality')}>View all control checks<IconArrowRight size={14}/></button></section>}</div>
 {has('orders.read')&&<section className="surface"><div className="surface-heading"><div><h2>Recent sales orders</h2></div><Button variant="ghost" size="sm" onClick={()=>go('orders')}>View all orders<IconArrowRight size={14}/></Button></div><div className="table-scroll"><table><thead><tr>{columns.orders.map(c=><th key={c.label}>{c.label}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{w.orders.slice(0,5).map(r=><tr key={String(r.id)} onDoubleClick={()=>setDetail(r)}>{columns.orders.map(c=><td key={c.label}><span className="mobile-cell-label">{c.label}</span><div className="register-cell-value">{c.render(r)}</div></td>)}<td><Button variant="ghost" size="icon-sm" aria-label={`View ${orderCode(r)}`} onClick={()=>setDetail(r)}><IconArrowUpRight size={15}/></Button></td></tr>)}</tbody></table>{!w.orders.length&&<State title="Your first order starts here">Create a customer, then record their sales order.</State>}</div></section>}
 <div className="dashboard-grid bottom-grid">{has('invoices.read')&&<section className="surface"><div className="surface-heading"><div><h2>Collection watchlist</h2></div><IconReceiptRupee size={18}/></div>{w.invoices.filter(i=>num(i.outstanding_paise)>0).slice(0,4).map(i=><button className="watch-row" key={String(i.id)} onClick={()=>go('invoices')}><span className="square-icon"><IconFileInvoice size={17}/></span><div><strong className="mono">{i.number}</strong><small>{orderFor(i.order_id)?.customer_name} · Due {formatDate(i.due_date)}</small></div><strong>{money(i.outstanding_paise)}</strong></button>)}{!w.invoices.some(i=>num(i.outstanding_paise)>0)&&<State title="No outstanding invoices">Recorded receipts will reduce invoice balances here.</State>}</section>}{canViewTeamFollowUps&&<section className="surface"><div className="surface-heading"><div><h2>Today’s follow-ups</h2></div><span className="subtle-tag">{due.length} actions</span></div>{due.slice(0,4).map(t=><button className="watch-row" key={String(t.id)} onClick={()=>go('tasks')}><span className="square-icon"><IconClock size={17}/></span><div><strong>{t.title}</strong><small>{t.owner} · {formatDate(t.due_date)}</small></div><Badge>{t.priority}</Badge></button>)}{!due.length&&<State title="You’re up to date">No open follow-ups due today.</State>}</section>}</div></>}
 {isRegister(page)&&<>
 {page==='sourcing'&&<div className="integration-banner"><IconArrowsExchange size={19}/><div><strong>Manual sourcing updates</strong></div>{integration.data?.sourcing.portalUrl&&<a className="external-button" target="_blank" rel="noreferrer" href={integration.data.sourcing.portalUrl}>Open sourcing<IconExternalLink size={14}/></a>}</div>}

 <section className="surface register-surface"><div className="register-toolbar"><div className="search-input"><IconSearch size={15}/><Input aria-label={`Search ${names[page]}`} placeholder={`Search ${names[page].toLowerCase()}…`} value={search} onChange={e=>{setSearch(e.target.value);setPageIndex(0);}}/></div>{statuses.length>0&&<select aria-label="Filter status" value={status} onChange={e=>{setStatus(e.target.value);setPageIndex(0);}}><option>All statuses</option>{statuses.map(s=><option key={s} value={s}>{page==="sourcing"?vendorStatusLabel(s):s}</option>)}</select>}<span className="record-count">{filtered.length} records</span><Button variant="outline" size="sm" disabled={!filtered.length||!can(page,'export')} onClick={()=>void exportRegister(page,filtered,w).catch(e=>setNotice(e.message))}><IconDownload size={14}/>Export</Button></div><div className="table-scroll"><table><thead><tr>{columns[page].map(c=><th key={c.label}>{c.label}</th>)}<th>Action</th></tr></thead><tbody>{filtered.slice(pageIndex*12,pageIndex*12+12).map(r=><tr key={String(r.id)} onDoubleClick={page==='orders'?()=>setDetail(r):undefined}>{columns[page].map(c=><td key={c.label}><span className="mobile-cell-label">{c.label}</span><div className="register-cell-value">{c.render(r)}</div></td>)}<td className="register-row-action">{(page==='invoices'||page==='dispatches')&&<Button variant="ghost" size="sm" onClick={()=>setLineDetail({entity:page,record:r})}>View items</Button>}{page==='orders'?<Button variant="ghost" size="sm" onClick={()=>setDetail(r)}>View<IconArrowUpRight size={13}/></Button>:['dispatches','tasks','sourcing'].includes(page)&&can(page,'update')?<Button variant="ghost" size="sm" onClick={()=>setForm({entity:page,record:r})}>Update</Button>:page==='invoices'&&can('receipts')&&num(r.outstanding_paise)>0?<Button variant="ghost" size="sm" onClick={()=>{setForm({entity:'receipts',invoiceId:String(r.id)});}}>Add receipt</Button>:<span className="muted">Recorded</span>}</td></tr>)}</tbody></table>{!filtered.length&&<State title={search||status!=='All statuses'?'No matching records':`No ${names[page].toLowerCase()} yet`}>{search?'Try another search term.':page==='orders'?'Add a customer, then create your first order.':'New records will appear here after they are saved.'}</State>}</div><footer className="table-footer"><span>{filtered.length?`${pageIndex*12+1}–${Math.min(pageIndex*12+12,filtered.length)} of ${filtered.length}`:'0 records'}</span><div><Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={pageIndex===0} onClick={()=>setPageIndex(n=>n-1)}><IconChevronLeft size={14}/></Button><Button variant="outline" size="icon-sm" aria-label="Next page" disabled={(pageIndex+1)*12>=filtered.length} onClick={()=>setPageIndex(n=>n+1)}><IconChevronRight size={14}/></Button></div></footer></section></>}
 {page==='quality'&&<section className="surface"><div className="surface-heading"><div><h2>Control exceptions</h2></div><Badge>{issues.length?`${issues.length} pending`:'All clear'}</Badge></div>{issues.length?issues.map((issue,i)=><div className="quality-row" key={i}><IconAlertTriangle size={17}/><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><Button variant="outline" size="sm" onClick={()=>go(issue.page)}>Review<IconArrowRight size={13}/></Button></div>):<State title="No control exceptions">Review overdue sales follow-ups.</State>}</section>}
 {page==='access'&&<AdminAccess actor={user} onSaved={setNotice}/>}
 {page==='settings'&&<><div className="dashboard-grid"><section className="surface settings-card"><h2>Account & appearance</h2><dl><dt>Name</dt><dd>{user.name}</dd><dt>Email</dt><dd>{user.email}</dd><dt>Roles</dt><dd>{user.is_super_admin?'Platform administrator':user.roles.map(r=>r.name).join(', ')||'No roles'}</dd><dt>Theme</dt><dd><select aria-label="Color theme" value={theme} onChange={e=>setTheme(e.target.value)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></dd></dl></section><section className="surface settings-card"><h2>Release scope</h2><dl><dt>Version</dt><dd>{integration.data?.sourcing.mode==='manual-reference'?'V1 · Manual sourcing':'V1 · Before sourcing'}</dd><dt>Workflow</dt><dd>Agreed price or enquiry → quotation → confirmation</dd><dt>Environment</dt><dd>{integration.data?.environment||'Loading…'}</dd></dl></section></div>{(has('audit.read')||has('audit.operations.read'))&&<section className="surface"><div className="surface-heading"><div><h2>Recent activity</h2></div></div><div className="table-scroll"><table><thead><tr><th>When</th><th>Team member</th><th>Action</th><th>Register</th><th>Reference</th></tr></thead><tbody>{w.audit.map(a=><tr key={String(a.id)}><td>{new Date(String(a.created_at)).toLocaleString('en-IN')}</td><td>{a.actor_name}</td><td>{a.action}</td><td>{a.entity}</td><td className="mono">{(a.entity==='orders'&&orderFor(a.record_id)?orderCode(orderFor(a.record_id)):a.entity==='customers'?w.customers.find(c=>c.id===a.record_id)?.name:a.entity==='sourcing'?w.sourcing.find(s=>s.id===a.record_id)?.sku:null)||String(a.record_id).slice(0,8)}</td></tr>)}</tbody></table>{!w.audit.length&&<State title="No activity yet">Saved changes will appear here.</State>}</div></section>}</>}
 </>}
 </main></div>
 {notice&&<div className="toast" role="status"><IconCircleCheck size={16}/>{notice}</div>}
 {lineDetail&&has(lineDetail.entity+'.read')&&<LineDetails detail={lineDetail} w={w} onClose={()=>setLineDetail(null)}/>}
 {form&&can(form.entity,form.record?'update':'create')&&<RecordForm key={form.entity+String(form.record?.id||'new')} request={form} w={w} onClose={()=>setForm(null)} onSaved={setNotice} onCreated={setCreatedOrderId}/>}
 {amendment&&can('orders','update')&&<OrderAmendment order={amendment} onClose={()=>setAmendment(null)} onSaved={(id,message)=>{setAmendment(null);setCreatedOrderId(id);setNotice(message);}}/>}
 {detail&&!form&&has('orders.read')&&<Dialog open onOpenChange={open=>{if(!open)setDetail(null);}}><DialogContent className="sm:max-w-[1000px] max-h-[90dvh] overflow-y-auto"><DialogHeader><div className="eyebrow">{orderCode(detail)}</div><DialogTitle>{detail.description}</DialogTitle><DialogDescription>{detail.customer_name} · {detail.po_ref||'No confirmation reference'}</DialogDescription></DialogHeader><div className="detail-summary"><div><span>Order value · ex GST</span><strong>{money(detail.subtotal_paise)}</strong></div><div><span>Order quantity</span><strong>{detail.qty} units</strong></div><div><span>Target delivery</span><strong>{formatDate(detail.target_date)}</strong></div><div><span>Stage</span><Badge>{String(detail.stage)}</Badge></div></div><dl className="order-facts"><dt>Agreement status</dt><dd>{detail.agreement_status||"—"}</dd><dt>Confirmed by</dt><dd>{detail.confirmed_by||"—"}</dd><dt>Enquiry received</dt><dd>{formatDate(detail.enquiry_received_date)}</dd><dt>How this request started</dt><dd>{detail.sales_path==='needs-pricing'?'Customer requested a quote':'Customer price was already agreed'}</dd><dt>Quotation</dt><dd>{detail.quote_ref||'—'}{num(detail.quote_version)>0?` · Revision ${detail.quote_version}`:''}</dd><dt>Pricing reference</dt><dd>{detail.pricing_source_ref||'—'}</dd><dt>Owner</dt><dd>{detail.owner}</dd><dt>Shipping address</dt><dd>{detail.ship_to||'Pending'}</dd><dt>Customer</dt><dd>{customerFor(detail.customer_id)}</dd></dl><OrderWorkflow sourcing={has("sourcing.read")&&<OrderSourcing items={w.order_items.filter(item=>item.order_id===detail.id)} records={w.sourcing.filter(record=>record.order_id===detail.id)}/>} onSource={can('sourcing')?()=>create('sourcing',String(detail.id)):undefined} onAmend={()=>{setAmendment(detail);setDetail(null);}} order={detail} canEdit={can('orders','update')} onEdit={()=>{setForm({entity:'orders',record:detail});setDetail(null);}} onSaved={setNotice}><OrderItems order={detail} w={w} showInvoices={false} showFulfilment={false}/></OrderWorkflow><div className="linked-records">{(['dispatches','invoices'] as Register[]).filter(entity=>has(entity+'.read')).map(entity=><button key={entity} onClick={()=>{setDetail(null);go(entity);}}><span>{names[entity]}</span><strong>{w[entity].filter(r=>r.order_id===detail.id).length}</strong><IconChevronRight size={14}/></button>)}</div>{canViewTeamFollowUps&&<section className="grid gap-2" aria-label="Team follow-ups">
 <div className="flex items-center justify-between gap-2">
  <h3 className="font-semibold">Team follow-ups</h3>
  {can('tasks')&&<Button size="sm" variant="outline" onClick={()=>setForm({entity:'tasks',orderId:String(detail.id)})}><IconPlus size={14}/>Add follow-up</Button>}
 </div>
 <ul className="divide-y divide-border">
  {w.tasks.filter(task=>task.order_id===detail.id).map(task=><li key={String(task.id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
   <div><strong>{task.title}</strong><p className="text-xs text-muted-foreground">Assigned to {task.owner} · Due {formatDate(task.due_date)}</p></div>
   <Badge>{task.status}</Badge>
  </li>)}
 </ul>
 {!w.tasks.some(task=>task.order_id===detail.id)&&<p className="text-xs text-muted-foreground">No follow-ups yet.</p>}
</section>}<OrderHistory key={String(detail.id)} orderId={String(detail.id)}/><div className="detail-actions">{can('orders','update')&&<Button variant="outline" onClick={()=>{setForm({entity:'orders',record:detail});setDetail(null);}}>Update order</Button>}{detail.stage==='Confirmed'&&can('dispatches')&&<Button variant="outline" onClick={()=>create('dispatches',String(detail.id))}>Add dispatch</Button>}{detail.stage==='Confirmed'&&can('invoices')&&<Button onClick={()=>create('invoices',String(detail.id))}>Add invoice</Button>}</div></DialogContent></Dialog>}
 </div>;
}

function OrderSourcing({items,records}:{items:Row[];records:Row[]}){
 const byItem=new Map(records.map(record=>[record.order_item_id,record]));
 const found=items.filter(item=>String(byItem.get(item.id)?.supplier??'').trim()).length;
 const remaining=items.length-found;
 return <div className="mt-2 w-full">
  <p className="mb-3 font-medium">Vendor found for {found} of {items.length} SKUs · {remaining} remaining</p>
  <ol aria-label="Sourcing by SKU">
   {items.map(item=>{
    const record=byItem.get(item.id);
    const ready=record?.status==='Ready';
    return <li key={item.id} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-4 last:pb-0 before:absolute before:inset-y-0 before:left-[11px] before:border-l before:border-border last:before:hidden">
     <span aria-hidden="true" className={`order-step-marker relative bg-background${ready?' done':''}`}>
      {ready?<IconCircleCheck size={15}/>:<span className="size-1.5 rounded-full bg-current"/>}
     </span>
     <div className="min-w-0">
     <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 break-words">
       <strong>{item.sku||'Legacy SKU'}</strong>
       <p>{item.description}</p>
      </div>
      <Badge>{record?.status?vendorStatusLabel(String(record.status)):'Not started'}</Badge>
     </div>
     {record&&<div className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
      {record.supplier&&<p>Vendor · {record.supplier}</p>}
      {record.vendor_phone&&<p>Phone · {record.vendor_phone}</p>}
      {record.vendor_email&&<p>Email · {record.vendor_email}</p>}
      {record.eta&&<p>Expected supply · {formatDate(record.eta)}</p>}
      {record.notes&&<p>{record.notes}</p>}
     </div>}
     </div>
    </li>;
   })}
  </ol>
 </div>;
}
