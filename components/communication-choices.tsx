'use client';
import {useId} from 'react';
import {IconPhone,IconBrandWhatsapp,IconMail,IconUsers,IconDots} from '@tabler/icons-react';
const icons:Record<string,typeof IconPhone>={Call:IconPhone,WhatsApp:IconBrandWhatsapp,Email:IconMail,'In person':IconUsers,Other:IconDots};
export function CommunicationChoices({label,value,onChange,options,required=true,className=''}:{label:string;value:string;onChange:(value:string)=>void;options:string[];required?:boolean;className?:string}){
 const name=useId();
 return <fieldset className={`communication-choices ${className}`}><legend>{label}{required&&<b> *</b>}</legend><div className="communication-buttons">{options.map(option=>{const Icon=icons[option]||IconDots;return <label key={option} className={value===option?'selected':''}><input type="radio" name={name} value={option} checked={value===option} required={required} onChange={()=>onChange(option)}/><Icon size={17} stroke={1.6}/><span>{option}</span></label>;})}</div></fieldset>;
}
