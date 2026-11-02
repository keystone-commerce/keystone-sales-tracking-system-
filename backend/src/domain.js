export class HttpError extends Error { constructor(status, message) { super(message); this.status=status; } }
export function requireValue(condition, message, status=400) { if(!condition) throw new HttpError(status,message); }
export function text(value, label, max=1000, optional=false) {
 requireValue(typeof value==='string' && value.length<=max && (optional || value.trim().length>0), `${label} is required (maximum ${max} characters)`);
 return value.trim();
}
export function integer(value, label, min=1, max=1_000_000) {
 requireValue(Number.isSafeInteger(value) && value>=min && value<=max, `${label} must be a whole number between ${min} and ${max}`); return value;
}
export function choice(value, options, label) { requireValue(options.includes(value),`Choose a valid ${label}`); return value; }
export function date(value, label) {
 requireValue(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,`${label} must be a valid date`); return value;
}
export function uuid(value, label='Record') { requireValue(typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),`${label} is invalid`); return value; }
export function money(value, label='Amount') { return integer(value,label,1,10_000_000_000); }
export function total(qty,rate,gst) {
 const base=BigInt(qty)*BigInt(rate); const result=base+(base*BigInt(gst)+5000n)/10000n;
 requireValue(result<=BigInt(Number.MAX_SAFE_INTEGER),'Amount is too large'); return Number(result);
}
export function capacity(ordered, existing, proposed, label) { requireValue(existing+proposed<=ordered,`${label} exceeds the remaining order quantity`,409); }
export function outstanding(totalPaise, paid, proposed) { requireValue(proposed<=totalPaise-paid,'Receipt exceeds invoice outstanding',409); }
