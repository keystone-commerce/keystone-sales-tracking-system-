import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('work',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:3210');
 await page.getByLabel('Work email').fill('admin@keystone.local');
 await page.getByLabel('Password',{exact:true}).fill('SalesOps-local-2026!');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Operations overview',exact:true})).toBeVisible();
 for(const name of ['Sourcing handoff','Dispatch & delivery','Invoices','Payment receipts'])await expect(page.locator('nav').getByRole('button',{name,exact:true})).toHaveCount(0);
 for(const name of ['Order approval pipeline','Enquiries & drafts','Customers'])await expect(page.getByText(name,{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Collection watchlist',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Delivery completion',{exact:true})).toHaveCount(0);
 const data=await page.evaluate(async()=>{const r=await fetch('/api/workspace');return r.json();});
 expect(data.invoices).toEqual([]);expect(data.sourcing).toEqual([]);
 await page.locator('nav').getByRole('button',{name:'Sales orders',exact:true}).click();
 if(data.orders.length){
  await page.getByRole('button',{name:'View',exact:true}).first().click();
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  for(const name of ['Add dispatch','Add invoice'])await expect(dialog.getByRole('button',{name,exact:true})).toHaveCount(0);
  for(const name of ['Dispatched','Delivered','Invoiced','To deliver'])await expect(dialog.getByRole('columnheader',{name,exact:true})).toHaveCount(0);
  await page.screenshot({path:'work/v1-order-detail.png',fullPage:true});
  await page.keyboard.press('Escape');
 }
 await page.getByRole('button',{name:'New request',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'work/v1-mobile.png',fullPage:true});
 expect(errors).toEqual([]);
 console.log('V1 browser checks passed: navigation, overview, order details, new order, API projection and mobile.');
}finally{await browser.close();}
