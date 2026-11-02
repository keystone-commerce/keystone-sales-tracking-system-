import {openDatabase,migrate} from './db.js';
import {bootstrap} from './seed.js';
import {bootstrapInitialAdmin} from './bootstrap-admin.js';
const db=await openDatabase();
try{
 if(process.argv[2]==='migrate'){const result=await migrate(db);console.log(result.applied.length?`Applied migrations: ${result.applied.join(', ')}`:'No pending migrations');console.log(`Already applied: ${result.skipped.length}`);}
 else if(process.argv[2]==='bootstrap'){await bootstrap(db,process.env.BOOTSTRAP_EMAIL,process.env.BOOTSTRAP_PASSWORD,process.env.BOOTSTRAP_NAME||'Administrator',process.env.BOOTSTRAP_ROLE||'admin');console.log('User created');}
 else if(process.argv[2]==='bootstrap-admin-once'){
  if(process.env.NODE_ENV!=='production'||db.embedded)throw Error('bootstrap-admin-once requires production PostgreSQL');
  const result=await bootstrapInitialAdmin(db,{email:process.env.BOOTSTRAP_EMAIL,name:process.env.BOOTSTRAP_NAME||'Administrator',role:process.env.BOOTSTRAP_ROLE||'admin'});
  console.log(result.status==='created'?'Initial admin created':'Initial admin already exists; no changes made');
 }
 else throw Error('Use migrate, bootstrap or bootstrap-admin-once');
}finally{await db.close();}
