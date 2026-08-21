const CELL=16,FRAMES=4;
export const SPRITE_KINDS=["crab","ripple","shell","grass","driftwood","tumbleweed","dust","warning","fence","debris","firefly","frog","vine","statue","fungus","moth","page","shelf","icicle","paper","ember","spark","pipe","vent","slag","glowmoth","mote","crystal","mushroom","spore","rune","fossil"] as const;
export type AtlasSpriteKind=typeof SPRITE_KINDS[number];
export type AtlasFrame={sx:number;sy:number;size:number};

let atlas:HTMLCanvasElement|null=null;
const frameMap=new Map<string,AtlasFrame>();
const px=(ctx:CanvasRenderingContext2D,x:number,y:number,w=1,h=1,color="#f3df9b")=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h)};

function drawFrame(ctx:CanvasRenderingContext2D,kind:string,frame:number,ox:number,oy:number){
  const flap=frame%2,wave=frame-1.5,bright="#fff3bd",gold="#dfac4f",green="#83d57a",blue="#78dbe3",pink="#f17fa5";
  if(["crab","frog","moth","glowmoth"].includes(kind)){
    const hop=kind==="frog"&&frame===2?-2:0;px(ctx,ox+5,oy+7+hop,6,4,kind==="frog"?green:kind.includes("moth")?blue:gold);px(ctx,ox+2-flap,oy+8+hop,4,2);px(ctx,ox+10+flap,oy+8+hop,4,2);px(ctx,ox+6,oy+11+hop,2,2,bright);px(ctx,ox+9,oy+11+hop,2,2,bright);
  }else if(["firefly","ember","spark","mote","dust","spore"].includes(kind)){
    const x=7+Math.round(Math.sin(frame*Math.PI/2)*2),y=6+frame%3;px(ctx,ox+x-2,oy+y-2,5,5,"rgba(245,210,83,.22)");px(ctx,ox+x,oy+y,2,2,kind==="spore"?pink:bright);
  }else if(["grass","vine","icicle","crystal","mushroom","pipe"].includes(kind)){
    const color=kind==="grass"||kind==="vine"||kind==="mushroom"?green:kind==="pipe"?gold:blue,x=8+Math.round(wave);px(ctx,ox+x,oy+3,2,11,color);px(ctx,ox+x-3,oy+6+flap,3,2,color);px(ctx,ox+x+2,oy+8-flap,3,2,color);if(kind==="mushroom")px(ctx,ox+x-4,oy+2+flap,10,3,pink);
  }else if(["page","paper","warning","debris","rune"].includes(kind)){
    const x=3+frame%2,y=4+(frame+1)%2;px(ctx,ox+x,oy+y,10,8,kind==="warning"?gold:bright);if(kind==="warning")px(ctx,ox+x+2,oy+y+2,6,2,"#3a2717");else if(kind==="rune"){px(ctx,ox+x+2+frame,oy+y+1,2,6,pink);px(ctx,ox+x+1,oy+y+3,7,2,pink)}else px(ctx,ox+x+2,oy+y+2,6,1,blue);
  }else if(["shelf","fence","vent"].includes(kind)){
    px(ctx,ox+2,oy+3,12,11,"#7b5a41");for(let i=0;i<3;i++)px(ctx,ox+3,oy+5+i*3,10,1,gold);if(kind==="vent")for(let i=0;i<3;i++)px(ctx,ox+4+i*3,oy+4,1,9,"#241d22");
  }else if(kind==="statue"||kind==="fossil"){
    px(ctx,ox+3,oy+3,10,10,"#a9aa87");px(ctx,ox+5,oy+6,2,frame===3?1:2,"#1d2520");px(ctx,ox+10,oy+6,2,frame===3?1:2,"#1d2520");px(ctx,ox+6,oy+10,5,1,"#625e52");
  }else if(kind==="ripple"){
    px(ctx,ox+2+frame,oy+8,12-frame*2,1,blue);px(ctx,ox+4,oy+10,8,1,"#d4fbff");
  }else{
    const shift=frame%2;px(ctx,ox+2+shift,oy+7,12-shift*2,4,gold);px(ctx,ox+6,oy+4,4,8,bright);
  }
}

function buildAtlas(){
  const canvas=document.createElement("canvas");canvas.width=CELL*FRAMES;canvas.height=CELL*SPRITE_KINDS.length;const ctx=canvas.getContext("2d")!;ctx.imageSmoothingEnabled=false;
  SPRITE_KINDS.forEach((kind,row)=>{for(let frame=0;frame<FRAMES;frame++){drawFrame(ctx,kind,frame,frame*CELL,row*CELL);frameMap.set(`${kind}:${frame}`,{sx:frame*CELL,sy:row*CELL,size:CELL})}});return canvas;
}

export function atlasFrame(kind:string,time:number,phase:number){
  if(typeof document==="undefined")return null;atlas??=buildAtlas();const frame=Math.floor(time*6+phase*2)%FRAMES,source=frameMap.get(`${kind}:${frame}`);return source?{atlas,source}:null;
}
