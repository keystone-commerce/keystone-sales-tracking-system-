import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate,one} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createRecord,updateRecord,workspace,orderHistory} from '../src/service.js';
let db,actor,customer;
before(async()=>{db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);await migrate(db);actor=await bootstrap(db,'pricing@example.test','pricing-test-password','Sales');customer=await createRecord(db,'customers',{name:'Pricing test customer'},actor);});
after(async()=>db?.close());
const line=(sku,rate=null)=>({sku,description:sku,qty:10,rate_paise:rate,gst_bps:1800});
const base=()=>({customer_id:customer.id,description:'Kettles',owner:'Sales',target_date:'2027-01-30',ship_to:'Bengaluru',po_ref:'PO-1'});
const row=async id=>one(db,'SELECT * FROM orders WHERE id=$1',[id]);
const lines=async id=>(await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY position',[id])).rows;
async function change(id,fields){const o=await row(id);return updateRecord(db,'orders',id,{stage:o.stage,version:o.version,...fields},actor);}
test('agreed prices confirm directly; missing prices cannot confirm and confirmed prices stay locked',async()=>{
 const o=await createRecord(db,'orders',{...base(),sales_path:'agreed',stage:'Draft',items:[line('A')]},actor);
 const w=await workspace(db);assert.equal(w.orders.find(r=>r.id===o.id).total_paise,null);
 await assert.rejects(()=>change(o.id,{stage:'Confirmed'}),/selling price/);
 const items=await lines(o.id);items[0].rate_paise=100000;
 await change(o.id,{items,stage:'Confirmed'});assert.equal((await row(o.id)).ever_confirmed,true);
 await assert.rejects(()=>change(o.id,{items}),/locked/);
});
test('enquiry pricing quote revision acceptance and concurrency preserve amounts and snapshots',async()=>{
 const o=await createRecord(db,'orders',{...base(),po_ref:'',sales_path:'needs-pricing',stage:'Enquiry',items:[line('B'),line('C',120000)]},actor);
 let w=await workspace(db);assert.equal(w.orders.find(r=>r.id===o.id).subtotal_paise,null);assert.equal(w.order_items.find(r=>r.id===o.item_ids[0]).rate_paise,null);
 await assert.rejects(()=>change(o.id,{stage:'Quoted',quote_ref:'Q-1'}),/selling price/);
 let items=await lines(o.id);items[0].rate_paise=100000;
 await assert.rejects(()=>change(o.id,{items,stage:'Confirmed',po_ref:'PO-2'}),/quotation/);
 assert.equal((await lines(o.id))[0].rate_paise,null);
 await change(o.id,{stage:'Pricing',items,pricing_source_ref:'Manual supplier estimate REF-1'});
 await assert.rejects(()=>change(o.id,{stage:'Quoted'}),/quotation reference/);
 await change(o.id,{stage:'Quoted',quote_ref:'Q-1'});
 assert.equal((await row(o.id)).quote_version,1);
 await assert.rejects(()=>change(o.id,{items}),/locked/);
 await change(o.id,{stage:'Pricing'});items=await lines(o.id);items[0].rate_paise=110000;
 const stale=await row(o.id);await change(o.id,{items,stage:'Quoted',quote_ref:'Q-2'});
 await assert.rejects(()=>updateRecord(db,'orders',o.id,{version:stale.version,stage:'Confirmed',po_ref:'PO-2'},actor),/changed/);
 await assert.rejects(()=>change(o.id,{stage:'Confirmed'}),/confirmation/);
 await change(o.id,{stage:'Confirmed',po_ref:'PO-2'});
 const snapshots=(await db.query('SELECT * FROM order_quotes WHERE order_id=$1 ORDER BY revision',[o.id])).rows;
 assert.equal(snapshots.length,2);assert.equal(snapshots[0].items[0].rate_paise,100000);assert.equal(snapshots[1].items[0].rate_paise,110000);
 w=await workspace(db);assert.equal(Number(w.orders.find(r=>r.id===o.id).total_paise),2714000);
 await assert.rejects(()=>change(o.id,{stage:'Pricing'}),/cannot return/);
});
test('zero, negative, duplicate SKU and cross-order price edits are rejected',async()=>{
 for(const rate of [0,-1])await assert.rejects(()=>createRecord(db,'orders',{...base(),stage:'Enquiry',sales_path:'needs-pricing',items:[line('D',rate)]},actor),/selling rate/);
 const o=await createRecord(db,'orders',{...base(),stage:'Draft',items:[line('E')]},actor);
 const items=await lines(o.id);items[0].qty=11;await assert.rejects(()=>change(o.id,{items}),/Only selling prices/);
 await assert.rejects(()=>createRecord(db,'orders',{...base(),stage:'Enquiry',sales_path:'needs-pricing',items:[line('X'),line('x')]},actor),/only once/);
});


test('request history is isolated and keeps before/after prices and quotation snapshots',async()=>{
 const first=await createRecord(db,'orders',{...base(),sales_path:'needs-pricing',stage:'Enquiry',items:[line('HISTORY')]},actor);
 const other=await createRecord(db,'orders',{...base(),stage:'Draft',items:[line('OTHER',200000)]},actor);
 let items=await lines(first.id);items[0].rate_paise=100000;
 await change(first.id,{items,stage:'Quoted',quote_ref:'HISTORY-Q-1'});
 await assert.rejects(()=>change(first.id,{stage:'Confirmed',po_ref:''}),/confirmation/);
 const history=await orderHistory(db,first.id);
 assert.equal(history.events.length,2);assert.equal(history.quotes.length,1);
 assert.equal(history.events[0].detail.before.items[0].rate_paise,null);
 assert.equal(history.events[0].detail.after.items[0].rate_paise,100000);
 assert.equal(history.events[1].detail.after.stage,'Enquiry');
 assert.equal(history.quotes[0].reference,'HISTORY-Q-1');
 assert.ok(!JSON.stringify(history).includes('OTHER'));
 await db.query("INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,'Updated','orders',$2,$3)",[actor.id,first.id,JSON.stringify({stage:'Pricing',invoiced:99,secret:'do not expose'})]);
 const legacy=(await orderHistory(db,first.id)).events[0].detail;
 assert.deepEqual(legacy.legacy,{stage:'Pricing'});assert.equal(legacy.after,null);
 assert.equal((await orderHistory(db,other.id)).events.length,1);
});
