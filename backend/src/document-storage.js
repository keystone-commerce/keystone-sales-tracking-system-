import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {HttpError} from './domain.js';
export class S3DocumentStore {
 constructor({s3Bucket,s3Region},client){this.kind='s3';this.bucket=s3Bucket;this.client=client||new S3Client({region:s3Region,maxAttempts:2});}
 async put(key,bytes,mime){
  const response=await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,ContentLength:bytes.length,ContentType:mime}),{abortSignal:AbortSignal.timeout(20000)});
  return {storage_backend:'s3',storage_bucket:this.bucket,storage_key:key,storage_version:response.VersionId||null};
 }
 async get(doc){
  if(doc.storage_bucket!==this.bucket||!doc.storage_key?.startsWith('sales-ops/documents/'))throw new HttpError(503,'Document storage is not configured for this file');
  const response=await this.client.send(new GetObjectCommand({Bucket:doc.storage_bucket,Key:doc.storage_key,...(doc.storage_version?{VersionId:doc.storage_version}:{})}),{abortSignal:AbortSignal.timeout(20000)});
  const body=Buffer.from(await response.Body.transformToByteArray());
  if(body.length!==Number(doc.size_bytes))throw new HttpError(503,'Document integrity check failed. Contact an administrator.');
  return body;
 }
 async remove(doc){
  await this.client.send(new DeleteObjectCommand({Bucket:doc.storage_bucket,Key:doc.storage_key,...(doc.storage_version?{VersionId:doc.storage_version}:{})}),{abortSignal:AbortSignal.timeout(20000)});
 }
}
export function createDocumentStore(config){return config.documentStorage==='s3'?new S3DocumentStore(config):null;}
export async function cleanUncommittedObject(db,store,id,stored){
 if(!stored)return;
 try{
  // A failed COMMIT acknowledgement does not prove the metadata was rolled back.
  const existing=await db.query('SELECT id FROM order_documents WHERE id=$1',[id]);
  if(!existing.rows.length)await store.remove(stored);
 }catch(error){console.error({event:'document_cleanup_required',documentId:id,code:error.code||error.name});}
}
