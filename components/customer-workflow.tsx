'use client';

import {useState,type FormEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {api,formatDate,orderCode,today,type Row} from '@/lib/data';
import {fileAccept} from '@/lib/documents';

type Sampling={rounds:Row[];events:Row[];documents:Row[]};
export type SampleStep='request'|'qc'|'customer'|'sourcing';
const selectClass='rounded-md border border-input bg-background p-2';
const stages=['Draft','Enquiry','Pricing'];
const retryable=['QC failed','Changes requested','Rejected'];
const issuedStages=['Issued','Customer accepted','Approved','Rejected','Changes requested'];
const labels:Record<string,string>={Receive:'Record receipt','Pass QC':'Pass QC','Fail QC':'Fail QC',Issue:'Issue to customer',
 Accept:'Record acceptance','Request changes':'Record changes requested',Reject:'Record rejection',Approve:'Save final approval',
 Return:'Record return',Replacement:'Record replacement'};
const evidence={
 qc:{label:'QC photos',accept:'image/png,image/jpeg,image/webp'},
 issue:{label:'Delivery challan or POD',accept:fileAccept},
 approval:{label:'Written customer approval',accept:fileAccept}
};
const statusActions:Record<string,string[]>={Ordered:['Receive'],Received:['Pass QC','Fail QC'],'QC passed':['Issue'],
 Issued:['Accept','Request changes','Reject'],'Customer accepted':['Approve']};

export function SamplePanel({actorId,step,order,items=[],canEdit=false,onQuote,onCompare}:{
 actorId:string;step:SampleStep;order?:Row;items?:Row[];canEdit?:boolean;onQuote?:(round:Row)=>void;onCompare?:(round:Row)=>void
}){
 const qc=useQueryClient();
 const [selected,setSelected]=useState('');
 const [itemId,setItemId]=useState('');
 const [creating,setCreating]=useState(false);
 const [action,setAction]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const scope=order?'/samples?order_id='+order.id:'/samples';
 const query=useQuery({queryKey:['samples',actorId,order?.id],queryFn:()=>api<Sampling>(scope),refetchInterval:30000});
 if(query.isPending)return <p role="status">Loading sample rounds…</p>;
 if(query.isError)return <p className="error-box" role="alert">{query.error.message}</p>;
 const {rounds,events,documents}=query.data;
 const round=rounds.find(r=>r.id===selected)||rounds[0];
 const roundEvents=events.filter(event=>event.round_id===round?.id);
 const roundFiles=documents.filter(doc=>doc.round_id===round?.id);
 const available=items.filter(item=>{
  const latest=rounds.find(r=>r.order_item_id===item.id);
  return !latest||retryable.includes(String(latest.status));
 });
 const editable=canEdit&&!['On hold','Cancelled'].includes(String(round?.order_stage));
 const canRequest=step==='request'&&canEdit&&!!order&&stages.includes(String(order.stage))&&available.length>0;
 const canQuote=step==='sourcing'&&onQuote&&round?.status==='Requested'&&stages.includes(String(round.order_stage));
 const stageActions=statusActions[String(round?.status)]||[];
 const actions=step==='qc'?stageActions.filter(a=>['Receive','Pass QC','Fail QC','Issue'].includes(a)):
  step==='customer'?[...stageActions.filter(a=>['Accept','Request changes','Reject','Approve'].includes(a)),
   ...(issuedStages.includes(String(round?.status))?['Return','Replacement']:[])]:[];
 const category=step==='qc'?(round?.status==='Received'?'qc':['QC passed',...issuedStages].includes(String(round?.status))?'issue':null):
  step==='customer'&&round?.status==='Customer accepted'?'approval':null;

 async function save(work:()=>Promise<unknown>){
  setBusy(true);setError('');
  try{
   await work();
   await Promise.all([qc.invalidateQueries({queryKey:['samples']}),qc.invalidateQueries({queryKey:['workspace']})]);
   setCreating(false);setAction('');
  }catch(error){setError((error as Error).message);}
  finally{setBusy(false);}
 }

 function create(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const fields=new FormData(event.currentTarget);
  void save(async()=>{
   const result=await api<{id:string}>('/samples',{method:'POST',body:JSON.stringify({
    order_id:order?.id,order_item_id:itemId,qty:Number(fields.get('qty')),sample_type:fields.get('sample_type'),
    needed_on:fields.get('needed_on'),specifications:fields.get('specifications')
   })});
   setSelected(result.id);
  });
 }

 function record(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!round)return;
  const fields=new FormData(event.currentTarget);
  void save(()=>api('/samples/'+round.id+'/events',{method:'POST',body:JSON.stringify({
   action,version:round.version,event_date:fields.get('event_date'),qty:Number(fields.get('qty')),
   reference:fields.get('reference'),notes:fields.get('notes')
  })}));
 }

 function upload(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const form=event.currentTarget;
  const file=new FormData(form).get('evidence');
  if(!category||!round||!(file instanceof File))return;
  void save(async()=>{
   if(!file.size||file.size>5*1024*1024)throw Error('Choose a file up to 5 MB.');
   await api('/samples/'+round.id+'/documents',{method:'POST',headers:{
    'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Document-Category':category
   },body:file});
   form.reset();
  });
 }

 return <section className="surface p-4 grid gap-4">
  <div className="flex items-center justify-between gap-3">
   <h2>{step==='sourcing'?'Sample sourcing':step==='qc'?'Sample receipt, QC & issue':step==='customer'?'Customer evaluation & approval':'Sample requests'}</h2>
   {canRequest&&!creating&&<Button onClick={()=>{setItemId('');setCreating(true);setError('');}}>Request sample</Button>}
  </div>
  {creating&&canRequest&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={create}>
   <label className="grid gap-2 sm:col-span-2">SKU<select aria-label="SKU" className={selectClass} required value={itemId} onChange={e=>setItemId(e.target.value)}>
    <option value="">Choose a SKU…</option>{available.map(item=><option key={item.id} value={String(item.id)}>{item.sku} · {item.description}</option>)}
   </select></label>
   <label className="grid gap-2">Sample type<Input required name="sample_type" maxLength={160} placeholder="Pre-production sample"/></label>
   <label className="grid gap-2">Sample quantity<Input required type="number" name="qty" min={1} max={1000000} defaultValue={1}/></label>
   <label className="grid gap-2">Needed by<Input required type="date" name="needed_on" defaultValue={today()}/></label>
   <label className="grid gap-2 sm:col-span-2">Confirmed product specifications<Textarea required name="specifications" maxLength={2000} placeholder="Model, sizes, colour, branding, quality, order quantity and delivery timeline"/></label>
   <div className="flex gap-2 sm:col-span-2"><Button disabled={busy}>Save sample request</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setCreating(false)}>Cancel</Button></div>
  </form>}
  {!round&&(!creating||step!=='request')&&<p className="muted">{step==='request'?'No sample rounds yet. Request a sample for an enquiry SKU that needs customer approval.':'No sample rounds to show yet.'}</p>}
  {round&&<>
   <label className="grid gap-2">Sample round
    <select aria-label="Sample round" className={selectClass} value={String(round.id)} disabled={busy} onChange={e=>{setSelected(e.target.value);setAction('');setError('');}}>
     {rounds.map(r=><option key={r.id} value={String(r.id)}>{r.customer_name} · {r.sku} · Round {r.round_number} · {r.status}</option>)}
    </select>
   </label>
   <div className="grid gap-1 text-sm">
    <strong>{round.sku} · {round.description}</strong>
    <span>{round.qty} × {round.sample_type} · Needed {formatDate(round.needed_on)} · {round.status}</span>
    <p className="whitespace-pre-wrap">{round.specifications}</p>
    {round.po_reference&&<p>Supplier PO {round.po_reference} · {round.supplier_name} · {round.po_qty} units</p>}
   </div>
   {step==='request'&&round.status==='Requested'&&<p className="muted">Sourcing can compare vendor quotes and issue the sample PO under Supplier sourcing → Sample requests.</p>}
   {step==='customer'&&round.status==='Approved'&&<p className="muted">This SKU has written approval. Open the enquiry in Enquiries & orders to continue with the commercial quotation or customer PO.</p>}
   {step==='sourcing'&&<div className="flex flex-wrap gap-2">
    {canQuote&&<Button onClick={()=>onQuote(round)}>Add sample quotation</Button>}
    {onCompare&&<Button variant="outline" onClick={()=>onCompare(round)}>Compare sample quotations</Button>}
   </div>}
   {step==='sourcing'&&round.status==='Ordered'&&<p className="muted">Use Purchase orders to request payment for a chargeable sample. Record receipt and QC in the customer’s workflow.</p>}
   {editable&&category&&<form key={round.id+'-'+category} className="grid gap-2" onSubmit={upload}>
    <label className="grid gap-2">{evidence[category].label}<Input required name="evidence" type="file" accept={evidence[category].accept}/></label>
    <div><Button variant="outline" disabled={busy}>{category==='qc'?'Upload QC photo':'Upload evidence'}</Button></div>
   </form>}
   {roundFiles.length>0&&<div className="flex flex-wrap gap-3" aria-label="Sample evidence">
    {roundFiles.map(doc=>{
     const href='/api/samples/'+round.id+'/documents/'+doc.id;
     return <a key={doc.id} className="grid gap-1 rounded border p-2 text-sm underline" href={href} target="_blank" rel="noreferrer">
      {doc.category==='qc'&&<img className="h-24 w-32 rounded object-contain" src={href} alt={String(doc.filename)}/>}
      <span>{evidence[doc.category as keyof typeof evidence].label} · {doc.filename}</span>
     </a>;
    })}
   </div>}
   {editable&&actions.length>0&&<div className="flex flex-wrap gap-2">{actions.map(next=><Button key={next} variant={action===next?'default':'outline'} disabled={busy||next==='Approve'&&!roundFiles.some(doc=>doc.category==='approval')} onClick={()=>{setAction(next);setError('');}}>{labels[next]}</Button>)}</div>}
   {editable&&actions.includes(action)&&<form key={round.id+'-'+action} className="grid gap-3 sm:grid-cols-2" onSubmit={record}>
    <label className="grid gap-2">Event date<Input required type="date" name="event_date" defaultValue={today()}/></label>
    {['Receive','Issue','Return','Replacement'].includes(action)&&<label className="grid gap-2">Quantity<Input required type="number" min={1} name="qty" defaultValue={action==='Receive'?String(round.po_qty):action==='Issue'?String(roundEvents.find(e=>e.action==='Receive')?.qty||1):1}/></label>}
    <label className="grid gap-2">Challan / tracking / POD reference<Input required={action==='Issue'} name="reference" maxLength={200}/></label>
    <label className="grid gap-2 sm:col-span-2">{action.endsWith('QC')?'QC findings / defects':'Notes'}<Textarea required={!['Receive','Issue','Accept','Approve'].includes(action)} name="notes" maxLength={2000}/></label>
    <div className="flex gap-2 sm:col-span-2"><Button disabled={busy}>Save activity</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setAction('')}>Cancel</Button></div>
   </form>}
   <div className="grid gap-2">
    <h3 className="font-semibold">Round history</h3>
    <ul className="grid gap-2 text-sm">{roundEvents.map(e=><li key={e.id} className="border-t pt-2">
     <strong>{labels[String(e.action)]||e.action}</strong> · {formatDate(e.event_date)} · {e.actor_name}
     {e.qty!=null&&<span> · {e.qty} units</span>}{e.reference&&<span> · {e.reference}</span>}
     {e.notes&&<p className="whitespace-pre-wrap">{e.notes}</p>}
    </li>)}</ul>
   </div>
  </>}
  {error&&<p className="error-box" role="alert">{error}</p>}
 </section>;
}

export function CustomerWorkflow({customer,orders,items,actorId,canCreate,canEdit,onCreate,onOpen}:{
 customer:Row;orders:Row[];items:Row[];actorId:string;canCreate:boolean;canEdit:boolean;onCreate:()=>void;onOpen:(order:Row)=>void
}){
 const [step,setStep]=useState<'enquiries'|SampleStep>('enquiries');
 const [selected,setSelected]=useState('');
 const order=orders.find(o=>o.id===selected)||orders[0];
 const tabs=[['enquiries','Enquiries & orders'],['request','Sample requests'],['qc','QC & issue'],['customer','Customer approval']] as const;
 return <div className="grid gap-4">
  <div className="flex flex-wrap gap-2" aria-label="Customer workflow">
   {tabs.map(([key,label])=><Button key={key} variant={step===key?'default':'outline'} aria-pressed={step===key} onClick={()=>setStep(key)}>{label}</Button>)}
  </div>
  {step==='enquiries'?<section className="surface">
   <div className="surface-heading"><h2>Enquiries & orders</h2>{canCreate&&<Button onClick={onCreate}>New enquiry</Button>}</div>
   {orders.length===0?<p className="p-4 muted">Record the first enquiry for {customer.name} to start the workflow.</p>:
    <div className="table-scroll"><table><thead><tr><th>Enquiry / order</th><th>SKUs</th><th>Stage</th><th>Actions</th></tr></thead>
     <tbody>{orders.map(o=><tr key={o.id}>
      <td><strong>{orderCode(o)}</strong><small>{o.description}</small></td>
      <td>{items.filter(item=>item.order_id===o.id).map(item=>item.sku).join(', ')}</td>
      <td>{o.stage}</td><td><Button variant="outline" size="sm" onClick={()=>onOpen(o)}>View order</Button></td>
     </tr>)}</tbody></table></div>}
  </section>:order?<>
   <label className="grid gap-2">Enquiry / order<select aria-label="Enquiry / order" className={selectClass} value={String(order.id)} onChange={e=>setSelected(e.target.value)}>
    {orders.map(o=><option key={o.id} value={String(o.id)}>{orderCode(o)} · {o.description}</option>)}
   </select></label>
   <SamplePanel key={String(order.id)} step={step} actorId={actorId} order={order} items={items.filter(i=>i.order_id===order.id)} canEdit={canEdit}/>
  </>:<p className="muted">Create an enquiry with a SKU before requesting samples.</p>}
 </div>;
}
