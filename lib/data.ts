export type Row = Record<string, string | number | null>;
export type Register = 'customers'|'orders'|'sourcing'|'dispatches'|'invoices'|'receipts'|'tasks';
export type Workspace = Record<Register|'audit'|'order_items'|'dispatch_items'|'invoice_items',Row[]>;
export type Actor = {id:string;name:string;email:string;role:string;is_super_admin:boolean;access_version:number;permissions:string[];roles:{id:string;name:string;key:string}[];teams:{id:string;name:string}[]};
export type Integration = {sourcing:{mode:string;portalUrl:string|null;apiConnected:boolean};delivery:{mode:string};payments:{mode:string};environment:string};
export const empty:Workspace={customers:[],orders:[],order_items:[],sourcing:[],dispatches:[],dispatch_items:[],invoices:[],invoice_items:[],receipts:[],tasks:[],audit:[]};
export const names:Record<Register,string>={customers:'Customers',orders:'Sales orders',sourcing:'Sourcing handoff',dispatches:'Dispatch & delivery',invoices:'Invoices',receipts:'Payment receipts',tasks:'Team follow-ups'};
export const singular:Record<Register,string>={customers:'customer',orders:'sales order',sourcing:'sourcing reference',dispatches:'dispatch',invoices:'invoice',receipts:'payment receipt',tasks:'follow-up'};
export const num=(v:unknown)=>Number(v)||0;
export const money=(paise:unknown)=>paise==null?'Not priced':new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(num(paise)/100);
export const day=(v:unknown)=>String(v||'').slice(0,10);
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const formatDate=(v:unknown)=>v?new Date(day(v)+'T12:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const orderCode=(o:Row|undefined)=>o?`SO-${String(o.code).padStart(5,'0')}`:'—';
export function orderStatus(o:Row,w:Workspace) {
 if(o.execution_status)return String(o.execution_status);
 if(o.stage!=='Confirmed')return String(o.stage);
 if(num(o.delivered)>=num(o.qty))return 'Delivered';
 if(num(o.delivered)>0)return 'Partially delivered';
 if(num(o.dispatched)>0)return 'In transit';
 const links=w.sourcing.filter(s=>s.order_id===o.id);
 const items=w.order_items.filter(i=>i.order_id===o.id);
 return items.length>0&&items.every(i=>links.some(s=>s.order_item_id===i.id&&s.status==='Ready'))?'Ready to dispatch':links.length?'Sourcing':'Confirmed';
}
export class ApiError extends Error {constructor(message:string,public status:number){super(message);this.name='ApiError';}}
export async function currentActor():Promise<Actor|null>{try{return await api<Actor>('/auth/me');}catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error;}}
export async function api<T=unknown>(path:string,options:RequestInit={}):Promise<T> {
 const result=await fetch('/api'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'sales-ops',...options.headers}});
 if(!result.ok){if(result.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('sales-ops:unauthorized'));const value=await result.json().catch(()=>({error:'API unavailable. Check that the backend is running.'}));throw new ApiError(value.error||'Request failed',result.status);}
 return result.status===204?undefined as T:result.json();
}
export function exportCsv(rows:Row[],name:string){
 if(!rows.length)return;
 const headers=Object.keys(rows[0]);const cell=(value:unknown)=>{let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const content='\ufeff'+[headers,...rows.map(r=>headers.map(k=>r[k]))].map(row=>row.map(cell).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`keystone-${name}-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function exportRegister(entity:Register,rows:Row[],w:Workspace) {
 const authorized=await api<{rows:Row[];items:Row[]}>('/export/'+entity);
 const ids=new Set(rows.map(r=>r.id));rows=authorized.rows.filter(r=>ids.has(r.id));
 const lineKey=entity==='orders'?'order_items':entity==='invoices'?'invoice_items':entity==='dispatches'?'dispatch_items':null;
 if(lineKey)w={...w,[lineKey]:authorized.items};
 const source=entity==='orders'?w.order_items:entity==='dispatches'?w.dispatch_items:entity==='invoices'?w.invoice_items:null;
 if(!source)return exportCsv(rows,entity);
 const key=entity==='orders'?'order_id':entity==='dispatches'?'dispatch_id':'invoice_id';
 const expanded=rows.flatMap(r=>source.filter(i=>i[key]===r.id).map(i=>({record_id:r.id,order_id:entity==='orders'?r.id:r.order_id,reference:entity==='orders'?orderCode(r):r.number||r.tracking,sku:i.sku,description:i.description,qty:i.qty,rate_paise:i.rate_paise??null,gst_bps:i.gst_bps??null,...(entity==='orders'?{}:{delivered_qty:i.delivered_qty??i.delivered??null,returned_qty:i.returned_qty??null,invoice_total_paise:entity==='invoices'?r.total_paise:null})})));
 exportCsv(expanded,entity+'-sku-lines');
}

export const vendorStatuses = [
 {value:'Requested',label:'Awaiting vendor response'},
 {value:'In progress',label:'In talks'},
 {value:'Ready',label:'Vendor agreed'},
 {value:'Rejected',label:'Vendor rejected'},
 {value:'Blocked',label:'Blocked'},
];

export function vendorStatusLabel(status: string) {
 return vendorStatuses.find(option=>option.value===status)?.label ?? status;
}
export const skuUnits = ['Nos','Pcs','Pairs','Sets','Boxes','Kits','Kg','Meters','Litres','Other'];
