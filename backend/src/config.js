import {otpConfigFrom} from './otp/config.js';
export function documentConfigFrom(env=process.env){
 const production=env.NODE_ENV==='production';
 const documentStorage=env.DOCUMENT_STORAGE||(production?'s3':'database');
 if(!['database','s3'].includes(documentStorage))throw Error('DOCUMENT_STORAGE must be database or s3');
 if(production&&documentStorage!=='s3')throw Error('Production documents must use S3');
 const s3Bucket=env.S3_DOCUMENT_BUCKET||'',s3Region=env.AWS_REGION||env.AWS_DEFAULT_REGION||'';
 if(documentStorage==='s3'&&(!s3Bucket||!s3Region))throw Error('Set S3_DOCUMENT_BUCKET and AWS_REGION for document storage');
 return {documentStorage,s3Bucket,s3Region};
}
export function configFrom(env=process.env) {
 const production=env.NODE_ENV==='production';
 if(!env.JWT_SECRET || env.JWT_SECRET.length<32 || (production && env.JWT_SECRET.startsWith('local-')))throw Error('Set a strong JWT_SECRET of at least 32 characters');
 const frontendOrigin=env.FRONTEND_ORIGIN||'http://localhost:3210';
 if(new URL(frontendOrigin).origin!==frontendOrigin || (production&&!frontendOrigin.startsWith('https://')))throw Error('Set FRONTEND_ORIGIN to the exact frontend origin');
 if(env.SOURCING_PORTAL_URL && new URL(env.SOURCING_PORTAL_URL).protocol!=='https:')throw Error('SOURCING_PORTAL_URL must use HTTPS');
 const releaseScope=env.RELEASE_SCOPE||'manual-sourcing';
 if(!['pre-sourcing','manual-sourcing','full'].includes(releaseScope))throw Error('Invalid RELEASE_SCOPE');
 return {...otpConfigFrom(env),...documentConfigFrom(env),releaseScope,production,secret:env.JWT_SECRET,frontendOrigin,sourcingUrl:env.SOURCING_PORTAL_URL,port:Number(env.PORT||8082)};
}
