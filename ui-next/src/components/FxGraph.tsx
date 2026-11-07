import { useEffect, useRef } from 'react';
import type { FxModuleId } from '../fx';

type Props = { id:FxModuleId; params:Record<string,number>; level:number; color:string; on:boolean;
  /** compressor gain reduction in dB, from the engine */ reduction?:number; /** resonator string notes, from the engine */ strings?:number[] };

/** Live per-module drawing on a canvas, redrawn at ~30 fps without React re-renders.
 *  Shapes follow the module's real parameters; brightness and motion follow its audio level. */
export function FxGraph(props:Props) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const latest=useRef(props); latest.current=props;
  const smooth=useRef(0);
  useEffect(()=>{
    let raf=0,last=0;
    const draw=(now:number)=>{
      raf=requestAnimationFrame(draw);
      if(now-last<33)return; last=now;
      const c=canvas.current, ctx=c?.getContext('2d'); if(!c||!ctx)return;
      const dpr=window.devicePixelRatio||1, W=c.clientWidth, H=c.clientHeight;
      if(c.width!==Math.round(W*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
      ctx.setTransform(dpr,0,0,dpr,0,0);
      const {id,params:p,level,color,on,reduction,strings}=latest.current;
      smooth.current=smooth.current*.8+Math.min(1,level*6)*.2;
      const L=on?smooth.current:0, t=now/1000;
      ctx.clearRect(0,0,W,H);
      // grid
      ctx.strokeStyle='#ffffff0d';ctx.lineWidth=1;
      for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,H*i/4);ctx.lineTo(W,H*i/4);ctx.stroke();}
      for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(W*i/8,0);ctx.lineTo(W*i/8,H);ctx.stroke();}
      const alpha=on?1:.35;
      ctx.globalAlpha=alpha;
      ctx.shadowColor=color;ctx.shadowBlur=on?6+L*16:0;
      ctx.strokeStyle=color;ctx.lineWidth=2;
      const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,color+'88');grad.addColorStop(1,color+'00');
      const line=(f:(x:number)=>number,fill=false)=>{
        ctx.beginPath();
        for(let i=0;i<=96;i++){const x=i/96,y=f(x);const px=x*W,py=H/2-y*H*.42;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}
        if(fill){ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();ctx.fillStyle=grad;ctx.fill();}
        else ctx.stroke();
      };
      const wave=(x:number,speed=1)=>Math.sin(x*Math.PI*6+t*speed*3);
      const amp=.25+.75*L;
      if(id==='filter'){
        const fc=20*Math.pow(1000,p.cutoff??.7),q=2-1.9*(p.reso??.3),mode=Math.round(p.mode??0);
        const resp=(x:number)=>{const f=20*Math.pow(1000,x),w=f/fc;const den=Math.sqrt(Math.pow(1-w*w,2)+Math.pow(q*w,2));
          const m=mode===0?1/den:mode===1?(q*w)/den:(w*w)/den;return Math.max(-1,Math.min(1,(20*Math.log10(m+1e-6))/24))*.9+.1;};
        ctx.shadowBlur=0;line(resp,true);ctx.shadowBlur=on?6+L*16:0;line(resp);
      } else if(id==='overdrive'){
        const d=1+(p.drive??.4)*24;line(x=>Math.tanh(wave(x,1)*d*amp)/Math.tanh(d)*.95);
        ctx.globalAlpha=alpha*.35;line(x=>wave(x,1)*amp);
      } else if(id==='bitcrusher'){
        const lv=Math.pow(2,(p.bits??9)-1)/64+1,hold=1+(p.rate??.3)*20;
        line(x=>{const q=Math.floor(x*96/hold)*hold/96;return Math.round(wave(q,1)*amp*lv)/lv;});
      } else if(id==='volume'){
        const g=(p.level??1)/1.5;ctx.fillStyle=grad;ctx.fillRect(0,H*(1-g*Math.max(.15,L)),W,H);
        line(x=>wave(x,.7)*g*amp);
      } else if(id==='phaser'||id==='flanger'){
        const rate=.2+(p.rate??.3)*4,depth=p.depth??.5,n=id==='phaser'?4:9;
        for(let i=0;i<n*3;i++){const x=(i+.5)/(n*3);const notch=Math.abs(Math.sin(x*Math.PI*n+Math.sin(t*rate)*depth*3));
          const h=(.15+.85*notch)*H*(.35+.65*amp);ctx.fillStyle=color;ctx.globalAlpha=alpha*(.35+.65*notch);
          ctx.fillRect(x*W-W/(n*7),H-h,W/(n*3.6),h);}
        ctx.globalAlpha=alpha;
      } else if(id==='ringmod'){
        const f=1+(p.freq??.4)*14;line(x=>Math.sin(x*Math.PI*2*f+t*4)*Math.sin(x*Math.PI*3+t)*amp);
      } else if(id==='delay'){
        const fb=p.feedback??.4,beats=[.125,.25,.5,.75,1,2][Math.round(p.time??2)]??.5,gap=Math.min(.45,beats*.18);
        for(let k=0,x=.04,a=1;x<1&&a>.03;k++,x+=gap,a*=fb){const h=a*H*.85*(.4+.6*amp);
          ctx.fillStyle=color;ctx.globalAlpha=alpha*(.3+.7*a);ctx.fillRect(x*W,H-h,5,h);}
        ctx.globalAlpha=alpha;
      } else if(id==='reverb'){
        const decay=1.5+6*(1-(p.decay??.6)),pre=(p.predelay??.1)*.25;
        ctx.shadowBlur=0;
        line(x=>x<pre?-1:Math.exp(-(x-pre)*decay)*1.8*(.4+.6*amp)-1+(Math.sin(x*180+t*9)*.06),true);
      } else if(id==='stutter'){
        const reps=Math.round(p.repeats??4),len=Math.round(p.length??3),slices=Math.min(32,1<<(len-1));
        const head=(t*(.5+(p.speed??.6)))%1;
        for(let i=0;i<slices;i++){const x=i/slices,rep=i%(reps+1)!==0;ctx.fillStyle=color;
          ctx.globalAlpha=alpha*(rep?.35+.5*amp:.9);ctx.fillRect(x*W+1,H*.2,W/slices-2,H*.6);}
        ctx.globalAlpha=alpha;ctx.fillStyle='#fff';ctx.fillRect(head*W,0,2,H);
      } else if(id==='chorus'){
        const v=Math.round(p.voices??2),depth=p.depth??.5,rate=.3+(p.rate??.3)*3;
        for(let k=0;k<v;k++){ctx.globalAlpha=alpha*(k?.55:1);
          line(x=>Math.sin(x*Math.PI*6+t*3+k*.9+Math.sin(t*rate+k*2.1)*depth*1.5)*amp*(1-k*.12));}
        ctx.globalAlpha=alpha;
      } else if(id==='compressor'){
        // Transfer curve: input level (x) against output level (y), with the threshold knee and the live gain reduction.
        const thr=1-(p.amount??.4),ratio=[2,4,8,20][Math.round(p.ratio??1)]??4,make=(p.makeup??.2)*.45;
        const curve=(x:number)=>Math.min(1,(x<thr?x:thr+(x-thr)/ratio)+make)*2-1;
        ctx.globalAlpha=alpha*.3;line(x=>x*2-1);ctx.globalAlpha=alpha;line(curve);
        ctx.fillStyle=color;ctx.globalAlpha=alpha*.8;ctx.fillRect(thr*W-1,0,2,H);
        const gr=Math.min(1,(reduction??0)/24);ctx.globalAlpha=alpha;ctx.fillRect(W-10,0,8,H*gr);
      } else if(id==='eq'){
        const lo=(p.low??0),mid=(p.mid??0),hi=(p.high??0),fm=Math.log10(200*Math.pow(25,p.freq??.5));
        const resp=(x:number)=>{const f=1.3+x*3; // log10 of 20 Hz .. 20 kHz
          const sl=1/(1+Math.exp((f-Math.log10(200))*6)),sh=1/(1+Math.exp(-(f-Math.log10(4000))*6)),bell=Math.exp(-Math.pow((f-fm)/.35,2));
          return (lo*sl+mid*bell+hi*sh)*.8;};
        ctx.globalAlpha=alpha*.3;line(()=>0);ctx.globalAlpha=alpha;ctx.shadowBlur=0;line(resp,true);ctx.shadowBlur=on?6+L*16:0;line(resp);
      } else if(id==='autowah'){
        // A band-pass peak that slides up as you play louder.
        const base=(p.base??.3)*.5,range=(p.range??.6)*.5,q=.04+.18*(1-(p.reso??.6));
        const c=base+range*Math.min(1,L*(.5+(p.sens??.5)*1.5));
        const resp=(x:number)=>Math.exp(-Math.pow((x-c)/q,2))*1.6*(.4+.6*amp)-.8;
        ctx.shadowBlur=0;line(resp,true);ctx.shadowBlur=on?6+L*16:0;line(resp);
      } else if(id==='gate'){
        // The gate's amplitude over one pattern: open cells (falling with Pump), closed cells down to (1 - Depth).
        const L=[4,6,8,9,12,16][Math.round(p.length??2)]??8,steps=Math.round(p.steps??0),depth=p.depth??1,pump=p.pump??0;
        const g=(x:number)=>{const c=x*L,k=Math.min(L-1,Math.floor(c));const open=(steps>>k)&1?1-pump*(c-k):0;return 1-depth*(1-open);};
        line(x=>(g(x)*2-1)*(.6+.4*amp),true);line(x=>(g(x)*2-1)*(.6+.4*amp));
      } else if(id==='resonator'){
        // One glowing string per tuned note, ringing with the level and Ring time.
        const notes=strings&&strings.length?strings:[48,52,55];
        const lo=Math.min(...notes)-6,hi=Math.max(...notes)+6;
        notes.forEach((n,k)=>{const x=(n-lo)/(hi-lo)*W,ring=(.3+.7*amp)*(.5+(p.decay??.5)*.5);
          ctx.globalAlpha=alpha*(.5+.5*ring);ctx.beginPath();
          for(let i=0;i<=40;i++){const y=i/40*H;const dx=Math.sin(i/40*Math.PI)*Math.sin(t*(8+k*3))*ring*10;i?ctx.lineTo(x+dx,y):ctx.moveTo(x+dx,y);}
          ctx.stroke();
          ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.font='bold 10px sans-serif';
          ctx.fillText(['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((n%12)+12)%12]+(Math.floor(n/12)-1),Math.min(W-22,x+4),H-4);});
      } else {
        const sp=p.speed??1;line(x=>Math.sin(x*Math.PI*6*sp+t*3*sp)*amp);ctx.globalAlpha=alpha*.3;line(x=>wave(x,1)*amp);
      }
      ctx.globalAlpha=1;ctx.shadowBlur=0;
    };
    raf=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf);
  },[]);
  return <canvas ref={canvas} className="fx-graph-canvas" aria-hidden="true"/>;
}
