'use client';
import {CommunicationChoices} from '@/components/communication-choices';
import {useState,type FormEvent,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {IconCheck,IconPaperclip,IconArrowRight} from '@tabler/icons-react';
import {api,today,formatDate,type Row} from '@/lib/data';
import {communicationMethods,documentsFor,fileAccept,uploadDocument,type OrderDocument} from '@/lib/documents';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
function Files({docs,orderId}:{docs:OrderDocument[];orderId:string}){return <div className="request-files">{docs.map(doc=><a key={doc.id} href={`/api/orders/${orderId}/documents/${doc.id}`} download><IconPaperclip size={14}/><span>{doc.filename}<small>{doc.channel} · {doc.uploaded_by} · {formatDate(doc.created_at)}{doc.quote_revision?` · Quote revision ${doc.quote_revision}`:''}{doc.category==='po'?` · Order revision ${doc.order_revision}`:''}</small></span></a>)}</div>;}
function EvidenceForm({order,category,canEdit,onSaved}:{order:Row;category:'request'|'quotation'|'po';canEdit:boolean;onSaved:(message:string)=>void}){
 const qc=useQueryClient();const [channel,setChannel]=useState(String(category==='request'&&order.request_channel!=='Not recorded'?order.request_channel:category==='po'?order.po_channel||'':''));const [file,setFile]=useState<File|null>(null);const [fileReset,setFileReset]=useState(0);const [reference,setReference]=useState(String(category==='quotation'?order.quote_ref||'':order.po_ref||''));const [received,setReceived]=useState(String(order.po_received_date||today()).slice(0,10));const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const accepted=['PO received','Ready for sourcing','Confirmed'].includes(String(order.stage));
 const docs=useQuery({queryKey:['order-documents',order.id],queryFn:()=>documentsFor(String(order.id)),staleTime:0});
 const documents=(docs.data||[]).filter(d=>d.category===category);
 const currentDocuments=documents.filter(d=>category!=='po'||d.order_revision===Number(order.order_revision));
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
  if(file){await uploadDocument(String(order.id),file,category,channel,Number(order.order_revision));setFile(null);setFileReset(value=>value+1);await qc.invalidateQueries({queryKey:['order-documents',order.id]});}
  if(category==='quotation')await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'Quoted',quote_ref:reference})});
  if(category==='po')await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'PO received',po_ref:reference,po_channel:channel,po_received_date:received})});
  await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]})]);onSaved(category==='request'?'Customer communication attached':category==='quotation'?'Quotation recorded as shared':'Customer PO received and recorded');
 }catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <>{docs.error?<div className="error-box" role="alert">{docs.error.message}<Button size="sm" variant="outline" onClick={()=>void docs.refetch()}>Try again</Button></div>:<Files docs={documents} orderId={String(order.id)}/>}
 {canEdit&&!accepted&&<form className="evidence-form" onSubmit={submit}>
 {category!=='request'&&<label>{category==='quotation'?'Quotation reference':'Customer PO reference'}<Input required maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
 <CommunicationChoices label={category==='request'?'Received through':category==='quotation'?'Quotation shared through':'PO received through'} value={channel} onChange={setChannel} options={category==='po'?communicationMethods.filter(m=>m!=='Call'):communicationMethods} className="wide"/>
 {category==='po'&&<label>PO received on<Input type="date" required value={received} onChange={e=>setReceived(e.target.value)}/></label>}
 <label className="evidence-file">{category==='request'?'Message / email screenshot':category==='quotation'?'Quotation PDF or shared-message screenshot':'Customer PO document'}<Input key={fileReset} type="file" accept={fileAccept} required={!currentDocuments.some(d=>d.channel===channel&&(category!=='quotation'||d.quote_revision===(order.stage==='Quoted'?Number(order.quote_version):Number(order.quote_version)+1)))} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
 <small>PNG / JPG / WebP / PDF · Max 5 MB</small>
 {error&&<div className="error-box" role="alert">{error}</div>}
 <Button type="submit" disabled={busy||docs.isPending}>{busy?'Saving…':category==='request'?'Attach communication':category==='quotation'?'Record quotation shared':'Record PO received'}</Button>
 </form>}
 </>;
}
export function OrderWorkflow({order,canEdit,onEdit,onAmend,onSaved,children}:{order:Row;canEdit:boolean;onEdit:()=>void;onAmend:()=>void;onSaved:(message:string)=>void;children?:ReactNode}){
 const qc=useQueryClient();const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const accepted=['PO received','Ready for sourcing','Confirmed'].includes(String(order.stage));const ready=order.stage==='Ready for sourcing';const needsQuote=order.sales_path==='needs-pricing';const quoteDone=Number(order.quote_version)>0;const revised=Number(order.order_revision)>1;
 const steps=[{title:'Customer request',done:true},{title:needsQuote?'Quotation shared':'Price agreed',done:!needsQuote||quoteDone},{title:revised?'Revised PO received':'Customer PO received',done:accepted},{title:'Ready for sourcing',done:ready}];
 async function markReady(){setBusy(true);setError('');try{await api(`/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({version:Number(order.version),stage:'Ready for sourcing'})});await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]})]);onSaved('Marked ready for sourcing');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
 return <section className="request-workflow" aria-label="Request progress">{revised&&<div className="form-note">Order revision {order.order_revision}{!accepted?' · Revised PO required':''}</div>}<div className="workflow-track">{steps.map((step,i)=><div key={step.title} className={step.done?'done':''}><span>{step.done?<IconCheck size={15}/>:i+1}</span><strong>{step.title}</strong></div>)}</div>
 <div className="evidence-card"><header><div><h3>1. Customer communication</h3><p>Received by {order.request_channel||'Not recorded'}{order.request_notes?` · ${order.request_notes}`:''}</p></div></header><EvidenceForm key={`request-${order.id}`} order={order} category="request" canEdit={canEdit} onSaved={onSaved}/></div>{children}
 <div className="evidence-card"><header><div><h3>2. {needsQuote?(revised?'Original quotation':'Share the quotation'):'Agreed customer prices'}</h3></div>{canEdit&&!accepted&&!revised&&<Button size="sm" variant="outline" onClick={onEdit}>Update prices / details</Button>}</header>{needsQuote&&<EvidenceForm key={`quotation-${order.id}-${order.quote_version}`} order={order} category="quotation" canEdit={canEdit&&!revised&&order.stage!=='Quoted'} onSaved={onSaved}/>} {order.stage==='Quoted'&&canEdit&&<p className="workflow-hint">To revise: change the step to Pricing.</p>}</div>
 <div className="evidence-card"><header><div><h3>3. {revised?'Revised customer PO':'Customer PO'}</h3>{accepted&&<p>{order.po_channel||'Not recorded'} · {formatDate(order.po_received_date)} · {order.po_ref||'No reference'}</p>}</div>{canEdit&&(accepted||revised)&&<Button size="sm" variant="outline" onClick={onAmend}>Add SKUs / revise PO</Button>}</header>{!needsQuote||quoteDone||revised?<EvidenceForm key={`po-${order.id}-${order.stage}`} order={order} category="po" canEdit={canEdit} onSaved={onSaved}/>:<p className="workflow-hint">Share the quotation first.</p>}</div>
 <div className="sourcing-ready"><div><h3>4. Ready for sourcing</h3><p>{ready?'Awaiting manual handoff':accepted?'PO received':'PO required'}</p></div>{canEdit&&!ready&&<Button disabled={!accepted||busy} onClick={()=>void markReady()}>{busy?'Saving…':'Mark ready for sourcing'}<IconArrowRight size={15}/></Button>}</div>{error&&<div className="error-box" role="alert">{error}</div>}
 </section>;
}
