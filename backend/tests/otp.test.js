import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrap} from '../src/seed.js';
import {createApp} from '../src/app.js';
import {otpConfigFrom} from '../src/otp/config.js';
import {gmailOtpMailer} from '../src/otp/gmail.js';
let db,app,mail=[],now=Date.now(),failDelivery=false;
const secret='separate-otp-test-secret-of-at-least-32-bytes';
const config={secret:'jwt-test-secret-with-at-least-32-characters',production:false,frontendOrigin:'http://localhost:3210',authMode:'otp',otp:{secret,logOnly:false,devFixedCode:'',gmail:{},gmailReady:true},otpTesting:{clock:()=>now,deliver:async value=>{if(failDelivery)throw Error('private provider credentials');mail.push(value);}}};
before(async()=>{db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});await migrate(db);app=createApp(db,config);});
after(async()=>db?.close());beforeEach(()=>{now+=16*60*1000;failDelivery=false;mail=[];});
async function user(){const email=`otp-${randomUUID()}@example.test`;const actor=await bootstrap(db,email,undefined,'OTP employee','viewer');return {...actor,email};}
const post=(agent,path,body)=>agent.post('/api/auth'+path).set('X-Requested-With','sales-ops').set('Origin','http://localhost:3210').send(body);
const send=(email,agent=request(app))=>post(agent,'/otp/send',{email});
const verify=(email,id,code,agent=request(app))=>post(agent,'/otp/verify',{email,challengeId:id,code});
const delivered=email=>mail.filter(m=>m.email===email).at(-1).code;
test('OTP sign-in issues the existing cookie session, enforces RBAC and disables password login',async()=>{
 const u=await user(),agent=request.agent(app);const sent=await send(' '+u.email.toUpperCase()+' ',agent).expect(200);assert.equal(sent.body.expiresIn,300);assert.equal(sent.body.code,undefined);assert.equal(mail.length,1);
 const stored=(await db.query('SELECT * FROM login_otp_challenges WHERE id=$1',[sent.body.challengeId])).rows[0];assert.equal(stored.code_hash.length,64);assert.notEqual(stored.code_hash,delivered(u.email));
 const r=await verify(u.email,sent.body.challengeId,delivered(u.email),agent).expect(200);assert.equal(r.body.email,u.email);assert.equal(r.body.password_hash,undefined);assert.match(r.headers['set-cookie'][0],/HttpOnly/i);
 const me=(await agent.get('/api/auth/me').expect(200)).body;assert.ok(me.permissions.includes('orders.read'));assert.equal(me.permissions.includes('orders.create'),false);
 await agent.post('/api/orders').set('X-Requested-With','sales-ops').send({}).expect(403);
 await post(agent,'/login',{email:u.email,password:'anything'}).expect(404);
 await agent.post('/api/auth/logout').set('X-Requested-With','sales-ops').send({}).expect(204);await agent.get('/api/auth/me').expect(401);
});
test('unknown and disabled accounts get the same public send response without email or signup',async()=>{
 const u=await user();await db.query('UPDATE users SET active=false WHERE id=$1',[u.id]);
 const unknown=await send('unknown@example.test').expect(200),disabled=await send(u.email).expect(200);assert.equal(mail.length,0);for(const key of ['message','expiresIn','resendAfter'])assert.equal(unknown.body[key],disabled.body[key]);
 await verify(u.email,disabled.body.challengeId,'000000').expect(401);assert.equal((await db.query('SELECT id FROM users WHERE email=$1',['unknown@example.test'])).rows.length,0);
});
test('wrong guesses are committed; three attempts lock a challenge even for the correct code',async()=>{
 const u=await user(),s=(await send(u.email).expect(200)).body,code=delivered(u.email),wrong=code==='000000'?'111111':'000000';
 for(let i=0;i<3;i++)await verify(u.email,s.challengeId,wrong).expect(401);
 await verify(u.email,s.challengeId,code).expect(401);const row=(await db.query('SELECT attempts,consumed_at FROM login_otp_challenges WHERE id=$1',[s.challengeId])).rows[0];assert.equal(row.attempts,3);assert.ok(row.consumed_at);
});
test('expired and superseded codes cannot be reused; resend cooldown and quotas are shared in SQL',async()=>{
 const u=await user(),first=(await send(u.email).expect(200)).body,old=delivered(u.email);await send(u.email).expect(429);await send(u.email,request(createApp(db,config))).expect(429);now+=61000;const second=(await send(u.email).expect(200)).body;await verify(u.email,first.challengeId,old).expect(401);
 now+=61000;await send(u.email).expect(200);now+=61000;await send(u.email).expect(429);
 const active=(await db.query('SELECT * FROM login_otp_challenges WHERE email=$1 ORDER BY created_at DESC LIMIT 1',[u.email])).rows[0];now+=300000;await verify(u.email,active.id,delivered(u.email)).expect(401);
});
test('concurrent correct verification creates one session; deactivation before verification blocks access',async()=>{
 const u=await user(),s=(await send(u.email).expect(200)).body,code=delivered(u.email);const results=await Promise.all([verify(u.email,s.challengeId,code),verify(u.email,s.challengeId,code)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal((await db.query('SELECT count(*)::int AS count FROM sessions WHERE user_id=$1',[u.id])).rows[0].count,1);
 const other=await user(),sent=(await send(other.email).expect(200)).body;await db.query('UPDATE users SET active=false WHERE id=$1',[other.id]);await verify(other.email,sent.challengeId,delivered(other.email)).expect(401);
});
test('challenge is bound to email, delivery failures invalidate codes, and malformed requests are rejected',async()=>{
 const a=await user(),b=await user(),s=(await send(a.email).expect(200)).body;await verify(b.email,s.challengeId,delivered(a.email)).expect(401);
 await send('victim@example.test\r\nBcc: attacker@example.test').expect(400);await verify(a.email,'-'.repeat(36),'000000').expect(400);await verify(a.email,s.challengeId,'12').expect(400);
 failDelivery=true;const f=(await send(b.email).expect(200)).body;const row=(await db.query('SELECT * FROM login_otp_challenges WHERE id=$1',[f.challengeId])).rows[0];assert.equal(row.delivery_status,'failed');assert.ok(row.consumed_at);await verify(b.email,f.challengeId,'000000').expect(401);
 const unavailable=createApp(db,{...config,otp:{...config.otp,gmailReady:false},otpTesting:{clock:()=>now}});const r=await send('unknown2@example.test',request(unavailable)).expect(503);assert.ok(!JSON.stringify(r.body).includes('private provider'));
});
test('local OTP shortcuts and password mode are rejected in production',()=>{
 assert.throws(()=>otpConfigFrom({NODE_ENV:'production',AUTH_MODE:'password'}),/must use OTP/);
 assert.throws(()=>otpConfigFrom({NODE_ENV:'production',OTP_LOG_ONLY:'true'}),/production/);
 assert.throws(()=>otpConfigFrom({NODE_ENV:'production',OTP_DEV_FIXED_CODE:'000000'}),/production/);
 assert.throws(()=>otpConfigFrom({OTP_HMAC_SECRET:secret,OTP_DEV_FIXED_CODE:'000000'}),/local log-only/);
 assert.throws(()=>otpConfigFrom({OTP_HMAC_SECRET:secret,OTP_LOG_ONLY:'true'}),/local embedded/);
});
test('Gmail OAuth refresh token and MIME message are sent server-side, with token caching',async()=>{
 const calls=[];const mailer=gmailOtpMailer({clientId:'client',clientSecret:'private-client-secret',refreshToken:'private-refresh-token',senderEmail:'sender@example.test',senderName:'Keystone Sales Ops'},{fetchUrl:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.includes('oauth2')?{access_token:'temporary-access-token',expires_in:3600}:{id:'message'}};}});
 await mailer({email:'employee@example.test',code:'012345'});await mailer({email:'other@example.test',code:'123456'});assert.equal(calls.filter(c=>c.url.includes('oauth2')).length,1);const sent=calls.find(c=>c.url.includes('gmail.googleapis'));assert.equal(sent.options.headers.Authorization,'Bearer temporary-access-token');const mime=Buffer.from(JSON.parse(sent.options.body).raw,'base64url').toString();assert.match(mime,/To: employee@example.test/);assert.ok(!mime.includes('private-refresh-token'));assert.ok(!mime.includes('private-client-secret'));const text=Buffer.from(mime.split('\r\n\r\n')[1].replaceAll('\r\n',''),'base64').toString();assert.match(text,/012345/);
});
