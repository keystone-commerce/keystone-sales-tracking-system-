import {randomBytes,randomUUID} from 'node:crypto';
import {hashPassword} from './auth.js';
import {EMAIL_PATTERN} from './otp/config.js';

// Separate from normal releases and legacy/local bootstrap. Never promotes an existing user.
export async function bootstrapInitialAdmin(db,{email,name='Administrator',role='admin'}={}){
 if(typeof email!=='string'||email.length>254||!EMAIL_PATTERN.test(email.trim()))throw Error('Set a valid BOOTSTRAP_EMAIL');
 email=email.trim().toLowerCase();
 if(role!=='admin')throw Error('Initial bootstrap requires BOOTSTRAP_ROLE=admin');
 if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Set a BOOTSTRAP_NAME of 1 to 120 characters');
 const id=randomUUID(),hash=await hashPassword(randomBytes(32).toString('hex'));
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(741030)');
  const adminRole=(await tx.query("SELECT id FROM access_roles WHERE key='admin'")).rows[0];
  if(!adminRole)throw Error('Admin role missing; run migrations before bootstrap');
  const existing=(await tx.query('SELECT id,active,role,is_super_admin FROM users WHERE email=$1',[email])).rows[0];
  if(existing){
   const assigned=(await tx.query('SELECT user_id FROM access_user_roles WHERE user_id=$1 AND role_id=$2',[existing.id,adminRole.id])).rows.length>0;
   if(existing.active&&existing.role==='admin'&&existing.is_super_admin&&assigned)return {status:'already-exists',email};
   throw Error('Account already exists with different access; use Admin access to review it');
  }
  const admins=await tx.query("SELECT id FROM users WHERE is_super_admin=true OR role='admin' OR id IN (SELECT user_id FROM access_user_roles WHERE role_id=$1) LIMIT 1",[adminRole.id]);
  if(admins.rows.length)throw Error('An administrator already exists; add users through Admin access');
  await tx.query('INSERT INTO users(id,email,name,password_hash,role,is_super_admin) VALUES ($1,$2,$3,$4,$5,true)',[id,email,name.trim(),hash,'admin']);
  await tx.query('INSERT INTO access_user_roles(user_id,role_id) VALUES ($1,$2)',[id,adminRole.id]);
  await tx.query("INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,'Initial admin created','auth',$1,$2)",[id,JSON.stringify({method:'one-time-bootstrap',role:'admin'})]);
  return {status:'created',email};
 });
}
