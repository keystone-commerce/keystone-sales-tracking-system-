import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {openDatabase,migrate} from '../backend/src/db.js';
import {bootstrap} from '../backend/src/seed.js';
import {createRecord} from '../backend/src/service.js';
import {createApp} from '../backend/src/app.js';

const origin='http://localhost:3309';
const password='Procurement-browser-test-2026';
await mkdir('work',{recursive:true});
const db=await openDatabase({DEV_EMBEDDED_DB:'true',EMBEDDED_PATH:'memory://'});
await migrate(db);
const admin=await bootstrap(db,'purchasing-ui@example.test',password,'Purchasing Admin');
const first=await bootstrap(db,'approver-ui@example.test',password,'Primary Approver');
const second=await bootstrap(db,'secondary-ui@example.test',password,'Secondary Approver');
const customer=await createRecord(db,'customers',{name:'ABC Helmets Customer'},admin);
const order=await createRecord(db,'orders',{
 customer_id:customer.id,description:'100 safety helmets',stage:'Confirmed',po_ref:'ABC-PO-100',
 owner:'Sales',ship_to:'ABC Bengaluru',target_date:'2027-02-10',
 items:[{sku:'HELMET-100',description:'Safety helmet',qty:100,rate_paise:100000,gst_bps:0}]
},admin);
const server=createApp(db,{releaseScope:'full',secret:'purchasing-ui-secret-at-least-32-characters',frontendOrigin:origin,production:false}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const web=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3309'],{
 stdio:'inherit',env:{...process.env,BACKEND_ORIGIN:'http://127.0.0.1:'+server.address().port,SALES_OPS_TEST_BUILD:'true',NEXT_TELEMETRY_DISABLED:'1'}
});
let browser,page;
async function login(page,email){
 await page.goto(origin);
 await page.getByLabel('Work email').fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Operations overview',exact:true})).toBeVisible();
 await page.locator('nav').getByRole('button',{name:'Supplier purchasing',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Purchase orders',exact:true})).toBeVisible();
}
async function save(page){
 await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
}
try{
 let ready=false;
 for(let attempt=0;attempt<90;attempt++){
  try{if((await fetch(origin)).ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw Error('Browser test frontend did not start');
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await login(page,'purchasing-ui@example.test');

 await page.getByRole('button',{name:'Approval settings',exact:true}).click();
 await page.getByLabel('Primary approver',{exact:true}).selectOption(first.id);
 await page.getByLabel('Secondary approver',{exact:true}).selectOption(second.id);
 await save(page);

 await page.getByRole('button',{name:'Suppliers',exact:true}).click();
 await page.getByRole('button',{name:'Add supplier',exact:true}).click();
 await page.getByLabel('Legal supplier name').fill('XYZ Helmets Supplier');
 await page.getByLabel('Contact person').fill('Vendor Contact');
 await save(page);

 const purchasing=(await db.query('SELECT id FROM suppliers')).rows[0];
 await page.getByRole('button',{name:'Supplier quotations',exact:true}).click();
 await page.getByRole('button',{name:'Add supplier quotation',exact:true}).click();
 await page.getByLabel('Ready sales order').selectOption(order.id);
 await page.getByLabel('Order SKU',{exact:true}).selectOption(order.item_ids[0]);
 await page.getByLabel('Supplier',{exact:true}).selectOption(purchasing.id);
 await page.getByLabel('Supplier quotation reference').fill('XYZ-QUOTE-100');
 await page.getByLabel('Quoted quantity').fill('100');
 await page.getByLabel('Supplier unit rate').fill('700');
 await page.getByLabel('GST (%)').fill('0');
 await save(page);
 await expect(page.getByRole('cell',{name:'XYZ-QUOTE-100',exact:true})).toBeVisible();

 await page.getByRole('button',{name:'Select / issue PO',exact:true}).click();
 await page.getByLabel('Supplier PO reference').fill('KEYSTONE-PO-100');
 await page.getByLabel('Supplier selection reason').fill('Approved specification and best accepted price');
 await save(page);
 await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
 await expect(page.getByRole('cell',{name:'KEYSTONE-PO-100',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Documents',exact:true}).click();
 await page.getByLabel('Supporting document',{exact:true}).setInputFiles({
  name:'supplier-pi.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')
 });
 await page.getByRole('button',{name:'Upload document',exact:true}).click();
 await expect(page.getByRole('link',{name:'supplier-pi.pdf'})).toBeVisible();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Request payment',exact:true}).click();
 await page.getByLabel('Unique payment request reference').fill('ADVANCE-100');
 await page.getByLabel('Requested amount').fill('21000');
 await page.getByLabel('Purpose',{exact:true}).selectOption('Advance against PI');
 await page.getByLabel('Justification / PI reference').fill('30% advance per supplier PI');
 await save(page);

 const approver=await browser.newPage();
 await login(approver,'approver-ui@example.test');
 await approver.getByRole('button',{name:'Payment requests',exact:true}).click();
 await approver.getByRole('button',{name:'Approve',exact:true}).click();
 await approver.getByLabel('Approval remarks').fill('PI and supplier PO verified');
 await save(approver);
 await approver.close();

 await page.getByRole('button',{name:'Payment requests',exact:true}).click();
 await page.reload();
 await expect(page.getByRole('heading',{name:'Operations overview',exact:true})).toBeVisible();
 await page.locator('nav').getByRole('button',{name:'Supplier purchasing',exact:true}).click();
 await page.getByRole('button',{name:'Payment requests',exact:true}).click();
 await page.getByRole('button',{name:'Record payment',exact:true}).click();
 await page.getByLabel('UTR / bank reference').fill('BANK-ADVANCE-100');
 await save(page);
 await expect(page.getByRole('cell',{name:'Fully paid',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Purchase orders',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Purchase orders',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Purchase orders',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:'work/procurement-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect.poll(async()=>page.locator('.app-sidebar').evaluate(element=>element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await expect(page.getByText('KEYSTONE-PO-100',{exact:true})).toBeVisible();
 await page.screenshot({path:'work/procurement-mobile.png',fullPage:true});
 const paid=(await db.query('SELECT SUM(amount_paise) AS paid FROM supplier_payments')).rows[0];
 expect(Number(paid.paid)).toBe(2100000);
 expect(errors).toEqual([]);
 console.log('Purchasing browser passed: sign-in, policy, supplier, quotation, selected PO, PI upload/download link, independent approval, advance payment and mobile layout.');
}catch(error){
 if(page){
  console.error((await page.locator('body').innerText()).slice(-2200));
  await page.screenshot({path:'work/procurement-browser-error.png',fullPage:true});
 }
 throw error;
}finally{
 await browser?.close();
 web.kill();
 server.closeAllConnections();
 await new Promise(resolve=>server.close(resolve));
 await db.close();
}
