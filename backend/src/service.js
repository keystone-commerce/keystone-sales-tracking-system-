import {CHANNELS,validateEvidenceStage} from './documents.js';
import {randomUUID} from 'node:crypto';
import {one} from './db.js';
import {requireValue,text,integer,choice,date,uuid,money,total,capacity,outstanding} from './domain.js';
import {can} from './access/permissions.js';

const stages=['Draft','Enquiry','Pricing','Quoted','PO received','Ready for sourcing','Confirmed','Awaiting revised PO','On hold','Cancelled'];
const dbDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const safeSum=values=>{const result=values.reduce((sum,n)=>sum+BigInt(n),0n);requireValue(result<=BigInt(Number.MAX_SAFE_INTEGER),'Combined order amount is too large');return Number(result);};

export async function audit(tx,actor,action,entity,id,detail={}) {
 await tx.query('INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,$2,$3,$4,$5)',[actor.id,action,entity,id,JSON.stringify(detail)]);
}
function vendorDetails(values, existing = {}) {
 const gstin = text(values.vendor_gstin ?? existing.vendor_gstin ?? '', 'Vendor GSTIN', 15, true).toUpperCase();
 requireValue(!gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin), 'Vendor GSTIN format is invalid');
 const phone = text(values.vendor_phone ?? existing.vendor_phone ?? '', 'Vendor phone', 40, true);
 const email = text(values.vendor_email ?? existing.vendor_email ?? '', 'Vendor email', 254, true);
 requireValue(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Vendor email format is invalid');
 return [gstin, phone, email];
}

function orderAgreement(values, existing = {}) {
 const status = values.agreement_status ?? existing.agreement_status ?? '';
 const confirmedBy = text(values.confirmed_by ?? existing.confirmed_by ?? '', 'Customer representative', 160, true);
 return [status === '' ? '' : choice(status, ['Not required','Required - pending','Under review','Signed'], 'agreement status'), confirmedBy];
}

const historyFields=['description','stage','po_ref','owner','agreement_status','confirmed_by','enquiry_received_date','target_date','ship_to','sales_path','quote_ref','pricing_source_ref','quote_version','request_channel','request_notes','po_channel','po_received_date','order_revision','amendment_notes'];
const historyItemFields=['sku','description','qty','rate_paise','gst_bps'];
const pick=(row,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
async function orderSnapshot(tx,id){
 const row=await one(tx,'SELECT * FROM orders WHERE id=$1',[id]);
 const items=(await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY position',[id])).rows;
 return {...pick(row,historyFields),items:items.map(i=>pick(i,historyItemFields))};
}
export async function orderHistory(db,id){
 uuid(id,'Order');
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await one(tx,'SELECT id FROM orders WHERE id=$1',[id]);
  const events=(await tx.query("SELECT a.id,a.action,a.created_at,a.detail,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id WHERE a.entity='orders' AND a.record_id=$1 ORDER BY a.id DESC",[id])).rows.map(event=>{
   const detail=event.detail||{};
   const clean=snapshot=>snapshot?{...pick(snapshot,historyFields),...(Array.isArray(snapshot.items)?{items:snapshot.items.map(i=>pick(i,historyItemFields))}:{})}:null;
   return {...event,detail:{before:clean(detail.before),after:clean(detail.after),legacy:detail.after?null:pick(detail,historyFields),document:detail.document?pick(detail.document,['id','category','channel','filename','quote_revision','order_revision']):null}};
  });
  const quotes=(await tx.query('SELECT q.revision,q.reference,q.items,q.created_at,u.name AS actor_name FROM order_quotes q JOIN users u ON u.id=q.created_by WHERE q.order_id=$1 ORDER BY q.revision DESC',[id])).rows.map(q=>({...q,items:q.items.map(i=>pick(i,historyItemFields))}));
  return {events,quotes};
 });
}
async function lockOrder(tx,id) { return one(tx,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[uuid(id,'Order')]); }
function executable(order) { requireValue(['Confirmed','Ready for sourcing'].includes(order.stage)&&order.accepted_revision===order.order_revision,'Accept the current PO and mark the order ready for sourcing before dispatching or invoicing',409); }
function itemArray(value) {
 requireValue(Array.isArray(value)&&value.length>0&&value.length<=100,'Add between 1 and 100 SKU lines');
 requireValue(value.every(v=>v&&typeof v==='object'&&!Array.isArray(v)),'Each SKU line must be an object');
 return value;
}
function newOrderItems(v) {
 const legacy=v.items===undefined;
 const lines=itemArray(legacy?[v]:v.items);
 const skus=new Set();
 return lines.map((line,index)=>{
  const sku=text(line.sku||'',`SKU on line ${index+1}`,100,legacy);
  if(sku){const key=sku.toLowerCase();requireValue(!skus.has(key),'Each SKU can appear only once in an order');skus.add(key);}
  const qty=integer(line.qty,'SKU quantity'),rate=line.rate_paise==null?null:money(line.rate_paise,'SKU selling rate'),gst=integer(line.gst_bps,'SKU GST',0,10000);
  return {id:randomUUID(),sku,description:text(line.description,`Description on line ${index+1}`,1000),qty,unit_of_measure:choice(line.unit_of_measure??'Nos', ['Nos','Pcs','Pairs','Sets','Boxes','Kits','Kg','Meters','Litres','Other'], 'unit of measure'),rate_paise:rate,gst_bps:gst,total_paise:rate===null?null:total(qty,rate,gst)};
 });
}
function validateSales(path,stage,lines,quoteRef,previous) {
 requireValue(path==='needs-pricing'||!['Enquiry','Pricing','Quoted'].includes(stage),'Choose the pricing-needed path for enquiry and quotation stages');
 if(['Quoted','PO received','Ready for sourcing','Confirmed'].includes(stage))requireValue(lines.every(i=>i.rate_paise!==null),'Add a selling price for every SKU before quoting or confirming');
 if(stage==='Quoted')requireValue(quoteRef,'Add a customer quotation reference before marking as quoted');
 if(path==='needs-pricing'&&['PO received','Ready for sourcing','Confirmed'].includes(stage))requireValue(['Quoted','PO received','Ready for sourcing'].includes(previous?.stage)||previous?.ever_confirmed,'Record the customer quotation before confirming this enquiry');
}
async function saveQuote(tx,id,reference,lines,actor) {
 const row=await one(tx,'UPDATE orders SET quote_version=quote_version+1 WHERE id=$1 RETURNING quote_version',[id]);
 await tx.query('INSERT INTO order_quotes(id,order_id,revision,reference,items,created_by) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),id,row.quote_version,reference,JSON.stringify(lines),actor.id]);
}
async function allocatedItems(tx,order,v) {
 const available=(await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY position',[order.id])).rows;
 let requested=v.items;
 if(requested===undefined){
  requireValue(available.length===1,'Select SKU lines for this multi-SKU order');
  requested=[{...v,order_item_id:available[0].id}];
 }
 const seen=new Set();
 return itemArray(requested).map(line=>{
  const item=available.find(i=>i.id===uuid(line.order_item_id,'Order SKU'));
  requireValue(item,'Selected SKU does not belong to this sales order');
  requireValue(!seen.has(item.id),'Select each order SKU only once');seen.add(item.id);
  return {item,input:line,qty:integer(line.qty,'SKU quantity')};
 });
}

export async function createRecord(db,entity,v,actor,{manualSourcing=false}={}) {
 const id=randomUUID();
 return db.transaction(async tx=>{
  let result={id};
  if(entity==='customers') {
   const gstin=text(v.gstin||'','GSTIN',15,true).toUpperCase();
   requireValue(!gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin),'GSTIN format is invalid');
   const billing=text(v.billing_address??v.address??'','Billing address',1000,true);
   const shipping=text(v.shipping_address??v.address??'','Shipping address',1000,true);
   await tx.query('INSERT INTO customers(id,name,email,gstin,address,terms,contact_name,phone,billing_address,shipping_address,city,state,pin_code,customer_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[
    id,text(v.name,'Customer name',160),text(v.email||'','Email',254,true),gstin,v.address===undefined?billing:text(v.address,'Address',1000,true),integer(v.terms??30,'Credit days',0,365),
    text(v.contact_name??'','Contact name',160,true),text(v.phone??'','Contact phone',40,true),billing,shipping,
    text(v.city??'','City',120,true),text(v.state??'','State',120,true),text(v.pin_code??'','PIN code',20,true),text(v.customer_notes??'','Customer notes',1000,true)
   ]);
  } else if(entity==='orders') {
   await one(tx,'SELECT id FROM customers WHERE id=$1',[uuid(v.customer_id,'Customer')]);
   const lines=newOrderItems(v);safeSum(lines.map(i=>i.total_paise||0));
   const stage=choice(v.stage,stages,'order stage');
   requireValue(stage!=='Awaiting revised PO','Create a request before starting a PO revision');
   const path=choice(v.sales_path||'agreed',['agreed','needs-pricing'],'sales path'),quoteRef=text(v.quote_ref||'','Quotation reference',200,true),pricingRef=text(v.pricing_source_ref||'','Pricing source reference',500,true);
   validateSales(path,stage,lines,quoteRef);
   const requestChannel=choice(v.request_channel||'Not recorded',['Not recorded',...CHANNELS],'request communication method'),requestNotes=text(v.request_notes||'','Communication notes',1000,true);
   if(requestChannel!=='Not recorded')requireValue(['Draft','Enquiry','Pricing'].includes(stage),'Save the customer request first, then attach evidence and continue through the steps');
   const po=text(v.po_ref||'','Confirmation reference',200,true),ship=text(v.ship_to||'','Ship-to address',1000,true);
   if(['PO received','Ready for sourcing','Confirmed'].includes(stage)){requireValue(po,'Add the Customer PO / confirmation reference before confirming');requireValue(ship,'Add the Ship-to address before confirming');}
   // Original commercial columns remain for compatibility. Line tables are authoritative.
   await tx.query('INSERT INTO orders(id,customer_id,description,sku,qty,rate_paise,gst_bps,stage,po_ref,owner,target_date,ship_to,enquiry_received_date,agreement_status,confirmed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[
    id,v.customer_id,text(v.description||lines[0].description,'Product / order title',1000),lines[0].sku,safeSum(lines.map(i=>i.qty)),lines[0].rate_paise,lines[0].gst_bps,stage,po,text(v.owner,'Owner',160),date(v.target_date,'Target date'),ship,v.enquiry_received_date===undefined?null:date(v.enquiry_received_date,'Enquiry received'),...orderAgreement(v)]);
   for(const [index,line]of lines.entries())await tx.query('INSERT INTO order_items(id,order_id,position,sku,description,qty,rate_paise,gst_bps,unit_of_measure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[line.id,id,index+1,line.sku,line.description,line.qty,line.rate_paise,line.gst_bps,line.unit_of_measure]);
   await tx.query('UPDATE orders SET sales_path=$1,quote_ref=$2,pricing_source_ref=$3,ever_confirmed=$4,request_channel=$6,request_notes=$7,created_by=$8 WHERE id=$5',[path,quoteRef,pricingRef,stage==='Confirmed',id,requestChannel,requestNotes,actor.id]);
   if(stage==='Quoted')await saveQuote(tx,id,quoteRef,lines,actor);
   result={id,item_ids:lines.map(i=>i.id)};
  } else if(entity==='sourcing') {
   const order=await lockOrder(tx,v.order_id);
   if(manualSourcing)requireValue(order.stage==='Ready for sourcing','Mark the order ready for sourcing first',409);
   else if(order.stage!=='Ready for sourcing')executable(order);
   const lines=await allocatedItems(tx,order,{items:v.order_item_id?[{order_item_id:v.order_item_id,qty:1}]:undefined,qty:1});
   const existing=await tx.query('SELECT id FROM sourcing_links WHERE order_item_id=$1',[lines[0].item.id]);
   requireValue(!existing.rows.length,'Sourcing is already recorded for this SKU. Update the existing record.',409);
   await tx.query('INSERT INTO sourcing_links(id,order_id,order_item_id,external_ref,status,supplier,eta,notes,vendor_gstin,vendor_phone,vendor_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,order.id,lines[0].item.id,text(v.external_ref??'','External sourcing reference',200,true),choice(v.status,['Requested','In progress','Ready','Blocked','Rejected'],'sourcing status'),text(v.supplier||'','Vendor name',200,true),v.eta?date(v.eta,'Supply date'):null,text(v.notes||'','Notes',1000,true),...vendorDetails(v)]);
  } else if(entity==='dispatches') {
   const order=await lockOrder(tx,v.order_id);executable(order);
   const lines=await allocatedItems(tx,order,v);
   for(const line of lines){
    const used=await one(tx,'SELECT COALESCE(SUM(qty),0)::int AS qty FROM dispatch_items WHERE order_item_id=$1',[line.item.id]);
    capacity(line.item.qty,used.qty,line.qty,`Dispatch quantity for ${line.item.sku||line.item.description}`);
   }
   const dispatchDate=date(v.dispatch_date,'Dispatch date'),expected=date(v.expected_date,'Expected date');requireValue(expected>=dispatchDate,'Expected delivery cannot precede dispatch');
   await tx.query('INSERT INTO dispatches(id,order_id,qty,carrier,tracking,dispatch_date,expected_date,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,order.id,safeSum(lines.map(i=>i.qty)),text(v.carrier,'Carrier',160),text(v.tracking,'Tracking reference',200),dispatchDate,expected,'In transit']);
   for(const line of lines)await tx.query('INSERT INTO dispatch_items(id,dispatch_id,order_id,order_item_id,qty) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),id,order.id,line.item.id,line.qty]);
  } else if(entity==='invoices') {
   const order=await lockOrder(tx,v.order_id);executable(order);
   const lines=await allocatedItems(tx,order,v);
   for(const line of lines){
    const used=await one(tx,'SELECT COALESCE(SUM(qty),0)::int AS qty FROM invoice_items WHERE order_item_id=$1',[line.item.id]);
    capacity(line.item.qty,used.qty,line.qty,`Invoice quantity for ${line.item.sku||line.item.description}`);
    line.rate=money(line.input.rate_paise??Number(line.item.rate_paise),'Invoiced SKU rate');
    line.gst=integer(line.input.gst_bps??line.item.gst_bps,'SKU GST',0,10000);
    line.total=total(line.qty,line.rate,line.gst);
   }
   const issued=date(v.invoice_date,'Invoice date'),due=date(v.due_date,'Due date');requireValue(due>=issued,'Due date cannot precede invoice date');
   await tx.query('INSERT INTO invoices(id,order_id,number,qty,rate_paise,gst_bps,total_paise,invoice_date,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,order.id,text(v.number,'Invoice number',100),safeSum(lines.map(i=>i.qty)),lines[0].rate,lines[0].gst,safeSum(lines.map(i=>i.total)),issued,due]);
   for(const line of lines)await tx.query('INSERT INTO invoice_items(id,invoice_id,order_id,order_item_id,qty,rate_paise,gst_bps,total_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),id,order.id,line.item.id,line.qty,line.rate,line.gst,line.total]);
  } else if(entity==='receipts') {
   const inv=await one(tx,'SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[uuid(v.invoice_id,'Invoice')]);
   const paid=await one(tx,'SELECT COALESCE(SUM(amount_paise),0)::bigint AS paid FROM receipts WHERE invoice_id=$1',[inv.id]);
   const amount=money(v.amount_paise);outstanding(Number(inv.total_paise),Number(paid.paid),amount);
   const received=date(v.receipt_date,'Receipt date');requireValue(received>=dbDate(inv.invoice_date),'Receipt cannot precede the invoice; advances need a separate workflow');
   await tx.query('INSERT INTO receipts(id,invoice_id,amount_paise,reference,mode,receipt_date,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,inv.id,amount,text(v.reference,'Payment reference',200),choice(v.mode,['NEFT','RTGS','IMPS','UPI','Cheque','Cash','Other'],'payment mode'),received,actor.id]);
  } else if(entity==='tasks') {
   if(v.order_id)await lockOrder(tx,v.order_id);
   const assignee=v.assignee_id?await one(tx,'SELECT id,name,email FROM users WHERE id=$1 AND active=true FOR SHARE',[uuid(v.assignee_id,'Assignee')]):null;
   await tx.query('INSERT INTO tasks(id,order_id,title,owner,due_date,priority,status,assignee_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id,v.order_id||null,text(v.title,'Task',500),assignee?.name??text(v.owner,'Owner',160),date(v.due_date,'Due date'),choice(v.priority,['Normal','High','Critical'],'priority'),'Open',assignee?.id??null]);
   if(assignee)result={id,notification:{email:assignee.email,title:v.title,dueDate:v.due_date,orderId:v.order_id}};
  }
  await audit(tx,actor,'Created',entity,id,entity==='orders'?{after:await orderSnapshot(tx,id)}:result.item_ids?{item_count:result.item_ids.length}:{});
  return result;
 });
}


export async function amendOrder(db,id,v,actor){
 uuid(id,'Order');
 requireValue(v&&typeof v==='object'&&!Array.isArray(v),'Amendment data is required');
 return db.transaction(async tx=>{
  const order=await lockOrder(tx,id);requireValue(order.version===v.version,'This order changed. Refresh before saving.',409);
  requireValue(['PO received','Ready for sourcing','Confirmed','Awaiting revised PO'].includes(order.stage),'Receive the original PO before starting an amendment',409);
  const linked=await one(tx,'SELECT ((SELECT count(*) FROM dispatches WHERE order_id=$1)+(SELECT count(*) FROM invoices WHERE order_id=$1)+(SELECT count(*) FROM sourcing_links WHERE order_id=$1)+(SELECT count(*) FROM purchase_orders WHERE order_id=$1))::int AS count',[id]);
  requireValue(!linked.count,'This order already has sourcing, dispatch or invoice activity. Coordinate the amendment with operations first.',409);
  const before=await orderSnapshot(tx,id);
  const notes=text(v.reason,'Reason for revision',500);
  requireValue(Array.isArray(v.items)&&v.items.length<=100,'Provide the additional SKU lines');
  const existing=(await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY position',[id])).rows;
  requireValue(existing.length+v.items.length<=100,'An order can contain up to 100 SKU lines');
  const lines=v.items.length?newOrderItems({items:v.items}):[];
  const seen=new Set(existing.map(i=>i.sku.toLowerCase()));
  for(const line of lines){requireValue(!seen.has(line.sku.toLowerCase()),'This SKU already exists. Add only new SKU codes');seen.add(line.sku.toLowerCase());requireValue(line.rate_paise!==null,'Enter the agreed selling price for each added SKU');}
  safeSum([...existing,...lines].map(i=>i.rate_paise===null?0:total(i.qty,Number(i.rate_paise),i.gst_bps)));
  for(const [index,line]of lines.entries())await tx.query('INSERT INTO order_items(id,order_id,position,sku,description,qty,rate_paise,gst_bps,unit_of_measure) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[line.id,id,existing.length+index+1,line.sku,line.description,line.qty,line.rate_paise,line.gst_bps,line.unit_of_measure]);
  const revision=order.order_revision+1;
  await tx.query("UPDATE orders SET order_revision=$1,amendment_notes=$2,stage='Awaiting revised PO',po_ref='',po_channel='',po_received_date=NULL,qty=$3,version=version+1 WHERE id=$4",[revision,notes,safeSum([...existing,...lines].map(i=>i.qty)),id]);
  await audit(tx,actor,'Order amended','orders',id,{before,after:await orderSnapshot(tx,id)});
  return {id,order_revision:revision,item_ids:lines.map(i=>i.id)};
 });
}

export async function updateRecord(db,entity,id,v,actor) {
 uuid(id);
 return db.transaction(async tx=>{
  let before;
  if(entity==='orders') {
   const order=await lockOrder(tx,id);requireValue(order.version===v.version,'This order changed. Refresh before saving.',409);
   const amendmentPending=order.order_revision>order.accepted_revision;
   before=await orderSnapshot(tx,id);
   const requestChannel=v.request_channel===undefined?order.request_channel:choice(v.request_channel,['Not recorded',...CHANNELS],'request communication method');
   const requestNotes=v.request_notes===undefined?order.request_notes:text(v.request_notes,'Communication notes',1000,true);
   const poChannel=v.po_channel===undefined?order.po_channel:choice(v.po_channel,['','WhatsApp','Email','In person','Other'],'PO receipt method');
   const poDate=v.po_received_date===undefined?order.po_received_date:v.po_received_date?date(v.po_received_date,'PO receipt date'):null;
   requireValue(order.request_channel==='Not recorded'||requestChannel!=='Not recorded','Keep the request communication method recorded');
   if(order.ever_confirmed){requireValue(requestChannel===order.request_channel,'Original communication evidence is locked after customer acceptance',409);if(!amendmentPending)requireValue(poChannel===order.po_channel&&String(poDate||'')===String(order.po_received_date||''),'Start a PO revision before changing the accepted PO',409);}
   requireValue(v.sales_path===undefined||v.sales_path===order.sales_path,'Sales path cannot change after creation');
   let lines=(await tx.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY position',[id])).rows;
   if(v.items!==undefined){
    requireValue(!order.ever_confirmed&&['Draft','Enquiry','Pricing'].includes(order.stage),'Prices are locked after quotation or confirmation. Return an unconfirmed quotation to Pricing to revise it',409);
    const proposed=itemArray(v.items);requireValue(proposed.length===lines.length,'Existing SKU lines must be retained');
    for(const [index,line]of lines.entries()){
     const input=proposed[index];requireValue(input.id===line.id&&input.sku===line.sku&&input.description===line.description&&input.qty===line.qty,'Only selling prices and GST can change after creation');
     line.rate_paise=input.rate_paise==null?null:money(input.rate_paise,'SKU selling rate');line.gst_bps=integer(input.gst_bps,'SKU GST',0,10000);
     await tx.query('UPDATE order_items SET rate_paise=$1,gst_bps=$2 WHERE id=$3',[line.rate_paise,line.gst_bps,line.id]);
    }
    safeSum(lines.map(i=>i.rate_paise===null?0:total(i.qty,Number(i.rate_paise),i.gst_bps)));
   }
   const quoteRef=v.quote_ref===undefined?order.quote_ref:text(v.quote_ref,'Quotation reference',200,true);
   const pricingRef=v.pricing_source_ref===undefined?order.pricing_source_ref:text(v.pricing_source_ref,'Pricing source reference',500,true);
   const stage=choice(v.stage,stages,'stage');
   requireValue(stage!=='Awaiting revised PO'||amendmentPending,'Use Add SKUs / revise PO to start an amendment');
   if(amendmentPending)requireValue(['Awaiting revised PO','PO received','On hold','Cancelled'].includes(stage),'Record the revised PO before proceeding');
   if(order.order_revision>1&&order.ever_confirmed)requireValue(!['Draft','Enquiry','Pricing','Quoted','Confirmed'].includes(stage),'The revised order must use the PO received and sourcing readiness steps');
   validateSales(order.sales_path,stage,lines,quoteRef,order);
   if(order.ever_confirmed)requireValue(!['Enquiry','Pricing','Quoted'].includes(stage),'Confirmed orders cannot return to pricing');
   if(order.stage==='Quoted'&&stage==='Quoted')requireValue(quoteRef===order.quote_ref,'Return to Pricing before changing a quotation reference',409);
   const po=v.po_ref===undefined?order.po_ref:text(v.po_ref,'Confirmation reference',200,true);
   if(order.ever_confirmed&&!amendmentPending)requireValue(po===order.po_ref,'Use Add SKUs / revise PO before replacing the accepted PO reference',409);
   const ship=v.ship_to===undefined?order.ship_to:text(v.ship_to,'Ship-to address',1000,true);
   const owner=v.owner===undefined?order.owner:text(v.owner,'Owner',160);
   const target=v.target_date===undefined?order.target_date:date(v.target_date,'Target delivery');
   if(['PO received','Ready for sourcing','Confirmed'].includes(stage)){requireValue(po,'Add the Customer PO / confirmation reference before confirming');requireValue(ship,'Add the Ship-to address before confirming');}
   await validateEvidenceStage(tx,{...order,request_channel:requestChannel,po_channel:poChannel,po_received_date:poDate},stage);
   if(stage==='Cancelled'||stage==='Draft'){
    const linked=await one(tx,'SELECT ((SELECT count(*) FROM dispatches WHERE order_id=$1)+(SELECT count(*) FROM invoices WHERE order_id=$1)+(SELECT count(*) FROM sourcing_links WHERE order_id=$1)+(SELECT count(*) FROM purchase_orders WHERE order_id=$1))::int AS count',[id]);
    requireValue(!linked.count,'Linked activity prevents cancellation or returning to draft',409);
   }
   if(['PO received','Ready for sourcing','Confirmed'].includes(stage))await tx.query('UPDATE orders SET accepted_revision=order_revision WHERE id=$1',[id]);
   await tx.query('UPDATE orders SET request_channel=$1,request_notes=$2,po_channel=$3,po_received_date=$4 WHERE id=$5',[requestChannel,requestNotes,poChannel,poDate,id]);
   await tx.query('UPDATE orders SET quote_ref=$1,pricing_source_ref=$2,ever_confirmed=ever_confirmed OR $3,rate_paise=$4,gst_bps=$5 WHERE id=$6',[quoteRef,pricingRef,['PO received','Ready for sourcing','Confirmed'].includes(stage),lines[0].rate_paise,lines[0].gst_bps,id]);
   if(stage==='Quoted'&&order.stage!=='Quoted')await saveQuote(tx,id,quoteRef,lines,actor);
   await tx.query('UPDATE orders SET stage=$1,po_ref=$2,ship_to=$3,owner=$4,target_date=$5,enquiry_received_date=$7,agreement_status=$8,confirmed_by=$9,version=version+1 WHERE id=$6',[stage,po,ship,owner,target,id,v.enquiry_received_date===undefined?order.enquiry_received_date:date(v.enquiry_received_date,'Enquiry received'),...orderAgreement(v,order)]);
  } else if(entity==='dispatches') {
   const d=await one(tx,'SELECT * FROM dispatches WHERE id=$1 FOR UPDATE',[id]);requireValue(d.version===v.version,'Shipment changed. Refresh before saving.',409);
   const saved=(await tx.query('SELECT * FROM dispatch_items WHERE dispatch_id=$1 ORDER BY id',[id])).rows;
   let requested=v.items;
   if(requested===undefined){requireValue(saved.length===1,'Enter delivery outcomes for each dispatched SKU');requested=[{order_item_id:saved[0].order_item_id,delivered_qty:v.delivered_qty,returned_qty:v.returned_qty??0}];}
   requireValue(itemArray(requested).length===saved.length,'Account for every dispatched SKU');
   const seen=new Set();
   const lines=requested.map(line=>{
    const item=saved.find(i=>i.order_item_id===uuid(line.order_item_id,'Dispatched SKU'));
    requireValue(item&&!seen.has(item.order_item_id),'Unknown or duplicate dispatched SKU');seen.add(item.order_item_id);
    const delivered=integer(line.delivered_qty,'Delivered SKU quantity',0,item.qty),returned=integer(line.returned_qty??0,'Returned SKU quantity',0,item.qty);
    requireValue(delivered+returned<=item.qty,'Delivered plus returned quantity exceeds dispatched SKU quantity');return {item,delivered,returned};
   });
   const delivered=safeSum(lines.map(i=>i.delivered)),returned=safeSum(lines.map(i=>i.returned));
   const status=choice(v.status,['In transit','Partially delivered','Delivered','Returned'],'shipment status');
   const pod=text(v.pod||'','POD reference',1000,true),actual=v.actual_date?date(v.actual_date,'Actual delivery'):null;
   if(actual)requireValue(actual>=dbDate(d.dispatch_date),'Delivery cannot precede dispatch');
   if(delivered>0)requireValue(actual&&pod,'Delivered quantities require a delivery date and POD');
   if(status==='Delivered')requireValue(delivered===d.qty&&returned===0&&actual&&pod,'Delivered requires the full quantity, delivery date and POD');
   if(status==='Partially delivered')requireValue(delivered>0&&delivered<d.qty,'Partial delivery requires a partial delivered quantity');
   if(status==='In transit')requireValue(delivered===0&&returned===0,'Use a delivery or return status when quantities are received');
   if(status==='Returned')requireValue(returned>0&&delivered+returned===d.qty,'Returned shipments must account for every dispatched unit');
   for(const line of lines)await tx.query('UPDATE dispatch_items SET delivered_qty=$1,returned_qty=$2 WHERE id=$3',[line.delivered,line.returned,line.item.id]);
   await tx.query('UPDATE dispatches SET delivered_qty=$1,returned_qty=$2,status=$3,pod=$4,actual_date=$5,version=version+1 WHERE id=$6',[delivered,returned,status,pod,actual,id]);
  } else if(entity==='tasks') {
   const task=await one(tx,'SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[id]);requireValue(can(actor,'access.users.read')||task.assignee_id===actor.id,'Follow-up not found',404);requireValue(task.version===v.version,'Task changed. Refresh before saving.',409);
   await tx.query('UPDATE tasks SET status=$1,version=version+1 WHERE id=$2',[choice(v.status,['Open','In progress','Blocked','Completed'],'task status'),id]);
  } else if(entity==='sourcing') {
   const link=await one(tx,'SELECT * FROM sourcing_links WHERE id=$1 FOR UPDATE',[id]);requireValue(link.version===v.version,'Sourcing reference changed. Refresh before saving.',409);
   await tx.query('UPDATE sourcing_links SET status=$1,supplier=$2,eta=$3,notes=$4,vendor_gstin=$6,vendor_phone=$7,vendor_email=$8,version=version+1,updated_at=now() WHERE id=$5',[choice(v.status,['Requested','In progress','Ready','Blocked','Rejected'],'sourcing status'),text(v.supplier||'','Vendor name',200,true),v.eta?date(v.eta,'ETA'):null,text(v.notes||'','Notes',1000,true),id,...vendorDetails(v,link)]);
  }
  await audit(tx,actor,'Updated',entity,id,entity==='orders'?{before,after:await orderSnapshot(tx,id)}:v);return {id};
 });
}

export async function workspace(db,actor) {
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=async (permission,sql,params)=>!actor||can(actor,permission)?(await tx.query(sql,params)).rows:[];
  const result={
   customers:await rows('customers.read','SELECT * FROM customers ORDER BY name'),
   orders:await rows('orders.read',`SELECT o.*,c.name AS customer_name,x.qty::int AS qty,x.item_count::int AS item_count,x.subtotal_paise::bigint AS subtotal_paise,x.total_paise::bigint AS total_paise,(SELECT count(*)::int FROM sourcing_links sl WHERE sl.order_id=o.id) AS sourcing_line_count,(SELECT count(*)::int FROM sourcing_links sl WHERE sl.order_id=o.id AND sl.status='Ready') AS sourcing_ready_count,COALESCE(d.dispatched,0)::int AS dispatched,COALESCE(d.delivered,0)::int AS delivered,COALESCE(i.invoiced,0)::int AS invoiced FROM orders o JOIN customers c ON c.id=o.customer_id JOIN (SELECT order_id,SUM(qty) qty,count(*) item_count,CASE WHEN count(rate_paise)=count(*) THEN SUM(qty::numeric*rate_paise) END subtotal_paise,CASE WHEN count(rate_paise)=count(*) THEN SUM(qty::numeric*rate_paise+floor((qty::numeric*rate_paise*gst_bps+5000)/10000)) END total_paise FROM order_items GROUP BY order_id) x ON x.order_id=o.id LEFT JOIN (SELECT order_id,SUM(qty) dispatched,SUM(delivered_qty) delivered FROM dispatch_items GROUP BY order_id) d ON d.order_id=o.id LEFT JOIN (SELECT order_id,SUM(qty) invoiced FROM invoice_items GROUP BY order_id) i ON i.order_id=o.id ORDER BY o.created_at DESC`),
   order_items:await rows('orders.read',`SELECT oi.*,COALESCE(d.dispatched,0)::int AS dispatched,COALESCE(d.delivered,0)::int AS delivered,COALESCE(i.invoiced,0)::int AS invoiced FROM order_items oi LEFT JOIN (SELECT order_item_id,SUM(qty) dispatched,SUM(delivered_qty) delivered FROM dispatch_items GROUP BY order_item_id) d ON d.order_item_id=oi.id LEFT JOIN (SELECT order_item_id,SUM(qty) invoiced FROM invoice_items GROUP BY order_item_id) i ON i.order_item_id=oi.id ORDER BY oi.order_id,oi.position`),
   sourcing:await rows('sourcing.read','SELECT s.*,oi.sku,oi.description AS item_description FROM sourcing_links s JOIN order_items oi ON oi.id=s.order_item_id ORDER BY s.updated_at DESC'),
   dispatches:await rows('dispatches.read','SELECT d.*,(SELECT count(*)::int FROM dispatch_items di WHERE di.dispatch_id=d.id) AS item_count FROM dispatches d ORDER BY d.created_at DESC'),
   dispatch_items:await rows('dispatches.read','SELECT di.*,oi.sku,oi.description FROM dispatch_items di JOIN order_items oi ON oi.id=di.order_item_id ORDER BY di.dispatch_id,oi.position'),
   invoices:await rows('invoices.read','SELECT i.*,(SELECT count(*)::int FROM invoice_items ii WHERE ii.invoice_id=i.id) AS item_count,COALESCE(r.paid,0)::bigint AS paid_paise,(i.total_paise-COALESCE(r.paid,0))::bigint AS outstanding_paise FROM invoices i LEFT JOIN (SELECT invoice_id,SUM(amount_paise) AS paid FROM receipts GROUP BY invoice_id) r ON r.invoice_id=i.id ORDER BY i.created_at DESC'),
   invoice_items:await rows('invoices.read','SELECT ii.*,oi.sku,oi.description FROM invoice_items ii JOIN order_items oi ON oi.id=ii.order_item_id ORDER BY ii.invoice_id,oi.position'),
   receipts:await rows('receipts.read','SELECT r.*,i.number AS invoice_number FROM receipts r JOIN invoices i ON i.id=r.invoice_id ORDER BY r.created_at DESC'),
   tasks:!actor||can(actor,'access.users.read')
    ?await rows('tasks.read','SELECT * FROM tasks ORDER BY due_date')
    :await rows('tasks.read','SELECT * FROM tasks WHERE assignee_id=$1 ORDER BY due_date',[actor.id]),
   audit:!actor||can(actor,'audit.read')
    ?await rows('audit.read','SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100')
    :await rows('audit.operations.read',`SELECT a.id,a.created_at,a.action,a.entity,a.record_id,u.name AS actor_name
     FROM audit a JOIN users u ON u.id=a.actor_id
     WHERE a.entity=ANY($1::text[]) ORDER BY a.id DESC LIMIT 100`,
     [['customers','orders','sourcing'].filter(entity=>can(actor,entity+'.read'))])
  };
  result.orders=result.orders.map(({sourcing_line_count,sourcing_ready_count,...row})=>({...row,execution_status:!['Confirmed','Ready for sourcing'].includes(row.stage)?row.stage:row.delivered>=row.qty?'Delivered':row.delivered>0?'Partially delivered':row.dispatched>0?'In transit':sourcing_ready_count===row.item_count?'Ready to dispatch':sourcing_line_count>0?'Sourcing':'Confirmed'}));
  if(actor&&!can(actor,'invoices.read'))for(const key of ['orders','order_items'])result[key]=result[key].map(({invoiced,...row})=>row);
  return result;
 });
}
