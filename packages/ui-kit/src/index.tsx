import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode } from 'react';

export function Button({className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button className={`kc-button ${className}`} {...props}/>;}
export function Card({className='',...props}:HTMLAttributes<HTMLDivElement>){return <section className={`kc-card ${className}`} {...props}/>;}
export function Badge({tone='neutral',children}:{tone?:'neutral'|'good'|'warn'|'bad'|'info';children:ReactNode}){return <span className={`kc-badge kc-badge--${tone}`}>{children}</span>;}
export function Metric({label,value,detail,tone='neutral'}:{label:string;value:ReactNode;detail?:ReactNode;tone?:'neutral'|'good'|'warn'|'bad'}){return <Card className={`kc-metric kc-metric--${tone}`}><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</Card>;}
export function EmptyState({title,detail,action}:{title:string;detail:string;action?:ReactNode}){return <div className="kc-empty"><span className="kc-empty__mark">◇</span><h3>{title}</h3><p>{detail}</p>{action}</div>;}
export function Stack({children,className=''}:PropsWithChildren<{className?:string}>){return <div className={`kc-stack ${className}`}>{children}</div>;}
