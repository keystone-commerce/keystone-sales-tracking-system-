import {randomUUID,randomBytes} from 'node:crypto';
import {hashPassword} from '../auth.js';
import {one} from '../db.js';
import {requireValue,text,uuid} from '../domain.js';
import {audit} from '../service.js';
import {effectiveAccess} from './resolver.js';
import {PERMISSIONS,PERMISSION_KEYS,can,requirePermissions} from './permissions.js';

function onlyKeys(value,keys){requireValue(value&&typeof value==='object'&&!Array.isArray(value),'Access data is required');requireValue(Object.keys(value).every(k=>keys.includes(k)),'Unsupported access field');}
function strings(value,label,validate=x=>x){requireValue(Array.isArray(value)&&value.length<=200&&value.every(v=>typeof v==='string'),`${label} must be a list`);return [...new Set(value.map(validate))];}
function permissions(value){return strings(value,'Permissions',key=>{requireValue(PERMISSION_KEYS.has(key),'Unknown permission: '+key);return key;});}
async function assignedPermissions(tx,roleIds,teamIds=[]) {
 if(roleIds.length){const roles=await tx.query('SELECT id FROM access_roles WHERE id=ANY($1::uuid[])',[roleIds]);requireValue(roles.rows.length===roleIds.length,'Unknown role');}
 if(teamIds.length){const teams=await tx.query('SELECT id FROM access_teams WHERE id=ANY($1::uuid[])',[teamIds]);requireValue(teams.rows.length===teamIds.length,'Unknown team');}
 return (await tx.query(`SELECT permission FROM access_role_permissions WHERE role_id=ANY($1::uuid[]) UNION
  SELECT rp.permission FROM access_role_permissions rp JOIN access_team_roles tr ON tr.role_id=rp.role_id WHERE tr.team_id=ANY($2::uuid[]) UNION
  SELECT permission FROM access_team_grants WHERE team_id=ANY($2::uuid[])`,[roleIds,teamIds])).rows.map(r=>r.permission);
}
function grantable(actor,keys){for(const key of keys)requireValue(can(actor,key),'You cannot grant permission you do not have: '+key,403);}
async function assignments(tx,actor,v,allowTeams=false){
 const roleIds=strings(v.role_ids,'Roles',id=>uuid(id,'Role')),grants=permissions(v.permissions);
 const teamIds=allowTeams?strings(v.team_ids,'Teams',id=>uuid(id,'Team')):[];
 const inherited=await assignedPermissions(tx,roleIds,teamIds);grantable(actor,[...inherited,...grants]);
 return {roleIds,grants,teamIds,effective:[...new Set([...inherited,...grants])]};
}
async function replaceAssignments(tx,kind,id,access){
 const user=kind==='user',roles=user?'access_user_roles':'access_team_roles',grants=user?'access_user_grants':'access_team_grants',column=user?'user_id':'team_id';
 await tx.query(`DELETE FROM ${roles} WHERE ${column}=$1`,[id]);await tx.query(`DELETE FROM ${grants} WHERE ${column}=$1`,[id]);
 for(const role of access.roleIds)await tx.query(`INSERT INTO ${roles}(${column},role_id) VALUES ($1,$2)`,[id,role]);
 for(const permission of access.grants)await tx.query(`INSERT INTO ${grants}(${column},permission) VALUES ($1,$2)`,[id,permission]);
 if(user){const old=(await tx.query('SELECT team_id FROM access_team_members WHERE user_id=$1',[id])).rows.map(r=>r.team_id);await tx.query('DELETE FROM access_team_members WHERE user_id=$1',[id]);for(const team of access.teamIds)await tx.query('INSERT INTO access_team_members(team_id,user_id) VALUES ($1,$2)',[team,id]);const changed=[...new Set([...old,...access.teamIds])].filter(team=>old.includes(team)!==access.teamIds.includes(team));if(changed.length)await tx.query('UPDATE access_teams SET version=version+1 WHERE id=ANY($1::uuid[])',[changed]);}
}
export async function accessOverview(db){
 return db.transaction(async tx=>{
  await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const roles=(await tx.query('SELECT * FROM access_roles ORDER BY is_system DESC,name')).rows;
  const rolePermissions=(await tx.query('SELECT * FROM access_role_permissions ORDER BY permission')).rows;
  const userRoles=(await tx.query('SELECT * FROM access_user_roles')).rows,userGrants=(await tx.query('SELECT * FROM access_user_grants')).rows;
  const teamRoles=(await tx.query('SELECT * FROM access_team_roles')).rows,teamGrants=(await tx.query('SELECT * FROM access_team_grants')).rows,members=(await tx.query('SELECT * FROM access_team_members')).rows;
  const users=(await tx.query('SELECT id,name,email,role,active,is_super_admin,access_version FROM users ORDER BY name')).rows;
  const teams=(await tx.query('SELECT * FROM access_teams ORDER BY name')).rows;
  return {permissions:PERMISSIONS,roles:roles.map(r=>({...r,permissions:rolePermissions.filter(p=>p.role_id===r.id).map(p=>p.permission)})),
   users:await Promise.all(users.map(async u=>({...u,role_ids:userRoles.filter(r=>r.user_id===u.id).map(r=>r.role_id),permissions:userGrants.filter(p=>p.user_id===u.id).map(p=>p.permission),team_ids:members.filter(m=>m.user_id===u.id).map(m=>m.team_id),effective_permissions:(await effectiveAccess(tx,u.id)).permissions}))),
   teams:teams.map(t=>({...t,role_ids:teamRoles.filter(r=>r.team_id===t.id).map(r=>r.role_id),permissions:teamGrants.filter(p=>p.team_id===t.id).map(p=>p.permission),member_ids:members.filter(m=>m.team_id===t.id).map(m=>m.user_id)}))};
 });
}
export async function mutateAccess(db,actor,kind,id,v){
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(741030)');
  const current=await effectiveAccess(tx,actor.id);requireValue(current.active,'Account is inactive',403);requirePermissions(current,'access.manage','access.users.read');
  const creating=!id;id=id?uuid(id):randomUUID();
  if(kind==='users'){
   onlyKeys(v,creating?['name','email','password','role_ids','permissions','team_ids']:['version','active','role_ids','permissions','team_ids']);
   const access=await assignments(tx,current,v,true);
   if(creating){
    const name=text(v.name,'Name',100),email=text(v.email,'Email',254).toLowerCase();requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Email is invalid');
    const initialPassword=v.password??randomBytes(32).toString('hex');
    requireValue(typeof initialPassword==='string'&&initialPassword.length>=12&&initialPassword.length<=256,'Initial password must be 12–256 characters');
    await tx.query("INSERT INTO users(id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'viewer')",[id,name,email,await hashPassword(initialPassword)]);
   }else{
    const target=await one(tx,'SELECT * FROM users WHERE id=$1 FOR UPDATE',[id]);requireValue(target.access_version===v.version,'User access changed. Reload before saving.',409);
    requireValue(!target.is_super_admin||current.is_super_admin,'Only a platform administrator can edit this user',403);
    if(!current.is_super_admin)grantable(current,(await effectiveAccess(tx,id)).permissions);
    requireValue(typeof v.active==='boolean','Account status is required');
    if(id===actor.id){requireValue(v.active,'You cannot deactivate your own account',409);requireValue(target.is_super_admin||access.effective.includes('access.manage'),'You cannot remove your own access management permission',409);}
    if(target.is_super_admin&&!v.active){const remaining=await one(tx,'SELECT count(*)::int AS count FROM users WHERE is_super_admin=true AND active=true AND id<>$1',[id]);requireValue(remaining.count>0,'Keep at least one active platform administrator',409);}
    await tx.query('UPDATE users SET active=$1,access_version=access_version+1 WHERE id=$2',[v.active,id]);
    if(!v.active)await tx.query('DELETE FROM sessions WHERE user_id=$1',[id]);
   }
   await replaceAssignments(tx,'user',id,access);
  }else if(kind==='roles'){
   onlyKeys(v,creating?['name','permissions']:['version','name','permissions']);
   const name=text(v.name,'Role name',80),keys=permissions(v.permissions);requireValue(name.length>=2,'Role name is too short');grantable(current,keys);
   if(creating)await tx.query('INSERT INTO access_roles(id,key,name) VALUES ($1,$2,$3)',[id,'CUSTOM_'+id,name]);
   else{const role=await one(tx,'SELECT * FROM access_roles WHERE id=$1 FOR UPDATE',[id]);requireValue(!role.is_system,'System roles cannot be edited');requireValue(role.version===v.version,'Role changed. Reload before saving.',409);
    // Removing or adding grants to a shared role is restricted to permissions the manager holds.
    grantable(current,(await tx.query('SELECT permission FROM access_role_permissions WHERE role_id=$1',[id])).rows.map(r=>r.permission));
    await tx.query('UPDATE access_roles SET name=$1,version=version+1 WHERE id=$2',[name,id]);await tx.query('DELETE FROM access_role_permissions WHERE role_id=$1',[id]);}
   for(const permission of keys)await tx.query('INSERT INTO access_role_permissions(role_id,permission) VALUES ($1,$2)',[id,permission]);
   if(!creating)await tx.query(`UPDATE users SET access_version=access_version+1 WHERE id IN (SELECT user_id FROM access_user_roles WHERE role_id=$1 UNION SELECT m.user_id FROM access_team_members m JOIN access_team_roles tr ON tr.team_id=m.team_id WHERE tr.role_id=$1)`,[id]);
  }else if(kind==='teams'){
   onlyKeys(v,creating?['name','role_ids','permissions','member_ids']:['version','name','role_ids','permissions','member_ids']);
   const name=text(v.name,'Team name',80),access=await assignments(tx,current,v);
   const memberIds=strings(v.member_ids,'Members',value=>uuid(value,'Member'));
   const members=await tx.query('SELECT id FROM users WHERE id=ANY($1::uuid[])',[memberIds]);requireValue(members.rows.length===memberIds.length,'Unknown team member');
   if(creating)await tx.query('INSERT INTO access_teams(id,name) VALUES ($1,$2)',[id,name]);
   else{const team=await one(tx,'SELECT * FROM access_teams WHERE id=$1 FOR UPDATE',[id]);requireValue(team.version===v.version,'Team changed. Reload before saving.',409);grantable(current,await assignedPermissions(tx,[],[id]));await tx.query('UPDATE access_teams SET name=$1,version=version+1 WHERE id=$2',[name,id]);}
   const prior=(await tx.query('SELECT user_id FROM access_team_members WHERE team_id=$1',[id])).rows.map(r=>r.user_id);
   await replaceAssignments(tx,'team',id,access);await tx.query('DELETE FROM access_team_members WHERE team_id=$1',[id]);
   for(const member of memberIds)await tx.query('INSERT INTO access_team_members(team_id,user_id) VALUES ($1,$2)',[id,member]);
   const affected=[...new Set([...prior,...memberIds])];if(affected.length)await tx.query('UPDATE users SET access_version=access_version+1 WHERE id=ANY($1::uuid[])',[affected]);
   // Team edits may alter the editor's own effective access, so validate after all changes.
   const after=await effectiveAccess(tx,actor.id);requireValue(can(after,'access.manage'),'You cannot remove your own access management permission',409);
  }else requireValue(false,'Unknown access resource',404);
  requireValue(can(await effectiveAccess(tx,actor.id),'access.manage'),'You cannot remove your own access management permission',409);
  await audit(tx,current,creating?'Created':'Updated','access.'+kind,id,{name:v.name,role_ids:v.role_ids,permissions:v.permissions,team_ids:v.team_ids,member_ids:v.member_ids,active:v.active});
  return {id};
 });
}
