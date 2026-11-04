export const EMAIL_PATTERN=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i;
export function otpConfigFrom(env=process.env){
 const production=env.NODE_ENV==='production',authMode=env.AUTH_MODE||'otp';
 if(!['otp','password'].includes(authMode))throw Error('AUTH_MODE must be otp or password');
 if(production&&authMode!=='otp')throw Error('Production login must use OTP');
 const logOnly=['true','1'].includes((env.OTP_LOG_ONLY||'').toLowerCase());
 const devFixedCode=(env.OTP_DEV_FIXED_CODE||'').trim();
 if(production&&(logOnly||devFixedCode))throw Error('Local OTP testing cannot be enabled in production');
 if(logOnly&&env.DEV_EMBEDDED_DB!=='true')throw Error('OTP_LOG_ONLY is restricted to the local embedded database');
 if(devFixedCode&&(!logOnly||!/^\d{6}$/.test(devFixedCode)))throw Error('OTP_DEV_FIXED_CODE requires local log-only mode and six digits');
 const secret=env.OTP_HMAC_SECRET||'';
 if(authMode==='otp'&&(Buffer.byteLength(secret)<32||/^(replace-|your-)/i.test(secret)||(production&&secret.startsWith('local-'))))throw Error('Set a separate OTP_HMAC_SECRET of at least 32 bytes');
 if(authMode==='otp'&&env.JWT_SECRET&&secret===env.JWT_SECRET)throw Error('OTP_HMAC_SECRET must differ from JWT_SECRET');
 const gmail={clientId:env.GMAIL_OAUTH_CLIENT_ID||'',clientSecret:env.GMAIL_OAUTH_CLIENT_SECRET||'',refreshToken:env.GMAIL_OAUTH_REFRESH_TOKEN||'',senderEmail:env.GMAIL_SENDER_EMAIL||'',senderName:env.GMAIL_SENDER_NAME||'Keystone Sales Operating System'};
 const gmailReady=!!(gmail.clientId&&gmail.clientSecret&&gmail.refreshToken&&EMAIL_PATTERN.test(gmail.senderEmail));
 if(/[\r\n]/.test(gmail.senderName))throw Error('Invalid GMAIL_SENDER_NAME');
 if(production&&!gmailReady)throw Error('Configure Gmail OAuth credentials and sender email for OTP delivery');
 return {authMode,otp:{secret,logOnly,devFixedCode,gmail,gmailReady}};
}
