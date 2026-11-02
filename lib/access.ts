import type {Actor,Register} from './data';
export type Permission={key:string;label:string;group:string;readOnly:boolean};
export type AccessRole={id:string;key:string;name:string;is_system:boolean;version:number;permissions:string[]};
export type AccessTeam={id:string;name:string;version:number;role_ids:string[];permissions:string[];member_ids:string[]};
export type AccessUser={id:string;name:string;email:string;active:boolean;is_super_admin:boolean;access_version:number;role_ids:string[];permissions:string[];team_ids:string[];effective_permissions:string[]};
export type AccessOverview={permissions:Permission[];roles:AccessRole[];teams:AccessTeam[];users:AccessUser[]};
export const can=(actor:Actor|undefined,key:string)=>!!actor&&(actor.is_super_admin||actor.permissions.includes(key));
export function prerequisites(entity:Register,action:string){
 const required=[entity+'.read',entity+'.'+action];
 if(action==='create'){
  if(['dispatches','sourcing','invoices'].includes(entity))required.push('orders.read');
  if(entity==='orders')required.push('customers.read');
  if(entity==='receipts')required.push('invoices.read');
 }
 return [...new Set(required)];
}
export const canAct=(actor:Actor,entity:Register,action:string)=>prerequisites(entity,action).every(key=>can(actor,key));
