'use client';
import {useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {IconPlus,IconTrash} from '@tabler/icons-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {api,money,num,orderCode,type Row} from '@/lib/data';
type NewItem={key:number;sku:string;description:string;qty:string;rate:string;gst:string};
export function OrderAmendment({order,onClose,onSaved}:{order:Row;onClose:()=>void;onSaved:(id:string)=>void}){
 const qc=useQueryClient();const [items,setItems]=useState<NewItem[]>([]);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 function edit(index:number,key:keyof NewItem,value:string){setItems(old=>old.map((item,i)=>i===index?{...item,[key]:value}:item));}
 function close(){if(!busy&&(!(reason||items.length)||window.confirm('Discard unsaved revision?')))onClose();}
 const added=items.reduce((total,i)=>{const base=num(i.qty)*Math.round(num(i.rate)*100);return total+base+Math.round(base*num(i.gst)/100);},0);
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="sm:max-w-[960px] max-h-[90dvh] overflow-y-auto" onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>Add SKUs / revise PO</DialogTitle><DialogDescription>{orderCode(order)} · Order revision {Number(order.order_revision)+1}</DialogDescription></DialogHeader>
 <form className="record-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const result=await api<{id:string}>(`/orders/${order.id}/amendments`,{method:'POST',body:JSON.stringify({version:Number(order.version),reason,items:items.map(i=>({sku:i.sku,description:i.description,qty:Number(i.qty),rate_paise:Math.round(Number(i.rate)*100),gst_bps:Math.round(Number(i.gst)*100)}))})});await Promise.all([qc.invalidateQueries({queryKey:['workspace']}),qc.invalidateQueries({queryKey:['order-history',order.id]}),qc.invalidateQueries({queryKey:['order-documents',order.id]})]);onSaved(result.id);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
 <div className="form-note">Existing items stay unchanged. A revised PO is required before sourcing.</div>
 <label>Reason for revision *<Textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Customer added more items / sent a revised PO"/></label>
 <section className="sku-editor"><div className="sku-heading"><h3>Additional SKUs</h3><Button type="button" variant="outline" size="sm" disabled={num(order.item_count)+items.length>=100} onClick={()=>setItems(old=>[...old,{key:Math.max(0,...old.map(i=>i.key))+1,sku:'',description:'',qty:'',rate:'',gst:'18'}])}><IconPlus size={14}/>Add SKU</Button></div>
 {!items.length?<p className="workflow-hint">Add new SKUs, or continue to update only the PO.</p>:<div className="sku-grid-scroll"><div className="sku-column-head sku-create-row"><span>SKU *</span><span>Description *</span><span>Quantity *</span><span>Agreed price · ₹ *</span><span>GST %</span><span>Amount · ex GST</span><span/></div>{items.map((item,index)=><div className="sku-create-row" key={item.key}>
 <Input aria-label={`Additional SKU ${index+1}`} required maxLength={100} value={item.sku} onChange={e=>edit(index,'sku',e.target.value)}/><Input aria-label={`Additional description ${index+1}`} required maxLength={1000} value={item.description} onChange={e=>edit(index,'description',e.target.value)}/><Input aria-label={`Additional quantity ${index+1}`} required type="number" min={1} max={1000000} step="1" value={item.qty} onChange={e=>edit(index,'qty',e.target.value)}/><Input aria-label={`Additional selling price ${index+1}`} required type="number" min="0.01" step="0.01" value={item.rate} onChange={e=>edit(index,'rate',e.target.value)}/><select aria-label={`Additional GST ${index+1}`} value={item.gst} onChange={e=>edit(index,'gst',e.target.value)}>{['0','5','12','18','28'].map(g=><option key={g}>{g}</option>)}</select><strong>{money(num(item.qty)*Math.round(num(item.rate)*100))}</strong><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove additional SKU ${index+1}`} onClick={()=>setItems(old=>old.filter((_,i)=>i!==index))}><IconTrash size={14}/></Button>
 </div>)}</div>}</section>
 <div className="sku-totals"><span>Existing total · incl GST<strong>{money(order.total_paise)}</strong></span><span>Additional value · incl GST<strong>{money(added)}</strong></span><span>Revised total · incl GST<strong>{money(num(order.total_paise)+added)}</strong></span></div>
 {error&&<div className="error-box" role="alert">{error}</div>}<div className="form-footer"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy?'Saving…':'Save revision & update PO'}</Button></div>
 </form></DialogContent></Dialog>;
}
