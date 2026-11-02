import {PERMISSIONS} from './permissions.js';
import {one} from '../db.js';

export async function effectiveAccess(db,userId) {
 const user=await one(db,'SELECT id,name,email,role,active,is_super_admin,access_version FROM users WHERE id=$1',[userId]);
 const roles=(await db.query(`SELECT DISTINCT r.id,r.key,r.name FROM access_roles r WHERE r.id IN (
  SELECT role_id FROM access_user_roles WHERE user_id=$1 UNION
  SELECT tr.role_id FROM access_team_roles tr JOIN access_team_members m ON m.team_id=tr.team_id WHERE m.user_id=$1
 ) ORDER BY r.name`,[userId])).rows;
 const teams=(await db.query('SELECT t.id,t.name FROM access_teams t JOIN access_team_members m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY t.name',[userId])).rows;
 const permissions=user.is_super_admin?PERMISSIONS.map(p=>p.key):(await db.query(`SELECT permission FROM access_user_grants WHERE user_id=$1 UNION
  SELECT rp.permission FROM access_role_permissions rp JOIN access_user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=$1 UNION
  SELECT rp.permission FROM access_role_permissions rp JOIN access_team_roles tr ON tr.role_id=rp.role_id JOIN access_team_members m ON m.team_id=tr.team_id WHERE m.user_id=$1 UNION
  SELECT tg.permission FROM access_team_grants tg JOIN access_team_members m ON m.team_id=tg.team_id WHERE m.user_id=$1 ORDER BY permission`,[userId])).rows.map(r=>r.permission);
 return {...user,roles,teams,permissions};
}
