import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {SignJWT,jwtVerify} from 'jose';
import {HttpError} from './domain.js';
import {effectiveAccess} from './access/resolver.js';
const scrypt=promisify(scryptCallback);
export async function hashPassword(password) {const salt=randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex');}
export async function verifyPassword(password,hash) {
 const [salt,key]=hash.split(':');const derived=Buffer.from(await scrypt(password,salt,64));const expected=Buffer.from(key,'hex');return derived.length===expected.length && timingSafeEqual(derived,expected);
}
export function authTools(db,config) {
 const key=new TextEncoder().encode(config.secret);
 const cookieOptions={httpOnly:true,secure:config.production,sameSite:'lax',path:'/',maxAge:8*3600*1000};
 function tokenFrom(req) { return (req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sales_session='))?.slice(14); }
 async function createSession(user,tx=db){
  const sid=randomUUID();
  const token=await new SignJWT({sid}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuer('keystone-sales-ops').setAudience('sales-ops').setIssuedAt().setExpirationTime('8h').sign(key);
  await tx.query('INSERT INTO sessions(id,user_id,expires_at) VALUES ($1,$2,now()+interval \'8 hours\')',[sid,user.id]);return token;
 }
 function setSession(res,token){res.cookie('sales_session',token,cookieOptions);}
 return {
  createSession,setSession,
  async login(res,user){setSession(res,await createSession(user));},
  async authenticate(req,res,next){try{
   const token=tokenFrom(req);if(!token)throw Error('No session');
   const {payload}=await jwtVerify(token,key,{issuer:'keystone-sales-ops',audience:'sales-ops',algorithms:['HS256']});
   const {rows}=await db.query('SELECT u.id,u.name,u.email,u.role,s.id AS session_id FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND s.expires_at>now() AND u.active=true',[payload.sub,payload.sid]);
   if(!rows[0])throw Error('Expired session');req.actor={...await effectiveAccess(db,rows[0].id),session_id:rows[0].session_id};next();
  }catch{next(new HttpError(401,'Please sign in to continue'));}},
  async logout(req,res){await db.query('DELETE FROM sessions WHERE id=$1',[req.actor.session_id]);res.clearCookie('sales_session',{...cookieOptions,maxAge:undefined});}
 };
}
