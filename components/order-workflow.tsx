'use client';
import {CommunicationChoices} from '@/components/communication-choices';
import {useState,type FormEvent,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {IconCheck,IconPaperclip,IconArrowRight,IconPlus,IconFileCheck,IconEye,IconTrash} from '@tabler/icons-react';
import {api,today,formatDate,type Row} from '@/lib/data';
import {communicationMethods,documentsFor,fileAccept,uploadDocument,type OrderDocument} from '@/lib/documents';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
function Files({docs,orderId,onChange,onRemove,editableRevision,busy}:{docs:OrderDocument[];orderId:string;onChange?:(doc:OrderDocument,remove:boolean)=>void;onRemove?:(doc:OrderDocument)=>void;editableRevision:number;busy:boolean}){
 return <div className="request-files">{docs.map(doc=>{
  const url="/api/orders/"+orderId+"/documents/"+doc.id;
  const previewUrl=url+"?preview=1";
  const metadata=<small>{doc.channel} · {doc.uploaded_by} · {formatDate(doc.created_at)}{doc.quote_revision?" · Quote revision "+doc.quote_revision:""}{doc.category==="po"?" · Order revision "+doc.order_revision:""}</small>;
  if(doc.category==="quotation")return <a key={doc.id} href={url} download><IconPaperclip size={14}/><span>{doc.filename}{metadata}</span></a>;
  const edit=doc.category!=="po"||doc.order_revision===editableRevision?onChange:undefined;
  const remove=edit?()=>edit(doc,true):onRemove&&(doc.category==="request"||doc.category==="po"&&doc.order_revision<editableRevision)?()=>onRemove(doc):undefined;
  return <div key={doc.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border border-border p-2">
   <a href={url} download className="flex min-w-0 items-center gap-2 break-all">
    <IconPaperclip size={14} className="shrink-0"/><span>{doc.filename}{metadata}</span>
   </a>
   <div className="ml-auto flex flex-wrap items-center gap-2">
   <Button asChild size="icon-sm" variant="outline" className="shrink-0">
    <a href={previewUrl} target="_blank" rel="noopener noreferrer" aria-label={"View "+doc.filename} title="View attachment"><IconEye aria-hidden/></a>
   </Button>
   {edit&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>edit(doc,false)}>Rename</Button>}
   {remove&&<Button size="icon-sm" variant="outline" disabled={busy} aria-label={"Remove "+doc.filename} title="Remove attachment" onClick={remove}><IconTrash aria-hidden/></Button>}
   </div>
  </div>;
 })}</div>;
}
function EvidenceForm({order,category,canEdit,onSaved,summary,actions}:{order:Row;category:'request'|'quotation'|'po';canEdit:boolean;onSaved:(message:string)=>void;summary?:ReactNode;actions?:ReactNode}){
 const qc=useQueryClient();const [channel,setChannel]=useState(String(category==='request'&&order.request_channel!=='Not recorded'?order.request_channel:category==='po'?order.po_channel||'':''));const [file,setFile]=useState<File|null>(null);const [fileReset,setFileReset]=useState(0);const [reference,setReference]=useState(String(category==='quotation'?order.quote_ref||'':order.po_ref||''));const [received,setReceived]=useState(String(order.po_received_date||today()).slice(0,10));const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [showForm,setShowForm]=useState(false);
 const [shipTo,setShipTo]=useState(String(order.ship_to||''));
 const requestChannel=String(order.request_channel||'');
 const hasRequestChannel=communicationMethods.includes(requestChannel);
 const requestLabel=order.sales_path==='agreed'?'Agreed price proof':'Request attachment';
 const accepted=['PO received','Ready for sourcing','Confirmed'].includes(String(order.stage));
 const docs=useQuery({queryKey:['order-documents',order.id],queryFn:()=>documentsFor(String(order.id)),staleTime:0});
 const documents=(docs.data||[]).filter(d=>d.category===category);
 const currentDocuments=documents.filter(d=>category!=='po'||d.order_revision===Number(order.order_revision));
 const hasMatchingPo=category==='po'&&currentDocuments.some(doc=>doc.channel===channel);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
  if(category==='po'&&!shipTo.trim())throw Error('Enter the ship-to address before recording the customer PO.');
  if(file){await uploadDocument(String(order.id),file,category,category==='request'?requestChannel:channel,Number(order.order_revision));setFile(null);setFileReset(value=>value+1);await qc.invalidateQueries({queryKey:['order-documents',order.id]});}
  if(category==='quotation')await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'Quoted',quote_ref:reference})});
  if(category==='po')await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'PO received',po_ref:reference,po_channel:channel,po_received_date:received,ship_to:shipTo.trim()})});
  await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]})]);setShowForm(false);onSaved(category==='request'?'Attachment saved':category==='quotation'?'Quotation recorded as shared':'Customer PO received and recorded');
 }catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 async function changeAttachment(doc:OrderDocument,remove:boolean){
  const filename=remove?null:window.prompt("Attachment name",doc.filename)?.trim();
  if(remove?!window.confirm("Remove "+doc.filename+"?"):!filename||filename===doc.filename)return;
  setBusy(true);setError("");
  try{
   await api("/orders/"+order.id+"/documents/"+doc.id,remove?{method:"DELETE"}:{method:"PATCH",body:JSON.stringify({filename})});
   await Promise.all([qc.invalidateQueries({queryKey:["order-documents",order.id]}),qc.invalidateQueries({queryKey:["order-history",order.id]})]);
   onSaved(remove?"Attachment removed":"Attachment renamed");
  }catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 const [poTrigger,setPoTrigger]=useState<HTMLButtonElement|null>(null);
 const addAttachment=(category==="po"||category==="request"&&hasRequestChannel)&&canEdit&&!accepted&&order.stage!=="Cancelled"&&(category==="po"||!showForm)&&!docs.error&&
  <Button type="button" size="sm" variant={category==="po"?"default":"outline"} ref={category==="po"?setPoTrigger:undefined} aria-haspopup={category==="po"?"dialog":undefined} disabled={docs.isPending} onClick={()=>{
   if(category==="po")setShipTo(String(order.ship_to||""));
   if(category==="po"&&!channel&&currentDocuments.length)setChannel(currentDocuments[0].channel);
   setError("");setShowForm(true);
  }}>
   {category==="po"&&<IconFileCheck size={15}/>} {category==="po"?"Record PO received":documents.length?"Add another attachment":"Add "+requestLabel.toLowerCase()}
  </Button>;
 function closeForm(){if(busy)return;setFile(null);setError("");setShowForm(false);}
 

 const form=<form className="evidence-form" onSubmit={submit}>
 {category!=='request'&&<label>{category==='quotation'?'Quotation reference':'Customer PO number'}<Input required maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
 {category==='po'&&<label>PO received on<Input type="date" required value={received} onChange={e=>setReceived(e.target.value)}/></label>}
 {category==='po'&&<label className="wide">Ship-to address<Textarea required maxLength={1000} value={shipTo} onChange={e=>setShipTo(e.target.value)}/></label>}
 {category!=='request'&&<CommunicationChoices label={category==='quotation'?'Quotation shared through':'PO received through'} value={channel} onChange={setChannel} options={category==='po'?communicationMethods.filter(m=>m!=='Call'):communicationMethods} className="wide"/>}
 <label className="evidence-file">{category==='request'?requestLabel:category==='quotation'?'Quotation PDF or shared-message screenshot':hasMatchingPo?'Additional PO document (optional)':'Customer PO document'}<Input key={fileReset} type="file" accept={fileAccept} required={category==='request'||!currentDocuments.some(d=>d.channel===channel&&(category!=='quotation'||d.quote_revision===(order.stage==='Quoted'?Number(order.quote_version):Number(order.quote_version)+1)))} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
 <small>PNG / JPG / WebP / PDF · Max 5 MB</small>
 <div className="col-span-full flex flex-wrap justify-end gap-2">
 {category!=='quotation'&&<Button type="button" variant="outline" disabled={busy} onClick={closeForm}>Cancel</Button>}
 <Button type="submit" disabled={busy||docs.isPending}>{busy?'Saving…':category==='request'?'Save attachment':category==='quotation'?'Record quotation shared':'Record PO received'}</Button>
 </div>
 {error&&showForm&&<div className="error-box" role="alert">{error}</div>}
 </form>;
 const showEvidence=canEdit&&!accepted&&order.stage!=='Cancelled'&&(category==='quotation'||showForm&&(category==='po'||hasRequestChannel));
 return <>{summary&&<header>{summary}<div className="ml-auto flex flex-wrap items-center gap-2">{actions}{addAttachment}</div></header>}
 {docs.error?<div className="error-box" role="alert">{docs.error.message}<Button size="sm" variant="outline" onClick={()=>void docs.refetch()}>Try again</Button></div>:<Files docs={documents} orderId={String(order.id)} busy={busy} editableRevision={Number(order.order_revision)} onRemove={canEdit?doc=>void changeAttachment(doc,true):undefined} onChange={canEdit&&!accepted&&order.stage!=="Cancelled"&&(category==="po"||category==="request"&&!order.ever_confirmed)?changeAttachment:undefined}/>}
 {showEvidence&&(category==='po'?<Dialog open onOpenChange={open=>{if(!open)closeForm();}}>
  <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={e=>{e.preventDefault();poTrigger?.focus();}} onInteractOutside={e=>e.preventDefault()}>
   <DialogHeader><DialogTitle>Record PO received</DialogTitle><DialogDescription>{Number(order.order_revision)>1?'Revised customer PO':'Customer PO'}</DialogDescription></DialogHeader>
   {form}
  </DialogContent>
 </Dialog>:form)}
 {error&&!showForm&&<div className="error-box" role="alert">{error}</div>}
 </>;
}
function OrderStep({number,done,children}:{number:number;done:boolean;children:ReactNode}){
 return <li className="order-step">
  <span className={done?"order-step-marker done":"order-step-marker"}>
   {done?<><IconCheck size={15} aria-hidden/><span className="sr-only">Completed</span></>:number}
  </span>
  <div className="order-step-content">{children}</div>
 </li>;
}
export function OrderWorkflow({order,canEdit,onEdit,onAmend,onSaved,onSource,sourcing,children}:{order:Row;canEdit:boolean;onEdit:()=>void;onAmend:()=>void;onSource?:()=>void;sourcing?:ReactNode;onSaved:(message:string)=>void;children?:ReactNode}){
 const qc=useQueryClient();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const accepted=['PO received','Ready for sourcing','Confirmed'].includes(String(order.stage));const ready=order.stage==='Ready for sourcing';const needsQuote=order.sales_path==='needs-pricing';const quoteDone=Number(order.quote_version)>0;const revised=Number(order.order_revision)>1;
 const pricesReady=needsQuote?quoteDone&&(accepted||revised||order.stage==='Quoted'):order.subtotal_paise!=null;
 async function markReady(){setBusy(true);setError('');try{await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'Ready for sourcing'})});await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]})]);onSaved('Marked ready for sourcing');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <section className="request-workflow" aria-label="Order progress">{revised&&<div className="form-note">Order revision {order.order_revision}{!accepted?" · Revised PO required":""}</div>}
  <ol className="order-steps">
   <OrderStep number={1} done>
    <EvidenceForm key={`request-${order.id}`} order={order} category="request" canEdit={canEdit} onSaved={onSaved} summary={<><div><h3>Customer request</h3><p>{communicationMethods.includes(String(order.request_channel))?'Received via '+order.request_channel:'Communication method not recorded'}{order.request_notes?` · ${order.request_notes}`:''}</p></div>{canEdit&&!accepted&&!communicationMethods.includes(String(order.request_channel))&&<Button size="sm" variant="outline" onClick={onEdit}>Record communication</Button>}</>}/>
   </OrderStep>
   <OrderStep number={2} done={pricesReady}>
    <header><div><h3>{needsQuote?"Quotation":"Agreed prices"}</h3></div>{canEdit&&!accepted&&!revised&&<Button size="sm" variant="outline" onClick={onEdit}>Edit prices</Button>}</header>
    {children}
    {needsQuote&&<EvidenceForm key={`quotation-${order.id}-${order.quote_version}`} order={order} category="quotation" canEdit={canEdit&&!revised&&order.stage!=='Quoted'} onSaved={onSaved}/>} {order.stage==='Quoted'&&canEdit&&<p className="workflow-hint">To revise: change the step to Pricing.</p>}
   </OrderStep>
   <OrderStep number={3} done={accepted}>
    {!needsQuote||quoteDone||revised?<EvidenceForm key={`po-${order.id}-${order.stage}`} order={order} category="po" canEdit={canEdit} onSaved={onSaved} summary={<div><h3>{revised?"Revised customer PO":"Customer PO"}</h3>{accepted&&<p>{order.po_channel||'Not recorded'} · {formatDate(order.po_received_date)} · {order.po_ref||'No reference'}</p>}</div>} actions={canEdit&&(accepted||revised)&&<Button size="sm" variant="outline" onClick={onAmend}><IconPlus size={15}/>Add SKUs / revise PO</Button>}/>:<><h3>Customer PO</h3><p className="workflow-hint">Share the quotation first.</p></>}
   </OrderStep>
   <OrderStep number={4} done={ready}>
    <header><h3>Ready for sourcing</h3>{ready&&onSource&&<Button size="sm" onClick={onSource}>Record sourcing details</Button>}</header><div><p>{ready?'Ready for manual handoff':accepted?'Customer PO received':'Confirm PO receipt above to continue.'}</p></div>{ready&&sourcing}{canEdit&&!ready&&<Button disabled={!accepted||busy} onClick={()=>void markReady()}>{busy?'Saving…':'Mark ready for sourcing'}<IconArrowRight size={15}/></Button>}{error&&<div className="error-box" role="alert">{error}</div>}
   </OrderStep>
  </ol>
 </section>;
}
