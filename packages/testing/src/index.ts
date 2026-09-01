import fc from 'fast-check';
import type { FaultKind, FaultPointDeclaration } from '@kcml/schemas';
export { faultHarnessActive, installFaultHarnessCapability, invokeFaultHook } from '@kcml/schemas';
export type { FaultHarnessCapability, FaultHookContext, FaultKind, FaultPointDeclaration } from '@kcml/schemas';

export interface ModelCommand<State,Real>{name:string;check(state:Readonly<State>):boolean;run(state:State,real:Real):Promise<void>;}
export interface FaultPoint{id:string;subsystem:string;effect:string;recoveryOracle:string;pointName?:string;side?:'before'|'after';applicableFaultKinds?:readonly FaultKind[];}
export interface ScheduleEvidence{seed:number;commands:string[];faults:string[];startedAt:string;completedAt:string;terminalClosure:boolean;}
export interface FaultSchedule{scheduleId:string;seed:number;faultPointId:string;faultKind:FaultKind;side:'before'|'after';}
export interface FaultCoverageReport{declaredPointIds:string[];coveredPointIds:string[];uncoveredPointIds:string[];singleFaultObligations:number;singleFaultCovered:number;pairwiseSchedules:number;threeWaySchedules:number;status:'PASS'|'FAIL';}
export const mandatoryThreeWayScheduleIds = [
  'crash+duplicate-delivery+stale-fence',
  'postgres-restart+delayed-worker+activation-switch',
  'credential-rotation+disconnect+delayed-callback',
  'browser-auth-expiry+popup-race+owner-takeover',
  'disk-full+cleanup-failure+service-restart',
  'queue-saturation+cancellation+deadline',
  'openai-rate-limit+sse-disconnect+duplicate-result',
  'rollback-failure+cleanup-failure+service-restart',
] as const;

export class DeterministicScheduler{
  readonly #events:Array<{at:number;order:number;task:()=>Promise<void>}>=[];#clock=0;#order=0;
  public now():number{return this.#clock;}
  public schedule(delayMs:number,task:()=>Promise<void>):void{this.#events.push({at:this.#clock+delayMs,order:this.#order++,task});}
  public async drain(maxEvents=10000):Promise<void>{let count=0;while(this.#events.length){if(++count>maxEvents)throw new Error('SCHEDULER_EVENT_BOUND_EXCEEDED');this.#events.sort((a,b)=>a.at-b.at||a.order-b.order);const event=this.#events.shift()!;this.#clock=event.at;await event.task();}}
  public scheduleFault(schedule:FaultSchedule,point:FaultPointDeclaration,inject:(point:FaultPointDeclaration,schedule:FaultSchedule)=>Promise<void>|void):void{
    if (schedule.faultPointId !== point.faultPointId || schedule.side !== point.side) throw new Error('FAULT_SCHEDULE_POINT_MISMATCH');
    if (!point.applicableFaultKinds.includes(schedule.faultKind)) throw new Error('FAULT_KIND_NOT_APPLICABLE');
    this.schedule(0, async () => inject(point, schedule));
  }
}

export class FaultRegistry{readonly #points=new Map<string,FaultPoint>();public register(point:FaultPoint):void{if(this.#points.has(point.id))throw new Error(`FAULT_POINT_DUPLICATE:${point.id}`);if(point.pointName&&!/^.+\.(before|after)$/u.test(point.pointName))throw new Error(`FAULT_POINT_NAME_INVALID:${point.id}`);this.#points.set(point.id,point);}public get(id:string):FaultPoint{const point=this.#points.get(id);if(!point)throw new Error(`FAULT_POINT_UNKNOWN:${id}`);return point;}public list():FaultPoint[]{return[...this.#points.values()].sort((a,b)=>a.id.localeCompare(b.id));}}

export class FaultCoverageTracker {
  readonly #declarations:readonly FaultPointDeclaration[];
  readonly #covered = new Map<string,Set<string>>();
  public constructor(declarations:readonly FaultPointDeclaration[]){this.#declarations=declarations;for(const point of declarations)this.#covered.set(point.faultPointId,new Set());}
  public record(pointId:string,kind:FaultKind):void{const point=this.#declarations.find((candidate)=>candidate.faultPointId===pointId);if(!point)throw new Error(`FAULT_POINT_UNKNOWN:${pointId}`);if(!point.applicableFaultKinds.includes(kind))throw new Error(`FAULT_KIND_NOT_APPLICABLE:${pointId}:${kind}`);this.#covered.get(pointId)!.add(kind);}
  public singleFaultSchedules():FaultSchedule[]{return this.#declarations.flatMap((point)=>point.applicableFaultKinds.map((faultKind)=>({scheduleId:`single:${point.faultPointId}:${faultKind}`,seed:0,faultPointId:point.faultPointId,faultKind,side:point.side})));}
  public report(pairwiseSchedules=0,threeWaySchedules=0):FaultCoverageReport{const schedules=this.singleFaultSchedules();const covered=schedules.filter((schedule)=>this.#covered.get(schedule.faultPointId)?.has(schedule.faultKind));const coveredPointIds=this.#declarations.filter((point)=>schedules.filter((schedule)=>schedule.faultPointId===point.faultPointId).every((schedule)=>this.#covered.get(point.faultPointId)?.has(schedule.faultKind))).map((point)=>point.faultPointId);const uncoveredPointIds=this.#declarations.map((point)=>point.faultPointId).filter((id)=>!coveredPointIds.includes(id));return{declaredPointIds:this.#declarations.map((point)=>point.faultPointId),coveredPointIds,uncoveredPointIds,singleFaultObligations:schedules.length,singleFaultCovered:covered.length,pairwiseSchedules,threeWaySchedules,status:covered.length===schedules.length&&uncoveredPointIds.length===0?'PASS':'FAIL'};}
}

export async function checkModel<State,Real>(options:{initial:()=>State;real:()=>Promise<Real>;commands:readonly fc.Arbitrary<ModelCommand<State,Real>>[];runs:number;seed?:number;terminal:(state:State,real:Real)=>Promise<boolean>}):Promise<void>{
  const commandArbitrary=fc.array(fc.oneof(...options.commands),{minLength:1,maxLength:100});
  await fc.assert(fc.asyncProperty(commandArbitrary,async commands=>{const state=options.initial();const real=await options.real();for(const command of commands){if(command.check(state))await command.run(state,real);}if(!(await options.terminal(state,real)))throw new Error('TERMINAL_CLOSURE_FAILED');}),{numRuns:options.runs,endOnFailure:true,interruptAfterTimeLimit:120_000,...(options.seed===undefined?{}:{seed:options.seed})});
}

export class LinearizabilityHistory{readonly #events:Array<{operationId:string;kind:'INVOKE'|'RETURN';at:number;value:unknown}>=[];public invoke(operationId:string,value:unknown):void{this.#events.push({operationId,kind:'INVOKE',at:Date.now(),value});}public returned(operationId:string,value:unknown):void{this.#events.push({operationId,kind:'RETURN',at:Date.now(),value});}public events(){return this.#events.slice();}public assertWellFormed():void{const states=new Map<string,string>();for(const event of this.#events){if(event.kind==='INVOKE'){if(states.has(event.operationId))throw new Error('LINEARIZABILITY_DUPLICATE_INVOKE');states.set(event.operationId,'INVOKED');}else if(states.get(event.operationId)!=='INVOKED')throw new Error('LINEARIZABILITY_RETURN_WITHOUT_INVOKE');else states.set(event.operationId,'RETURNED');}}}
