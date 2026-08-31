import fc from 'fast-check';

export interface ModelCommand<State,Real>{name:string;check(state:Readonly<State>):boolean;run(state:State,real:Real):Promise<void>;}
export interface FaultPoint{id:string;subsystem:string;effect:string;recoveryOracle:string;}
export interface ScheduleEvidence{seed:number;commands:string[];faults:string[];startedAt:string;completedAt:string;terminalClosure:boolean;}

export class DeterministicScheduler{
  readonly #events:Array<{at:number;order:number;task:()=>Promise<void>}>=[];#clock=0;#order=0;
  public now():number{return this.#clock;}
  public schedule(delayMs:number,task:()=>Promise<void>):void{this.#events.push({at:this.#clock+delayMs,order:this.#order++,task});}
  public async drain(maxEvents=10000):Promise<void>{let count=0;while(this.#events.length){if(++count>maxEvents)throw new Error('SCHEDULER_EVENT_BOUND_EXCEEDED');this.#events.sort((a,b)=>a.at-b.at||a.order-b.order);const event=this.#events.shift()!;this.#clock=event.at;await event.task();}}
}

export class FaultRegistry{readonly #points=new Map<string,FaultPoint>();public register(point:FaultPoint):void{if(this.#points.has(point.id))throw new Error(`FAULT_POINT_DUPLICATE:${point.id}`);this.#points.set(point.id,point);}public get(id:string):FaultPoint{const point=this.#points.get(id);if(!point)throw new Error(`FAULT_POINT_UNKNOWN:${id}`);return point;}public list():FaultPoint[]{return[...this.#points.values()].sort((a,b)=>a.id.localeCompare(b.id));}}

export async function checkModel<State,Real>(options:{initial:()=>State;real:()=>Promise<Real>;commands:readonly fc.Arbitrary<ModelCommand<State,Real>>[];runs:number;seed?:number;terminal:(state:State,real:Real)=>Promise<boolean>}):Promise<void>{
  const commandArbitrary=fc.array(fc.oneof(...options.commands),{minLength:1,maxLength:100});
  await fc.assert(fc.asyncProperty(commandArbitrary,async commands=>{const state=options.initial();const real=await options.real();for(const command of commands){if(command.check(state))await command.run(state,real);}if(!(await options.terminal(state,real)))throw new Error('TERMINAL_CLOSURE_FAILED');}),{numRuns:options.runs,endOnFailure:true,interruptAfterTimeLimit:120_000,...(options.seed===undefined?{}:{seed:options.seed})});
}

export class LinearizabilityHistory{readonly #events:Array<{operationId:string;kind:'INVOKE'|'RETURN';at:number;value:unknown}>=[];public invoke(operationId:string,value:unknown):void{this.#events.push({operationId,kind:'INVOKE',at:Date.now(),value});}public returned(operationId:string,value:unknown):void{this.#events.push({operationId,kind:'RETURN',at:Date.now(),value});}public events(){return this.#events.slice();}public assertWellFormed():void{const states=new Map<string,string>();for(const event of this.#events){if(event.kind==='INVOKE'){if(states.has(event.operationId))throw new Error('LINEARIZABILITY_DUPLICATE_INVOKE');states.set(event.operationId,'INVOKED');}else if(states.get(event.operationId)!=='INVOKED')throw new Error('LINEARIZABILITY_RETURN_WITHOUT_INVOKE');else states.set(event.operationId,'RETURNED');}}}
