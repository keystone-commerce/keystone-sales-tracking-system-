'use client';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {IconPlus,IconTrash} from '@tabler/icons-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {communicationMethods,fileAccept,uploadDocument} from '@/lib/documents';
import {Textarea} from '@/components/ui/textarea';
import {skuUnits,api,money,num,orderCode,today,type Row} from '@/lib/data';
type NewItem={key:number;sku:string;description:string;unit_of_measure:string;qty:string;rate:string;gst:string};
export function OrderAmendment({order,onClose,onSaved}:{order:Row;onClose:()=>void;onSaved:(id:string,message:string)=>void}){
 const qc=useQueryClient();const [items,setItems]=useState<NewItem[]>([]);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [poFile,setPoFile]=useState<File|null>(null);
 const [poChannel,setPoChannel]=useState(String(order.po_channel||''));
 const [poNumber,setPoNumber]=useState('');
 const [poDate,setPoDate]=useState(today);
 function edit(index:number,key:keyof NewItem,value:string){setItems(old=>old.map((item,i)=>i===index?{...item,[key]:value}:item));}
 function close(){if(!busy&&(!(reason||items.length||poFile)||window.confirm('Discard unsaved revision?')))onClose();}
 const added=items.reduce((total,i)=>{const base=num(i.qty)*Math.round(num(i.rate)*100);return total+base+Math.round(base*num(i.gst)/100);},0);
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="sm:max-w-[960px] max-h-[90dvh] overflow-y-auto" onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>Add SKUs / revise PO</DialogTitle><DialogDescription>{orderCode(order)} · Order revision {Number(order.order_revision)+1}</DialogDescription></DialogHeader>
 <form className="record-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{if(poFile&&(!poFile.size||poFile.size>5*1024*1024))throw Error('Choose a non-empty PO document up to 5 MB.');const result=await api<{id:string;order_revision:number}>(`/orders/${order.id}/amendments`,{method:'POST',body:JSON.stringify({version:Number(order.version),reason,items:items.map(i=>({sku:i.sku,description:i.description,unit_of_measure:i.unit_of_measure,qty:Number(i.qty),rate_paise:Math.round(Number(i.rate)*100),gst_bps:Math.round(Number(i.gst)*100)}))})});
  let message="Revision saved. Attach the revised customer PO.";
  if(poFile){
   let uploaded=false;
   try{
    await uploadDocument(result.id,poFile,"po",poChannel,result.order_revision);
    uploaded=true;
    // Saving an amendment increments the order version once. Uploading the document does not.
    await api(`/orders/${result.id}`,{method:'PATCH',body:JSON.stringify({
     version:Number(order.version)+1,stage:'PO received',po_ref:poNumber.trim(),po_channel:poChannel,po_received_date:poDate
    })});
    message="Revision saved and revised PO confirmed.";
   }catch(err){
    message=uploaded
     ?`Revision saved and PO attached. Confirm receipt from Customer PO. ${(err as Error).message}`
     :`Revision saved. Upload the revised PO from Customer PO. ${(err as Error).message}`;
   }
  }
  await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]}),qc.invalidateQueries({queryKey:['order-documents',order.id]})]);onSaved(result.id,message);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
 <label>Reason for revision *<Textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Customer added SKUs"/></label>
 <section className="sku-editor"><div className="sku-heading"><h3>Additional SKUs</h3><Button type="button" variant="outline" size="sm" disabled={num(order.item_count)+items.length>=100} onClick={()=>setItems(old=>[...old,{key:Math.max(0,...old.map(i=>i.key))+1,sku:'',description:'',unit_of_measure:'Nos',qty:'',rate:'',gst:'18'}])}><IconPlus size={14}/>Add SKU</Button></div>
 {!items.length?<p className="m-0 px-3 py-3 text-xs leading-5 text-muted-foreground">No additional SKUs</p>:<div className="sku-grid-scroll"><div className="sku-column-head sku-create-row"><span>SKU *</span><span>Description *</span><span>Unit of measure *</span><span>Quantity *</span><span>Agreed unit price · ₹ *</span><span>GST %</span><span>Amount · ex GST</span><span/></div>{items.map((item,index)=><div className="sku-create-row" key={item.key}>
 <label className="sku-entry-field"><span className="mobile-cell-label">SKU</span><Input aria-label={`Additional SKU ${index+1}`} required maxLength={100} value={item.sku} onChange={e=>edit(index,'sku',e.target.value)}/></label><label className="sku-entry-field"><span className="mobile-cell-label">Description</span><Input aria-label={`Additional description ${index+1}`} required maxLength={1000} value={item.description} onChange={e=>edit(index,'description',e.target.value)}/></label><label className="sku-entry-field"><span className="mobile-cell-label">Unit of measure</span><select aria-label={`Unit of measure for additional SKU ${index+1}`} required value={item.unit_of_measure} onChange={e=>edit(index,'unit_of_measure',e.target.value)}>{skuUnits.map(unit=><option key={unit}>{unit}</option>)}</select></label><label className="sku-entry-field"><span className="mobile-cell-label">Quantity</span><Input aria-label={`Additional quantity ${index+1}`} required type="number" min={1} max={1000000} step="1" value={item.qty} onChange={e=>edit(index,'qty',e.target.value)}/></label><label className="sku-entry-field"><span className="mobile-cell-label">Unit price (₹)</span><Input aria-label={`Additional selling price ${index+1}`} required type="number" min="0.01" step="0.01" value={item.rate} onChange={e=>edit(index,'rate',e.target.value)}/></label><label className="sku-entry-field"><span className="mobile-cell-label">GST %</span><select aria-label={`Additional GST ${index+1}`} value={item.gst} onChange={e=>edit(index,'gst',e.target.value)}>{['0','5','12','18','28'].map(g=><option key={g}>{g}</option>)}</select></label><strong>{money(num(item.qty)*Math.round(num(item.rate)*100))}</strong><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove additional SKU ${index+1}`} onClick={()=>setItems(old=>old.filter((_,i)=>i!==index))}><IconTrash size={14}/></Button>
 </div>)}</div>}</section>
 <div className="field-grid mt-4 items-start">
  <label><span>Revised PO document</span><Input type="file" className="h-10 text-xs file:mr-3" accept={fileAccept} disabled={busy} onChange={e=>setPoFile(e.target.files?.[0]||null)}/></label>
  <label><span>PO received through{poFile&&<b> *</b>}</span><select className="h-10 w-full text-xs" required={!!poFile} disabled={!poFile||busy} value={poChannel} onChange={e=>setPoChannel(e.target.value)}><option value="">Select…</option>{communicationMethods.filter(method=>method!=="Call").map(method=><option key={method}>{method}</option>)}</select></label>
  <label><span>Customer PO number{poFile&&<b> *</b>}</span><Input className="h-10" required={!!poFile} disabled={!poFile||busy} maxLength={200} pattern=".*\S.*" value={poNumber} onChange={e=>setPoNumber(e.target.value)}/></label>
  <label><span>PO received on{poFile&&<b> *</b>}</span><Input className="h-10" type="date" required={!!poFile} disabled={!poFile||busy} value={poDate} onChange={e=>setPoDate(e.target.value)}/></label>
 </div>
 <div className="sku-totals"><span>Existing total · incl GST<strong>{money(order.total_paise)}</strong></span><span>Additional value · incl GST<strong>{money(added)}</strong></span><span>Revised total · incl GST<strong>{money(num(order.total_paise)+added)}</strong></span></div>
 {error&&<div className="error-box" role="alert">{error}</div>}<div className="form-footer"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':poFile?'Save revision & confirm PO':'Save revision'}</Button></div>
 </form></DialogContent></Dialog>;
}
