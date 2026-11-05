import {cleanUncommittedObject} from './document-storage.js';
import {randomUUID} from 'node:crypto';
import {Router,raw} from 'express';
import {one} from './db.js';
import {requireValue,text,choice,uuid} from './domain.js';
import {can,requirePermissions} from './access/permissions.js';
export const CHANNELS=['Call','WhatsApp','Email','In person','Other'];
export async function validateEvidenceStage(tx,order,stage){
 const modern=order.request_channel!=='Not recorded';
 if(!modern&&order.order_revision===1&&!['PO received','Ready for sourcing'].includes(stage))return;
 if(['Quoted','PO received','Ready for sourcing','Confirmed'].includes(stage)){
  requireValue(modern||order.order_revision>1,'Record how the customer request was received first');
 }
 if(stage==='Quoted'){
  const revision=order.stage==='Quoted'?order.quote_version:order.quote_version+1;
  const proof=await tx.query("SELECT id FROM order_documents WHERE order_id=$1 AND category='quotation' AND quote_revision=$2 LIMIT 1",[order.id,revision]);
  requireValue(proof.rows.length,'Attach the quotation or shared-message screenshot for this revision before marking it as sent');
 }
 if(['PO received','Ready for sourcing','Confirmed'].includes(stage)){
  requireValue(order.po_channel&&order.po_received_date,'Record how and when the customer PO was received');
  const proof=await tx.query("SELECT id FROM order_documents WHERE order_id=$1 AND category='po' AND channel=$2 AND order_revision=$3 LIMIT 1",[order.id,order.po_channel,order.order_revision]);
  requireValue(proof.rows.length,'Attach the customer PO using the recorded receipt method');
 }
 if(stage==='Ready for sourcing')requireValue(['PO received','Ready for sourcing','Confirmed'].includes(order.stage),'Save the PO received step before marking the request ready for sourcing');
}
export function mimeOf(bytes){
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 if(bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-')return 'application/pdf';
 requireValue(false,'Upload a PNG, JPG, WebP image or PDF document');
}
export function documentRoutes(db,store=null){
 const router=Router();
 router.get('/:id/documents',async(req,res)=>{
  requirePermissions(req.actor,'orders.read');uuid(req.params.id,'Order');await one(db,'SELECT id FROM orders WHERE id=$1',[req.params.id]);
  const {rows}=await db.query('SELECT d.id,d.category,d.channel,d.filename,d.mime_type,d.size_bytes AS size,d.created_at,d.quote_revision,d.order_revision,u.name AS uploaded_by FROM order_documents d JOIN users u ON u.id=d.uploaded_by WHERE d.order_id=$1 ORDER BY d.created_at DESC',[req.params.id]);res.json(rows);
 });
 router.get('/:id/documents/:documentId',async(req,res)=>{
  requirePermissions(req.actor,'orders.read');uuid(req.params.id,'Order');uuid(req.params.documentId,'Document');
  const doc=await one(db,'SELECT filename,mime_type,content,storage_backend,storage_bucket,storage_key,storage_version,size_bytes FROM order_documents WHERE id=$1 AND order_id=$2',[req.params.documentId,req.params.id]);
  let bytes;try{bytes=doc.storage_backend==='s3'?await store?.get(doc):Buffer.from(doc.content);if(!bytes)throw Error('S3 storage is not configured');}catch(error){console.error({event:'document_download_failed',code:error.code||error.name});return res.status(503).json({error:'Document storage is unavailable. Try again.'});}
  const preview=req.query.preview==='1'&&['image/png','image/jpeg','image/webp','application/pdf'].includes(doc.mime_type);
  res.set('Content-Type',doc.mime_type).set('Content-Disposition',`${preview?"inline":"attachment"}; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`).set('Cache-Control','private, no-store').set('X-Content-Type-Options','nosniff');res.send(bytes);
 });
 router.route('/:id/documents/:documentId')
  .patch((req,res)=>changeAttachment(req,res,false))
  .delete((req,res)=>changeAttachment(req,res,true));
 async function changeAttachment(req,res,remove){
  requirePermissions(req.actor,'orders.read','orders.update');
  const orderId=uuid(req.params.id,'Order');
  const documentId=uuid(req.params.documentId,'Document');
  const filename=remove?null:text(req.body?.filename,'Filename',180).replace(/[\\/\x00-\x1f\x7f]/g,'_');
  const document=await db.transaction(async tx=>{
   const order=await one(tx,'SELECT stage,ever_confirmed,order_revision FROM orders WHERE id=$1 FOR UPDATE',[orderId]);
   const doc=await one(tx,"SELECT id,category,channel,filename,order_revision,storage_backend,storage_bucket,storage_key,storage_version FROM order_documents WHERE id=$1 AND order_id=$2 AND category IN ('request','po')",[documentId,orderId]);
   const editable=doc.category==='request'?!order.ever_confirmed:doc.order_revision===order.order_revision;
   const historicalPoRemoval=remove&&doc.category==='po'&&doc.order_revision<order.order_revision;
   const requestRemoval=remove&&doc.category==='request';
   requireValue(historicalPoRemoval||requestRemoval||(editable&&!['Cancelled','PO received','Ready for sourcing','Confirmed'].includes(order.stage)),'Attachment is locked at this stage',409);
   if(remove)await tx.query('DELETE FROM order_documents WHERE id=$1',[documentId]);
   else await tx.query('UPDATE order_documents SET filename=$1 WHERE id=$2',[filename,documentId]);
   await tx.query("INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,$2,'orders',$3,$4)",[req.actor.id,remove?'Document removed':'Document renamed',orderId,JSON.stringify({document:{id:doc.id,category:doc.category,channel:doc.channel,filename:filename??doc.filename}})]);
   return doc;
  });
  if(remove&&document.storage_backend==='s3')await cleanUncommittedObject(db,store,documentId,document);
  res.status(204).end();
 }
 router.post('/:id/documents',raw({type:'application/octet-stream',limit:'5mb'}),async(req,res)=>{
  requirePermissions(req.actor,'orders.read');uuid(req.params.id,'Order');
  const category=choice(req.get('x-document-category'),['request','quotation','po'],'document type');
  const channel=choice(req.get('x-communication-channel'),CHANNELS,'communication method');
  let filename;try{filename=decodeURIComponent(req.get('x-file-name')||'');}catch{requireValue(false,'Invalid filename');}
  filename=text(filename,'Filename',180).replace(/[\\/\x00-\x1f\x7f]/g,'_');
  requireValue(Buffer.isBuffer(req.body)&&req.body.length>0,'Choose a document to upload');const mime=mimeOf(req.body);
  const id=randomUUID();let stored;
  try{await db.transaction(async tx=>{
   const order=await one(tx,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);
   const expectedRevision=req.get('x-order-revision');if(expectedRevision)requireValue(Number(expectedRevision)===order.order_revision,'The order revision changed. Refresh before attaching this document.',409);
   requireValue(can(req.actor,'orders.update')||(category==='request'&&can(req.actor,'orders.create')&&order.created_by===req.actor.id&&!order.ever_confirmed),'You do not have permission to attach documents to this request',403);
   requireValue(order.stage!=='Cancelled','Documents cannot be added to a cancelled request',409);
   const count=await one(tx,'SELECT count(*)::int AS count FROM order_documents WHERE order_id=$1',[order.id]);requireValue(count.count<20,'A request can contain up to 20 documents');
   const revision=category==='quotation'?(order.stage==='Quoted'?order.quote_version:order.quote_version+1):null;
   requireValue(category!=='quotation'||!order.ever_confirmed,'Quotation evidence cannot change after customer acceptance',409);
   if(store){try{stored=await store.put(`sales-ops/documents/${order.id}/${id}`,req.body,mime);}catch(error){console.error({event:'document_upload_failed',code:error.code||error.name});return requireValue(false,'Document storage is unavailable. Try again.',503);}}
   await tx.query('INSERT INTO order_documents(id,order_id,category,channel,filename,mime_type,content,uploaded_by,quote_revision,order_revision,size_bytes,storage_backend,storage_bucket,storage_key,storage_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id,order.id,category,channel,filename,mime,stored?null:req.body,req.actor.id,revision,order.order_revision,req.body.length,stored?'s3':'database',stored?.storage_bucket||null,stored?.storage_key||null,stored?.storage_version||null]);
   await tx.query("INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,'Document attached','orders',$2,$3)",[req.actor.id,order.id,JSON.stringify({document:{id,category,channel,filename,quote_revision:revision,order_revision:order.order_revision}})]);
  });}catch(error){await cleanUncommittedObject(db,store,id,stored);throw error;}res.status(201).json({id});
 });
 return router;
}
