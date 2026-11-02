import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openDatabase,migrate} from '../src/db.js';
import {bootstrapInitialAdmin} from '../src/bootstrap-admin.js';
import {bootstrap} from '../src/seed.js';
import {effectiveAccess} from '../src/access/resolver.js';
const values={email:'yashraj@keystonecommerce.in',name:'Yashraj',role:'admin'};
async function fixture(run){const db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});try{await migrate(db);await run(db);}finally{await db.close();}}

test('first-admin setup creates active admin access and an audit entry; repeat is unchanged',()=>fixture(async db=>{
 assert.equal((await bootstrapInitialAdmin(db,values)).status,'created');
 const before=(await db.query('SELECT * FROM users WHERE email=$1',[values.email])).rows[0];
 const access=await effectiveAccess(db,before.id);assert.equal(access.active,true);assert.equal(access.is_super_admin,true);assert.ok(access.roles.some(r=>r.key==='admin'));assert.ok(access.permissions.includes('access.manage'));
 assert.equal((await bootstrapInitialAdmin(db,values)).status,'already-exists');assert.deepEqual((await db.query('SELECT * FROM users WHERE id=$1',[before.id])).rows[0],before);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM audit WHERE action='Initial admin created'")).rows[0].n,1);
}));
test('first-admin setup refuses to promote or reactivate an existing account',()=>fixture(async db=>{
 const user=await bootstrap(db,values.email,undefined,'Existing user','viewer');
 await assert.rejects(()=>bootstrapInitialAdmin(db,values),/different access/);
 await db.query("UPDATE users SET role='admin',is_super_admin=true,active=false WHERE id=$1",[user.id]);
 await assert.rejects(()=>bootstrapInitialAdmin(db,values),/different access/);
 assert.equal((await db.query('SELECT active FROM users WHERE id=$1',[user.id])).rows[0].active,false);
}));
test('first-admin setup refuses a second initial admin',()=>fixture(async db=>{
 await bootstrap(db,'existing-admin@example.test',undefined,'Existing admin','admin');await assert.rejects(()=>bootstrapInitialAdmin(db,values),/administrator already exists/);
 assert.equal((await db.query('SELECT id FROM users WHERE email=$1',[values.email])).rows.length,0);
}));
test('concurrent first-admin requests create only one account',()=>fixture(async db=>{
 const results=await Promise.all([bootstrapInitialAdmin(db,values),bootstrapInitialAdmin(db,values)]);assert.deepEqual(results.map(r=>r.status).sort(),['already-exists','created']);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
}));
test('bootstrap validates identity and role and rolls back if audit cannot be written',()=>fixture(async db=>{
 await assert.rejects(()=>bootstrapInitialAdmin(db,{...values,email:'invalid'}),/BOOTSTRAP_EMAIL/);
 await assert.rejects(()=>bootstrapInitialAdmin(db,{...values,role:'viewer'}),/BOOTSTRAP_ROLE/);
 await db.query('DROP TABLE audit');await assert.rejects(()=>bootstrapInitialAdmin(db,values));assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,0);
}));
test('CodeBuild admin job is separate, embeds its buildspec and pins the approved identity',async()=>{
 const root=new URL('../ci/',import.meta.url);const project=JSON.parse(await readFile(new URL('bootstrap-admin-project.example.json',root),'utf8'));const spec=await readFile(new URL('bootstrap-admin-buildspec.yml',root),'utf8');
 assert.equal(project.source.type,'NO_SOURCE');assert.equal(project.source.buildspec,spec);assert.equal(project.concurrentBuildLimit,1);assert.equal(project.environment.privilegedMode,true);
 const env=Object.fromEntries(project.environment.environmentVariables.map(v=>[v.name,v]));assert.equal(env.BOOTSTRAP_EMAIL.value,values.email);assert.equal(env.BOOTSTRAP_ROLE.value,'admin');assert.equal(env.DATABASE_URL.type,'PARAMETER_STORE');
 assert.ok(spec.includes('node src/manage.js bootstrap-admin-once'));assert.ok(spec.includes('EXPECTED_IMAGE_DIGEST'));assert.ok(!spec.includes('node src/manage.js migrate'));assert.ok(!spec.includes('update-service'));
});
