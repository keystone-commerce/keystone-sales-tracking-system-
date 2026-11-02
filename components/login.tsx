'use client';
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {IconArrowRight,IconBuildingStore} from '@tabler/icons-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {api} from '@/lib/data';
type Challenge={challengeId:string;expiresIn:number;resendAfter:number;message:string};
export function Login({onLogin}:{onLogin:()=>void}){
 const settings=useQuery({queryKey:['auth-config'],queryFn:()=>api<{mode:'otp'|'password';localTest:boolean}>('/auth/config')});
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [challenge,setChallenge]=useState<Challenge|null>(null),[expiresAt,setExpiresAt]=useState(0),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!challenge)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[challenge]);
 const legacy=settings.data?.mode==='password';const remaining=Math.max(0,Math.ceil((resendAt-now)/1000)),expiry=Math.max(0,Math.ceil((expiresAt-now)/1000));
 async function send(){setBusy(true);setError('');try{const value=await api<Challenge>('/auth/otp/send',{method:'POST',body:JSON.stringify({email:email.trim().toLowerCase()})});setEmail(email.trim().toLowerCase());setCode('');setChallenge(value);const start=Date.now();setNow(start);setExpiresAt(start+value.expiresIn*1000);setResendAt(start+value.resendAfter*1000);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function verify(){setBusy(true);setError('');try{await api('/auth/otp/verify',{method:'POST',body:JSON.stringify({email,code,challengeId:challenge!.challengeId})});onLogin();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="login-page"><div className="login-brand"><span className="brand-icon"><IconBuildingStore size={20}/></span> KEYSTONE <span>COMMERCE</span></div><section className="login-card"><div className="eyebrow">B2B SALES OPERATIONS</div><h1>{challenge?'Enter your sign-in code':'Sign in to your workspace'}</h1>
 {settings.isPending?<p>Opening sign-in…</p>:settings.error?<div className="error-box" role="alert">Sign-in is unavailable.<Button size="sm" variant="outline" onClick={()=>void settings.refetch()}>Try again</Button></div>:<form onSubmit={async e=>{e.preventDefault();if(legacy){setBusy(true);setError('');try{await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});onLogin();}catch(err){setError((err as Error).message);}finally{setBusy(false);}}else if(challenge)await verify();else await send();}}>
 {!challenge?<label>Work email<Input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy}/></label>:<div className="otp-recipient"><span>{email}</span><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={()=>{setChallenge(null);setCode('');setError('');}}>Change email</Button></div>}
 {legacy&&<label>Password<Input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>}
 {challenge&&<><label>6-digit code<Input key={challenge.challengeId} autoFocus aria-label="6-digit code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required disabled={busy}/></label><p className="otp-expiry" role="status">{expiry?`Code expires in ${Math.floor(expiry/60)}:${String(expiry%60).padStart(2,'0')}`:'Code expired. Request a new code.'}</p></>}
 {error&&<div role="alert" className="error-box">{error}</div>}
 <Button disabled={busy||!!challenge&&(code.length!==6||expiry===0)} type="submit">{busy?(challenge?'Verifying…':'Please wait…'):legacy?'Sign in':challenge?'Verify & sign in':'Send code'}<IconArrowRight size={15}/></Button>
 {challenge&&<Button type="button" variant="outline" disabled={busy||remaining>0} onClick={()=>void send()}>{remaining>0?`Resend code in ${remaining}s`:'Resend code'}</Button>}
 {!legacy&&settings.data?.localTest&&<small className="otp-local">Local test mode</small>}
 </form>}
 </section></main>;
}
