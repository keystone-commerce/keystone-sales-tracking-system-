import {sampleRoutes} from './samples.js';
import {procurementRoutes,supplierOptions} from './procurement.js';
import {gmailMailer} from './otp/gmail.js';
import {otpRoutes} from './otp/routes.js';
import express from 'express';
import {createDocumentStore} from './document-storage.js';
import {documentRoutes} from './documents.js';
import helmet from 'helmet';
import {HttpError,requireValue} from './domain.js';
import {REGISTERS,requirePermissions} from './access/permissions.js';
import {accessRoutes} from './access/routes.js';
import {authTools,verifyPassword,hashPassword} from './auth.js';
import {createRecord,updateRecord,workspace,orderHistory,amendOrder} from './service.js';
export function createApp(db,config) {
 const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
 app.set('json replacer',(_k,v)=>typeof v==='bigint'?Number(v):v);
 app.use(helmet());app.use(express.json({limit:'64kb'}));
 const sendFollowUp=config.otp?.gmailReady?gmailMailer(config.otp.gmail):null;
 const auth=authTools(db,config);
 const deferred=new Set(['sourcing','dispatches','invoices','receipts']);
 const v1=config.releaseScope!=='full';
 const manualSourcing=config.releaseScope==='manual-sourcing';
 if(manualSourcing)deferred.delete('sourcing');
 const releaseWorkspace=async actor=>{
  const data=await workspace(db,actor);
  if(v1){
   for(const key of [...deferred,'dispatch_items','invoice_items'])data[key]=[];
   for(const key of ['orders','order_items'])data[key]=data[key].map(({dispatched,delivered,invoiced,execution_status,...row})=>key==='orders'?{...row,execution_status:row.stage}:row);
   data.audit=data.audit.filter(row=>!deferred.has(row.entity));
  }
  return data;
 };
 const requireReleased=entity=>requireValue(!v1||!deferred.has(entity),'This module is not available in V1',404);
 app.get('/healthz',(_req,res)=>res.json({status:'ok'}));
 app.get('/readyz',async(_req,res)=>{try{await db.query('SELECT 1 FROM schema_migrations LIMIT 1');res.json({status:'ready'});}catch{res.status(503).json({error:'Database not ready'});}});
 app.use('/api',(req,_res,next)=>{
  _res.set('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   if(req.get('x-requested-with')!=='sales-ops')return next(new HttpError(403,'Missing request protection header'));
   const origin=req.get('origin');if(origin && origin!==config.frontendOrigin)return next(new HttpError(403,'Untrusted request origin'));
  }next();
 });
 app.use('/api/auth',otpRoutes(db,config,auth));
 const attempts=new Map();
 const dummyHash=hashPassword('unused-constant-time-password');
 app.post('/api/auth/login',async(req,res)=>{
  if(config.authMode==='otp')return res.status(404).json({error:'Use email code sign-in'});
  const now=Date.now(),ip=req.ip||'unknown';
  for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
  const count=attempts.get(ip)||{count:0,until:now+15*60_000};
  requireValue(count.count<10,'Too many login attempts. Try again in 15 minutes.',429);
  count.count++;attempts.set(ip,count);
  const {email,password}=req.body||{};
  requireValue(typeof email==='string'&&email.length<=254&&typeof password==='string'&&password.length<=256,'Email and password are required');
  const {rows}=await db.query('SELECT * FROM users WHERE email=$1 AND active=true',[email.trim().toLowerCase()]);
  const user=rows[0];const valid=await verifyPassword(password,user?.password_hash||await dummyHash);
  requireValue(user&&valid,'Email or password is incorrect',401);
  await auth.login(res,user);attempts.delete(ip);res.json({id:user.id,name:user.name,email:user.email,role:user.role});
 });
 app.use('/api',auth.authenticate);
 app.get('/api/auth/me',(req,res)=>res.json({...req.actor,session_id:undefined}));
 app.post('/api/auth/logout',async(req,res)=>{await auth.logout(req,res);res.status(204).end();});
 app.use('/api/access',accessRoutes(db));
 app.use('/api/samples',(req,_res,next)=>{
  requireValue(config.releaseScope==='full','Customer samples are not enabled in this release',404);
  next();
 },sampleRoutes(db,config.documentStore||createDocumentStore(config)));
 app.use('/api/procurement',(req,_res,next)=>{
  requireValue(config.releaseScope==='full','Supplier purchasing is not enabled in this release',404);
  next();
 },procurementRoutes(db,config.documentStore||createDocumentStore(config)));
 app.get('/api/sourcing/suppliers',async(req,res)=>{
  requirePermissions(req.actor,'sourcing.read');
  requireValue(config.releaseScope==='full','Shared suppliers are not enabled in this release',404);
  res.json(await supplierOptions(db));
 });
 app.use('/api/orders',documentRoutes(db,config.documentStore||createDocumentStore(config)));
 app.get('/api/task-assignees',async(req,res)=>{
  requirePermissions(req.actor,'tasks.read','tasks.create');
  const {rows}=await db.query('SELECT id,name,email FROM users WHERE active=true ORDER BY name,email');
  res.json(rows);
 });
 app.get('/api/workspace',async(req,res)=>res.json(await releaseWorkspace(req.actor)));
 app.post('/api/orders/:id/amendments',async(req,res)=>{requirePermissions(req.actor,'orders.read','orders.update');res.status(201).json(await amendOrder(db,req.params.id,req.body,req.actor));});
 app.get('/api/orders/:id/history',async(req,res)=>{requirePermissions(req.actor,'orders.read');res.json(await orderHistory(db,req.params.id));});
 app.get('/api/export/:entity',async(req,res)=>{
  const {entity}=req.params;requireValue(REGISTERS.includes(entity),'Unknown register',404);requireReleased(entity);
  requirePermissions(req.actor,entity+'.read',entity+'.export');
  const data=await releaseWorkspace(req.actor),lineKey={orders:'order_items',invoices:'invoice_items',dispatches:'dispatch_items'}[entity];
  res.json({rows:data[entity],items:lineKey?data[lineKey]:[]});
 });
 app.get('/api/integrations',(_req,res)=>res.json({releaseScope:config.releaseScope||'pre-sourcing',procurement:{enabled:config.releaseScope==='full'},sourcing:{mode:v1&&!manualSourcing?'disabled':'manual-reference',portalUrl:config.sourcingUrl||null,apiConnected:false},delivery:{mode:v1?'disabled':'manual'},payments:{mode:v1?'disabled':'manual-verified-receipt'},environment:config.production?'production':'local development'}));
 app.post('/api/:entity',async(req,res)=>{
  const {entity}=req.params;requireValue(REGISTERS.includes(entity),'Unknown register',404);requireReleased(entity);
  requirePermissions(req.actor,entity+'.read',entity+'.create');
  if(['sourcing','dispatches','invoices'].includes(entity)||entity==='tasks'&&req.body?.order_id)requirePermissions(req.actor,'orders.read');
  if(entity==='orders')requirePermissions(req.actor,'customers.read');
  if(entity==='receipts')requirePermissions(req.actor,'invoices.read');
  requireValue(req.body && typeof req.body==='object'&&!Array.isArray(req.body),'Record data is required');
  const {notification,...saved}=await createRecord(db,entity,req.body,req.actor,{manualSourcing});
  if(!notification)return res.status(201).json(saved);
  let emailStatus='unavailable';
  if(sendFollowUp){
   try{
    await sendFollowUp({
     email:notification.email,subject:'New Keystone Sales Operating System follow-up',
     text:`You have a new follow-up in Keystone Sales Operating System.\n\n${notification.title}\nDue: ${notification.dueDate}\n\n${config.frontendOrigin}`
    });
    emailStatus='sent';
   }catch{
    emailStatus='failed';
    console.error({event:'follow_up_email_failed',taskId:saved.id});
   }
  }
  res.status(201).json({...saved,emailStatus});
 });
 app.patch('/api/:entity/:id',async(req,res)=>{
  const {entity,id}=req.params;requireValue(['orders','dispatches','tasks','sourcing'].includes(entity),'This register does not support updates',404);
  requireReleased(entity);
  requirePermissions(req.actor,entity+'.read',entity+'.update');
  requireValue(req.body && typeof req.body==='object'&&!Array.isArray(req.body),'Record data is required');
  res.json(await updateRecord(db,entity,id,req.body,req.actor));
 });
 app.use((_req,_res,next)=>next(new HttpError(404,'Endpoint not found')));
 app.use((error,_req,res,_next)=>{
  const conflict=['23505','23503','23514','22P02'].includes(error.code);
  const status=error.status|| (conflict?409:500);
  if(error.retryAfter)res.set('Retry-After',String(error.retryAfter));
  if(status===500)console.error({event:'request_failed',code:error.code,message:error.message});
  res.status(status).json({error:status===500?'An unexpected server error occurred':conflict?'Duplicate or invalid linked record. Check the references and try again.':error.message});
 });
 return app;
}
