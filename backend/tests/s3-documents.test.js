import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createRecord} from '../src/service.js';
import {createApp} from '../src/app.js';
import {S3DocumentStore} from '../src/document-storage.js';
import {documentConfigFrom} from '../src/config.js';
let db,actor,customer,app,admin,store,client,legacyApp;
const config={secret:'s3-test-secret-at-least-32-characters',frontendOrigin:'http://localhost:3210',production:false};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC1lEQVR42mP8/x8AAwMCAO+aKz0AAAAASUVORK5CYII=','base64');
class FakeS3{
 objects=new Map();calls=[];failPut=false;failGet=false;
 async send(command){const type=command.constructor.name,input=command.input;this.calls.push({type,input});if(type==='PutObjectCommand'){if(this.failPut)throw Error('sensitive upload failure');this.objects.set(input.Key,Buffer.from(input.Body));return {VersionId:'saved-version'};}if(type==='GetObjectCommand'){if(this.failGet)throw Error('sensitive missing object');const bytes=this.objects.get(input.Key);return {Body:{transformToByteArray:async()=>bytes}};}if(type==='DeleteObjectCommand'){this.objects.delete(input.Key);return {};}}
}
before(async()=>{db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);await migrate(db);actor=await bootstrap(db,'s3@example.test','S3-Tests-2026!','S3 Admin');customer=await createRecord(db,'customers',{name:'S3 Hotel'},actor);client=new FakeS3();store=new S3DocumentStore({s3Bucket:'private-sales-ops',s3Region:'ap-south-1'},client);app=createApp(db,{...config,documentStore:store});admin=await login(app);legacyApp=createApp(db,config);});
after(async()=>db?.close());
async function login(target){const agent=request.agent(target);await agent.post('/api/auth/login').set('X-Requested-With','sales-ops').send({email:'s3@example.test',password:'S3-Tests-2026!'}).expect(200);return agent;}
async function order(){return createRecord(db,'orders',{customer_id:customer.id,stage:'Enquiry',sales_path:'needs-pricing',request_channel:'Email',owner:'Sales',target_date:'2027-01-30',items:[{sku:'KTL',description:'Kettle',qty:1,rate_paise:null,gst_bps:1800}]},actor);}
const upload=(agent,id)=>agent.post(`/api/orders/${id}/documents`).set('X-Requested-With','sales-ops').set('Content-Type','application/octet-stream').set('X-Document-Category','request').set('X-Communication-Channel','Email').set('X-File-Name','request.png').send(png);
test('S3 stores private file bytes; SQL stores metadata/version, and downloads stay authenticated',async()=>{
 const o=await order();const r=await upload(admin,o.id).expect(201);const doc=(await db.query('SELECT * FROM order_documents WHERE id=$1',[r.body.id])).rows[0];assert.equal(doc.content,null);assert.equal(doc.storage_backend,'s3');assert.equal(doc.storage_bucket,'private-sales-ops');assert.equal(doc.storage_version,'saved-version');assert.equal(doc.size_bytes,png.length);assert.equal(client.objects.get(doc.storage_key).compare(png),0);
 const put=client.calls.find(c=>c.input.Key===doc.storage_key&&c.type==='PutObjectCommand');assert.equal(put.input.ACL,undefined);assert.equal(put.input.ContentType,'image/png');
 const list=await admin.get(`/api/orders/${o.id}/documents`).expect(200);assert.equal(list.body[0].size,png.length);assert.equal(list.body[0].storage_key,undefined);
 const downloaded=await admin.get(`/api/orders/${o.id}/documents/${doc.id}`).expect(200);assert.equal(downloaded.body.compare(png),0);assert.match(downloaded.headers['content-disposition'],/^attachment/);
 assert.equal(client.calls.at(-1).input.VersionId,'saved-version');const before=client.calls.length;await request(app).get(`/api/orders/${o.id}/documents/${doc.id}`).expect(401);assert.equal(client.calls.length,before);
});
test('existing database documents remain readable with S3 enabled',async()=>{
 const o=await order(),legacy=await login(legacyApp);const r=await upload(legacy,o.id).expect(201);const before=client.calls.length;const file=await admin.get(`/api/orders/${o.id}/documents/${r.body.id}`).expect(200);assert.equal(file.body.compare(png),0);assert.equal(client.calls.length,before);
});
test('storage failure creates no document or audit; download failures return a safe retry error',async()=>{
 const o=await order();client.failPut=true;const failed=await upload(admin,o.id).expect(503);assert.match(failed.body.error,/storage is unavailable/);assert.equal((await db.query('SELECT count(*)::int AS count FROM order_documents WHERE order_id=$1',[o.id])).rows[0].count,0);assert.equal((await db.query("SELECT count(*)::int AS count FROM audit WHERE record_id=$1 AND action='Document attached'",[o.id])).rows[0].count,0);client.failPut=false;
 const r=await upload(admin,o.id).expect(201);client.failGet=true;const download=await admin.get(`/api/orders/${o.id}/documents/${r.body.id}`).expect(503);assert.equal(JSON.stringify(download.body).includes('sensitive'),false);client.failGet=false;
});
test('metadata rollback removes the exact uploaded object version',async()=>{
 const o=await order();const failingDb={...db,transaction:fn=>db.transaction(tx=>fn({...tx,query:(sql,args)=>{if(sql.startsWith('INSERT INTO audit(')&&args?.[1]===o.id)throw Error('force rollback');return tx.query(sql,args);}}))};
 const failingApp=createApp(failingDb,{...config,documentStore:store}),agent=await login(failingApp);await upload(agent,o.id).expect(500);const removed=client.calls.at(-1);assert.equal(removed.type,'DeleteObjectCommand');assert.equal(removed.input.VersionId,'saved-version');assert.equal(client.objects.has(removed.input.Key),false);assert.equal((await db.query('SELECT count(*)::int AS count FROM order_documents WHERE order_id=$1',[o.id])).rows[0].count,0);
});
test('production requires bucket/region and does not silently store new files in SQL',()=>{
 assert.equal(documentConfigFrom({}).documentStorage,'database');assert.throws(()=>documentConfigFrom({NODE_ENV:'production'}),/S3_DOCUMENT_BUCKET/);assert.throws(()=>documentConfigFrom({NODE_ENV:'production',DOCUMENT_STORAGE:'database'}),/must use S3/);assert.deepEqual(documentConfigFrom({NODE_ENV:'production',S3_DOCUMENT_BUCKET:'private-sales-ops',AWS_REGION:'ap-south-1'}),{documentStorage:'s3',s3Bucket:'private-sales-ops',s3Region:'ap-south-1'});
});
