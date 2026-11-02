import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {openDatabase,migrate} from '../src/db.js';
import {createRecord,updateRecord,workspace} from '../src/service.js';
import {bootstrap} from '../src/seed.js';
import {createApp} from '../src/app.js';
let db,actor,agent;
before(async()=>{
 db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);
 actor=await bootstrap(db,'multi@example.com','multi-sku-password','Multi Admin');
 agent=request.agent(createApp(db,{releaseScope:'full',secret:'multi-sku-test-session-secret-at-least-32-characters',production:false,frontendOrigin:'http://localhost:3210'}));
 assert.equal((await agent.post('/api/auth/login').set('X-Requested-With','sales-ops').send({email:'multi@example.com',password:'multi-sku-password'})).status,200);
});
after(async()=>db?.close());
async function order(){
 const customer=await createRecord(db,'customers',{name:'Multi customer '+randomUUID(),terms:30},actor);
 return createRecord(db,'orders',{customer_id:customer.id,description:'Kettle variants',stage:'Confirmed',po_ref:'MULTI-PO',ship_to:'Bengaluru',owner:'Sales',target_date:'2027-01-30',items:[
  {sku:'KTL-BLACK',description:'Black kettle',qty:10,rate_paise:100000,gst_bps:1800},
  {sku:'KTL-WHITE',description:'White kettle',qty:5,rate_paise:120000,gst_bps:1200}
 ]},actor);
}
const shipment=(id,items)=>({order_id:id,items,carrier:'Courier',tracking:'MULTI-AWB',dispatch_date:'2027-01-01',expected_date:'2027-01-02'});
const bill=(id,items)=>({order_id:id,items,number:'MULTI-INV-'+randomUUID(),invoice_date:'2027-01-01',due_date:'2027-01-31'});

test('multi-SKU order, mixed shipment, delivery, invoice and receipt retain separate balances',async()=>{
 const o=await order(),[black,white]=o.item_ids;
 const items=[{order_item_id:black,qty:6},{order_item_id:white,qty:2}];
 const response=await agent.post('/api/dispatches').set('X-Requested-With','sales-ops').send(shipment(o.id,items));
 assert.equal(response.status,201);const d=response.body;
 await updateRecord(db,'dispatches',d.id,{version:1,status:'Partially delivered',actual_date:'2027-01-02',pod:'MULTI-POD',items:[{order_item_id:black,delivered_qty:4,returned_qty:0},{order_item_id:white,delivered_qty:1,returned_qty:0}]},actor);
 const inv=await createRecord(db,'invoices',bill(o.id,items),actor);
 await createRecord(db,'receipts',{invoice_id:inv.id,amount_paise:300000,reference:'MULTI-UTR',mode:'NEFT',receipt_date:'2027-01-02'},actor);
 const w=await workspace(db),saved=w.orders.find(r=>r.id===o.id),lines=w.order_items.filter(i=>i.order_id===o.id);
 assert.equal(saved.item_count,2);assert.equal(saved.qty,15);assert.equal(saved.dispatched,8);assert.equal(saved.delivered,5);assert.equal(saved.invoiced,8);
 assert.equal(Number(saved.subtotal_paise),1600000);assert.equal(Number(saved.total_paise),1852000);
 assert.deepEqual(lines.map(i=>[i.sku,i.dispatched,i.delivered,i.invoiced]),[['KTL-BLACK',6,4,6],['KTL-WHITE',2,1,2]]);
 const invoice=w.invoices.find(i=>i.id===inv.id);assert.equal(Number(invoice.total_paise),976800);assert.equal(Number(invoice.outstanding_paise),676800);
 assert.equal(w.invoice_items.filter(i=>i.invoice_id===inv.id).length,2);
 assert.deepEqual(w.invoice_items.filter(i=>i.invoice_id===inv.id).map(i=>i.gst_bps),[1800,1200]);
});

test('per-SKU limits apply even when aggregate order capacity would allow the request',async()=>{
 const o=await order(),[black,white]=o.item_ids;
 await assert.rejects(()=>createRecord(db,'dispatches',shipment(o.id,[{order_item_id:black,qty:11}]),actor),/KTL-BLACK/);
 await assert.rejects(()=>createRecord(db,'invoices',bill(o.id,[{order_item_id:white,qty:6}]),actor),/KTL-WHITE/);
 const w=await workspace(db);assert.equal(w.dispatches.filter(d=>d.order_id===o.id).length,0);assert.equal(w.invoices.filter(i=>i.order_id===o.id).length,0);
});

test('duplicate/cross-order SKU lines and ambiguous legacy requests are rejected atomically',async()=>{
 const a=await order(),b=await order();
 await assert.rejects(()=>createRecord(db,'dispatches',shipment(a.id,[{order_item_id:b.item_ids[0],qty:1}]),actor),/does not belong/);
 await assert.rejects(()=>createRecord(db,'invoices',bill(a.id,[{order_item_id:a.item_ids[0],qty:1},{order_item_id:a.item_ids[0],qty:2}]),actor),/only once/);
 await assert.rejects(()=>createRecord(db,'dispatches',{...shipment(a.id,undefined),qty:1},actor),/Select SKU lines/);
 await assert.rejects(()=>createRecord(db,'sourcing',{order_id:a.id,external_ref:'SRC',status:'Requested'},actor),/Select SKU lines/);
 const customer=await createRecord(db,'customers',{name:'Duplicate SKU '+randomUUID()},actor);
 const shared={customer_id:customer.id,description:'Invalid order',stage:'Draft',owner:'Sales',target_date:'2027-01-30'};
 const line={sku:'DUPLICATE',description:'Variant',qty:1,rate_paise:10000,gst_bps:1800};
 await assert.rejects(()=>createRecord(db,'orders',{...shared,items:[line,{...line,sku:'duplicate'}]},actor),/only once/);
 await assert.rejects(()=>createRecord(db,'orders',{...shared,items:[]},actor),/1 and 100/);
 assert.equal((await workspace(db)).orders.filter(o=>o.customer_id===customer.id).length,0);
});

test('delivery cannot transfer units between SKUs and must include every shipment line',async()=>{
 const o=await order(),[black,white]=o.item_ids;
 const d=await createRecord(db,'dispatches',shipment(o.id,[{order_item_id:black,qty:6},{order_item_id:white,qty:2}]),actor);
 const common={version:1,status:'Delivered',pod:'POD',actual_date:'2027-01-02'};
 await assert.rejects(()=>updateRecord(db,'dispatches',d.id,{...common,items:[{order_item_id:black,delivered_qty:7},{order_item_id:white,delivered_qty:1}]},actor),/between 0 and 6/);
 await assert.rejects(()=>updateRecord(db,'dispatches',d.id,{...common,items:[{order_item_id:black,delivered_qty:6}]},actor),/every dispatched SKU/);
 await assert.rejects(()=>updateRecord(db,'dispatches',d.id,{...common,items:[{order_item_id:black,delivered_qty:6},{order_item_id:black,delivered_qty:2}]},actor),/duplicate/);
 const saved=(await workspace(db)).dispatch_items.filter(i=>i.dispatch_id===d.id);assert.ok(saved.every(i=>i.delivered_qty===0));
});

test('sourcing is independently linked and updated per SKU',async()=>{
 const o=await order();
 for(const [index,itemId] of o.item_ids.entries())await createRecord(db,'sourcing',{order_id:o.id,order_item_id:itemId,external_ref:'SRC-'+index,status:index?'Ready':'In progress'},actor);
 const links=(await workspace(db)).sourcing.filter(s=>s.order_id===o.id);assert.equal(links.length,2);assert.deepEqual(new Set(links.map(s=>s.sku)),new Set(['KTL-BLACK','KTL-WHITE']));
});

test('competing multi-SKU allocations serialize and a rejected batch leaves no partial rows',async()=>{
 const o=await order(),[black,white]=o.item_ids;
 const results=await Promise.allSettled([
  createRecord(db,'dispatches',shipment(o.id,[{order_item_id:black,qty:6},{order_item_id:white,qty:2}]),actor),
  createRecord(db,'dispatches',shipment(o.id,[{order_item_id:black,qty:6},{order_item_id:white,qty:2}]),actor)
 ]);
 assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
 const w=await workspace(db);assert.equal(w.dispatch_items.filter(i=>i.order_id===o.id).length,2);
 const invoices=await Promise.allSettled([
  createRecord(db,'invoices',bill(o.id,[{order_item_id:black,qty:6},{order_item_id:white,qty:2}]),actor),
  createRecord(db,'invoices',bill(o.id,[{order_item_id:black,qty:6},{order_item_id:white,qty:2}]),actor)
 ]);
 assert.deepEqual(invoices.map(r=>r.status).sort(),['fulfilled','rejected']);
 assert.equal((await workspace(db)).invoice_items.filter(i=>i.order_id===o.id).length,2);
});

test('migration preserves a v1 order, shipment, invoice, receipt and sourcing link; reruns are safe',async()=>{
 const legacy=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});
 try {
  await migrate(legacy,['001_sales_ops']);
  const admin=await bootstrap(legacy,'legacy@example.com','legacy-password-123');
  const customer=randomUUID(),orderId=randomUUID(),dispatchId=randomUUID(),invoiceId=randomUUID(),receiptId=randomUUID(),sourceId=randomUUID();
  await legacy.query('INSERT INTO customers(id,name) VALUES ($1,$2)',[customer,'Legacy customer']);
  await legacy.query("INSERT INTO orders(id,customer_id,description,sku,qty,rate_paise,gst_bps,stage,po_ref,owner,target_date,ship_to) VALUES ($1,$2,'Legacy kettle','LEGACY-KTL',100,100000,1800,'Confirmed','PO-OLD','Sales','2027-01-30','Mumbai')",[orderId,customer]);
  await legacy.query("INSERT INTO dispatches(id,order_id,qty,delivered_qty,carrier,tracking,dispatch_date,expected_date,status,pod,actual_date) VALUES ($1,$2,60,40,'Courier','OLD-AWB','2027-01-01','2027-01-02','Partially delivered','OLD-POD','2027-01-02')",[dispatchId,orderId]);
  await legacy.query("INSERT INTO invoices(id,order_id,number,qty,rate_paise,gst_bps,total_paise,invoice_date,due_date) VALUES ($1,$2,'OLD-INV',60,100000,1800,7080000,'2027-01-01','2027-01-31')",[invoiceId,orderId]);
  await legacy.query("INSERT INTO receipts(id,invoice_id,amount_paise,reference,mode,receipt_date,recorded_by) VALUES ($1,$2,3000000,'OLD-UTR','NEFT','2027-01-02',$3)",[receiptId,invoiceId,admin.id]);
  await legacy.query("INSERT INTO sourcing_links(id,order_id,external_ref,status) VALUES ($1,$2,'OLD-SRC','Ready')",[sourceId,orderId]);
  await migrate(legacy);await migrate(legacy);
  const w=await workspace(legacy);assert.equal(w.orders.length,1);assert.equal(w.order_items.length,1);assert.equal(w.orders[0].id,orderId);assert.equal(w.orders[0].qty,100);assert.equal(w.orders[0].delivered,40);assert.equal(w.orders[0].invoiced,60);
  assert.equal(w.dispatch_items[0].dispatch_id,dispatchId);assert.equal(w.dispatch_items[0].delivered_qty,40);
  assert.equal(w.invoices[0].id,invoiceId);assert.equal(Number(w.invoices[0].outstanding_paise),4080000);assert.equal(w.receipts[0].id,receiptId);
  assert.equal(w.sourcing[0].id,sourceId);assert.equal(w.sourcing[0].order_item_id,w.order_items[0].id);
 }finally{await legacy.close();}
});
