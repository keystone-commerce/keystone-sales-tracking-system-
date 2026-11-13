import {Router,raw} from 'express';
import {randomUUID} from 'node:crypto';
import {one} from './db.js';
import {choice,date,integer,requireValue,text,uuid} from './domain.js';
import {requirePermissions} from './access/permissions.js';
import {mimeOf} from './documents.js';
import {cleanUncommittedObject} from './document-storage.js';

const stages=['Draft','Enquiry','Pricing'];
const retryable=['QC failed','Changes requested','Rejected'];
const issuedStages=['Issued','Customer accepted','Approved','Rejected','Changes requested'];
const categories={qc:['Received'],issue:['QC passed',...issuedStages],approval:['Customer accepted']};
const transitions={
 Receive:['Ordered','Received'], 'Pass QC':['Received','QC passed'], 'Fail QC':['Received','QC failed'],
 Issue:['QC passed','Issued'], Accept:['Issued','Customer accepted'], 'Request changes':['Issued','Changes requested'],
 Reject:['Issued','Rejected'], Approve:['Customer accepted','Approved']
};
const asDate=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);

export function requireSamplingStage(order){
 requireValue(!order.ever_confirmed&&stages.includes(order.stage),'Samples can be requested and sourced while the enquiry is in Draft, Enquiry or Pricing',409);
}

export async function requireApprovedSamples(tx,orderId,stage){
 if(!['Quoted','PO received','Ready for sourcing','Confirmed'].includes(stage))return;
 const pending=await tx.query(`SELECT DISTINCT ON (r.order_item_id) r.status,i.sku
  FROM sample_rounds r JOIN order_items i ON i.id=r.order_item_id
  WHERE r.order_id=$1 ORDER BY r.order_item_id,r.round_number DESC`,[orderId]);
 const blocked=pending.rows.find(row=>row.status!=='Approved');
 requireValue(!blocked,'Record written customer sample approval for '+(blocked?.sku||'the SKU')+' before continuing',409);
}

export async function sampleEvent(tx,roundId,actorId,action,eventDate,qty=null,reference='',notes=''){
 await tx.query('INSERT INTO sample_events(id,round_id,actor_id,action,event_date,qty,reference,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
  [randomUUID(),roundId,actorId,action,eventDate,qty,reference,notes]);
}

async function lockRound(tx,id){
 const key=uuid(id,'Sample round');
 const order=await one(tx,'SELECT o.* FROM orders o JOIN sample_rounds r ON r.order_id=o.id WHERE r.id=$1 FOR UPDATE OF o',[key]);
 requireValue(!['On hold','Cancelled'].includes(order.stage),'Release the enquiry hold before updating samples',409);
 return one(tx,'SELECT * FROM sample_rounds WHERE id=$1 FOR UPDATE',[key]);
}

export function sampleRoutes(db,store){
 const router=Router();
 router.use((req,_res,next)=>{requirePermissions(req.actor,'orders.read');next();});
 router.get('/',async(req,res)=>{
  const orderId=req.query.order_id===undefined?null:uuid(req.query.order_id,'Enquiry');
  res.json(await db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const rows=async sql=>(await tx.query(sql,[orderId])).rows;
   return {
    rounds:await rows(`SELECT r.*,i.sku,i.description,c.name AS customer_name,o.stage AS order_stage,
     p.reference AS po_reference,p.qty AS po_qty,s.name AS supplier_name
     FROM sample_rounds r JOIN order_items i ON i.id=r.order_item_id
     JOIN orders o ON o.id=r.order_id JOIN customers c ON c.id=o.customer_id
     LEFT JOIN purchase_orders p ON p.sample_round_id=r.id LEFT JOIN suppliers s ON s.id=p.supplier_id
     WHERE ($1::uuid IS NULL OR r.order_id=$1) ORDER BY r.created_at DESC`),
    events:await rows(`SELECT e.*,u.name AS actor_name FROM sample_events e JOIN sample_rounds r ON r.id=e.round_id
     JOIN users u ON u.id=e.actor_id WHERE ($1::uuid IS NULL OR r.order_id=$1) ORDER BY e.created_at DESC`),
    documents:await rows(`SELECT d.id,d.round_id,d.category,d.filename,d.mime_type FROM sample_documents d
     JOIN sample_rounds r ON r.id=d.round_id WHERE ($1::uuid IS NULL OR r.order_id=$1) ORDER BY d.created_at DESC`)
   };
  }));
 });
 router.post('/',async(req,res)=>{
  requirePermissions(req.actor,'orders.update');
  const v=req.body||{},id=randomUUID();
  await db.transaction(async tx=>{
   const order=await one(tx,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[uuid(v.order_id,'Enquiry')]);
   requireSamplingStage(order);
   const item=await one(tx,'SELECT id FROM order_items WHERE order_id=$1 AND id=$2',[order.id,uuid(v.order_item_id,'SKU')]);
   const previous=(await tx.query('SELECT status,round_number FROM sample_rounds WHERE order_item_id=$1 ORDER BY round_number DESC LIMIT 1',[item.id])).rows[0];
   requireValue(!previous||retryable.includes(previous.status),'This SKU already has an active or approved sample round',409);
   const qty=integer(v.qty,'Sample quantity'),needed=date(v.needed_on,'Needed by');
   await tx.query('INSERT INTO sample_rounds(id,order_id,order_item_id,round_number,qty,sample_type,specifications,needed_on,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,order.id,item.id,(previous?.round_number||0)+1,qty,text(v.sample_type,'Sample type',160),
     text(v.specifications,'Product specifications',2000),needed,req.actor.id]);
   await tx.query('UPDATE orders SET version=version+1 WHERE id=$1',[order.id]);
   await sampleEvent(tx,id,req.actor.id,'Requested',new Date().toISOString().slice(0,10),qty);
  });
  res.status(201).json({id});
 });
 router.post('/:id/events',async(req,res)=>{
  requirePermissions(req.actor,'orders.update');
  const v=req.body||{};
  const action=choice(v.action,[...Object.keys(transitions),'Return','Replacement'],'sample action');
  await db.transaction(async tx=>{
   const r=await lockRound(tx,req.params.id);
   requireValue(r.version===v.version,'Sample round changed. Refresh and try again.',409);
   const transition=transitions[action];
   requireValue(transition?r.status===transition[0]:issuedStages.includes(r.status),
    'This action is unavailable at the current sample stage',409);
   const eventDate=date(v.event_date,'Event date');
   const po=await one(tx,'SELECT qty,order_date FROM purchase_orders WHERE sample_round_id=$1',[r.id]);
   const history=(await tx.query('SELECT action,qty,event_date FROM sample_events WHERE round_id=$1',[r.id])).rows;
   const lastDate=history.reduce((last,event)=>event.action!=='Requested'&&asDate(event.event_date)>last?asDate(event.event_date):last,asDate(po.order_date));
   requireValue(eventDate>=lastDate,'Event date cannot precede the previous sample activity');
   const received=history.find(e=>e.action==='Receive')?.qty||0;
   const issued=history.find(e=>e.action==='Issue')?.qty||0;
   const returned=history.filter(e=>e.action==='Return').reduce((sum,e)=>sum+e.qty,0);
   const replaced=history.filter(e=>e.action==='Replacement').reduce((sum,e)=>sum+e.qty,0);
   const limit={Receive:po.qty,Issue:received,Return:issued+replaced-returned,Replacement:issued-replaced}[action];
   const qty=limit===undefined?null:integer(v.qty,'Sample quantity');
   requireValue(qty===null||qty<=limit,'Quantity exceeds the remaining samples',409);
   const reference=text(v.reference||'','Challan / tracking / POD reference',200,action!=='Issue');
   const notes=text(v.notes||'','Notes',2000,['Receive','Issue','Accept','Approve'].includes(action));
   if(action==='Approve'){
    const proof=await tx.query("SELECT id FROM sample_documents WHERE round_id=$1 AND category='approval' LIMIT 1",[r.id]);
    requireValue(proof.rows.length,'Upload written customer approval for this round first',409);
   }
   await sampleEvent(tx,r.id,req.actor.id,action,eventDate,qty,reference,notes);
   await tx.query('UPDATE sample_rounds SET status=$2,version=version+1 WHERE id=$1',[r.id,transition?.[1]||r.status]);
  });
  res.json({saved:true});
 });
 router.post('/:id/documents',raw({type:'application/octet-stream',limit:'5mb'}),async(req,res)=>{
  requirePermissions(req.actor,'orders.update');
  const category=choice(req.get('x-document-category'),Object.keys(categories),'document category');
  let filename;
  try{filename=decodeURIComponent(req.get('x-file-name')||'');}catch{requireValue(false,'Invalid filename');}
  filename=text(filename,'Filename',180).replace(/[\\/\x00-\x1f\x7f]/g,'_');
  requireValue(Buffer.isBuffer(req.body)&&req.body.length>0,'Choose a file to upload');
  const mime=mimeOf(req.body),id=randomUUID();
  requireValue(category!=='qc'||mime.startsWith('image/'),'Choose a PNG, JPEG or WebP photo for QC');
  let stored;
  try{
   await db.transaction(async tx=>{
    const r=await lockRound(tx,req.params.id);
    requireValue(categories[category].includes(r.status),'This evidence belongs to a different sample stage',409);
    const count=await one(tx,'SELECT count(*)::int AS count FROM sample_documents WHERE round_id=$1 AND category=$2',[r.id,category]);
    requireValue(count.count<20,'Each evidence category can contain up to 20 files');
    if(store){
     try{stored=await store.put('sales-ops/documents/samples/'+id,req.body,mime);}
     catch{requireValue(false,'Document storage is unavailable. Try again.',503);}
    }
    await tx.query(`INSERT INTO sample_documents(id,round_id,category,filename,mime_type,size_bytes,content,storage_backend,storage_bucket,storage_key,storage_version,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
     [id,r.id,category,filename,mime,req.body.length,stored?null:req.body,stored?.storage_backend||'database',
      stored?.storage_bucket||null,stored?.storage_key||null,stored?.storage_version||null,req.actor.id]);
   });
  }catch(error){await cleanUncommittedObject(db,store,id,stored,'sample_documents');throw error;}
  res.status(201).json({id});
 });
 router.get('/:id/documents/:documentId',async(req,res)=>{
  const doc=await one(db,'SELECT * FROM sample_documents WHERE id=$1 AND round_id=$2',
   [uuid(req.params.documentId,'Document'),uuid(req.params.id,'Sample round')]);
  let bytes;
  try{
   bytes=doc.storage_backend==='s3'?await store?.get(doc):Buffer.from(doc.content);
   if(!bytes)throw Error('Storage unavailable');
  }catch{return res.status(503).json({error:'Document storage is unavailable. Try again.'});}
  const disposition=doc.category==='qc'?'inline':'attachment';
  res.set('Content-Type',doc.mime_type)
   .set('Content-Disposition',disposition+"; filename=document; filename*=UTF-8''"+encodeURIComponent(doc.filename))
   .set('X-Content-Type-Options','nosniff').set('Cache-Control','private, no-store').send(bytes);
 });
 return router;
}
