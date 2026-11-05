'use client';
import {CommunicationChoices} from '@/components/communication-choices';
import {communicationMethods,fileAccept,uploadDocument} from '@/lib/documents';
import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {IconPlus,IconTrash} from '@tabler/icons-react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {skuUnits,vendorStatuses,api,day,money,names,num,orderCode,singular,today,type Register,type Row,type Workspace} from '@/lib/data';

type Field={key:string;label:string;type?:string;options?:{value:string;label:string}[];optional?:boolean;wide?:boolean};
type SkuInput={key:number;id?:string;sku:string;description:string;unit_of_measure:string;qty:string;rate_rupees:string;gst_percent:string};
type Allocation={order_item_id:string;qty:string;rate_rupees:string;gst_percent:string;delivered_qty:string;returned_qty:string};
const options=(values:string[])=>values.map(value=>({value,label:value}));
const newSku=(key:number):SkuInput=>({key,sku:'',description:'',unit_of_measure:'Nos',qty:'',rate_rupees:'',gst_percent:'18'});
function addDays(value:string,days:number){const date=new Date(value+'T12:00:00');date.setDate(date.getDate()+days);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export type FormRequest={entity:Register;record?:Row;orderId?:string;invoiceId?:string};

export function RecordForm({request,w,onClose,onSaved,onCreated}:{request:FormRequest;w:Workspace;onClose:()=>void;onSaved:(s:string)=>void;onCreated?:(id:string)=>void}) {
 const {entity,record,orderId,invoiceId}=request,editing=!!record;
 const active=w.orders.filter(o=>entity==='sourcing'?o.stage==='Ready for sourcing':['Ready for sourcing','Confirmed'].includes(String(o.stage)));
 const orderOptions=active.map(o=>({value:String(o.id),label:`${orderCode(o)} · ${o.customer_name} · ${o.description}`}));
 const customers=w.customers.map(c=>({value:String(c.id),label:String(c.name)}));
 const invoices=w.invoices.filter(i=>num(i.outstanding_paise)>0).map(i=>({value:String(i.id),label:`${i.number} · ${money(i.outstanding_paise)} outstanding`}));
 const assignees=useQuery({
  queryKey:['task-assignees'],enabled:entity==='tasks'&&!editing,
  queryFn:()=>api<{id:string;name:string;email:string}[]>('/task-assignees')
 });
 const initialOrder=w.orders.find(o=>o.id===(record?.order_id||orderId));
 const initialCustomer=w.customers.find(c=>c.id===initialOrder?.customer_id);
 const initial=():Record<string,string>=>({
  request_channel:'',request_notes:'',sales_path:'agreed',stage:'Draft',status:entity==='sourcing'?'Requested':'Open',priority:'Normal',mode:'NEFT',
  invoice_date:today(),receipt_date:today(),dispatch_date:today(),due_date:addDays(today(),num(initialCustomer?.terms)),
  terms:'0',enquiry_received_date:today(),target_date:today(),expected_date:initialOrder?day(initialOrder.target_date):today(),order_id:orderId||'',
  invoice_id:invoiceId||'',...Object.fromEntries(Object.entries(record||{}).map(([k,v])=>[k,k.endsWith('_date')||k==='eta'?day(v):String(v??'')]))
 });
 const allocationFor=(id:unknown):Allocation[]=>{
  const lines=editing&&entity==='dispatches'?w.dispatch_items.filter(i=>i.dispatch_id===record?.id):w.order_items.filter(i=>i.order_id===id);
  return lines.map(i=>({
   order_item_id:String(editing&&entity==='dispatches'?i.order_item_id:i.id),
   qty:String(Math.max(0,num(i.qty)-num(entity==='invoices'?i.invoiced:i.dispatched))),
   rate_rupees:String(num(i.rate_paise)/100),gst_percent:String(num(i.gst_bps)/100),
   delivered_qty:String(num(i.delivered_qty)),returned_qty:String(num(i.returned_qty))
  }));
 };
 const [values,setValues]=useState(initial);
 const [skuLines,setSkuLines]=useState<SkuInput[]>(()=>editing&&entity==='orders'?w.order_items.filter(i=>i.order_id===record?.id).map((i,index)=>({key:index+1,id:String(i.id),sku:String(i.sku),description:String(i.description),unit_of_measure:String(i.unit_of_measure??'Nos'),qty:String(i.qty),rate_rupees:i.rate_paise==null?'':String(num(i.rate_paise)/100),gst_percent:String(num(i.gst_bps)/100)})):[newSku(1)]);
 const [allocations,setAllocations]=useState<Allocation[]>(()=>allocationFor(initialOrder?.id));
 const [requestFile,setRequestFile]=useState<File|null>(null);
 const [dirty,setDirty]=useState(false);const qc=useQueryClient();
 const order=w.orders.find(o=>o.id===values.order_id);
 const orderItems=w.order_items.filter(i=>i.order_id===values.order_id);
 const shipmentItems=w.dispatch_items.filter(i=>i.dispatch_id===record?.id);
 const pricingPath=values.sales_path==='needs-pricing';
 const canEditPrices=entity==='orders'&&editing&&!record?.ever_confirmed&&['Draft','Enquiry','Pricing'].includes(String(record?.stage));
 const legacy=editing&&record?.request_channel==='Not recorded';
 const stageOptions=Number(record?.order_revision)>1?['Awaiting revised PO','PO received','Ready for sourcing','On hold','Cancelled']:legacy?(pricingPath?['Enquiry','Pricing','Quoted','Confirmed','On hold','Cancelled']:['Draft','Confirmed','On hold','Cancelled']):(pricingPath?['Enquiry','Pricing','Quoted','PO received','Ready for sourcing','On hold','Cancelled']:['Draft','PO received','Ready for sourcing','On hold','Cancelled']);
 const acceptance=['PO received','Ready for sourcing','Confirmed'].includes(values.stage);
 const fields:Record<Register,Field[]>={
  customers:[{key:'name',label:'Legal customer name',wide:true},{key:'contact_name',label:'Contact name'},{key:'phone',label:'Contact phone',type:'tel'},{key:'email',label:'Contact email',type:'email',optional:true},{key:'gstin',label:'GSTIN',optional:true},{key:'billing_address',label:'Billing address',type:'textarea',wide:true,optional:true},{key:'shipping_address',label:'Default shipping address',type:'textarea',wide:true,optional:true},{key:'city',label:'City',optional:true},{key:'state',label:'State',optional:true},{key:'pin_code',label:'PIN code',optional:true},{key:'terms',label:'Credit terms (days)',type:'number',optional:true},{key:'customer_notes',label:'Customer instructions / notes',type:'textarea',wide:true,optional:true}],
  orders:editing?[
   {key:'stage',label:'Current step',type:'select',options:options(stageOptions)},{key:'po_ref',label:'Customer PO / confirmation reference',optional:!acceptance},{key:'owner',label:'Sales owner'},{key:'enquiry_received_date',label:'Enquiry received',type:'date',optional:editing},{key:'target_date',label:'Target delivery',type:'date'},{key:'ship_to',label:'Ship-to address',type:'textarea',wide:true,optional:!acceptance}
  ]:[
   {key:'customer_id',label:'Customer',type:'select',options:customers,wide:true},{key:'request_channel',label:'How did the customer contact us?',type:'select',options:options(communicationMethods),wide:true},{key:'request_notes',label:'What did the customer ask for?',type:'textarea',optional:true,wide:true},{key:'description',label:'Product / order title',wide:true},
   {key:'owner',label:'Sales owner'},
   {key:'enquiry_received_date',label:'Enquiry received',type:'date',optional:editing},{key:'target_date',label:'Target delivery',type:'date'},
   {key:'ship_to',label:'Ship-to address',type:'textarea',wide:true,optional:!acceptance}
  ],
  sourcing:[...(!editing?[
   {key:'order_id',label:'Sales order',type:'select',options:orderOptions,wide:true},
   {key:'order_item_id',label:'Order SKU',type:'select',options:orderItems.map(i=>({value:String(i.id),label:`${i.sku||'Legacy SKU'} · ${i.description}`})),wide:true},
   {key:'external_ref',label:'Sourcing reference',optional:true,wide:true}
  ]:[]),{key:'status',label:'Vendor response',type:'select',options:vendorStatuses},{key:'supplier',label:'Vendor name',optional:true},{key:'vendor_gstin',label:'Vendor GSTIN',optional:true},{key:'vendor_phone',label:'Vendor phone',type:'tel',optional:true},{key:'vendor_email',label:'Vendor email',type:'email',optional:true},{key:'eta',label:'Expected supply date',type:'date',optional:true},{key:'notes',label:'Sourcing notes',type:'textarea',wide:true,optional:true}],
  dispatches:editing?[
   {key:'status',label:'Shipment status',type:'select',options:options(['In transit','Partially delivered','Delivered','Returned'])},{key:'actual_date',label:'Actual delivery date',type:'date',optional:true},{key:'pod',label:'Proof of delivery reference / secure URL',wide:true,optional:true}
  ]:[
   {key:'order_id',label:'Confirmed sales order',type:'select',options:orderOptions,wide:true},{key:'carrier',label:'Courier / transporter'},{key:'tracking',label:'AWB / LR / tracking reference'},{key:'dispatch_date',label:'Dispatch date',type:'date'},{key:'expected_date',label:'Expected delivery',type:'date'}
  ],
  invoices:[{key:'order_id',label:'Confirmed sales order',type:'select',options:orderOptions,wide:true},{key:'number',label:'Invoice number'},{key:'invoice_date',label:'Invoice date',type:'date'},{key:'due_date',label:'Payment due date',type:'date'}],
  receipts:[{key:'invoice_id',label:'Outstanding invoice',type:'select',options:invoices,wide:true},{key:'amount_rupees',label:'Amount received (₹)',type:'number'},{key:'receipt_date',label:'Receipt date',type:'date'},{key:'reference',label:'Verified UTR / bank reference',wide:true},{key:'mode',label:'Payment mode',type:'select',options:options(['NEFT','RTGS','IMPS','UPI','Cheque','Cash','Other'])}],
  tasks:editing?[{key:'status',label:'Task status',type:'select',options:options(['Open','In progress','Blocked','Completed'])}]:[{key:'title',label:'Required action',type:'textarea',wide:true},...(orderId?[]:[{key:'order_id',label:'Linked order',type:'select',options:w.orders.map(o=>({value:String(o.id),label:orderCode(o)+' · '+o.description})),wide:true,optional:true}]),{key:'assignee_id',label:'Assigned to',type:'select',options:(assignees.data??[]).map(user=>({value:user.id,label:user.name+' · '+user.email}))},{key:'due_date',label:'Due date',type:'date'},{key:'priority',label:'Priority',type:'select',options:options(['Normal','High','Critical'])}]
 };
 function change(key:string,value:string){
  setDirty(true);
  if(key==='order_id')setAllocations(allocationFor(value));
  setValues(old=>{
   const next={...old,[key]:value};
   if(key==='sales_path')next.stage=value==='needs-pricing'?'Enquiry':'Draft';
   if(key==='stage'&&value==='PO received'&&!next.po_received_date)next.po_received_date=today();
   if(key==='customer_id'){
    const customer=w.customers.find(c=>c.id===value);
    const previous=w.customers.find(c=>c.id===old.customer_id);
    if(!old.ship_to||old.ship_to===String(previous?.shipping_address??previous?.address??'')){
     next.ship_to=String(customer?.shipping_address??customer?.address??'');
    }
   }
   if(key==='order_id'){
    const o=w.orders.find(o=>o.id===value),items=w.order_items.filter(i=>i.order_id===value);
    next.order_item_id=items.length===1?String(items[0].id):'';
    if(o&&entity==='invoices'){const c=w.customers.find(c=>c.id===o.customer_id);next.due_date=addDays(next.invoice_date||today(),num(c?.terms));}
    if(o&&entity==='dispatches')next.expected_date=day(o.target_date);
   }
   return next;
  });
 }
 function changeSku(index:number,key:keyof SkuInput,value:string){setDirty(true);setSkuLines(lines=>lines.map((line,i)=>i===index?{...line,[key]:value}:line));}
 function changeAllocation(id:string,key:keyof Allocation,value:string){setDirty(true);setAllocations(lines=>lines.map(line=>line.order_item_id===id?{...line,[key]:value}:line));}
 if(entity==='orders'&&!editing)fields.orders.push({key:'sales_path',label:'Pricing status',type:'select',options:[{value:'agreed',label:'Price agreed'},{value:'needs-pricing',label:'Quote needed'}],wide:true});
 if(entity==='orders'&&editing){fields.orders.push({key:'request_channel',label:'How did the customer contact us?',type:'select',options:options(['Not recorded',...communicationMethods]),wide:true},{key:'request_notes',label:'Communication notes',type:'textarea',wide:true,optional:true});if(acceptance)fields.orders.push({key:'po_channel',label:'How did we receive the PO?',type:'select',options:options(['WhatsApp','Email','In person','Other'])},{key:'po_received_date',label:'PO received on',type:'date'});}
 if(entity==='orders')fields.orders.push({key:'agreement_status',label:'Agreement status',type:'select',options:options(['Not required','Required - pending','Under review','Signed']),optional:true},{key:'confirmed_by',label:'Confirmed by (customer representative)',optional:true});
 if(entity==='orders'&&pricingPath)fields.orders.push({key:'pricing_source_ref',label:'Pricing / sourcing reference',optional:true,wide:true},{key:'quote_ref',label:'Customer quotation reference',optional:values.stage!=='Quoted',wide:true});
 const mutation=useMutation({mutationFn:async()=>{
  if(requestFile&&requestFile.size>5*1024*1024)throw Error('Choose a document up to 5 MB.');
  const body:Record<string,unknown>={...values};
  if(entity==='customers')body.terms=Number(values.terms||0);
  if(!body.enquiry_received_date)delete body.enquiry_received_date;
  for(const key of ['version'])if(values[key]!==undefined)body[key]=Number(values[key]);
  if(values.amount_rupees!==undefined)body.amount_paise=Math.round(Number(values.amount_rupees)*100);
  if(entity==='orders'&&(!editing||canEditPrices))body.items=skuLines.map(line=>({...editing?{id:line.id}:{},sku:line.sku,description:line.description,unit_of_measure:line.unit_of_measure,qty:Number(line.qty),rate_paise:line.rate_rupees.trim()===''?null:Math.round(Number(line.rate_rupees)*100),gst_bps:Math.round(Number(line.gst_percent)*100)}));
  if((entity==='dispatches'||entity==='invoices')&&!editing)body.items=allocations.filter(line=>Number(line.qty)>0).map(line=>({
   order_item_id:line.order_item_id,qty:Number(line.qty),
   ...(entity==='invoices'?{rate_paise:Math.round(Number(line.rate_rupees)*100),gst_bps:Math.round(Number(line.gst_percent)*100)}:{})
  }));
  if(entity==='dispatches'&&editing)body.items=allocations.map(line=>({order_item_id:line.order_item_id,delivered_qty:Number(line.delivered_qty),returned_qty:Number(line.returned_qty)}));
  const saved=await api<{id:string;uploadError?:string;emailStatus?:string}>(`/${entity}${editing?'/'+record.id:''}`,{method:editing?'PATCH':'POST',body:JSON.stringify(body)});
  if(entity==='orders'&&!editing&&requestFile){try{await uploadDocument(saved.id,requestFile,'request',values.request_channel);}catch(error){saved.uploadError=(error as Error).message;}}
  return saved;
 },onSuccess:async(saved)=>{await qc.invalidateQueries({queryKey:['workspace']});onSaved(saved.emailStatus?(saved.emailStatus==='sent'?'Follow-up created and email sent.':saved.emailStatus==='unavailable'?'Follow-up created. Email delivery is not configured.':'Follow-up created. Email delivery failed.'):saved.uploadError?`Request saved, but attachment failed: ${saved.uploadError} Open the request to upload again.`:`${editing?'Updated':'Created'} ${singular[entity]}`);if(entity==='orders'&&!editing)onCreated?.(saved.id);onClose();}});
 const close=()=>{if(mutation.isPending)return;if(!dirty||window.confirm('Discard unsaved changes?'))onClose();};
 const showOrderLines=entity==='orders'&&(!editing||canEditPrices);
 const fullyPriced=!showOrderLines||skuLines.every(l=>l.rate_rupees.trim()!=='');
 const showAllocation=(entity==='dispatches'||entity==='invoices')&&!editing;
 const showDelivery=entity==='dispatches'&&editing;
 const priced=showOrderLines?skuLines:entity==='invoices'?allocations:[];
 const subTotal=priced.reduce((sum,l)=>sum+Math.round(num(l.rate_rupees)*100)*num(l.qty),0);
 const grossTotal=priced.reduce((sum,l)=>{const base=Math.round(num(l.rate_rupees)*100)*num(l.qty);return sum+base+Math.round(base*num(l.gst_percent)/100);},0);
 const vendorGstin = values.vendor_gstin || '';
 const invalidVendorGstin = entity === 'sourcing' && !!vendorGstin &&
  !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(vendorGstin);
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className={`max-h-[90dvh] overflow-y-auto ${showOrderLines||showAllocation||showDelivery?'sm:max-w-[960px]':'sm:max-w-[640px]'}`} onInteractOutside={e=>e.preventDefault()}><DialogHeader><DialogTitle>{entity==='orders'?(editing?'Update customer request':'New customer request'):`${editing?'Update':'Create'} ${singular[entity]}`}</DialogTitle><DialogDescription className="sr-only">{names[entity]}</DialogDescription></DialogHeader>
 {entity==='tasks'&&!editing&&assignees.isError&&<div className='error-box' role='alert'>Could not load team members. <Button type='button' variant='outline' onClick={()=>void assignees.refetch()}>Try again</Button></div>}
 <form onSubmit={e=>{e.preventDefault();if(!invalidVendorGstin)mutation.mutate();}} className="record-form">
 {order&&<div className="form-note">{orderCode(order)} · {order.customer_name}</div>}
 {entity==='orders'&&editing&&record?.stage==='Quoted'&&<div className="form-note">To revise prices: change the step to Pricing and save.</div>}
 <div className="field-grid">{fields[entity].map(f=>['request_channel','po_channel'].includes(f.key)?<CommunicationChoices key={f.key} className={f.wide?'wide':''} label={f.label} value={values[f.key]||''} onChange={value=>change(f.key,value)} options={(f.options||[]).map(option=>option.value)} required={!f.optional}/>:<label className={f.wide?'wide':''} key={f.key}><span>{f.label}{!f.optional&&<b> *</b>}</span>{f.type==='select'?<select required={!f.optional} value={values[f.key]||''} onChange={e=>change(f.key,e.target.value)}><option value="">Select…</option>{f.options?.map(op=><option key={op.value} value={op.value}>{op.label}</option>)}</select>:f.type==='textarea'?<Textarea required={!f.optional} maxLength={1000} value={values[f.key]||''} onChange={e=>change(f.key,e.target.value)}/>:<Input required={!f.optional} type={f.type||'text'} pattern={f.key==='contact_name'||f.key==='phone'?String.raw`.*S.*`:undefined} min={f.type==='number'?0:undefined} max={f.key==='terms'?365:undefined} step={f.key.endsWith('_rupees')?'0.01':'1'} maxLength={f.key==='gstin'||f.key==='vendor_gstin'?15:f.key==='phone'?40:f.key==='contact_name'?160:undefined} value={values[f.key]||''} aria-invalid={f.key==='vendor_gstin'&&invalidVendorGstin||undefined} aria-describedby={f.key==='vendor_gstin'?'vendor-gstin-hint':undefined} onChange={e=>change(f.key,f.key==='vendor_gstin'?e.target.value.trim().toUpperCase():e.target.value)}/>} {f.key==='vendor_gstin'&&<small id='vendor-gstin-hint' className={invalidVendorGstin?'text-destructive':'text-muted-foreground'}>{invalidVendorGstin?'Enter a valid 15-character GSTIN, e.g. 29ABCDE1234F1Z5.':'Optional · 15 characters'}</small>}</label>)}
  {entity==='orders'&&!editing&&<label className="wide">
   <span>{values.sales_path==='agreed'?'Agreed price proof':'Request attachment'} (optional)</span>
   <Input type="file" className="file:mr-3" accept={fileAccept} onChange={e=>{setRequestFile(e.target.files?.[0]||null);setDirty(true);}}/>
   <small className="text-muted-foreground">Image or PDF · Up to 5 MB</small>
  </label>}
 </div>
 {showOrderLines&&<section className="sku-editor" aria-label="Order items"><div className="sku-heading"><div><h3>Order items</h3></div><Button type="button" variant="outline" size="sm" disabled={editing||skuLines.length>=100} onClick={()=>{setDirty(true);setSkuLines(lines=>[...lines,newSku(Math.max(...lines.map(l=>l.key))+1)]);}}><IconPlus size={14}/>Add SKU</Button></div>
 <div className="sku-grid-scroll"><div className="sku-column-head sku-create-row"><span>SKU *</span><span>Description / variant *</span><span>Unit of measure *</span><span>Quantity *</span><span>Selling price · ₹ / unit</span><span>GST %</span><span>Amount · ex GST</span><span/></div>
 {skuLines.map((line,index)=><div className="sku-create-row" key={line.key}>
 <label className="sku-entry-field"><span className="mobile-cell-label">SKU</span><Input aria-label={`SKU ${index+1}`} disabled={editing} required maxLength={100} placeholder="KTL-BLACK" value={line.sku} onChange={e=>changeSku(index,'sku',e.target.value)}/></label>
 <label className="sku-entry-field"><span className="mobile-cell-label">Description</span><Input aria-label={`Description ${index+1}`} disabled={editing} required maxLength={1000} placeholder="Product / variant" value={line.description} onChange={e=>changeSku(index,'description',e.target.value)}/></label>
 <label className="sku-entry-field"><span className="mobile-cell-label">Unit of measure</span><select aria-label={`Unit of measure for SKU ${index+1}`} required disabled={editing} value={line.unit_of_measure} onChange={e=>changeSku(index,'unit_of_measure',e.target.value)}>{skuUnits.map(unit=><option key={unit}>{unit}</option>)}</select></label>
 <label className="sku-entry-field"><span className="mobile-cell-label">Quantity</span><Input aria-label={`Quantity ${index+1}`} disabled={editing} required type="number" min={1} max={1000000} step="1" value={line.qty} onChange={e=>changeSku(index,'qty',e.target.value)}/></label>
 <label className="sku-entry-field"><span className="mobile-cell-label">Unit price (₹)</span><Input aria-label={`Unit rate ${index+1}`} placeholder="Not priced" required={['Quoted','PO received','Ready for sourcing','Confirmed'].includes(values.stage)} type="number" min=".01" step=".01" value={line.rate_rupees} onChange={e=>changeSku(index,'rate_rupees',e.target.value)}/></label>
 <label className="sku-entry-field"><span className="mobile-cell-label">GST %</span><select aria-label={`GST ${index+1}`} value={line.gst_percent} onChange={e=>changeSku(index,'gst_percent',e.target.value)}>{['0','5','12','18','28'].map(g=><option key={g}>{g}</option>)}</select></label>
 <strong>{line.rate_rupees.trim()===''?'Not priced':money(num(line.qty)*Math.round(num(line.rate_rupees)*100))}</strong>
 <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove SKU ${index+1}`} disabled={editing||skuLines.length===1} onClick={()=>{setDirty(true);setSkuLines(lines=>lines.filter(l=>l.key!==line.key));}}><IconTrash size={14}/></Button>
 </div>)}</div></section>}
 {showAllocation&&<section className="sku-editor" aria-label="Select order SKUs"><div className="sku-heading"><div><h3>{entity==='invoices'?'Invoice items':'Dispatch items'}</h3></div></div>
 {!order?<div className="form-note">Select an order.</div>:<div className="allocation-list">{orderItems.map(item=>{
  const id=String(item.id),line=allocations.find(l=>l.order_item_id===id),remaining=Math.max(0,num(item.qty)-num(entity==='invoices'?item.invoiced:item.dispatched));
  if(!line)return null;
  return <div className="allocation-row" key={id}><label className="sku-choice"><input type="checkbox" aria-label={`Include ${item.sku||'legacy SKU'}`} checked={num(line.qty)>0} disabled={!remaining} onChange={e=>changeAllocation(id,'qty',e.target.checked?String(remaining):'0')}/><span><strong className="mono">{item.sku||'Legacy SKU'}</strong><small>{item.description}</small></span></label><span className="sku-remaining">{remaining} remaining</span><label className="compact-field">Quantity<Input aria-label={`Quantity for ${item.sku||'legacy SKU'}`} type="number" required min={0} max={remaining} step="1" value={line.qty} onChange={e=>changeAllocation(id,'qty',e.target.value)}/></label>
  {entity==='invoices'&&<><label className="compact-field">Unit rate · ₹<Input aria-label={`Rate for ${item.sku||'legacy SKU'}`} type="number" min=".01" step=".01" required={num(line.qty)>0} disabled={num(line.qty)===0} value={line.rate_rupees} onChange={e=>changeAllocation(id,'rate_rupees',e.target.value)}/></label><label className="compact-field">GST %<select aria-label={`GST for ${item.sku||'legacy SKU'}`} value={line.gst_percent} disabled={num(line.qty)===0} onChange={e=>changeAllocation(id,'gst_percent',e.target.value)}>{['0','5','12','18','28'].map(g=><option key={g}>{g}</option>)}</select></label></>}
  </div>;
 })}</div>}</section>}
 {showDelivery&&<section className="sku-editor" aria-label="Delivery quantities"><div className="sku-heading"><div><h3>Delivery by SKU</h3></div><Button type="button" variant="outline" size="sm" onClick={()=>{setDirty(true);setValues(v=>({...v,status:'Delivered',actual_date:today()}));setAllocations(lines=>lines.map(l=>({...l,delivered_qty:String(shipmentItems.find(i=>i.order_item_id===l.order_item_id)?.qty||0),returned_qty:'0'})));}}>Mark all delivered</Button></div><div className="allocation-list">{shipmentItems.map(item=>{
  const id=String(item.order_item_id),line=allocations.find(l=>l.order_item_id===id);if(!line)return null;
  return <div className="allocation-row delivery-row" key={id}><div className="sku-choice"><span><strong className="mono">{item.sku||'Legacy SKU'}</strong><small>{item.description}</small></span></div><span className="sku-remaining">{item.qty} dispatched</span><label className="compact-field">Delivered<Input aria-label={`Delivered for ${item.sku||'legacy SKU'}`} required type="number" min={0} max={num(item.qty)} step="1" value={line.delivered_qty} onChange={e=>changeAllocation(id,'delivered_qty',e.target.value)}/></label><label className="compact-field">Returned<Input aria-label={`Returned for ${item.sku||'legacy SKU'}`} required type="number" min={0} max={num(item.qty)} step="1" value={line.returned_qty} onChange={e=>changeAllocation(id,'returned_qty',e.target.value)}/></label></div>;
 })}</div></section>}
 {(showOrderLines||entity==='invoices')&&<div className="sku-totals"><span>Subtotal · ex GST<strong>{fullyPriced?money(subTotal):'Not fully priced'}</strong></span><span>GST<strong>{fullyPriced?money(grossTotal-subTotal):'—'}</strong></span><span>Total · incl GST<strong>{fullyPriced?money(grossTotal):'Not fully priced'}</strong></span></div>}
 {mutation.error&&<div className="error-box" role="alert">{mutation.error.message}</div>}
 <div className="form-footer"><Button type="button" variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={mutation.isPending||invalidVendorGstin}>{mutation.isPending?'Saving…':editing?'Save changes':entity==='orders'?'Save request':'Create '+singular[entity]}</Button></div>
 </form></DialogContent></Dialog>;
}

