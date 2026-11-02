import {randomUUID,randomBytes} from 'node:crypto';
import {hashPassword} from './auth.js';
import {createRecord} from './service.js';
export async function bootstrap(db,email,password,name='Administrator',role='admin') {
 if(!email || password&&password.length<12)throw Error('Provide BOOTSTRAP_EMAIL and an optional BOOTSTRAP_PASSWORD of 12+ characters');
 password=password||randomBytes(32).toString('hex');
 const id=randomUUID(),hash=await hashPassword(password);
 await db.transaction(async tx=>{
  const modern=(await tx.query("SELECT to_regclass('public.access_roles') AS present")).rows[0].present;
  if(modern){
   await tx.query('INSERT INTO users(id,email,name,password_hash,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,$6)',[id,email.trim().toLowerCase(),name,hash,role,role==='admin']);
   await tx.query('INSERT INTO access_user_roles(user_id,role_id) SELECT $1,id FROM access_roles WHERE key=$2',[id,role]);
  }else await tx.query('INSERT INTO users(id,email,name,password_hash,role) VALUES ($1,$2,$3,$4,$5)',[id,email.trim().toLowerCase(),name,hash,role]);
 });
 return {id,name,role};
}
export async function seedDevelopment(db) {
 const existing=await db.query('SELECT id FROM users LIMIT 1');if(existing.rows.length)return;
 const actor=await bootstrap(db,'admin@keystone.local','SalesOps-local-2026!','Development Admin');
 const customer=await createRecord(db,'customers',{name:'ABC Hotels · sample',email:'purchasing@example.com',address:'Business Park, Bengaluru',terms:30},actor);
 const dt=(days)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
 const order=await createRecord(db,'orders',{customer_id:customer.id,description:'Electric kettles · 1.5 L stainless steel',sku:'KTL-1500',qty:100,rate_paise:100000,gst_bps:1800,stage:'Confirmed',po_ref:'SAMPLE-PO-001',owner:'Sales team',target_date:dt(7),ship_to:'ABC Hotels, Business Park, Bengaluru'},actor);
 await createRecord(db,'sourcing',{order_id:order.id,external_ref:'SAMPLE-SRC-001',status:'In progress',supplier:'Supplier A · sample',eta:dt(3),notes:'Sample reference only; connect the existing sourcing application.'},actor);
 await createRecord(db,'dispatches',{order_id:order.id,qty:60,carrier:'Sample transporter',tracking:'SAMPLE-TRACK-001',dispatch_date:dt(-1),expected_date:dt(2)},actor);
 const invoice=await createRecord(db,'invoices',{order_id:order.id,number:'SAMPLE-INV-001',qty:60,rate_paise:100000,gst_bps:1800,invoice_date:dt(-1),due_date:dt(29)},actor);
 await createRecord(db,'receipts',{invoice_id:invoice.id,amount_paise:3000000,reference:'SAMPLE-UTR-001',mode:'NEFT',receipt_date:dt(0)},actor);
 await createRecord(db,'tasks',{order_id:order.id,title:'Confirm supplier readiness for remaining 40 kettles',owner:'Sales team',due_date:dt(0),priority:'High'},actor);
}
