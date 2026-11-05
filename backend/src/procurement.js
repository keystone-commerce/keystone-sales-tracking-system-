import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {one} from './db.js';
import {audit} from './service.js';
import {requireValue,text,integer,money,date,uuid,choice,total,capacity} from './domain.js';
import {can,requirePermissions} from './access/permissions.js';
import {effectiveAccess} from './access/resolver.js';
import {procurementDocumentRoutes} from './procurement-documents.js';

const acceptedStages = ['Ready for sourcing','Confirmed'];
const dateString=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const methods = ['NEFT','RTGS','IMPS','UPI','Cheque','Bank transfer','Other'];

async function eligibleApprovers(db) {
 const users = (await db.query('SELECT id FROM users WHERE active=true ORDER BY name,id')).rows;
 const actors = await Promise.all(users.map(user=>effectiveAccess(db,user.id)));
 return actors.filter(actor=>can(actor,'procurement.read')&&can(actor,'procurement.approve'))
  .map(({id,name,email})=>({id,name,email}));
}

async function checkApprover(tx,id) {
 const actor = await effectiveAccess(tx,uuid(id,'Approver'));
 requireValue(actor.active&&can(actor,'procurement.read')&&can(actor,'procurement.approve'),
  'Choose an active user with supplier approval permission');
}

async function lockedOrder(tx,id) {
 const order = await one(tx,'SELECT * FROM orders WHERE id=$1 FOR UPDATE',[uuid(id,'Sales order')]);
 requireValue(acceptedStages.includes(order.stage)&&order.order_revision===order.accepted_revision,
  'Mark the accepted order ready for sourcing first',409);
 return order;
}

export function procurementRoutes(db,store) {
 const router = Router();
 router.use((req,_res,next)=>{
  requirePermissions(req.actor,'procurement.read');
  if(['POST','PUT'].includes(req.method)&&!req.path.startsWith('/documents/')){
   requireValue(req.body&&typeof req.body==='object'&&!Array.isArray(req.body),'Purchasing data is required');
  }
  next();
 });
 router.get('/',async(req,res)=>{
  res.json(await db.transaction(async tx=>{
   await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const rows = async sql=>(await tx.query(sql)).rows;
   return {
    suppliers:await rows('SELECT * FROM suppliers ORDER BY name'),
    quotes:await rows('SELECT q.*,s.name AS supplier_name,oi.sku,oi.description FROM supplier_quotes q JOIN suppliers s ON s.id=q.supplier_id JOIN order_items oi ON oi.id=q.order_item_id ORDER BY q.created_at DESC'),
    purchase_orders:await rows('SELECT p.*,s.name AS supplier_name,oi.sku,oi.description,COALESCE(r.reserved,0)::bigint AS reserved_paise,COALESCE(pay.paid,0)::bigint AS paid_paise FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id JOIN order_items oi ON oi.id=p.order_item_id LEFT JOIN (SELECT purchase_order_id,SUM(amount_paise) AS reserved FROM supplier_payment_requests WHERE status NOT IN (\'Rejected\',\'Cancelled\') GROUP BY purchase_order_id) r ON r.purchase_order_id=p.id LEFT JOIN (SELECT r.purchase_order_id,SUM(p.amount_paise) AS paid FROM supplier_payments p JOIN supplier_payment_requests r ON r.id=p.request_id GROUP BY r.purchase_order_id) pay ON pay.purchase_order_id=p.id ORDER BY p.created_at DESC'),
    requests:await rows('SELECT r.*,p.reference AS po_reference,s.name AS supplier_name,u.name AS raised_by,COALESCE(pay.paid,0)::bigint AS paid_paise FROM supplier_payment_requests r JOIN purchase_orders p ON p.id=r.purchase_order_id JOIN suppliers s ON s.id=p.supplier_id JOIN users u ON u.id=r.created_by LEFT JOIN (SELECT request_id,SUM(amount_paise) AS paid FROM supplier_payments GROUP BY request_id) pay ON pay.request_id=r.id ORDER BY r.created_at DESC'),
    approvals:await rows('SELECT a.*,u.name AS actor_name FROM supplier_approvals a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at'),
    payments:await rows('SELECT p.*,r.reference AS request_reference FROM supplier_payments p JOIN supplier_payment_requests r ON r.id=p.request_id ORDER BY p.created_at DESC'),
    policy:await one(tx,'SELECT * FROM supplier_approval_policy WHERE id=1'),
    approvers:await eligibleApprovers(tx)
   };
  }));
 });

 router.post('/suppliers',async(req,res)=>{
  requirePermissions(req.actor,'procurement.create');
  const v=req.body,id=randomUUID();
  const gstin=text(v.gstin||'','GSTIN',15,true).toUpperCase();
  requireValue(!gstin||/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin),'Supplier GSTIN format is invalid');
  const email=text(v.email||'','Email',254,true);
  requireValue(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Supplier email format is invalid');
  await db.transaction(async tx=>{
   await tx.query(
    'INSERT INTO suppliers(id,name,gstin,contact_name,email,phone,address,bank_name,account_number,ifsc,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [id,text(v.name,'Supplier name',160),gstin,text(v.contact_name||'','Contact name',160,true),email,
     text(v.phone||'','Phone',40,true),text(v.address||'','Address',1000,true),text(v.bank_name||'','Bank name',160,true),
     text(v.account_number||'','Account number',40,true),text(v.ifsc||'','IFSC',11,true).toUpperCase(),req.actor.id]);
   await audit(tx,req.actor,'Supplier created','suppliers',id);
  });
  res.status(201).json({id});
 });

 router.post('/quotes',async(req,res)=>{
  requirePermissions(req.actor,'procurement.create','orders.read');
  const v=req.body,id=randomUUID();
  await db.transaction(async tx=>{
   const order=await lockedOrder(tx,v.order_id);
   await one(tx,'SELECT id FROM order_items WHERE id=$1 AND order_id=$2',[uuid(v.order_item_id,'Order SKU'),order.id]);
   await one(tx,'SELECT id FROM suppliers WHERE id=$1',[uuid(v.supplier_id,'Supplier')]);
   const qty=integer(v.qty,'Quotation quantity');
   const rate=money(v.rate_paise,'Supplier rate');
   const gst=integer(v.gst_bps,'GST',0,10000);
   total(qty,rate,gst);
   await tx.query(
    'INSERT INTO supplier_quotes(id,order_id,order_item_id,supplier_id,reference,qty,rate_paise,gst_bps,quote_date,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [id,order.id,v.order_item_id,v.supplier_id,text(v.reference,'Quotation reference',200),qty,rate,gst,
     date(v.quote_date,'Quotation date'),text(v.notes||'','Quotation notes',1000,true),req.actor.id]);
   await audit(tx,req.actor,'Supplier quotation recorded','orders',order.id,{quote_id:id});
  });
  res.status(201).json({id});
 });

 router.post('/purchase-orders',async(req,res)=>{
  requirePermissions(req.actor,'procurement.create','orders.read');
  const v=req.body,id=randomUUID();
  await db.transaction(async tx=>{
   const quote=await one(tx,'SELECT * FROM supplier_quotes WHERE id=$1',[uuid(v.quote_id,'Supplier quotation')]);
   const order=await lockedOrder(tx,quote.order_id);
   const item=await one(tx,'SELECT * FROM order_items WHERE id=$1',[quote.order_item_id]);
   const qty=integer(v.qty,'Purchase quantity');
   const allocated=await one(tx,'SELECT COALESCE(SUM(qty),0)::int AS qty FROM purchase_orders WHERE order_item_id=$1',[item.id]);
   const quoted=await one(tx,'SELECT COALESCE(SUM(qty),0)::int AS qty FROM purchase_orders WHERE quote_id=$1',[quote.id]);
   capacity(item.qty,allocated.qty,qty,'Purchase quantity');
   capacity(quote.qty,quoted.qty,qty,'Selected quotation quantity');
   const ordered=date(v.order_date,'PO date'),expected=date(v.expected_date,'Expected supply date');
   requireValue(expected>=ordered,'Expected supply cannot precede the PO date');
   await tx.query(
    'INSERT INTO purchase_orders(id,quote_id,order_id,order_item_id,supplier_id,reference,qty,rate_paise,gst_bps,total_paise,order_date,expected_date,selection_reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [id,quote.id,order.id,item.id,quote.supplier_id,text(v.reference,'Supplier PO reference',200),qty,quote.rate_paise,quote.gst_bps,
     total(qty,Number(quote.rate_paise),quote.gst_bps),ordered,expected,text(v.selection_reason,'Supplier selection reason',1000),req.actor.id]);
   await audit(tx,req.actor,'Supplier PO issued','orders',order.id,{purchase_order_id:id,quote_id:quote.id,qty});
  });
  res.status(201).json({id});
 });

 router.put('/policy',async(req,res)=>{
  requirePermissions(req.actor,'procurement.manage');
  const v=req.body;
  await db.transaction(async tx=>{
   const policy=await one(tx,'SELECT * FROM supplier_approval_policy WHERE id=1 FOR UPDATE');
   requireValue(policy.version===v.version,'Approval policy changed. Refresh and try again.',409);
   await checkApprover(tx,v.primary_approver);
   await checkApprover(tx,v.secondary_approver);
   requireValue(v.primary_approver!==v.secondary_approver,'Choose different primary and secondary approvers');
   await tx.query('UPDATE supplier_approval_policy SET threshold_paise=$1,primary_approver=$2,secondary_approver=$3,version=version+1 WHERE id=1',
    [integer(v.threshold_paise,'Approval threshold',0,10_000_000_000),v.primary_approver,v.secondary_approver]);
   await audit(tx,req.actor,'Supplier approval policy updated','procurement',req.actor.id,
    {threshold_paise:v.threshold_paise,primary_approver:v.primary_approver,secondary_approver:v.secondary_approver});
  });
  res.json({saved:true});
 });

 router.post('/requests',async(req,res)=>{
  requirePermissions(req.actor,'procurement.create');
  const v=req.body,id=randomUUID();
  await db.transaction(async tx=>{
   const po=await one(tx,'SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE',[uuid(v.purchase_order_id,'Supplier PO')]);
   const order=await one(tx,'SELECT stage FROM orders WHERE id=$1 FOR SHARE',[po.order_id]);
   requireValue(acceptedStages.includes(order.stage),'The sales order is on hold or awaiting acceptance',409);
   const amount=money(v.amount_paise);
   const reserved=await one(tx,"SELECT COALESCE(SUM(amount_paise),0)::bigint AS amount FROM supplier_payment_requests WHERE purchase_order_id=$1 AND status NOT IN ('Rejected','Cancelled')",[po.id]);
   requireValue(amount<=Number(po.total_paise)-Number(reserved.amount),'Request exceeds the unallocated purchase order balance',409);
   const policy=await one(tx,'SELECT * FROM supplier_approval_policy WHERE id=1 FOR SHARE');
   requireValue(policy.primary_approver,'An administrator must configure independent payment approvers first',409);
   const secondary=amount>Number(policy.threshold_paise)?policy.secondary_approver:null;
   await checkApprover(tx,policy.primary_approver);
   if(amount>Number(policy.threshold_paise)){
    requireValue(secondary,'Configure a secondary approver first',409);
    await checkApprover(tx,secondary);
   }
   requireValue(req.actor.id!==policy.primary_approver&&req.actor.id!==secondary,'The requester must be different from every assigned approver',409);
   await tx.query(
    'INSERT INTO supplier_payment_requests(id,purchase_order_id,reference,amount_paise,purpose,justification,due_date,created_by,primary_approver,secondary_approver) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [id,po.id,text(v.reference,'Request reference',200),amount,text(v.purpose,'Payment purpose',200),
     text(v.justification,'Payment justification',1000),date(v.due_date,'Due date'),req.actor.id,policy.primary_approver,secondary]);
   await audit(tx,req.actor,'Supplier payment requested','supplier_requests',id,{purchase_order_id:po.id,amount_paise:amount});
  });
  res.status(201).json({id});
 });

 router.post('/requests/:id/decision',async(req,res)=>{
  const v=req.body,decision=choice(v.decision,['Approve','Reject','Cancel'],'request decision');
  requirePermissions(req.actor,decision==='Cancel'?'procurement.create':'procurement.approve');
  await db.transaction(async tx=>{
   const request=await one(tx,'SELECT * FROM supplier_payment_requests WHERE id=$1 FOR UPDATE',[uuid(req.params.id,'Request')]);
   requireValue(request.version===v.version&&request.status==='Pending approval','Request changed or has already been decided. Refresh first.',409);
   const remarks=text(v.remarks||'','Decision reason',1000,decision==='Approve');
   if(decision==='Cancel'){
    requireValue(request.created_by===req.actor.id,'Only the requester can cancel this pending request',403);
    await tx.query("UPDATE supplier_payment_requests SET status='Cancelled',version=version+1 WHERE id=$1",[request.id]);
   }else{
    const assigned=request.approval_step===1?request.primary_approver:request.secondary_approver;
    requireValue(assigned===req.actor.id&&request.created_by!==req.actor.id,'Only the assigned independent approver can decide this request',403);
    await tx.query('INSERT INTO supplier_approvals(id,request_id,step,actor_id,decision,remarks) VALUES ($1,$2,$3,$4,$5,$6)',
     [randomUUID(),request.id,request.approval_step,req.actor.id,decision,remarks]);
    const nextStep=decision==='Approve'&&request.approval_step===1&&request.secondary_approver;
    await tx.query('UPDATE supplier_payment_requests SET status=$1,approval_step=$2,version=version+1 WHERE id=$3',
     [decision==='Reject'?'Rejected':nextStep?'Pending approval':'Approved',nextStep?2:request.approval_step,request.id]);
   }
   await audit(tx,req.actor,'Supplier request '+decision.toLowerCase(),'supplier_requests',request.id,{remarks,step:request.approval_step});
  });
  res.json({saved:true});
 });

 router.post('/payments',async(req,res)=>{
  requirePermissions(req.actor,'procurement.pay');
  const v=req.body,id=uuid(v.id,'Payment submission');
  await db.transaction(async tx=>{
   const request=await one(tx,'SELECT * FROM supplier_payment_requests WHERE id=$1 FOR UPDATE',[uuid(v.request_id,'Request')]);
   const amount=money(v.amount_paise),reference=text(v.reference,'UTR / bank reference',200);
   const paymentDate=date(v.payment_date,'Payment date'),mode=choice(v.mode,methods,'payment method');
   const bank=text(v.bank||'','Paying bank',200,true);
   const accounting=text(v.accounting_reference||'','Accounting reference',200,true);
   const previous=(await tx.query('SELECT * FROM supplier_payments WHERE id=$1',[id])).rows[0];
   if(previous){
    requireValue(previous.request_id===request.id&&previous.created_by===req.actor.id&&Number(previous.amount_paise)===amount&&previous.reference===reference&&dateString(previous.payment_date)===paymentDate&&previous.mode===mode&&previous.bank===bank&&previous.accounting_reference===accounting,
     'This payment submission was already used with different values',409);
    return;
   }
   requireValue(request.status==='Approved','Only fully approved requests can be paid',409);
   const order=await one(tx,'SELECT o.stage FROM orders o JOIN purchase_orders p ON p.order_id=o.id WHERE p.id=$1 FOR SHARE OF o',[request.purchase_order_id]);
   requireValue(acceptedStages.includes(order.stage),'Release the sales order hold before paying',409);
   const paid=await one(tx,'SELECT COALESCE(SUM(amount_paise),0)::bigint AS amount FROM supplier_payments WHERE request_id=$1',[request.id]);
   requireValue(amount<=Number(request.amount_paise)-Number(paid.amount),'Payment exceeds the approved request balance',409);
   const po=await one(tx,'SELECT order_date FROM purchase_orders WHERE id=$1',[request.purchase_order_id]);
   requireValue(paymentDate>=dateString(po.order_date),'Payment date cannot precede the supplier PO');
   await tx.query(
    'INSERT INTO supplier_payments(id,request_id,amount_paise,reference,mode,payment_date,bank,accounting_reference,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id,request.id,amount,reference,mode,paymentDate,bank,accounting,req.actor.id]);
   await audit(tx,req.actor,'Supplier payment recorded','supplier_payments',id,{request_id:request.id,amount_paise:amount,reference});
  });
  res.status(201).json({id});
 });
 router.use(procurementDocumentRoutes(db,store));
 return router;
}
