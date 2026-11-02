import {createHmac,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {HttpError,requireValue} from '../domain.js';
import {EMAIL_PATTERN} from './config.js';
import {gmailOtpMailer} from './gmail.js';
const EXPIRY=300,COOLDOWN=60,WINDOW=15*60*1000;
const INVALID='Invalid or expired code. Request a new code if needed.';
export function normalizeEmail(value){requireValue(typeof value==='string'&&value.length<=254&&EMAIL_PATTERN.test(value.trim()),'Enter a valid work email');return value.trim().toLowerCase();}
export function otpService(db,config,{deliver,clock=()=>Date.now(),log=console.log}={}){
 const settings=config.otp;
 const digest=(purpose,value)=>createHmac('sha256',settings.secret).update(purpose+'\0'+value).digest('hex');
 const codeHash=(email,id,code)=>digest('sales-ops-email-otp',email+'\0'+id+'\0'+code);
 const mailer=deliver||gmailOtpMailer(settings.gmail);
 const rateError=()=>Object.assign(new HttpError(429,'Too many attempts. Please try again later.'),{retryAfter:60});
 async function lockEmail(tx,email){await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[digest('otp-email-lock',email)]);}
 async function limit(tx,kind,identifier,max,now){
  const key=digest(kind,identifier),time=new Date(now);
  const added=await tx.query('INSERT INTO login_otp_limits(key,window_started_at,attempts) VALUES ($1,$2,1) ON CONFLICT DO NOTHING RETURNING key',[key,time]);
  if(added.rows.length)return true;
  const row=(await tx.query('SELECT * FROM login_otp_limits WHERE key=$1 FOR UPDATE',[key])).rows[0];
  if(now-new Date(row.window_started_at).getTime()>=WINDOW){await tx.query('UPDATE login_otp_limits SET window_started_at=$1,attempts=1 WHERE key=$2',[time,key]);return true;}
  if(row.attempts>=max)return false;
  await tx.query('UPDATE login_otp_limits SET attempts=attempts+1 WHERE key=$1',[key]);return true;
 }
 return {
  async send(input,ip){
   const email=normalizeEmail(input?.email);
   if(!settings.logOnly&&!deliver&&!settings.gmailReady)throw new HttpError(503,'Sign-in email is unavailable. Contact your administrator.');
   const now=clock(),id=randomUUID(),code=settings.devFixedCode||String(randomInt(0,1000000)).padStart(6,'0');
   const result=await db.transaction(async tx=>{
    await lockEmail(tx,email);
    if(!await limit(tx,'otp-send-ip',ip||'unknown',20,now))return {limited:true};
    const latest=(await tx.query('SELECT created_at FROM login_otp_challenges WHERE email=$1 ORDER BY created_at DESC LIMIT 1',[email])).rows[0];
    if(latest&&now-new Date(latest.created_at).getTime()<COOLDOWN*1000)return {limited:true};
    if(!await limit(tx,'otp-send-email',email,3,now))return {limited:true};
    await tx.query('DELETE FROM login_otp_challenges WHERE expires_at<$1',[new Date(now-24*3600*1000)]);
    await tx.query('DELETE FROM login_otp_limits WHERE window_started_at<$1',[new Date(now-24*3600*1000)]);
    const user=(await tx.query('SELECT id FROM users WHERE email=$1 AND active=true',[email])).rows[0];
    await tx.query('UPDATE login_otp_challenges SET consumed_at=$1 WHERE email=$2 AND consumed_at IS NULL',[new Date(now),email]);
    await tx.query("INSERT INTO login_otp_challenges(id,user_id,email,code_hash,created_at,expires_at,delivery_status) VALUES ($1,$2,$3,$4,$5,$6,'pending')",[id,user?.id||null,email,codeHash(email,id,code),new Date(now),new Date(now+EXPIRY*1000)]);
    return {user};
   });
   if(result.limited)throw rateError();
   try{
    if(result.user){if(settings.logOnly)log(`[Sales Ops local OTP] ${email}: ${code}`);else await mailer({email,code});}
    await db.query("UPDATE login_otp_challenges SET delivery_status='sent' WHERE id=$1 AND consumed_at IS NULL",[id]);
   }catch{
    await db.query("UPDATE login_otp_challenges SET delivery_status='failed',consumed_at=$1 WHERE id=$2",[new Date(clock()),id]);
    // The public result is identical for an unknown account or delivery failure.
    console.error({event:'otp_email_delivery_failed'});
   }
   return {challengeId:id,expiresIn:EXPIRY,resendAfter:COOLDOWN,message:'If this account has access, a sign-in code has been sent.'};
  },
  async verify(input,ip,issueSession){
   const email=normalizeEmail(input?.email);const {code,challengeId}=input||{};
   requireValue(typeof code==='string'&&/^\d{6}$/.test(code),'Enter the 6-digit code');
   requireValue(typeof challengeId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId),'Request a new sign-in code');
   const now=clock();
   const result=await db.transaction(async tx=>{
    await lockEmail(tx,email);
    if(!await limit(tx,'otp-verify-ip',ip||'unknown',60,now)||!await limit(tx,'otp-verify-email',email,15,now))return {limited:true};
    const row=(await tx.query('SELECT * FROM login_otp_challenges WHERE id=$1 AND email=$2 FOR UPDATE',[challengeId,email])).rows[0];
    if(!row||row.consumed_at||row.delivery_status!=='sent'||new Date(row.expires_at).getTime()<=now||row.attempts>=3)return {invalid:true};
    const expected=Buffer.from(codeHash(email,challengeId,code),'hex'),stored=Buffer.from(row.code_hash,'hex');
    const matches=stored.length===expected.length&&timingSafeEqual(stored,expected);
    const attempts=row.attempts+1;
    await tx.query('UPDATE login_otp_challenges SET attempts=$1,consumed_at=$2 WHERE id=$3',[attempts,matches||attempts>=3?new Date(now):null,row.id]);
    if(!matches||!row.user_id)return {invalid:true};
    const user=(await tx.query('SELECT id,name,email,role FROM users WHERE id=$1 AND email=$2 AND active=true FOR UPDATE',[row.user_id,email])).rows[0];
    if(!user)return {invalid:true};
    const token=await issueSession(tx,user);
    await tx.query("INSERT INTO audit(actor_id,action,entity,record_id,detail) VALUES ($1,'Signed in','auth',$1,$2)",[user.id,JSON.stringify({method:'email-otp'})]);
    return {user,token};
   });
   if(result.limited)throw rateError();if(result.invalid)throw new HttpError(401,INVALID);return result;
  }
 };
}
