import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.js';
import {createApp} from '../src/app.js';
import {bootstrap} from '../src/seed.js';
import {createRecord} from '../src/service.js';
import {integer,total} from '../src/domain.js';
let db,app,admin,sales,viewer,adminActor;
const origin='http://localhost:3210';
const post=(agent,path,body)=>agent.post('/api'+path).set('X-Requested-With','sales-ops').set('Origin',origin).send(body);
const patch=(path,body)=>admin.patch('/api'+path).set('X-Requested-With','sales-ops').set('Origin',origin).send(body);
before(async()=>{
 db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);await migrate(db);
 adminActor=await bootstrap(db,'admin@example.com','testing-password-123','Admin');
 await bootstrap(db,'sales@example.com','testing-password-123','Sales','sales');
 await bootstrap(db,'viewer@example.com','testing-password-123','Viewer','viewer');
 app=createApp(db,{releaseScope:'full',secret:'test-session-secret-with-at-least-32-chars',production:false,frontendOrigin:origin});
 admin=request.agent(app);sales=request.agent(app);viewer=request.agent(app);
 for(const [agent,email]of [[admin,'admin@example.com'],[sales,'sales@example.com'],[viewer,'viewer@example.com']])assert.equal((await post(agent,'/auth/login',{email,password:'testing-password-123'})).status,200);
});
after(async()=>{await db?.close();});
async function order(stage='Confirmed'){
 const customer=await createRecord(db,'customers',{name:'Customer '+randomUUID(),terms:30},adminActor);
 return (await post(admin,'/orders',{customer_id:customer.id,description:'100 kettles',sku:'KTL',qty:100,rate_paise:100000,gst_bps:1800,stage,po_ref:stage==='Confirmed'?'PO-123':'',ship_to:stage==='Confirmed'?'Bengaluru':'',owner:'Sales',target_date:'2027-01-30'})).body;
}
test('API rejects anonymous access, untrusted origins and role escalation',async()=>{
 assert.equal((await request(app).get('/api/workspace')).status,401);
 assert.equal((await admin.post('/api/tasks').send({})).status,403);
 assert.equal((await admin.post('/api/tasks').set('X-Requested-With','sales-ops').set('Origin','https://evil.example').send({})).status,403);
 assert.equal((await post(viewer,'/customers',{name:'Forbidden'})).status,403);
 assert.equal((await post(sales,'/receipts',{})).status,403);
 assert.equal((await admin.get('/readyz')).status,200);
 assert.equal((await admin.get('/api/workspace')).headers['cache-control'],'no-store');
});
test('complete B2B workflow preserves quantities, financial balances and audit history',async()=>{
 const o=await order();assert.ok(o.id);
 const sourcing=await post(admin,'/sourcing',{order_id:o.id,external_ref:'SRC-001',status:'In progress'});assert.equal(sourcing.status,201);
 const shipment=await post(admin,'/dispatches',{order_id:o.id,qty:60,carrier:'Courier',tracking:'AWB-001',dispatch_date:'2027-01-01',expected_date:'2027-01-02'});assert.equal(shipment.status,201);
 assert.equal((await patch('/dispatches/'+shipment.body.id,{version:1,status:'Delivered',delivered_qty:60,returned_qty:0,actual_date:'2027-01-02',pod:'POD-001'})).status,200);
 const inv=await post(admin,'/invoices',{order_id:o.id,number:'INV-'+randomUUID(),qty:60,rate_paise:100000,gst_bps:1800,invoice_date:'2027-01-01',due_date:'2027-01-31'});assert.equal(inv.status,201);
 const receipt={invoice_id:inv.body.id,amount_paise:3000000,reference:'UTR-001',mode:'NEFT',receipt_date:'2027-01-02'};
 assert.equal((await post(admin,'/receipts',receipt)).status,201);
 assert.equal((await post(admin,'/receipts',{...receipt,reference:'utr-001'})).status,409);
 assert.equal((await post(admin,'/receipts',{...receipt,reference:'UTR-002',amount_paise:5000000})).status,409);
 const w=(await admin.get('/api/workspace')).body;
 const saved=w.orders.find(x=>x.id===o.id);assert.equal(saved.delivered,60);assert.equal(saved.dispatched,60);assert.equal(saved.invoiced,60);
 const bill=w.invoices.find(x=>x.id===inv.body.id);assert.equal(Number(bill.total_paise),7080000);assert.equal(Number(bill.outstanding_paise),4080000);
 assert.ok(w.audit.some(a=>a.record_id===shipment.body.id&&a.action==='Updated'));
 assert.equal((await patch('/dispatches/'+shipment.body.id,{version:1,status:'Delivered',delivered_qty:60,pod:'POD-001',actual_date:'2027-01-02'})).status,409);
});
test('competing shipments and invoices cannot over-allocate a single order',async()=>{
 const o=await order();
 const shipment={order_id:o.id,qty:60,carrier:'Courier',tracking:'AWB',dispatch_date:'2027-01-01',expected_date:'2027-01-02'};
 const replies=await Promise.all([post(admin,'/dispatches',shipment),post(admin,'/dispatches',shipment)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
 const invoice={order_id:o.id,number:'CONCURRENT-A-'+randomUUID(),qty:60,rate_paise:100000,gst_bps:1800,invoice_date:'2027-01-01',due_date:'2027-01-31'};
 const bills=await Promise.all([post(admin,'/invoices',invoice),post(admin,'/invoices',{...invoice,number:'CONCURRENT-B-'+randomUUID()})]);
 assert.deepEqual(bills.map(r=>r.status).sort(),[201,409]);
});
test('competing receipts cannot collect more than invoice outstanding',async()=>{
 const o=await order();
 const bill=await post(admin,'/invoices',{order_id:o.id,number:'PAY-'+randomUUID(),qty:1,rate_paise:100000,gst_bps:0,invoice_date:'2027-01-01',due_date:'2027-01-31'});
 const payment={invoice_id:bill.body.id,amount_paise:60000,reference:'PAY-A',mode:'NEFT',receipt_date:'2027-01-02'};
 const results=await Promise.all([post(admin,'/receipts',payment),post(admin,'/receipts',{...payment,reference:'PAY-B'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
});
test('draft confirmation needs evidence; holds block fulfilment; stale updates are rejected',async()=>{
 const o=await order('Draft');
 assert.equal((await patch('/orders/'+o.id,{version:1,stage:'Confirmed'})).status,400);
 assert.equal((await patch('/orders/'+o.id,{version:1,stage:'Confirmed',po_ref:'PO-NEW',ship_to:'Mumbai'})).status,200);
 assert.equal((await patch('/orders/'+o.id,{version:1,stage:'Cancelled'})).status,409);
 assert.equal((await patch('/orders/'+o.id,{version:2,stage:'On hold'})).status,200);
 assert.equal((await post(admin,'/dispatches',{order_id:o.id,qty:1,carrier:'Courier',tracking:'AWB',dispatch_date:'2027-01-01',expected_date:'2027-01-02'})).status,409);
});
test('invalid POD, quantity and dates do not change saved shipment',async()=>{
 const o=await order();
 const d=await post(admin,'/dispatches',{order_id:o.id,qty:10,carrier:'Courier',tracking:'AWB',dispatch_date:'2027-01-01',expected_date:'2027-01-02'});
 assert.equal((await patch('/dispatches/'+d.body.id,{version:1,status:'Delivered',delivered_qty:10,actual_date:'2027-01-02'})).status,400);
 assert.equal((await patch('/dispatches/'+d.body.id,{version:1,status:'Partially delivered',delivered_qty:8,returned_qty:3,pod:'POD',actual_date:'2027-01-02'})).status,400);
 assert.equal((await patch('/dispatches/'+d.body.id,{version:1,status:'Delivered',delivered_qty:10,pod:'POD',actual_date:'2026-12-31'})).status,400);
 assert.equal((await post(admin,'/dispatches',{order_id:o.id,qty:1,carrier:'Courier',tracking:'AWB',dispatch_date:'2027-02-30',expected_date:'2027-03-01'})).status,400);
});
test('money uses integer paise and invalid numbers are rejected',()=>{
 assert.equal(total(3,10005,1800),35418);
 assert.throws(()=>total(1000000,10000000000,1800));
 assert.throws(()=>integer(NaN,'Quantity'));assert.throws(()=>integer(Infinity,'Quantity'));assert.throws(()=>integer(1.2,'Quantity'));
});
test('logout revokes the server session',async()=>{
 const agent=request.agent(app);assert.equal((await post(agent,'/auth/login',{email:'admin@example.com',password:'testing-password-123'})).status,200);
 assert.equal((await post(agent,'/auth/logout',{})).status,204);
 assert.equal((await agent.get('/api/auth/me')).status,401);
});
