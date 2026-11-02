import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('work',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const admin=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const restricted=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
const errors=[];for(const page of [admin,restricted])page.on('pageerror',e=>errors.push(e.message));
const stamp=Date.now(),email=`rbac-browser-${stamp}@example.test`,password='Access-Browser-2026!';
const roleName=`Browser RBAC Shipping ${stamp}`,teamName=`Browser RBAC Follow-ups ${stamp}`;
async function login(page,email,password){await page.goto('http://localhost:3210');await page.getByLabel('Work email').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Operations overview',exact:true})).toBeVisible();}
const nav=(page,name)=>page.locator('nav').getByRole('button',{name,exact:true});
async function save(){await admin.getByRole('button',{name:'Save access',exact:true}).click();await expect(admin.getByRole('dialog')).toHaveCount(0);}
try{
 await login(admin,'admin@keystone.local','SalesOps-local-2026!');await nav(admin,'Admin access').click();
 await expect(admin.getByRole('cell',{name:'admin@keystone.local',exact:false})).toBeVisible();
 await admin.getByRole('tab',{name:/^Roles/}).click();await admin.getByRole('button',{name:'New role',exact:true}).click();
 await admin.getByLabel('Access name').fill(roleName);
 for(const permission of ['orders.read','dispatches.read','dispatches.update'])await admin.getByLabel('Permission: '+permission,{exact:true}).check();
 await admin.screenshot({path:'work/access-role-editor.png',fullPage:true});
 await admin.setViewportSize({width:390,height:844});expect(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await admin.screenshot({path:'work/access-role-mobile.png',fullPage:true});await admin.setViewportSize({width:1440,height:1000});
 await save();await admin.getByRole('tab',{name:/^Users/}).click();await admin.getByRole('button',{name:'New user',exact:true}).click();
 await admin.getByLabel('Access name').fill('Browser RBAC Employee');await admin.getByLabel('Access email').fill(email);await admin.getByLabel('Initial password').fill(password);await admin.getByLabel('Role: '+roleName,{exact:true}).check();await admin.getByLabel('Permission: tasks.read',{exact:true}).check();await save();
 await admin.getByRole('tab',{name:/^Teams/}).click();await admin.getByRole('button',{name:'New team',exact:true}).click();await admin.getByLabel('Access name').fill(teamName);await admin.getByLabel('Permission: tasks.create',{exact:true}).check();await admin.getByLabel('Member: '+email,{exact:true}).check();await save();
 await admin.getByRole('tab',{name:/^Users/}).click();await admin.screenshot({path:'work/admin-access-users.png',fullPage:true});
 await login(restricted,email,password);
 for(const label of ['Sales orders','Dispatch & delivery','Team follow-ups'])await expect(nav(restricted,label)).toBeVisible();
 for(const label of ['Admin access','Invoices','Payment receipts','Customers','Sourcing handoff'])await expect(nav(restricted,label)).toHaveCount(0);
 await expect(restricted.getByText('Customer receivables',{exact:true})).toHaveCount(0);await expect(restricted.getByRole('heading',{name:'Collection watchlist'})).toHaveCount(0);
 const data=await restricted.evaluate(async()=>{const r=await fetch('/api/workspace');return r.json();});expect(data.invoices).toEqual([]);expect(data.receipts).toEqual([]);expect(data.customers).toEqual([]);expect(data.orders[0].invoiced).toBeUndefined();
 const denied=await restricted.evaluate(async()=>{const r=await fetch('/api/receipts',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'sales-ops'},body:'{}'});return r.status;});expect(denied).toBe(403);
 await nav(restricted,'Sales orders').click();await expect(restricted.getByRole('button',{name:'New sales order',exact:true})).toHaveCount(0);await restricted.getByRole('button',{name:'View',exact:true}).first().click();await expect(restricted.getByRole('columnheader',{name:'Invoiced',exact:true})).toHaveCount(0);await expect(restricted.getByRole('button',{name:'Add invoice',exact:true})).toHaveCount(0);await restricted.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await nav(restricted,'Dispatch & delivery').click();await expect(restricted.getByRole('button',{name:'New dispatch',exact:true})).toHaveCount(0);await restricted.getByRole('button',{name:'Update',exact:true}).first().click();await expect(restricted.getByLabel('Shipment status')).toBeVisible();await restricted.getByRole('button',{name:'Cancel',exact:true}).click();
 await nav(restricted,'Team follow-ups').click();await expect(restricted.getByRole('button',{name:'New follow-up',exact:true})).toBeVisible();await restricted.screenshot({path:'work/access-restricted-user.png',fullPage:true});
 await admin.getByRole('tab',{name:/^Teams/}).click();await admin.getByRole('row').filter({hasText:teamName}).getByRole('button',{name:'Edit team',exact:true}).click();await admin.getByLabel('Member: '+email,{exact:true}).uncheck();await save();
 await restricted.reload();await nav(restricted,'Team follow-ups').click();await expect(restricted.getByRole('button',{name:'New follow-up',exact:true})).toHaveCount(0);
 await admin.getByRole('tab',{name:/^Users/}).click();await admin.getByRole('row').filter({hasText:email}).getByRole('button',{name:'Edit access',exact:true}).click();await admin.getByLabel('Role: '+roleName,{exact:true}).uncheck();await admin.getByLabel('Permission: tasks.read',{exact:true}).uncheck();await save();
 await restricted.reload();await expect(nav(restricted,'Sales orders')).toHaveCount(0);await expect(nav(restricted,'Dispatch & delivery')).toHaveCount(0);await expect(nav(restricted,'Team follow-ups')).toHaveCount(0);
 await admin.getByRole('row').filter({hasText:email}).getByRole('button',{name:'Edit access',exact:true}).click();await admin.getByLabel('Account status').selectOption('inactive');await save();
 await restricted.reload();await expect(restricted.getByRole('heading',{name:'Sign in to your workspace'})).toBeVisible();expect(errors).toEqual([]);
 console.log('PASS: access editor, custom roles, direct grants, team inheritance, restricted data/navigation/actions, revocation, deactivation and mobile layout.');
}catch(e){await admin.screenshot({path:'work/access-admin-failure.png',fullPage:true});await restricted.screenshot({path:'work/access-user-failure.png',fullPage:true});throw e;}finally{await browser.close();}
