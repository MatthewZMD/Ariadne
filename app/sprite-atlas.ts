const CELL=16,FRAMES=4;
export const SPRITE_KINDS=["crab","ripple","shell","grass","driftwood","tumbleweed","dust","warning","fence","debris","firefly","frog","vine","statue","fungus","moth","page","shelf","icicle","paper","ember","spark","pipe","vent","slag","glowmoth","mote","crystal","mushroom","spore","rune","fossil"] as const;
export type AtlasSpriteKind=typeof SPRITE_KINDS[number];
export type AtlasFrame={sx:number;sy:number;size:number};

let atlas:HTMLCanvasElement|null=null;
const frameMap=new Map<string,AtlasFrame>();
const px=(ctx:CanvasRenderingContext2D,x:number,y:number,w=1,h=1,color="#f3df9b")=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h)};

function drawFrame(ctx:CanvasRenderingContext2D,kind:string,frame:number,ox:number,oy:number){
  const flap=frame%2,wave=[-1,0,1,0][frame]!,bright="#fff3bd",gold="#dfac4f",green="#83d57a",blue="#78dbe3",pink="#f17fa5",dark="#26302d",rust="#9b5e43",stone="#aaa98b",ice="#d4fbff";
  // Every form remains deliberately small and incomplete: recognizable at a
  // glance, but still part of the maze's unstable pixel-collage language.
  if(kind==="crab"){
    px(ctx,ox+5,oy+7,6,4,gold);px(ctx,ox+6,oy+6,1,1,bright);px(ctx,ox+9,oy+6,1,1,bright);px(ctx,ox+2-flap,oy+7,3,2,rust);px(ctx,ox+11+flap,oy+7,3,2,rust);px(ctx,ox+3,oy+11,3,1,gold);px(ctx,ox+10,oy+11,3,1,gold);
  }else if(kind==="ripple"){
    px(ctx,ox+2+frame,oy+7,12-frame*2,1,blue);px(ctx,ox+4+flap,oy+10,8-flap*2,1,ice);px(ctx,ox+7,oy+5-wave,2,2,"rgba(212,251,255,.55)");
  }else if(kind==="shell"){
    px(ctx,ox+4,oy+7,8,6,"#d8a869");px(ctx,ox+6,oy+5,4,8,gold);px(ctx,ox+7,oy+6,1,6,bright);px(ctx,ox+4,oy+12,8,1,rust);px(ctx,ox+5+frame%3,oy+8,1,4,"#b57d55");
  }else if(kind==="grass"){
    px(ctx,ox+3,oy+12,10,1,dark);for(let i=0;i<5;i++){const x=4+i*2,lean=(i%2?wave:-wave);px(ctx,ox+x,oy+6+i%3,1,7-i%3,green);px(ctx,ox+x+lean,oy+5+i%2,1,3,i%2?"#a3d47b":green)}
  }else if(kind==="driftwood"){
    px(ctx,ox+2,oy+10,11,3,"#8e6848");px(ctx,ox+4,oy+9,7,2,"#b58a5e");px(ctx,ox+7,oy+5,2,6,rust);px(ctx,ox+11,oy+7,3,2,"#c49a69");px(ctx,ox+3,oy+11,2,1,gold);
  }else if(kind==="tumbleweed"){
    const x=wave;px(ctx,ox+4+x,oy+5,8,1,gold);px(ctx,ox+3+x,oy+7,10,2,"#ad8a53");px(ctx,ox+4+x,oy+10,8,2,gold);px(ctx,ox+6+x,oy+4,1,9,"#c49c58");px(ctx,ox+10+x,oy+5,1,8,"#806a45");
  }else if(kind==="dust"){
    px(ctx,ox+3+frame,oy+10-wave,7,1,"rgba(223,190,112,.72)");px(ctx,ox+7-frame,oy+7+wave,6,1,"rgba(255,231,163,.5)");px(ctx,ox+11,oy+4+frame,1,1,gold);
  }else if(kind==="warning"){
    px(ctx,ox+3,oy+3,2,11,rust);px(ctx,ox+5,oy+4,8,6,gold);px(ctx,ox+7,oy+6,4,1,dark);px(ctx,ox+8,oy+5+flap,2,4,"#be563d");px(ctx,ox+2,oy+13,5,1,"#6e4938");
  }else if(kind==="fence"){
    px(ctx,ox+2,oy+4,2,10,"#73533d");px(ctx,ox+12,oy+4,2,10,"#73533d");px(ctx,ox+3,oy+6,10,2,"#a67a52");px(ctx,ox+3,oy+11,10,2,"#a67a52");px(ctx,ox+6,oy+6,1,7,gold);px(ctx,ox+10,oy+6,1,7,rust);
  }else if(kind==="debris"){
    px(ctx,ox+2+flap,oy+10,5,3,rust);px(ctx,ox+8,oy+7-wave,4,5,"#7c6047");px(ctx,ox+11-flap,oy+11,3,2,gold);px(ctx,ox+5,oy+6,2,2,"#c69762");
  }else if(kind==="firefly"){
    const x=7+wave,y=7-frame%2;px(ctx,ox+x-2,oy+y-2,5,5,"rgba(245,210,83,.2)");px(ctx,ox+x,oy+y,2,2,bright);px(ctx,ox+x-2-flap,oy+y,2,1,blue);px(ctx,ox+x+2+flap,oy+y,2,1,blue);
  }else if(kind==="frog"){
    const hop=frame===2?-2:0;px(ctx,ox+4,oy+8+hop,8,5,green);px(ctx,ox+5,oy+6+hop,2,3,"#a8dd80");px(ctx,ox+9,oy+6+hop,2,3,"#a8dd80");px(ctx,ox+5,oy+7+hop,1,1,dark);px(ctx,ox+10,oy+7+hop,1,1,dark);px(ctx,ox+2-flap,oy+12+hop,4,1,green);px(ctx,ox+10+flap,oy+12+hop,4,1,green);px(ctx,ox+6,oy+11+hop,4,1,pink);
  }else if(kind==="vine"){
    px(ctx,ox+7+wave,oy+2,2,12,green);px(ctx,ox+4+wave,oy+5,4,2,"#a2d27b");px(ctx,ox+9+wave,oy+8,4,2,"#6dad66");px(ctx,ox+4-wave,oy+11,4,2,"#8bc972");px(ctx,ox+8,oy+3,1,9,"#d2dc87");
  }else if(kind==="statue"){
    px(ctx,ox+4,oy+3,8,10,stone);px(ctx,ox+5,oy+4,6,5,"#c0bea0");px(ctx,ox+5,oy+6,2,frame===3?1:2,dark);px(ctx,ox+9,oy+6,2,frame===3?1:2,dark);px(ctx,ox+6,oy+10,4,1,"#68675c");px(ctx,ox+3,oy+13,10,1,"#777665");px(ctx,ox+4,oy+3,2,2,bright);
  }else if(kind==="fungus"){
    px(ctx,ox+7,oy+8,2,6,"#d7d0a8");px(ctx,ox+3,oy+5+flap,10,4,pink);px(ctx,ox+5,oy+4+flap,6,2,"#ef9ab9");px(ctx,ox+5,oy+7+flap,2,1,bright);px(ctx,ox+10,oy+7+flap,1,1,blue);px(ctx,ox+3,oy+12,4,2,"#8065a2");
  }else if(kind==="moth"||kind==="glowmoth"){
    const glow=kind==="glowmoth",wing=flap?1:3;px(ctx,ox+7,oy+5,2,8,glow?gold:"#baaac5");px(ctx,ox+3-wing,oy+6,4+wing,wing,glow?blue:"#d8cbd3");px(ctx,ox+9,oy+6,4+wing,wing,glow?"#9be7c7":"#a98fc0");px(ctx,ox+4,oy+9,3,2,glow?bright:pink);px(ctx,ox+9,oy+9,3,2,glow?bright:blue);
  }else if(kind==="page"){
    px(ctx,ox+3+flap,oy+3+wave,10,11,bright);px(ctx,ox+5+flap,oy+6+wave,6,1,blue);px(ctx,ox+5+flap,oy+9+wave,5,1,stone);px(ctx,ox+5+flap,oy+12+wave,7,1,pink);px(ctx,ox+11+flap,oy+11+wave,2,3,"#c8e3e2");
  }else if(kind==="shelf"){
    px(ctx,ox+2,oy+2,12,12,"#654b3d");for(let y=4;y<14;y+=4)px(ctx,ox+3,oy+y,10,1,gold);for(let i=0;i<5;i++)px(ctx,ox+4+i*2,oy+5+(i%2)*4,1,3,[blue,pink,green,bright,gold][(i+frame)%5]);
  }else if(kind==="icicle"){
    px(ctx,ox+2,oy+2,12,2,ice);for(let i=0;i<4;i++){const length=5+((i+frame)%4)*2;px(ctx,ox+3+i*3,oy+4,2,length,blue);px(ctx,ox+3+i*3,oy+4,1,length-1,ice)}
  }else if(kind==="paper"){
    px(ctx,ox+2+frame,oy+6+wave,11-frame,1,bright);px(ctx,ox+5+frame,oy+7+wave,6-frame,3,"#e7e5d2");px(ctx,ox+8,oy+10+wave,1,3,blue);px(ctx,ox+4+frame,oy+5+wave,1,1,pink);
  }else if(kind==="ember"){
    const rise=frame;px(ctx,ox+6,oy+8-rise,5,6,"rgba(234,103,52,.38)");px(ctx,ox+7,oy+7-rise,3,6,"#ef8141");px(ctx,ox+8,oy+6-rise,2,5,gold);px(ctx,ox+8,oy+9-rise,1,3,bright);
  }else if(kind==="spark"){
    const radius=2+frame;px(ctx,ox+8-radius,oy+7,1+radius*2,2,gold);px(ctx,ox+7,oy+8-radius,2,1+radius*2,gold);px(ctx,ox+7,oy+7,2,2,bright);px(ctx,ox+3+frame,oy+3,1,1,pink);
  }else if(kind==="pipe"){
    px(ctx,ox+3,oy+2,4,11,rust);px(ctx,ox+5,oy+10,8,4,"#b97748");px(ctx,ox+2,oy+4,6,2,gold);px(ctx,ox+11,oy+9,2,5,gold);px(ctx,ox+8+frame,oy+3-wave,2,2,"rgba(220,246,234,.55)");
  }else if(kind==="vent"){
    px(ctx,ox+2,oy+2,12,12,"#53615e");px(ctx,ox+4,oy+4,8,8,dark);const shift=frame%2;px(ctx,ox+7-shift,oy+4,2+shift*2,8,stone);px(ctx,ox+4,oy+7-shift,8,2+shift*2,stone);px(ctx,ox+7,oy+7,2,2,gold);
  }else if(kind==="slag"){
    px(ctx,ox+2,oy+10,12,4,"#513a32");px(ctx,ox+4,oy+7,4,5,rust);px(ctx,ox+9,oy+8,3,4,"#774434");px(ctx,ox+5,oy+9,2,2,"#f08a42");px(ctx,ox+10,oy+10,2,1,gold);px(ctx,ox+7,oy+7-wave,1,2,bright);
  }else if(kind==="mote"){
    px(ctx,ox+7+wave,oy+7-wave,2,2,bright);px(ctx,ox+3+frame*2,oy+5,1,1,blue);px(ctx,ox+12-frame,oy+11+wave,1,1,pink);px(ctx,ox+6,oy+3+frame,1,1,"rgba(255,243,189,.6)");
  }else if(kind==="crystal"){
    px(ctx,ox+6,oy+3,3,11,blue);px(ctx,ox+8,oy+2,2,12,ice);px(ctx,ox+3,oy+8,3,6,"#6caac4");px(ctx,ox+10,oy+6,3,8,"#8f83d1");px(ctx,ox+8,oy+4+flap,1,5,bright);px(ctx,ox+11,oy+8,1,3,pink);
  }else if(kind==="mushroom"){
    px(ctx,ox+7,oy+8,2,6,"#d9d2b3");px(ctx,ox+3,oy+5+wave,10,4,"#8e70c4");px(ctx,ox+5,oy+4+wave,6,2,pink);px(ctx,ox+5,oy+7+wave,2,1,bright);px(ctx,ox+10,oy+7+wave,1,1,blue);px(ctx,ox+3,oy+12,3,2,"#d06ea7");
  }else if(kind==="spore"){
    const points=[[3+frame,10-wave],[7,4+frame],[11-frame,8+wave],[9+frame,13-frame],[13,3+frame]];for(const[x,y]of points){px(ctx,ox+x-1,oy+y-1,3,3,"rgba(241,127,165,.18)");px(ctx,ox+x,oy+y,1,1,pink)}
  }else if(kind==="rune"){
    px(ctx,ox+4,oy+3+wave,2,3,pink);px(ctx,ox+10,oy+3-wave,2,3,pink);px(ctx,ox+7,oy+5,2,7,"#8d6fd1");px(ctx,ox+4,oy+11-wave,8,2,pink);px(ctx,ox+6,oy+7,4,2,blue);px(ctx,ox+7,oy+7,2,2,bright);
  }else if(kind==="fossil"){
    px(ctx,ox+3,oy+4,10,9,stone);px(ctx,ox+5,oy+5,6,7,"#777766");px(ctx,ox+6,oy+6,4,5,stone);px(ctx,ox+7,oy+7,2,3,"#55564e");px(ctx,ox+3+flap,oy+8,3,1,gold);px(ctx,ox+10,oy+5+flap,2,1,bright);
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
