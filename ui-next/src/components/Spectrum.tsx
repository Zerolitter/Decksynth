import { useEffect, useRef } from 'react';

const N=512, BANDS=40;

function fftMag(input:number[]):Float32Array {
  const re=new Float32Array(N), im=new Float32Array(N);
  for(let i=0;i<N;i++){const w=.5-.5*Math.cos(2*Math.PI*i/(N-1));re[i]=(input[i]??0)*w;}
  for(let i=1,j=0;i<N;i++){let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
  for(let len=2;len<=N;len<<=1){
    const ang=-2*Math.PI/len;
    for(let i=0;i<N;i+=len)for(let k=0;k<len/2;k++){
      const c=Math.cos(ang*k),s=Math.sin(ang*k),a=i+k,b=a+len/2;
      const tr=re[b]*c-im[b]*s,ti=re[b]*s+im[b]*c;
      re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
    }
  }
  const mag=new Float32Array(N/2);
  for(let i=0;i<N/2;i++)mag[i]=Math.hypot(re[i],im[i]);
  return mag;
}

/** Live spectrum of the real engine output (FFT in the renderer, never in the audio process). */
export function Spectrum({samples}:{samples?:number[]}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const bars=useRef(new Float32Array(BANDS));
  const latest=useRef(samples);latest.current=samples;
  useEffect(()=>{
    let raf=0;
    const draw=()=>{
      raf=requestAnimationFrame(draw);
      const c=canvas.current;const ctx=c?.getContext('2d');if(!c||!ctx)return;
      const s=latest.current;const target=new Float32Array(BANDS);
      if(s&&s.length>=64){
        const mag=fftMag(s.length>=N?s.slice(-N):[...s,...Array(N-s.length).fill(0)]);
        for(let b=0;b<BANDS;b++){
          const lo=Math.floor(Math.pow(256,b/BANDS)),hi=Math.max(lo+1,Math.floor(Math.pow(256,(b+1)/BANDS)));
          let m=0;for(let k=lo;k<hi&&k<N/2;k++)m=Math.max(m,mag[k]);
          target[b]=Math.max(0,Math.min(1,(20*Math.log10(m+1e-6)+50)/50));
        }
      }
      const v=bars.current, w=c.width, h=c.height, bw=w/BANDS;
      ctx.clearRect(0,0,w,h);
      for(let b=0;b<BANDS;b++){
        v[b]=target[b]>v[b]?target[b]:v[b]*.9+target[b]*.1;
        const hue=160+b/BANDS*140;
        ctx.fillStyle=`hsl(${hue} 70% 62%)`;
        const bh=Math.max(1,v[b]*h);
        ctx.fillRect(b*bw+1,h-bh,bw-2,bh);
      }
    };
    raf=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(raf);
  },[]);
  return <canvas ref={canvas} className="fx-spectrum" width={320} height={40} aria-label="Live spectrum"/>;
}
