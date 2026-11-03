import {EMAIL_PATTERN} from './config.js';
export function gmailMailer(gmail,{fetchUrl=fetch,now=()=>Date.now()}={}){
 let cached=null;
 async function accessToken(){
  if(cached&&now()<cached.expiresAt)return cached.value;
  const response=await fetchUrl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:gmail.clientId,client_secret:gmail.clientSecret,refresh_token:gmail.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Gmail token exchange failed');const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token)throw Error('Gmail token exchange failed');
  cached={value:token.access_token,expiresAt:now()+Math.max(0,(Number(token.expires_in)||3600)-60)*1000};return cached.value;
 }
 return async({email,subject,text})=>{
  if(!EMAIL_PATTERN.test(email)||!EMAIL_PATTERN.test(gmail.senderEmail)||/[\r\n]/.test(subject))throw Error('Invalid email');
  const sender=Buffer.from(gmail.senderName||'Keystone Sales Ops').toString('base64');
  const raw=Buffer.from([`From: =?UTF-8?B?${sender}?= <${gmail.senderEmail}>`,`To: ${email}`,("Subject: "+subject),'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n')).toString('base64url');
  for(let attempt=0;attempt<2;attempt++){
   const token=await accessToken();
   const response=await fetchUrl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),signal:AbortSignal.timeout(10000)});
   if(response.ok)return;
   if(response.status===401&&attempt===0){cached=null;continue;}
   throw Error('Gmail delivery failed');
  }
 };
}

export function gmailOtpMailer(gmail, options){
 const send=gmailMailer(gmail,options);
 return ({email,code})=>{
  if(!/^\d{6}$/.test(code))throw Error('Invalid OTP email');
  return send({
   email,subject:'Your Keystone Sales Ops sign-in code',
   text:`Your Keystone Sales Ops sign-in code is ${code}.\n\nThis code expires in 5 minutes. If you did not request it, ignore this email.`
  });
 };
}