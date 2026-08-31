import type { AgentsSdkRuntime, AgentRuntimeRequest } from '@kcml/openai-runtime';
import type { AuthorityLineage } from '@kcml/agentic-authority';
import { z } from '@kcml/schemas';

export const agentDefinitionSchema=z.object({
  name:z.string().min(1),instructions:z.string().min(1),model:z.string().min(1),mode:z.enum(['INTERACTIVE','TRIGGERED','EVALUATION','REPAIR']),
  inputSchema:z.record(z.string(),z.unknown()),outputSchema:z.record(z.string(),z.unknown()),toolAliases:z.record(z.string(),z.object({operation:z.string(),bindingDigest:z.string()}).strict()),
  maxTurns:z.number().int().min(1).max(128).default(32),enabled:z.boolean().default(true)
}).strict();
export type AgentDefinition=z.infer<typeof agentDefinitionSchema>;

export class AgentSdk{
  public constructor(private readonly runtime:AgentsSdkRuntime){}
  public async execute(definitionValue:unknown,input:string,authority:AuthorityLineage):Promise<unknown>{const definition=agentDefinitionSchema.parse(definitionValue);if(!definition.enabled)throw new Error('AGENT_DISABLED');const request:AgentRuntimeRequest={name:definition.name,instructions:definition.instructions,input,model:definition.model,authority};return this.runtime.execute(request);}
}
