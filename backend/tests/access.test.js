import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createApp} from '../src/app.js';
import {createRecord} from '../src/service.js';
let db,app,admin,actor,orderId;
const password='Access-Tests-2026!';
const post=(agent,path,body)=>agent.post('/api'+path).set('X-Requested-With','sales-ops').set('Origin','http://localhost:3210').send(body);
const put=(agent,path,body)=>agent.put('/api'+path).set('X-Requested-With','sales-ops').set('Origin','http://localhost:3210').send(body);
before(async()=>{
 db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);await migrate(db);
 actor=await bootstrap(db,'admin@access.test',password,'Platform Admin');
 app=createApp(db,{releaseScope:'full',secret:'access-test-secret-at-least-32-characters',production:false,frontendOrigin:'http://localhost:3210'});
 admin=await login('admin@access.test');
 const c=await createRecord(db,'customers',{name:'Private customer'},actor);
 const o=await createRecord(db,'orders',{customer_id:c.id,description:'Private order',sku:'RBAC-SKU',qty:10,rate_paise:10000,gst_bps:1800,stage:'Confirmed',owner:'Sales',po_ref:'RBAC-PO',ship_to:'Mumbai',target_date:'2027-01-30'},actor);orderId=o.id;
 await createRecord(db,'sourcing',{order_id:o.id,external_ref:'RBAC-PRIVATE-SOURCING',status:'Ready'},actor);
 await createRecord(db,'invoices',{order_id:o.id,number:'RBAC-PRIVATE-INVOICE',qty:2,rate_paise:10000,gst_bps:1800,invoice_date:'2027-01-01',due_date:'2027-01-31'},actor);
});
after(async()=>db?.close());
async function login(email){const agent=request.agent(app);const r=await post(agent,'/auth/login',{email,password});assert.equal(r.status,200,r.body.error);return agent;}
async function newUser(permissions=[],roleIds=[],teamIds=[]){const email=randomUUID()+'@access.test';const response=await post(admin,'/access/users',{name:'Test employee',email,password,permissions,role_ids:roleIds,team_ids:teamIds});assert.equal(response.status,201,response.body.error);return {id:response.body.id,email,agent:await login(email)};}
async function overview(){const response=await admin.get('/api/access');assert.equal(response.status,200,response.body.error);return response.body;}
const assignment=(user,extra={})=>({version:user.access_version,active:user.active,role_ids:user.role_ids,permissions:user.permissions,team_ids:user.team_ids,...extra});

test('read permissions filter backend payloads, monetary summaries and exports',async()=>{
 const user=await newUser(['orders.read']);
 const response=await user.agent.get('/api/workspace');assert.equal(response.status,200);
 assert.equal(response.body.orders.length,1);assert.equal(response.body.orders[0].execution_status,'Ready to dispatch');assert.ok(!JSON.stringify(response.body).includes('RBAC-PRIVATE-SOURCING'));assert.equal(response.body.order_items.length,1);
 for(const key of ['invoices','invoice_items','receipts','customers','dispatches','dispatch_items','audit'])assert.deepEqual(response.body[key],[]);
 assert.equal('invoiced' in response.body.orders[0],false);assert.equal('invoiced' in response.body.order_items[0],false);
 assert.ok(!JSON.stringify(response.body).includes('RBAC-PRIVATE-INVOICE'));
 assert.equal((await user.agent.get('/api/export/orders')).status,403);
 assert.equal((await user.agent.get('/api/access')).status,403);
 assert.equal((await post(user.agent,'/orders',{})).status,403);
 const empty=await newUser();const w=(await empty.agent.get('/api/workspace')).body;assert.ok(Object.values(w).every(rows=>rows.length===0));
});
test('custom roles and direct grants combine; revocations apply to the same active session',async()=>{
 const role=await post(admin,'/access/roles',{name:'Order observer '+randomUUID(),permissions:['orders.read']});assert.equal(role.status,201);
 const user=await newUser(['tasks.read','tasks.create'],[role.body.id]);
 let me=(await user.agent.get('/api/auth/me')).body;assert.ok(me.permissions.includes('orders.read'));assert.ok(me.permissions.includes('tasks.create'));assert.equal(me.is_super_admin,false);
 const task={title:'Follow up',owner:'Employee',due_date:'2027-01-01',priority:'Normal'};
 assert.equal((await post(user.agent,'/tasks',task)).status,201);
 let target=(await overview()).users.find(u=>u.id===user.id);
 assert.equal((await put(admin,'/access/users/'+user.id,assignment(target,{role_ids:[],permissions:[]}))).status,200);
 me=(await user.agent.get('/api/auth/me')).body;assert.deepEqual(me.permissions,[]);
 assert.equal((await post(user.agent,'/tasks',task)).status,403);
 assert.deepEqual((await user.agent.get('/api/workspace')).body.orders,[]);
});
test('team roles and direct grants are inherited and removed immediately',async()=>{
 const role=await post(admin,'/access/roles',{name:'Task operator '+randomUUID(),permissions:['tasks.read','tasks.create']});
 const team=await post(admin,'/access/teams',{name:'Operations '+randomUUID(),role_ids:[role.body.id],permissions:['orders.read'],member_ids:[]});assert.equal(team.status,201,team.body.error);
 const user=await newUser([],[],[team.body.id]);let me=(await user.agent.get('/api/auth/me')).body;
 assert.ok(me.permissions.includes('tasks.create'));assert.ok(me.permissions.includes('orders.read'));assert.equal(me.teams[0].id,team.body.id);
 const t=(await overview()).teams.find(t=>t.id===team.body.id);
 assert.equal((await put(admin,'/access/teams/'+t.id,{version:t.version,name:t.name,role_ids:[],permissions:[],member_ids:[user.id]})).status,200);
 assert.deepEqual((await user.agent.get('/api/auth/me')).body.permissions,[]);
 const target=(await overview()).users.find(u=>u.id===user.id);
 const oldVersion=target.access_version;
 assert.equal((await put(admin,'/access/teams/'+t.id,{version:t.version,name:t.name,role_ids:[],permissions:[],member_ids:[]})).status,409);
 assert.equal((await overview()).users.find(u=>u.id===user.id).access_version,oldVersion);
});
test('delegated managers cannot elevate themselves or grant permissions they do not hold',async()=>{
 const manager=await newUser(['access.users.read','access.manage','orders.read']);
 const catalog=await overview(),adminRole=catalog.roles.find(r=>r.key==='admin');
 assert.equal((await post(manager.agent,'/access/roles',{name:'Escalation',permissions:['invoices.read']})).status,403);
 assert.equal((await post(manager.agent,'/access/users',{name:'Escalated',email:'escalated@access.test',password,role_ids:[adminRole.id],permissions:[],team_ids:[]})).status,403);
 assert.equal((await post(manager.agent,'/access/users',{name:'Escalated',email:'super@access.test',password,role_ids:[],permissions:[],team_ids:[],is_super_admin:true})).status,400);
 const target=catalog.users.find(u=>u.id===manager.id);
 assert.equal((await put(manager.agent,'/access/users/'+manager.id,assignment(target,{permissions:[...target.permissions,'receipts.read']}))).status,403);
 assert.equal((await put(manager.agent,'/access/users/'+manager.id,assignment(target,{permissions:[]}))).status,409);
 const platform=catalog.users.find(u=>u.id===actor.id);
 assert.equal((await put(manager.agent,'/access/users/'+actor.id,assignment(platform))).status,403);
 const ownRole=await post(manager.agent,'/access/roles',{name:'Allowed observer '+randomUUID(),permissions:['orders.read']});assert.equal(ownRole.status,201);
 assert.ok(!(await overview()).users.some(u=>u.email==='escalated@access.test'));
});
test('system roles, stale edits and privileged identity fields are protected',async()=>{
 const catalog=await overview(),system=catalog.roles.find(r=>r.key==='viewer');
 assert.equal((await put(admin,'/access/roles/'+system.id,{version:1,name:'Changed',permissions:[]})).status,400);
 assert.equal((await post(admin,'/access/roles',{name:'Unknown',permissions:['unknown.permission']})).status,400);
 const role=await post(admin,'/access/roles',{name:'Concurrent '+randomUUID(),permissions:['orders.read']});
 const results=await Promise.all([put(admin,'/access/roles/'+role.body.id,{version:1,name:'A '+randomUUID(),permissions:['orders.read']}),put(admin,'/access/roles/'+role.body.id,{version:1,name:'B '+randomUUID(),permissions:['orders.read']})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const user=await newUser(['orders.read']);const row=(await overview()).users.find(u=>u.id===user.id);
 assert.equal((await put(admin,'/access/users/'+row.id,assignment(row,{active:false}))).status,200);
 assert.equal((await user.agent.get('/api/auth/me')).status,401);
 assert.equal((await post(user.agent,'/auth/login',{email:user.email,password})).status,401);
 assert.equal((await put(admin,'/access/users/'+row.id,assignment(row))).status,409);
 const me=(await admin.get('/api/auth/me')).body;assert.equal('password_hash' in me,false);assert.equal('session_id' in me,false);
 const session=(await admin.get('/api/access/session')).body;assert.equal('session_id' in session,false);
 assert.ok((await admin.get('/api/workspace')).body.audit.some(a=>a.entity==='access.users'));
});
test('export permission and write prerequisites are independently enforced',async()=>{
 const user=await newUser(['orders.read','orders.export','dispatches.create','dispatches.read']);
 const exported=await user.agent.get('/api/export/orders');assert.equal(exported.status,200);assert.equal(exported.body.items.length,1);
 assert.equal((await post(user.agent,'/dispatches',{order_id:orderId,qty:1,carrier:'Courier',tracking:'RBAC',dispatch_date:'2027-01-01',expected_date:'2027-01-02'})).status,201);
 assert.equal((await post(user.agent,'/invoices',{})).status,403);
 const noRead=await newUser(['tasks.create']);assert.equal((await post(noRead.agent,'/tasks',{title:'No read',owner:'Employee',due_date:'2027-01-01',priority:'Normal'})).status,403);
});


test('V1 ends before sourcing even for administrators and preserves deferred records',async()=>{
 const limited=createApp(db,{releaseScope:'pre-sourcing',secret:'access-test-secret-at-least-32-characters',production:false,frontendOrigin:'http://localhost:3210'});
 const agent=request.agent(limited);
 assert.equal((await post(agent,'/auth/login',{email:'admin@access.test',password})).status,200);
 const data=(await agent.get('/api/workspace')).body;
 for(const key of ['sourcing','dispatches','dispatch_items','invoices','invoice_items','receipts'])assert.deepEqual(data[key],[]);
 assert.equal(data.orders[0].execution_status,'Confirmed');
 assert.equal('delivered' in data.orders[0],false);
 assert.equal('invoiced' in data.order_items[0],false);
 for(const entity of ['sourcing','dispatches','invoices','receipts']){
  assert.equal((await post(agent,'/'+entity,{})).status,404);
  assert.equal((await agent.get('/api/export/'+entity)).status,404);
 }
 assert.equal((await agent.patch('/api/sourcing/'+randomUUID()).set('X-Requested-With','sales-ops').send({})).status,404);
 const exported=await agent.get('/api/export/orders');assert.equal(exported.status,200);assert.equal('delivered' in exported.body.items[0],false);
 assert.equal((await post(agent,'/customers',{name:'V1 customer'})).status,201);
 assert.equal((await agent.get('/api/integrations')).body.sourcing.mode,'disabled');
 assert.ok((await db.query('SELECT id FROM invoices')).rows.length>0);
});


test('scoped order history requires order read and does not expose unrelated audit records',async()=>{
 const emptyUser=await newUser();assert.equal((await emptyUser.agent.get('/api/orders/'+orderId+'/history')).status,403);
 const reader=await newUser(['orders.read']);assert.equal((await post(reader.agent,'/orders/'+orderId+'/amendments',{version:1,reason:'No update permission',items:[]})).status,403);const r=await reader.agent.get('/api/orders/'+orderId+'/history');assert.equal(r.status,200);
 assert.ok(r.body.events.length>0);assert.ok(!JSON.stringify(r.body).includes('access.users'));
 assert.equal((await reader.agent.get('/api/orders/not-a-uuid/history')).status,400);
 assert.equal((await reader.agent.get('/api/orders/'+randomUUID()+'/history')).status,404);
});
