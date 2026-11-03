import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createRecord,updateRecord,orderHistory,amendOrder} from '../src/service.js';
import {createApp} from '../src/app.js';
let db,actor,admin,app,customer;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKz0AAAAASUVORK5CYII=','base64');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
before(async()=>{db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);await migrate(db);actor=await bootstrap(db,'evidence@example.test','Evidence-Tests-2026!','Evidence Admin');app=createApp(db,{secret:'evidence-secret-at-least-32-characters',frontendOrigin:'http://localhost:3210',production:false});admin=request.agent(app);await admin.post('/api/auth/login').set('X-Requested-With','sales-ops').send({email:'evidence@example.test',password:'Evidence-Tests-2026!'}).expect(200);customer=await createRecord(db,'customers',{name:'Evidence Hotel'},actor);});
after(async()=>db?.close());
async function order(channel='Email',path='needs-pricing'){return createRecord(db,'orders',{customer_id:customer.id,request_channel:channel,request_notes:'Customer asked for 10 kettles',sales_path:path,stage:path==='agreed'?'Draft':'Enquiry',owner:'Sales',target_date:'2027-01-30',ship_to:'Bengaluru',items:[{sku:'KTL',description:'Kettle',qty:10,rate_paise:100000,gst_bps:1800}]},actor);}
async function change(id,values){const o=(await db.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0];return updateRecord(db,'orders',id,{version:o.version,stage:o.stage,...values},actor);}
const upload=(agent,id,category,channel,bytes=png,name='message.png')=>agent.post(`/api/orders/${id}/documents`).set('X-Requested-With','sales-ops').set('Origin','http://localhost:3210').set('Content-Type','application/octet-stream').set('X-Document-Category',category).set('X-Communication-Channel',channel).set('X-File-Name',encodeURIComponent(name)).send(bytes);
test('email requests can advance without a request attachment and still require quotation and PO evidence',async()=>{
 const o=await order();
 await assert.rejects(()=>change(o.id,{stage:'Quoted',quote_ref:'Q-1'}),/quotation or shared/);
 const quote=await upload(admin,o.id,'quotation','WhatsApp',pdf,'quote.pdf');assert.equal(quote.status,201);
 await change(o.id,{stage:'Quoted',quote_ref:'Q-1'});
 await assert.rejects(()=>change(o.id,{stage:'Ready for sourcing',po_ref:'PO-1',po_channel:'Email',po_received_date:'2026-10-31'}),/Attach the customer PO/);
 await upload(admin,o.id,'po','Email',pdf,'customer-po.pdf').expect(201);
 await assert.rejects(()=>change(o.id,{stage:'Ready for sourcing',po_ref:'PO-1',po_channel:'Email',po_received_date:'2026-10-31'}),/Save the PO received/);
 await assert.rejects(()=>change(o.id,{stage:'PO received',po_ref:'PO-1',po_channel:'WhatsApp',po_received_date:'2026-10-31'}),/recorded receipt method/);
 await change(o.id,{stage:'PO received',po_ref:'PO-1',po_channel:'Email',po_received_date:'2026-10-31'});
 await change(o.id,{stage:'Ready for sourcing'});
 const row=(await db.query('SELECT * FROM orders WHERE id=$1',[o.id])).rows[0];assert.equal(row.ever_confirmed,true);assert.equal(row.stage,'Ready for sourcing');
 await assert.rejects(()=>change(o.id,{stage:'Pricing'}),/cannot return/);
 const history=await orderHistory(db,o.id);assert.equal(history.events.filter(e=>e.detail.document).length,2);assert.ok(!JSON.stringify(history).includes('content'));
 const list=await admin.get(`/api/orders/${o.id}/documents`).expect(200);assert.equal(list.body.length,2);assert.ok(!JSON.stringify(list.body).includes('content'));
 const file=await admin.get(`/api/orders/${o.id}/documents/${quote.body.id}`).expect(200);assert.equal(file.headers['content-type'],'application/pdf');assert.match(file.headers['content-disposition'],/^attachment/);assert.equal(Buffer.compare(file.body,pdf),0);
});
test('call requests skip screenshots but still need a customer PO before handoff',async()=>{
 const o=await order('Call','agreed');
 await assert.rejects(()=>change(o.id,{stage:'PO received',po_ref:'PO-CALL',po_channel:'Other',po_received_date:'2026-10-31'}),/Attach the customer PO/);
 await upload(admin,o.id,'po','Other',pdf,'physical-po.pdf').expect(201);
 await change(o.id,{stage:'PO received',po_ref:'PO-CALL',po_channel:'Other',po_received_date:'2026-10-31'});
 assert.equal((await db.query('SELECT stage FROM orders WHERE id=$1',[o.id])).rows[0].stage,'PO received');
});
test('documents reject unsafe types, oversized content, anonymous access and cross-order downloads',async()=>{
 const o=await order(),other=await order();
 await upload(admin,o.id,'request','Email',Buffer.from('<svg onload=alert(1)>'),'bad.svg').expect(400);
 await upload(admin,o.id,'request','Email',Buffer.alloc(5*1024*1024+1),'large.png').expect(413);
 const file=await upload(admin,o.id,'request','Email');assert.equal(file.status,201);
 await request(app).get(`/api/orders/${o.id}/documents/${file.body.id}`).expect(401);
 await admin.get(`/api/orders/${other.id}/documents/${file.body.id}`).expect(404);
 const user=await admin.post('/api/access/users').set('X-Requested-With','sales-ops').send({name:'No access',email:`${randomUUID()}@evidence.test`,password:'Evidence-Tests-2026!',permissions:[],role_ids:[],team_ids:[]}).expect(201);
 const agent=request.agent(app);await agent.post('/api/auth/login').set('X-Requested-With','sales-ops').send({email:user.body.email|| (await db.query('SELECT email FROM users WHERE id=$1',[user.body.id])).rows[0].email,password:'Evidence-Tests-2026!'}).expect(200);
 await agent.get(`/api/orders/${o.id}/documents`).expect(403);
 await upload(agent,o.id,'po','Email').expect(403);
});


test('new SKUs and PO-only amendments retain old items/documents and require a new PO revision',async()=>{
 const o=await order('Call','agreed');
 const oldDoc=await upload(admin,o.id,'po','Email',pdf,'original-po.pdf');assert.equal(oldDoc.status,201);
 await change(o.id,{stage:'PO received',po_ref:'ORIGINAL-PO',po_channel:'Email',po_received_date:'2026-10-31'});await change(o.id,{stage:'Ready for sourcing'});
 const original=(await db.query('SELECT * FROM order_items WHERE order_id=$1',[o.id])).rows[0];
 const row=async()=>(await db.query('SELECT * FROM orders WHERE id=$1',[o.id])).rows[0];
 let current=await row();
 await assert.rejects(()=>amendOrder(db,o.id,{version:current.version,reason:'Duplicate',items:[{sku:'ktl',description:'Duplicate',qty:1,rate_paise:100000,gst_bps:1800}]},actor),/already exists/);
 assert.equal((await row()).stage,'Ready for sourcing');
 const amendment={version:current.version,reason:'Customer added white kettles',items:[{sku:'KTL-WHITE',description:'White kettle',qty:2,rate_paise:200000,gst_bps:1800}]};
 const revised=await admin.post(`/api/orders/${o.id}/amendments`).set('X-Requested-With','sales-ops').send(amendment).expect(201);assert.equal(revised.body.order_revision,2);
 current=await row();assert.equal(current.stage,'Awaiting revised PO');assert.equal(current.po_ref,'');assert.equal(current.accepted_revision,1);
 assert.deepEqual((await db.query('SELECT * FROM order_items WHERE id=$1',[original.id])).rows[0],original);
 await assert.rejects(()=>amendOrder(db,o.id,amendment,actor),/changed/);
 await assert.rejects(()=>change(o.id,{stage:'Ready for sourcing'}),/revised PO/);
 await assert.rejects(()=>change(o.id,{stage:'PO received',po_ref:'REVISED-PO',po_channel:'Email',po_received_date:'2026-10-31'}),/Attach the customer PO/);
 const staleUpload=upload(admin,o.id,'po','Email',pdf,'stale.pdf').set('X-Order-Revision','1');await staleUpload.expect(409);
 await upload(admin,o.id,'po','Email',pdf,'revised-po.pdf').set('X-Order-Revision','2').expect(201);
 await change(o.id,{stage:'PO received',po_ref:'REVISED-PO',po_channel:'Email',po_received_date:'2026-10-31'});await change(o.id,{stage:'Ready for sourcing'});
 current=await row();assert.equal(current.accepted_revision,2);
 const docs=(await admin.get(`/api/orders/${o.id}/documents`).expect(200)).body;assert.equal(docs.filter(d=>d.category==='po').length,2);assert.deepEqual(new Set(docs.map(d=>d.order_revision)),new Set([1,2]));
 await admin.get(`/api/orders/${o.id}/documents/${oldDoc.body.id}`).expect(200);
 const h=await orderHistory(db,o.id);const event=h.events.find(e=>e.action==='Order amended');assert.equal(event.detail.before.po_ref,'ORIGINAL-PO');assert.equal(event.detail.before.items.length,1);assert.equal(event.detail.after.items.length,2);
 await assert.rejects(()=>change(o.id,{po_ref:'SILENT-REPLACEMENT'}),/Add SKUs/);
 const third=await amendOrder(db,o.id,{version:current.version,reason:'PO reference corrected by customer',items:[]},actor);assert.equal(third.order_revision,3);
 assert.equal((await db.query('SELECT count(*)::int AS count FROM order_items WHERE order_id=$1',[o.id])).rows[0].count,2);
 await assert.rejects(()=>change(o.id,{stage:'PO received',po_ref:'PO-3',po_channel:'Email',po_received_date:'2026-10-31'}),/Attach the customer PO/);
});

test('amendment endpoint requires update permission and blocks orders already in operations',async()=>{
 const o=await order('Call','agreed');await assert.rejects(()=>amendOrder(db,o.id,{version:1,reason:'Early',items:[]},actor),/original PO/);
 const legacy=await createRecord(db,'orders',{customer_id:customer.id,stage:'Confirmed',po_ref:'OPS-PO',ship_to:'Bengaluru',owner:'Sales',target_date:'2027-01-30',items:[{sku:'OPS',description:'In sourcing',qty:2,rate_paise:100000,gst_bps:1800}]},actor);
 await createRecord(db,'sourcing',{order_id:legacy.id,external_ref:'EXISTING-OPS',status:'Requested'},actor);
 await assert.rejects(()=>amendOrder(db,legacy.id,{version:1,reason:'Too late',items:[]},actor),/operations/);
 await request(app).post(`/api/orders/${legacy.id}/amendments`).set('X-Requested-With','sales-ops').send({version:1,reason:'Unauthorized',items:[]}).expect(401);
});

test('request attachments can be renamed and removed only on the matching open order',async()=>{
 const o=await order(),other=await order();
 const file=await upload(admin,o.id,'request','Email').expect(201);
 const path='/api/orders/'+o.id+'/documents/'+file.body.id;
 await admin.patch(path).set('X-Requested-With','sales-ops').send({filename:'Customer request.png'}).expect(204);
 const list=await admin.get('/api/orders/'+o.id+'/documents').expect(200);
 assert.equal(list.body[0].filename,'Customer request.png');
 await admin.delete('/api/orders/'+other.id+'/documents/'+file.body.id).set('X-Requested-With','sales-ops').expect(404);
 await admin.delete(path).set('X-Requested-With','sales-ops').expect(204);
 await admin.get(path).expect(404);
 const history=await orderHistory(db,o.id);
 assert.ok(history.events.some(event=>event.action==='Document renamed'));
 assert.ok(history.events.some(event=>event.action==='Document removed'));
});

test('manual sourcing requires a ready order and allows one record per SKU',async()=>{
 const o=await order('Call','agreed');
 const input={order_id:o.id,status:'Ready',supplier:'Example supplier'};
 await assert.rejects(()=>createRecord(db,'sourcing',input,actor,{manualSourcing:true}),/ready for sourcing/);
 await upload(admin,o.id,'po','Email',pdf,'po.pdf').expect(201);
 await change(o.id,{stage:'PO received',po_ref:'PO-MANUAL',po_channel:'Email',po_received_date:'2026-10-31'});
 await change(o.id,{stage:'Ready for sourcing'});
 const record=await createRecord(db,'sourcing',input,actor,{manualSourcing:true});
 assert.equal((await db.query('SELECT supplier FROM sourcing_links WHERE id=$1',[record.id])).rows[0].supplier,input.supplier);
 await assert.rejects(()=>createRecord(db,'sourcing',input,actor,{manualSourcing:true}),/already recorded/);
});
