import { handleFieldRequest, isFieldEnvelope } from "./field.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

async function boundedJson(request:Request):Promise<{value:unknown}|{error:"invalid"|"too_large"}>{
  const declared=request.headers.get("content-length");
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>MAX_REQUEST_BYTES))return{error:"too_large"};
  if(!request.body)return{error:"invalid"};
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const{done,value}=await reader.read();if(done)break;if(!value)continue;size+=value.byteLength;if(size>MAX_REQUEST_BYTES){await reader.cancel();return{error:"too_large"}}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{return{value:JSON.parse(new TextDecoder().decode(bytes)) as unknown}}catch{return{error:"invalid"}}
}

export async function POST(request: Request) {
  const parsed = await boundedJson(request);
  if ("error" in parsed) return Response.json({ error: parsed.error === "too_large" ? "companion request too large" : "invalid JSON" }, { status: parsed.error === "too_large" ? 413 : 400 });
  if (!isFieldEnvelope(parsed.value)) return Response.json({ error: "invalid field request" }, { status: 400 });
  return handleFieldRequest(parsed.value, request.signal);
}
