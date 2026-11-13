import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createRecord,updateRecord,amendOrder} from '../src/service.js';
import {createApp} from '../src/app.js';

let db,app,admin,member,first,second,finance,viewer,actors,customer;
const password='Purchasing-test-password-2026';
const config={releaseScope:'full',secret:'purchasing-session-secret-at-least-32-characters',frontendOrigin:'http://localhost:3210',production:false};
const post=(agent,path,body)=>agent.post('/api'+path).set('X-Requested-With','sales-ops').send(body);
const decision=(agent,row,value)=>post(agent,'/procurement/requests/'+row.id+'/decision',{version:row.version,decision:value,remarks:'Checked supporting references'});
const pdf=Buffer.from('%PDF-1.4\n%%EOF');

before(async()=>{
 db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});
 await migrate(db);await migrate(db);
 actors={};
 for(const [key,role] of [['admin','admin'],['member','member'],['first','viewer'],['second','viewer'],['finance','viewer'],['viewer','viewer']]){
  actors[key]=await bootstrap(db,key+'@procurement.test',password,key,role);
 }
 for(const key of ['first','second','finance']){
  const permissions=['procurement.read',key==='finance'?'procurement.pay':'procurement.approve'];
  for(const permission of permissions)await db.query('INSERT INTO access_user_grants(user_id,permission) VALUES ($1,$2)',[actors[key].id,permission]);
 }
 app=createApp(db,config);
 const agents={};
 for(const key of Object.keys(actors)){
  agents[key]=request.agent(app);
  await post(agents[key],'/auth/login',{email:key+'@procurement.test',password}).expect(200);
 }
 ({admin,member,first,second,finance,viewer}=agents);
 customer=await createRecord(db,'customers',{name:'ABC customer'},actors.admin);
});
after(async()=>db?.close());

async function policy(threshold=5000000){
 const current=(await admin.get('/api/procurement')).body.policy;
 await admin.put('/api/procurement/policy').set('X-Requested-With','sales-ops').send({
  version:current.version,threshold_paise:threshold,primary_approver:actors.first.id,secondary_approver:actors.second.id
 }).expect(200);
}
async function setup(qty=100,issuePurchaseOrder=true){
 const order=await createRecord(db,'orders',{customer_id:customer.id,request_channel:'Call',sales_path:'agreed',stage:'Draft',
  owner:'Sales',target_date:'2027-02-10',ship_to:'ABC Bengaluru',items:[{sku:'HELMET',description:'Helmet',qty,rate_paise:100000,gst_bps:0}]},actors.admin);
 await admin.post('/api/orders/'+order.id+'/documents').set('X-Requested-With','sales-ops')
  .set('Content-Type','application/octet-stream').set('X-File-Name','customer-po.pdf')
  .set('X-Document-Category','po').set('X-Communication-Channel','Email').send(pdf).expect(201);
 await updateRecord(db,'orders',order.id,{version:1,stage:'PO received',po_ref:'ABC-PO',po_channel:'Email',po_received_date:'2027-01-01'},actors.admin);
 await updateRecord(db,'orders',order.id,{version:2,stage:'Ready for sourcing'},actors.admin);
 const supplier=await post(member,'/procurement/suppliers',{name:'XYZ '+randomUUID()}).expect(201);
 const quote=await post(member,'/procurement/quotes',{order_id:order.id,order_item_id:order.item_ids[0],supplier_id:supplier.body.id,
  reference:'QUOTE-'+randomUUID(),qty,rate_paise:70000,gst_bps:0,quote_date:'2027-01-01'}).expect(201);
 if(!issuePurchaseOrder)return {order,quote:quote.body};
 const po=await post(member,'/procurement/purchase-orders',{quote_id:quote.body.id,reference:'PO-'+randomUUID(),qty,
  order_date:'2027-01-01',expected_date:'2027-01-15',selection_reason:'Best accepted quote'}).expect(201);
 return {order,quote:quote.body,po:po.body};
}
async function raise(po,amount=2100000,agent=member){
 return post(agent,'/procurement/requests',{purchase_order_id:po.id,reference:'REQ-'+randomUUID(),amount_paise:amount,
  purpose:'Advance against PI',justification:'30% advance per PI',due_date:'2027-01-02'});
}
async function getRequest(id){
 return (await admin.get('/api/procurement')).body.requests.find(row=>row.id===id);
}
function payment(requestId,amount=2100000){
 return {id:randomUUID(),request_id:requestId,amount_paise:amount,reference:'UTR-'+randomUUID(),mode:'NEFT',payment_date:'2027-01-02'};
}

test('release scopes and permissions protect purchasing routes',async()=>{
 await request(app).get('/api/procurement').expect(401);
 await viewer.get('/api/procurement').expect(403);
 await post(member,'/procurement/payments',{}).expect(403);
 await post(finance,'/procurement/suppliers',{name:'Forbidden'}).expect(403);
 const oldScope=createApp(db,{...config,releaseScope:'manual-sourcing'});
 const oldAgent=request.agent(oldScope);
 await post(oldAgent,'/auth/login',{email:'admin@procurement.test',password}).expect(200);
 await oldAgent.get('/api/procurement').expect(404);
 await oldAgent.get('/api/integrations').expect(res=>assert.equal(res.body.procurement.enabled,false));
});

test('modern customer PO reaches supplier advance, delivery, invoicing, collection and supplier balance',async()=>{
 await policy();
 const {order,po}=await setup();
 const advance=(await raise(po)).body;
 await post(finance,'/procurement/payments',payment(advance.id)).expect(409);
 await decision(first,await getRequest(advance.id),'Approve').expect(200);
 const transfer=payment(advance.id);
 await post(finance,'/procurement/payments',transfer).expect(201);
 await post(finance,'/procurement/payments',transfer).expect(201);
 await post(finance,'/procurement/payments',{...transfer,amount_paise:1}).expect(409);
 const dispatch=await post(admin,'/dispatches',{order_id:order.id,items:[{order_item_id:order.item_ids[0],qty:100}],
  carrier:'Courier',tracking:'TRACK-HELMETS',dispatch_date:'2027-01-03',expected_date:'2027-01-04'}).expect(201);
 await admin.patch('/api/dispatches/'+dispatch.body.id).set('X-Requested-With','sales-ops').send({
  version:1,status:'Delivered',actual_date:'2027-01-04',pod:'POD-100',items:[{order_item_id:order.item_ids[0],delivered_qty:100,returned_qty:0}]
 }).expect(200);
 const invoice=await post(admin,'/invoices',{order_id:order.id,number:'INV-'+randomUUID(),items:[{order_item_id:order.item_ids[0],qty:100}],
  invoice_date:'2027-01-04',due_date:'2027-02-04'}).expect(201);
 await post(admin,'/receipts',{invoice_id:invoice.body.id,amount_paise:10000000,reference:'CUSTOMER-UTR',mode:'NEFT',receipt_date:'2027-01-05'}).expect(201);
 const balance=(await raise(po,4900000)).body;
 await decision(first,await getRequest(balance.id),'Approve').expect(200);
 await post(finance,'/procurement/payments',payment(balance.id,4900000)).expect(201);
 const data=(await admin.get('/api/procurement')).body;
 const saved=data.purchase_orders.find(row=>row.id===po.id);
 assert.equal(Number(saved.paid_paise),7000000);
 assert.equal(Number(saved.reserved_paise),7000000);
 assert.equal(data.payments.filter(row=>row.request_id===advance.id).length,1);
 const workspace=(await admin.get('/api/workspace')).body;
 assert.equal(Number(workspace.invoices.find(row=>row.id===invoice.body.id).outstanding_paise),0);
});

test('large requests require two assigned approvals and stale or unrelated approvals fail',async()=>{
 await policy(1000000);
 const {po}=await setup();
 const raised=await raise(po);assert.equal(raised.status,201);
 const pending=await getRequest(raised.body.id);
 await decision(admin,pending,'Approve').expect(403);
 await decision(first,pending,'Approve').expect(200);
 await decision(first,pending,'Approve').expect(409);
 await post(finance,'/procurement/payments',payment(pending.id)).expect(409);
 const secondStep=await getRequest(pending.id);
 assert.equal(secondStep.approval_step,2);
 await decision(first,secondStep,'Approve').expect(403);
 await decision(second,secondStep,'Approve').expect(200);
 await post(finance,'/procurement/payments',payment(pending.id)).expect(201);
 const self=await raise(po,1000,first);
 assert.equal(self.status,403); // Approvers have no create permission.
 await db.query("INSERT INTO access_user_grants(user_id,permission) VALUES ($1,'procurement.create')",[actors.first.id]);
 await raise(po,1000,first).then(res=>assert.equal(res.status,409));
});

test('concurrent PO allocations, requests and payments cannot exceed their balances',async()=>{
 await policy();
 const {quote,po}=await setup();
 const duplicate=await post(member,'/procurement/purchase-orders',{quote_id:quote.id,reference:'PO-OVER-'+randomUUID(),qty:1,order_date:'2027-01-01',expected_date:'2027-01-15',selection_reason:'Excess'});
 assert.equal(duplicate.status,409);
 const requests=await Promise.all([raise(po,4000000),raise(po,4000000)]);
 assert.deepEqual(requests.map(res=>res.status).sort(),[201,409]);
 const raised=requests.find(res=>res.status===201).body;
 await decision(first,await getRequest(raised.id),'Approve').expect(200);
 const payments=await Promise.all([post(finance,'/procurement/payments',payment(raised.id,3000000)),post(finance,'/procurement/payments',payment(raised.id,3000000))]);
 assert.deepEqual(payments.map(res=>res.status).sort(),[201,409]);
});

test('rejected and cancelled requests release reservations and procurement blocks destructive order changes',async()=>{
 await policy();
 const {order,po}=await setup();
 const raised=(await raise(po,7000000)).body;
 await decision(first,await getRequest(raised.id),'Reject').expect(200);
 const replacement=await raise(po,7000000);assert.equal(replacement.status,201);
 await decision(member,await getRequest(replacement.body.id),'Cancel').expect(200);
 assert.equal((await raise(po,7000000)).status,201);
 await assert.rejects(amendOrder(db,order.id,{version:3,items:[],reason:'Must coordinate purchasing'},actors.admin),/already has sourcing/);
 await assert.rejects(updateRecord(db,'orders',order.id,{version:3,stage:'Cancelled'},actors.admin),/Linked activity/);
});

test('supplier documents are authenticated and upload rollback preserves metadata consistency',async()=>{
 await policy();
 const {po}=await setup();
 const path='/procurement/documents/purchase_orders/'+po.id;
 const upload=agent=>agent.post('/api'+path).set('X-Requested-With','sales-ops').set('Content-Type','application/octet-stream').set('X-File-Name','supplier-po.pdf').send(pdf);
 const doc=await upload(member).expect(201);
 await viewer.get('/api'+path).expect(403);
 await request(app).get('/api'+path+'/'+doc.body.id).expect(401);
 await member.get('/api'+path+'/'+doc.body.id).expect(200).expect('Content-Type',/pdf/);
 const removed=[];
 const failingStore={put:async()=>({storage_backend:'s3',storage_bucket:'test',storage_key:'sales-ops/documents/test',storage_version:'1'}),remove:async doc=>removed.push(doc.storage_version)};
 const failedApp=createApp(db,{...config,documentStore:failingStore});
 const agent=request.agent(failedApp);
 await post(agent,'/auth/login',{email:'member@procurement.test',password}).expect(200);
 await db.query("CREATE FUNCTION fail_procurement_doc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$");
 await db.query('CREATE TRIGGER fail_document BEFORE INSERT ON procurement_documents FOR EACH ROW EXECUTE FUNCTION fail_procurement_doc()');
 await upload(agent).expect(500);
 await db.query('DROP TRIGGER fail_document ON procurement_documents');
 assert.deepEqual(removed,['1']);
 assert.equal((await member.get('/api'+path)).body.length,1);
});


test('competing supplier POs cannot commit more than a sales SKU quantity',async()=>{
 const {quote}=await setup(100,false);
 const input={quote_id:quote.id,qty:60,order_date:'2027-01-01',expected_date:'2027-01-15',selection_reason:'Split allocation'};
 const replies=await Promise.all([
  post(member,'/procurement/purchase-orders',{...input,reference:'PO-A-'+randomUUID()}),
  post(member,'/procurement/purchase-orders',{...input,reference:'PO-B-'+randomUUID()})
 ]);
 assert.deepEqual(replies.map(reply=>reply.status).sort(),[201,409]);
});

test('order holds block new requests and payments, and bank references cannot be reused',async()=>{
 await policy();
 const {order,po}=await setup();
 const raised=(await raise(po)).body;
 await decision(first,await getRequest(raised.id),'Approve').expect(200);
 await updateRecord(db,'orders',order.id,{version:3,stage:'On hold'},actors.admin);
 await post(finance,'/procurement/payments',payment(raised.id)).expect(409);
 assert.equal((await raise(po,1000)).status,409);
 await updateRecord(db,'orders',order.id,{version:4,stage:'PO received'},actors.admin);
 await updateRecord(db,'orders',order.id,{version:5,stage:'Ready for sourcing'},actors.admin);
 const transfer=payment(raised.id,1000000);
 await post(finance,'/procurement/payments',transfer).expect(201);
 await post(finance,'/procurement/payments',{...transfer,id:randomUUID(),reference:transfer.reference.toLowerCase()}).expect(409);
 await post(finance,'/procurement/payments',{...payment(raised.id,1),payment_date:'2020-01-01'}).expect(400);
 await post(finance,'/procurement/payments',payment(raised.id,1100001)).expect(409);
 await post(finance,'/procurement/payments',payment(raised.id,1100000)).expect(201);
});


test('one SKU supports several shared suppliers and quotations with consistent sourcing identities',async()=>{
 const {order,quote}=await setup(100,false);
 const firstSupplier=(await db.query('SELECT supplier_id FROM supplier_quotes WHERE id=$1',[quote.id])).rows[0].supplier_id;
 const secondSupplier=await post(member,'/procurement/suppliers',{
  name:'Alternative supplier '+randomUUID(),phone:'9999999999',email:'supplier@example.test'
 }).expect(201);
 const reference=(supplierId,code)=>post(member,'/sourcing',{
  order_id:order.id,order_item_id:order.item_ids[0],supplier_id:supplierId,
  external_ref:code,status:'Ready',supplier:'Client name override',vendor_email:'override@example.test'
 });
 const first=await reference(firstSupplier,'SRC-A').expect(201);
 const second=await reference(secondSupplier.body.id,'SRC-B').expect(201);
 await reference(firstSupplier,'DUPLICATE-A').expect(409);
 const quoteInput={order_id:order.id,order_item_id:order.item_ids[0],qty:100,rate_paise:70000,gst_bps:0,quote_date:'2027-01-01'};
 await post(member,'/procurement/quotes',{...quoteInput,supplier_id:firstSupplier,sourcing_link_id:first.body.id,reference:'SHARED-A1-'+randomUUID()}).expect(201);
 await post(member,'/procurement/quotes',{...quoteInput,supplier_id:firstSupplier,sourcing_link_id:first.body.id,reference:'SHARED-A2-'+randomUUID(),rate_paise:68000}).expect(201);
 await post(member,'/procurement/quotes',{...quoteInput,supplier_id:secondSupplier.body.id,sourcing_link_id:second.body.id,reference:'SHARED-B1-'+randomUUID(),rate_paise:75000}).expect(201);
 await post(member,'/procurement/quotes',{...quoteInput,supplier_id:firstSupplier,sourcing_link_id:second.body.id,reference:'INVALID-LINK-'+randomUUID()}).expect(404);
 const workspace=(await member.get('/api/workspace')).body;
 const records=workspace.sourcing.filter(row=>row.order_id===order.id);
 assert.equal(records.length,2);
 assert.ok(!records.some(row=>row.supplier==='Client name override'));
 assert.equal(records.find(row=>row.supplier_id===secondSupplier.body.id).vendor_email,'supplier@example.test');
 assert.equal(workspace.orders.find(row=>row.id===order.id).execution_status,'Ready to dispatch');
 const data=(await member.get('/api/procurement')).body;
 assert.equal(data.quotes.filter(row=>row.sourcing_link_id===first.body.id).length,2);
 await member.patch('/api/sourcing/'+first.body.id).set('X-Requested-With','sales-ops')
  .send({version:1,status:'Ready',supplier_id:secondSupplier.body.id}).expect(409);
 const options=await member.get('/api/procurement/suppliers').expect(200);
 assert.ok(options.body.some(row=>row.id===secondSupplier.body.id));
 assert.ok(options.body.every(row=>!Object.hasOwn(row,'account_number')));
 await viewer.get('/api/procurement/suppliers').expect(403);
 const sourcingOptions=await viewer.get('/api/sourcing/suppliers').expect(200);
 assert.ok(sourcingOptions.body.every(row=>!Object.hasOwn(row,'account_number')));
});

test('customer sampling compares suppliers, pays sample costs, records QC evidence and gates bulk confirmation',async()=>{
 await policy();
 await request(app).get('/api/samples').expect(401);
 const order=await createRecord(db,'orders',{customer_id:customer.id,request_channel:'Call',sales_path:'agreed',stage:'Draft',
  owner:'Sales',target_date:'2027-02-10',ship_to:'ABC Bengaluru',items:[{sku:'SAMPLE-HELMET',description:'Helmet',qty:100,rate_paise:100000,gst_bps:0}]},actors.admin);
 const sampleInput={order_id:order.id,order_item_id:order.item_ids[0],qty:2,needed_on:'2027-01-10',sample_type:'Pre-production',
  specifications:'Blue helmet, size M, ABC logo. Bulk quantity 100.'};
 const path='/samples?order_id='+order.id;
 const round=(await post(member,'/samples',sampleInput).expect(201)).body;
 await post(member,'/samples',sampleInput).expect(409);
 const acceptOrder=version=>admin.patch('/api/orders/'+order.id).set('X-Requested-With','sales-ops')
  .send({version,stage:'PO received',po_ref:'ABC-SAMPLE-BULK',po_channel:'Email',po_received_date:'2027-01-08'});
 const blocked=await acceptOrder(2).expect(409);
 assert.match(blocked.body.error,/written customer sample approval/);
 const supplierIds=[];
 for(const name of ['Sample vendor A','Sample vendor B']){
  supplierIds.push((await post(member,'/procurement/suppliers',{name}).expect(201)).body.id);
 }
 const quoteInput={order_id:order.id,order_item_id:order.item_ids[0],sample_round_id:round.id,qty:2,gst_bps:0,quote_date:'2027-01-01'};
 const quote=(await post(member,'/procurement/quotes',{...quoteInput,supplier_id:supplierIds[0],reference:'SAMPLE-A',rate_paise:25000,courier_paise:10000}).expect(201)).body;
 await post(member,'/procurement/quotes',{...quoteInput,supplier_id:supplierIds[1],reference:'SAMPLE-B',rate_paise:0}).expect(201);
 const issuePO=(quoteId,qty,reference)=>post(member,'/procurement/purchase-orders',{quote_id:quoteId,qty,reference,
  order_date:'2027-01-01',expected_date:'2027-01-03',selection_reason:'Meets the customer specification'});
 await issuePO(quote.id,3,'TOO-MANY-SAMPLES').expect(409);
 const po=(await issuePO(quote.id,2,'SAMPLE-PO').expect(201)).body;
 await issuePO(quote.id,1,'DUPLICATE-SAMPLE-PO').expect(409);
 await raise(po,60001).then(res=>assert.equal(res.status,409));
 const advance=(await raise(po,60000)).body;
 await post(finance,'/procurement/payments',payment(advance.id,60000)).expect(409);
 await decision(first,await getRequest(advance.id),'Approve').expect(200);
 await post(finance,'/procurement/payments',payment(advance.id,60000)).expect(201);
 const event=(action,version,day,body={})=>post(member,'/samples/'+round.id+'/events',{action,version,event_date:'2027-01-'+day,...body});
 const document=(category,bytes,filename)=>member.post('/api/samples/'+round.id+'/documents')
  .set('X-Requested-With','sales-ops').set('Content-Type','application/octet-stream')
  .set('X-Document-Category',category).set('X-File-Name',filename).send(bytes);
 await event('Pass QC',2,'03',{notes:'Too early'}).expect(409);
 await event('Receive',2,'03',{qty:2}).expect(200);
 await document('qc',pdf,'not-a-photo.pdf').expect(400);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ZkAAAAASUVORK5CYII=','base64');
 const photo=(await document('qc',png,'qc-helmet.png').expect(201)).body;
 const photoPath='/api/samples/'+round.id+'/documents/'+photo.id;
 await request(app).get(photoPath).expect(401);
 const fetched=await member.get(photoPath).expect('Content-Type',/image\/png/).expect('Content-Disposition',/^inline/).expect(200);
 assert.deepEqual(fetched.body,png);
 await event('Pass QC',3,'03',{notes:'Shell and logo match the confirmed specifications'}).expect(200);
 await event('Issue',4,'04',{qty:2,reference:'CHALLAN-001 / TRACK-001'}).expect(200);
 await event('Accept',5,'05',{notes:'ABC confirmed the logo and fit'}).expect(200);
 await event('Approve',6,'06').expect(409);
 await document('approval',pdf,'abc-written-approval.pdf').expect(201);
 await event('Approve',6,'06').expect(200);
 await event('Return',7,'07',{qty:3,notes:'Too many'}).expect(409);
 await event('Return',7,'07',{qty:1,notes:'One sample returned to Keystone'}).expect(200);
 const saved=(await member.get('/api'+path).expect(200)).body;
 assert.equal(saved.rounds[0].status,'Approved');
 assert.equal(saved.rounds[0].supplier_name,'Sample vendor A');
 assert.equal(saved.events.length,8);
 assert.equal(saved.documents.length,2);
 await admin.post('/api/orders/'+order.id+'/documents').set('X-Requested-With','sales-ops').set('Content-Type','application/octet-stream')
  .set('X-File-Name','abc-bulk-po.pdf').set('X-Document-Category','po').set('X-Communication-Channel','Email').send(pdf).expect(201);
 await acceptOrder(2).expect(200);
 await updateRecord(db,'orders',order.id,{version:3,stage:'Ready for sourcing'},actors.admin);
 const bulk=(await post(member,'/procurement/quotes',{...quoteInput,sample_round_id:null,qty:100,supplier_id:supplierIds[0],reference:'BULK-A',rate_paise:70000}).expect(201)).body;
 await issuePO(bulk.id,100,'BULK-SAMPLE-FLOW-PO').expect(201);
});
