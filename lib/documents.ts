import {api} from '@/lib/data';
export const communicationMethods=['Call','WhatsApp','Email','In person','Other'];
export const fileAccept='image/png,image/jpeg,image/webp,application/pdf';
export async function uploadDocument(orderId:string,file:File,category:string,channel:string,orderRevision?:number){
 if(file.size===0||file.size>5*1024*1024)throw Error('Choose a document up to 5 MB.');
 const response=await fetch(`/api/orders/${orderId}/documents`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream','X-Requested-With':'sales-ops','X-File-Name':encodeURIComponent(file.name),'X-Document-Category':category,'X-Communication-Channel':channel,...(orderRevision?{'X-Order-Revision':String(orderRevision)}:{})},body:file});
 if(!response.ok){const body=await response.json().catch(()=>({error:'Document upload failed. Try again.'}));throw Error(body.error);}
 return response.json();
}
export type OrderDocument={id:string;category:'request'|'quotation'|'po';channel:string;filename:string;mime_type:string;size:number;created_at:string;quote_revision:number|null;order_revision:number;uploaded_by:string};
export const documentsFor=(id:string)=>api<OrderDocument[]>(`/orders/${id}/documents`);
