'use client';

import {useState,type FormEvent,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {SamplePanel} from '@/components/customer-workflow';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {api,money,num,orderCode,formatDate,today,type Actor,type Row,type Workspace} from '@/lib/data';
import {can} from '@/lib/access';

type Policy={version:number;threshold_paise:number;primary_approver:string|null;secondary_approver:string|null};
type Purchasing={suppliers:Row[];quotes:Row[];purchase_orders:Row[];requests:Row[];approvals:Row[];payments:Row[];policy:Policy;approvers:{id:string;name:string;email:string}[]};
type Tab='suppliers'|'quotes'|'purchase_orders'|'requests'|'payments';
type FormKind=Tab|'policy'|'decision';
type PurchasingForm={kind:FormKind;row?:Row;decision?:string;sample?:Row};
type DocumentTarget={entity:'purchase_orders'|'requests'|'payments';row:Row};
type Field={key:string;label:string;type?:string;optional?:boolean;options?:{value:string;label:string}[]};
const titles:Record<Tab,string>={suppliers:'Suppliers',quotes:'Supplier quotations',purchase_orders:'Purchase orders',requests:'Payment requests',payments:'Supplier payments'};
const creationLabels:Record<Tab,string>={suppliers:'supplier',quotes:'supplier quotation',purchase_orders:'purchase order',requests:'payment request',payments:'supplier payment'};
const statusFor=(row:Row)=>row.status==='Approved'?(num(row.paid_paise)>=num(row.amount_paise)?'Fully paid':num(row.paid_paise)>0?'Partially paid':'Pending finance'):String(row.status);
const optionRows=(rows:Row[],label:(row:Row)=>string)=>rows.map(row=>({value:String(row.id),label:label(row)}));

export function Procurement({actor,w,sourcing}:{actor:Actor;w:Workspace;sourcing?:ReactNode}) {
 const qc=useQueryClient();
 const [tab,setTab]=useState<Tab|'sourcing'|'samples'>('suppliers');
 const [quoteSku,setQuoteSku]=useState('');
 const [quoteRound,setQuoteRound]=useState<Row|null>(null);
 const [form,setForm]=useState<PurchasingForm|null>(null);
 const [documents,setDocuments]=useState<DocumentTarget|null>(null);
 const [message,setMessage]=useState('');
 const query=useQuery({
  queryKey:['procurement',actor.id,actor.permissions.join('|')],
  queryFn:()=>api<Purchasing>('/procurement'),refetchInterval:30000
 });
 const has=(action:string)=>can(actor,'procurement.'+action);
 async function refresh(){
  await Promise.all([qc.invalidateQueries({queryKey:['procurement']}),qc.invalidateQueries({queryKey:['procurement-suppliers']}),qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['samples']})]);
 }
 if(query.isPending)return <p role="status">Loading supplier sourcing…</p>;
 if(query.isError)return <div role="alert" className="error-box">{query.error.message}<Button onClick={()=>void query.refetch()}>Try again</Button></div>;
 const data=query.data;
 const quotedSkus=w.order_items.filter(item=>data.quotes.some(quote=>quote.order_item_id===item.id));
 const rows=tab==='sourcing'||tab==='samples'?[]:tab==='quotes'?data.quotes.filter(quote=>(!quoteSku||quote.order_item_id===quoteSku)&&(!quoteRound||quote.sample_round_id===quoteRound.id)):data[tab];
 const columns:Record<Tab,{label:string;render:(row:Row)=>ReactNode}[]>={
  suppliers:[
   {label:'Supplier',render:r=><strong>{r.name}</strong>},
   {label:'GSTIN',render:r=>r.gstin||'—'},
   {label:'Contact',render:r=><>{r.contact_name}<small>{r.email} {r.phone}</small></>},
   {label:'Bank details',render:r=><>{r.bank_name||'—'}<small>{r.account_number} {r.ifsc}</small></>}
  ],
  quotes:[
   {label:'Reference',render:r=><strong>{r.reference}</strong>},
   {label:'Supplier',render:r=>r.supplier_name},
   {label:'Sourcing reference',render:r=>r.sample_round_id?<>Sample round {r.round_number}<small>{money(r.courier_paise)} courier</small></>:w.sourcing.find(source=>source.id===r.sourcing_link_id)?.external_ref||'—'},
   {label:'Order / SKU',render:r=><>{orderCode(w.orders.find(o=>o.id===r.order_id))}<small>{r.sku} · {r.description}</small></>},
   {label:'Quoted quantity',render:r=>r.qty},
   {label:'Unit rate · ex GST',render:r=>money(r.rate_paise)},
   {label:'GST',render:r=>num(r.gst_bps)/100+'%'},
   {label:'Date / notes',render:r=><>{formatDate(r.quote_date)}<small>{r.notes}</small></>}
  ],
  purchase_orders:[
   {label:'Supplier PO',render:r=><strong>{r.reference}{r.sample_round_id&&<small>Sample round {r.round_number}</small>}</strong>},
   {label:'Supplier / SKU',render:r=><>{r.supplier_name}<small>{r.sku} · {r.qty} units</small></>},
   {label:'Sales order',render:r=>orderCode(w.orders.find(o=>o.id===r.order_id))},
   {label:'Total · incl GST',render:r=>money(r.total_paise)},
   {label:'Paid / balance',render:r=><>{money(r.paid_paise)}<small>{money(num(r.total_paise)-num(r.paid_paise))} balance</small></>},
   {label:'Available to request',render:r=>money(num(r.total_paise)-num(r.reserved_paise))},
   {label:'Expected supply',render:r=>formatDate(r.expected_date)},
   {label:'Selection reason',render:r=>r.selection_reason}
  ],
  requests:[
   {label:'Request / supplier PO',render:r=><strong>{r.reference}<small>{r.po_reference} · {r.supplier_name}{r.sample_round_id?' · Sample':''}</small></strong>},
   {label:'Raised by / purpose',render:r=><>{r.raised_by}<small>{r.purpose}</small><small>{r.justification}</small></>},
   {label:'Requested / paid',render:r=><>{money(r.amount_paise)}<small>{money(r.paid_paise)} paid</small></>},
   {label:'Status',render:r=><span className="status">{statusFor(r)}</span>},
   {label:'Approval history',render:r=><>{data.approvals.filter(a=>a.request_id===r.id).map(a=><small key={String(a.id)}>{a.actor_name} · {a.decision}{a.remarks?' · '+a.remarks:''}</small>)}{r.status==='Pending approval'&&<small>Awaiting {data.approvers.find(a=>a.id===(num(r.approval_step)===1?r.primary_approver:r.secondary_approver))?.name||'assigned approver'}</small>}</>},
   {label:'Due date',render:r=>formatDate(r.due_date)}
  ],
  payments:[
   {label:'UTR / bank reference',render:r=><strong>{r.reference}</strong>},
   {label:'Request',render:r=><>{r.request_reference}{r.sample_round_id&&<small>Sample</small>}</>},
   {label:'Amount',render:r=>money(r.amount_paise)},
   {label:'Date / method',render:r=><>{formatDate(r.payment_date)}<small>{r.mode}</small></>},
   {label:'Bank / accounting',render:r=><>{r.bank||'—'}<small>{r.accounting_reference}</small></>}
  ]
 };
 return <div className="grid gap-4">
  <p className="text-sm text-muted-foreground">Register suppliers, track their responses, compare quotations by SKU, issue purchase orders, and record payments.</p>
  <div className="grid gap-3 sm:grid-cols-3">
   <div className="surface p-4"><p>Bulk supplier commitments</p><strong>{money(data.purchase_orders.filter(row=>!row.sample_round_id).reduce((sum,row)=>sum+num(row.total_paise),0))}</strong><small className="block muted">Samples · {money(data.purchase_orders.filter(row=>row.sample_round_id).reduce((sum,row)=>sum+num(row.total_paise),0))}</small></div>
   <div className="surface p-4"><p>Payments recorded</p><strong>{money(data.payments.reduce((sum,row)=>sum+num(row.amount_paise),0))}</strong></div>
   <div className="surface p-4"><p>Awaiting approval</p><strong>{data.requests.filter(row=>row.status==='Pending approval').length}</strong></div>
  </div>
  <div className="flex flex-wrap gap-2" aria-label="Supplier sourcing steps">
   <Button variant={tab==='suppliers'?'default':'outline'} aria-pressed={tab==='suppliers'} onClick={()=>setTab('suppliers')}>Suppliers</Button>
   {sourcing&&<Button variant={tab==='sourcing'?'default':'outline'} aria-pressed={tab==='sourcing'} onClick={()=>setTab('sourcing')}>Sourcing references</Button>}
   {can(actor,'orders.read')&&<Button variant={tab==='samples'?'default':'outline'} aria-pressed={tab==='samples'} onClick={()=>setTab('samples')}>Sample requests</Button>}
   {(['quotes','purchase_orders','requests','payments'] as const).map(key=><Button key={key} variant={tab===key?'default':'outline'} aria-pressed={tab===key} onClick={()=>setTab(key)}>{titles[key]}</Button>)}
   {has('manage')&&<Button variant="outline" onClick={()=>setForm({kind:'policy'})}>Approval settings</Button>}
  </div>
  {message&&<p role="status">{message}</p>}
  {!data.policy.primary_approver&&<p className="integration-banner">An administrator must configure primary and secondary approvers before payment requests can be raised.</p>}
  {tab==='quotes'&&quoteRound&&<div className="flex flex-wrap items-center gap-2">
   <span>Sample quotations · {quoteRound.customer_name} · {quoteRound.sku} · Round {quoteRound.round_number}</span>
   <Button size="sm" variant="outline" onClick={()=>{setQuoteRound(null);setQuoteSku('');}}>Clear sample filter</Button>
  </div>}
  {tab==='quotes'&&!quoteRound&&<label className="grid gap-2 text-sm sm:max-w-xl">
   Compare quotations for SKU
   <select className="rounded-md border border-input bg-background p-2" value={quoteSku} onChange={event=>setQuoteSku(event.target.value)}>
    <option value="">All order SKUs</option>
    {quotedSkus.map(item=><option key={String(item.id)} value={String(item.id)}>{orderCode(w.orders.find(order=>order.id===item.order_id))} · {item.sku} · {item.description}</option>)}
   </select>
  </label>}
  {tab==='sourcing'?sourcing:tab==='samples'?<SamplePanel actorId={actor.id} step="sourcing" onQuote={has('create')?sample=>setForm({kind:'quotes',sample}):undefined} onCompare={sample=>{setQuoteRound(sample);setQuoteSku('');setTab('quotes');}}/>:<section className="surface register-surface">
   <div className="surface-heading"><h2>{titles[tab]}</h2>
    {tab==='quotes'&&quoteRound?has('create')&&quoteRound.status==='Requested'&&rows.every(quote=>quote.sample_status==='Requested')&&
     <Button onClick={()=>setForm({kind:'quotes',sample:quoteRound})}>Add sample quotation</Button>:
     tab!=='payments'&&has('create')&&<Button onClick={()=>setForm({kind:tab})}>Add {creationLabels[tab]}</Button>}
   </div>
   <div className="table-scroll"><table><thead><tr>{columns[tab].map(column=><th key={column.label}>{column.label}</th>)}<th>Actions</th></tr></thead><tbody>
    {rows.map(row=><tr key={String(row.id)}>
     {columns[tab].map(column=><td key={column.label}><span className="mobile-cell-label">{column.label}</span><div className="register-cell-value">{column.render(row)}</div></td>)}
     <td className="register-row-action"><div className="flex flex-wrap gap-2">
      {tab==='quotes'&&has('create')&&(!row.sample_round_id||row.sample_status==='Requested')&&<Button size="sm" variant="outline" onClick={()=>setForm({kind:'purchase_orders',row})}>Select / issue PO</Button>}
      {tab==='purchase_orders'&&has('create')&&num(row.reserved_paise)<num(row.total_paise)&&<Button size="sm" onClick={()=>setForm({kind:'requests',row})}>Request payment</Button>}
      {tab==='requests'&&row.status==='Pending approval'&&has('approve')&&row.created_by!==actor.id&&(num(row.approval_step)===1?row.primary_approver:row.secondary_approver)===actor.id&&<>
       <Button size="sm" onClick={()=>setForm({kind:'decision',row,decision:'Approve'})}>Approve</Button>
       <Button size="sm" variant="outline" onClick={()=>setForm({kind:'decision',row,decision:'Reject'})}>Reject</Button>
      </>}
      {tab==='requests'&&row.status==='Pending approval'&&row.created_by===actor.id&&has('create')&&<Button size="sm" variant="outline" onClick={()=>setForm({kind:'decision',row,decision:'Cancel'})}>Cancel request</Button>}
      {tab==='requests'&&row.status==='Approved'&&num(row.paid_paise)<num(row.amount_paise)&&has('pay')&&<Button size="sm" onClick={()=>setForm({kind:'payments',row})}>Record payment</Button>}
      {(['purchase_orders','requests','payments'] as string[]).includes(tab)&&<Button size="sm" variant="outline" onClick={()=>setDocuments({entity:tab as DocumentTarget['entity'],row})}>Documents</Button>}
     </div></td>
    </tr>)}
   </tbody></table>{!rows.length&&<p className="p-6 text-muted-foreground">No {titles[tab].toLowerCase()} recorded yet.</p>}</div>
  </section>}
  {tab==='payments'&&<p className="text-sm text-muted-foreground">Record transfers completed through your bank, including UTR and payment proof. Upload proof under Documents after recording the payment.</p>}
  {form&&<PurchasingEditor key={form.kind+String(form.row?.id||'')+String(form.decision||'')} form={form} data={data} w={w} onClose={()=>setForm(null)} onSaved={async()=>{if(form.sample){setQuoteRound(form.sample);setQuoteSku('');setTab('quotes');}setForm(null);setMessage('Saved successfully.');await refresh();}}/>}
  {documents&&<PurchasingDocuments target={documents} canUpload={has('create')||has('pay')} onClose={()=>setDocuments(null)}/>}
 </div>;
}

function PurchasingEditor({form,data,w,onClose,onSaved}:{form:PurchasingForm;data:Purchasing;w:Workspace;onClose:()=>void;onSaved:()=>Promise<void>}) {
 const {kind,row,decision,sample}=form;
 const [values,setValues]=useState<Record<string,string>>(()=>({
  id:crypto.randomUUID(),qty:String(sample?.qty??row?.qty??''),gst_percent:'18',quote_date:today(),order_date:today(),expected_date:today(),due_date:today(),payment_date:today(),mode:'NEFT',
  sourcing_link_id:'',order_id:String(sample?.order_id||''),order_item_id:String(sample?.order_item_id||''),supplier_id:'',sample_round_id:String(sample?.id||''),
  quote_id:kind==='purchase_orders'?String(row?.id||''):'',
  purchase_order_id:kind==='requests'?String(row?.id||''):'',
  request_id:kind==='payments'?String(row?.id||''):'',
  amount_rupees:kind==='payments'?String((num(row?.amount_paise)-num(row?.paid_paise))/100):'',
  threshold_rupees:String(num(data.policy.threshold_paise)/100),
  primary_approver:data.policy.primary_approver||'',secondary_approver:data.policy.secondary_approver||''
 }));
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const activeOrders=w.orders.filter(order=>['Ready for sourcing','Confirmed'].includes(String(order.stage)));
 const sourcingReferences=w.sourcing.filter(source=>source.supplier_id&&activeOrders.some(order=>order.id===source.order_id));
 const fields:Record<FormKind,Field[]>={
  suppliers:[
   {key:'name',label:'Legal supplier name'},{key:'gstin',label:'GSTIN',optional:true},{key:'contact_name',label:'Contact person',optional:true},
   {key:'email',label:'Email',type:'email',optional:true},{key:'phone',label:'Phone',type:'tel',optional:true},
   {key:'address',label:'Address',type:'textarea',optional:true},{key:'bank_name',label:'Bank name',optional:true},
   {key:'account_number',label:'Bank account number',optional:true},{key:'ifsc',label:'IFSC',optional:true}
  ],
  quotes:[
   ...(sample?[{key:'supplier_id',label:'Supplier',options:optionRows(data.suppliers,supplier=>String(supplier.name))},
    {key:'courier_rupees',label:'Courier charge (₹)',type:'number',optional:true}]:
    [{key:'sourcing_link_id',label:'Sourcing reference',options:optionRows(sourcingReferences,source=>orderCode(w.orders.find(order=>order.id===source.order_id))+' · '+source.sku+' · '+source.supplier+' · '+(source.external_ref||String(source.id).slice(0,8)))}]),
   {key:'reference',label:'Supplier quotation reference'},{key:'quote_date',label:'Quotation date',type:'date'},
   {key:'qty',label:'Quoted quantity',type:'number'},{key:'rate_rupees',label:'Supplier unit rate (₹, ex GST)',type:'number'},
   {key:'gst_percent',label:'GST (%)',type:'number'},{key:'notes',label:'Quote notes / terms',type:'textarea',optional:true}
  ],
  purchase_orders:[
   {key:'quote_id',label:'Selected supplier quotation',options:optionRows(data.quotes.filter(quote=>!quote.sample_round_id||quote.sample_status==='Requested'),quote=>quote.reference+' · '+quote.supplier_name+' · '+quote.sku+(quote.sample_round_id?' · Sample round '+quote.round_number:'')+' · '+money(quote.rate_paise)+'/unit')},
   {key:'reference',label:'Supplier PO reference'},{key:'qty',label:'Quantity to purchase',type:'number'},
   {key:'order_date',label:'PO date',type:'date'},{key:'expected_date',label:'Expected supply date',type:'date'},
   {key:'selection_reason',label:'Supplier selection reason',type:'textarea'}
  ],
  requests:[
   {key:'purchase_order_id',label:'Supplier PO',options:optionRows(data.purchase_orders.filter(po=>num(po.reserved_paise)<num(po.total_paise)),po=>po.reference+' · '+po.supplier_name+' · '+money(num(po.total_paise)-num(po.reserved_paise))+' available')},
   {key:'reference',label:'Unique payment request reference'},{key:'amount_rupees',label:'Requested amount (₹)',type:'number'},
   {key:'purpose',label:'Purpose',options:['Advance against PI','Advance against quotation','Balance payment','Invoice payment','Sample payment','Freight / logistics','Other'].map(value=>({value,label:value}))},
   {key:'due_date',label:'Due date',type:'date'},{key:'justification',label:'Justification / PI reference',type:'textarea'}
  ],
  payments:[
   {key:'request_id',label:'Approved request',options:optionRows(data.requests.filter(request=>request.status==='Approved'&&num(request.paid_paise)<num(request.amount_paise)),request=>request.reference+' · '+money(num(request.amount_paise)-num(request.paid_paise))+' unpaid')},
   {key:'amount_rupees',label:'Payment amount (₹)',type:'number'},{key:'reference',label:'UTR / bank reference'},
   {key:'payment_date',label:'Payment / value date',type:'date'},
   {key:'mode',label:'Payment method',options:['NEFT','RTGS','IMPS','UPI','Cheque','Bank transfer','Other'].map(value=>({value,label:value}))},
   {key:'bank',label:'Paying bank account / narration',optional:true},
   {key:'accounting_reference',label:'Accounting voucher reference',optional:true}
  ],
  policy:[
   {key:'threshold_rupees',label:'Amount above which two approvals are required (₹)',type:'number'},
   {key:'primary_approver',label:'Primary approver',options:data.approvers.map(actor=>({value:actor.id,label:actor.name+' · '+actor.email}))},
   {key:'secondary_approver',label:'Secondary approver',options:data.approvers.map(actor=>({value:actor.id,label:actor.name+' · '+actor.email}))}
  ],
  decision:[{key:'remarks',label:decision==='Approve'?'Approval remarks':'Reason',type:'textarea',optional:decision==='Approve'}]
 };
 function change(key:string,value:string){
  setValues(current=>{
   const next={...current,[key]:value};
   if(key==='order_id')next.order_item_id='';
   if(key==='sourcing_link_id'){
    const source=sourcingReferences.find(source=>source.id===value);
    next.order_id=String(source?.order_id||'');
    next.order_item_id=String(source?.order_item_id||'');
    next.supplier_id=String(source?.supplier_id||'');
    next.qty=String(w.order_items.find(item=>item.id===source?.order_item_id)?.qty||'');
   }
   if(key==='quote_id')next.qty=String(data.quotes.find(quote=>quote.id===value)?.qty||'');
   if(key==='request_id'){
    const request=data.requests.find(request=>request.id===value);
    next.amount_rupees=String((num(request?.amount_paise)-num(request?.paid_paise))/100);
   }
   return next;
  });
 }
 async function save(event:FormEvent){
  event.preventDefault();
  setBusy(true);setError('');
  try{
   const body:Record<string,unknown>={...values};
   for(const [input,output] of [['amount_rupees','amount_paise'],['rate_rupees','rate_paise'],['courier_rupees','courier_paise'],['gst_percent','gst_bps'],['threshold_rupees','threshold_paise']]){
    if(values[input]!==undefined)body[output]=Math.round(Number(values[input])*100);
   }
   if(values.qty)body.qty=Number(values.qty);
   let path='/procurement/'+kind,method='POST';
   if(kind==='purchase_orders')path='/procurement/purchase-orders';
   if(kind==='policy'){body.version=data.policy.version;method='PUT';}
   if(kind==='decision'){path='/procurement/requests/'+row!.id+'/decision';body.version=row!.version;body.decision=decision;}
   await api(path,{method,body:JSON.stringify(body)});
   await onSaved();
  }catch(error){setError((error as Error).message);}
  finally{setBusy(false);}
 }
 const title=kind==='policy'?'Supplier approval policy':kind==='decision'?decision+' payment request':titles[kind];
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="sm:max-w-[700px] max-h-[90dvh] overflow-y-auto">
  <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{kind==='policy'?'Assigned approvers are saved on each new request. Existing requests retain their approval route.':'Record the details and save to the shared workspace.'}</DialogDescription></DialogHeader>
  {sample&&<p className="text-sm text-muted-foreground">{sample.customer_name} · {sample.sku} · Sample round {sample.round_number}. Record each vendor’s quotation separately. Enter a zero unit rate for a free sample.</p>}
  {kind==='quotes'&&!sample&&<p className="text-sm text-muted-foreground">Choose the supplier's sourcing reference for this order SKU. Register the supplier under Suppliers, then create its reference under Sourcing references. You can record several quotations against a reference.</p>}
  <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
   {fields[kind].map(field=><div key={field.key} className={'grid gap-2 text-sm '+(field.type==='textarea'?'sm:col-span-2':'')}>
    <label htmlFor={'purchasing-'+field.key}>{field.label}{field.optional?' (optional)':''}</label>
    {field.options?<select id={'purchasing-'+field.key} className="rounded-md border border-input bg-background p-2" required={!field.optional} value={values[field.key]||''} onChange={event=>change(field.key,event.target.value)}><option value="">Choose…</option>{field.options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
     :field.type==='textarea'?<Textarea id={'purchasing-'+field.key} required={!field.optional} maxLength={1000} value={values[field.key]||''} onChange={event=>change(field.key,event.target.value)}/>
     :<Input id={'purchasing-'+field.key} required={!field.optional} type={field.type||'text'} min={field.type==='number'?0:undefined} step={field.key==='qty'?1:'0.01'} maxLength={field.key==='gstin'?15:200} value={values[field.key]||''} onChange={event=>change(field.key,event.target.value)}/>}
   </div>)}
   {error&&<p role="alert" className="text-destructive sm:col-span-2">{error}</p>}
   <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>{busy?'Saving…':'Save'}</Button><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button></div>
  </form>
 </DialogContent></Dialog>;
}

function PurchasingDocuments({target,canUpload,onClose}:{target:DocumentTarget;canUpload:boolean;onClose:()=>void}){
 const qc=useQueryClient();
 const path='/procurement/documents/'+target.entity+'/'+target.row.id;
 const query=useQuery({queryKey:['procurement-documents',target.entity,target.row.id],queryFn:()=>api<Row[]>(path)});
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function upload(event:FormEvent){
  event.preventDefault();if(!file)return;
  setBusy(true);setError('');
  try{
   if(file.size>5*1024*1024)throw Error('Choose a file up to 5 MB.');
   await api(path,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
   setFile(null);
   await qc.invalidateQueries({queryKey:['procurement-documents',target.entity,target.row.id]});
  }catch(error){setError((error as Error).message);}
  finally{setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent>
  <DialogHeader><DialogTitle>Supporting documents</DialogTitle><DialogDescription>{target.row.reference} · Quotations, supplier POs, invoices or payment proof. PDF, PNG, JPG and WebP, up to 5 MB each.</DialogDescription></DialogHeader>
  {query.isPending&&<p>Loading documents…</p>}
  {query.isError&&<p role="alert">{query.error.message}</p>}
  <ul>{query.data?.map(document=><li key={String(document.id)} className="py-2"><a className="underline" href={'/api'+path+'/'+document.id}>{document.filename}</a></li>)}</ul>
  {canUpload&&<form onSubmit={upload} className="grid gap-3">
   <Input aria-label="Supporting document" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={event=>setFile(event.target.files?.[0]||null)}/>
   <Button disabled={busy||!file}>{busy?'Uploading…':'Upload document'}</Button>
  </form>}
  {error&&<p role="alert" className="text-destructive">{error}</p>}
 </DialogContent></Dialog>;
}
