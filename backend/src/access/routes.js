import {Router} from 'express';
import {requirePermissions} from './permissions.js';
import {accessOverview,mutateAccess} from './management.js';
export function accessRoutes(db){
 const router=Router();
 router.get('/session',(req,res)=>res.json({...req.actor,session_id:undefined}));
 router.get('/',async(req,res)=>{requirePermissions(req.actor,'access.users.read');res.json(await accessOverview(db));});
 router.post('/:kind',async(req,res)=>{requirePermissions(req.actor,'access.manage','access.users.read');res.status(201).json(await mutateAccess(db,req.actor,req.params.kind,null,req.body));});
 router.put('/:kind/:id',async(req,res)=>{requirePermissions(req.actor,'access.manage','access.users.read');res.json(await mutateAccess(db,req.actor,req.params.kind,req.params.id,req.body));});
 return router;
}
