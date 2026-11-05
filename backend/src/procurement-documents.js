import {Router,raw} from 'express';
import {randomUUID} from 'node:crypto';
import {one} from './db.js';
import {mimeOf} from './documents.js';
import {cleanUncommittedObject} from './document-storage.js';
import {can} from './access/permissions.js';
import {requireValue,choice,uuid,text} from './domain.js';
import {audit} from './service.js';

async function linkedRecord(db,entity,id) {
 choice(entity,['purchase_orders','requests','payments'],'document record type');
 uuid(id,'Linked record');
 const queries={
  purchase_orders:'SELECT id AS purchase_order_id FROM purchase_orders WHERE id=$1',
  requests:'SELECT purchase_order_id FROM supplier_payment_requests WHERE id=$1',
  payments:'SELECT r.purchase_order_id FROM supplier_payments p JOIN supplier_payment_requests r ON r.id=p.request_id WHERE p.id=$1'
 };
 return one(db,queries[entity],[id]);
}

export function procurementDocumentRoutes(db,store) {
 const router=Router();
 router.get('/documents/:entity/:id',async(req,res)=>{
  const {entity,id}=req.params;
  await linkedRecord(db,entity,id);
  res.json((await db.query('SELECT id,filename,mime_type,size_bytes,created_at FROM procurement_documents WHERE entity=$1 AND record_id=$2 ORDER BY created_at DESC',[entity,id])).rows);
 });
 router.get('/documents/:entity/:id/:documentId',async(req,res)=>{
  const {entity,id,documentId}=req.params;
  await linkedRecord(db,entity,id);
  const doc=await one(db,'SELECT * FROM procurement_documents WHERE id=$1 AND entity=$2 AND record_id=$3',[uuid(documentId,'Document'),entity,id]);
  let bytes;
  try {
   bytes=doc.storage_backend==='s3'?await store?.get(doc):Buffer.from(doc.content);
   if(!bytes)throw Error('Storage unavailable');
  }catch{
   return res.status(503).json({error:'Document storage is unavailable. Try again.'});
  }
  res.set('Content-Type',doc.mime_type).set('Content-Disposition',"attachment; filename=document; filename*=UTF-8''"+encodeURIComponent(doc.filename))
   .set('X-Content-Type-Options','nosniff').set('Cache-Control','private, no-store').send(bytes);
 });
 router.post('/documents/:entity/:id',raw({type:'application/octet-stream',limit:'5mb'}),async(req,res)=>{
  const {entity,id}=req.params;
  requireValue(can(req.actor,'procurement.create')||can(req.actor,'procurement.pay'),'Supplier document upload permission is required',403);
  let filename;
  try{filename=decodeURIComponent(req.get('x-file-name')||'');}catch{requireValue(false,'Invalid filename');}
  filename=text(filename,'Filename',180).replace(/[\\/\x00-\x1f\x7f]/g,'_');
  requireValue(Buffer.isBuffer(req.body)&&req.body.length>0,'Choose a document to upload');
  const mime=mimeOf(req.body),documentId=randomUUID();
  let stored;
  try {
   await db.transaction(async tx=>{
    const record=await linkedRecord(tx,entity,id);
    await one(tx,'SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE',[record.purchase_order_id]);
    const count=await one(tx,'SELECT count(*)::int AS count FROM procurement_documents WHERE entity=$1 AND record_id=$2',[entity,id]);
    requireValue(count.count<20,'A record can contain up to 20 documents');
    if(store){
     try{stored=await store.put('sales-ops/documents/procurement/'+documentId,req.body,mime);}
     catch{requireValue(false,'Document storage is unavailable. Try again.',503);}
    }
    await tx.query('INSERT INTO procurement_documents(id,purchase_order_id,entity,record_id,filename,mime_type,size_bytes,content,storage_backend,storage_bucket,storage_key,storage_version,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
     [documentId,record.purchase_order_id,entity,id,filename,mime,req.body.length,stored?null:req.body,
      stored?'s3':'database',stored?.storage_bucket||null,stored?.storage_key||null,stored?.storage_version||null,req.actor.id]);
    await audit(tx,req.actor,'Supplier document attached','procurement',id,{document_id:documentId,entity,filename});
   });
  }catch(error){
   await cleanUncommittedObject(db,store,documentId,stored,'procurement_documents');
   throw error;
  }
  res.status(201).json({id:documentId});
 });
 return router;
}
