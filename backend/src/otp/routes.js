import {Router} from 'express';
import {otpService} from './service.js';
export function otpRoutes(db,config,auth){
 const router=Router(),enabled=config.authMode==='otp';
 const service=enabled?otpService(db,config,config.otpTesting||{}):null;
 router.get('/config',(_req,res)=>res.json({mode:enabled?'otp':'password',localTest:enabled&&!!config.otp.logOnly}));
 router.post('/otp/send',async(req,res)=>{
  if(!enabled)return res.status(404).json({error:'Email code login is not enabled'});
  res.json(await service.send(req.body,req.ip));
 });
 router.post('/otp/verify',async(req,res)=>{
  if(!enabled)return res.status(404).json({error:'Email code login is not enabled'});
  const result=await service.verify(req.body,req.ip,(tx,user)=>auth.createSession(user,tx));
  auth.setSession(res,result.token);res.json(result.user);
 });
 return router;
}
