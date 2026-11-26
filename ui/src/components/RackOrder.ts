import { useEffect, useRef, type RefObject } from 'react';
import { startRelativeDrag, type RelativeDragHandle } from '../chordz-primitives/relative-drag';

export type RackDrag = {
  start(e:React.PointerEvent<HTMLElement>):void;
  moved():boolean;
  key(e:React.KeyboardEvent):boolean;
};

/** One committed order change per gesture; the shared drag utility owns cancellation/capture. */
export function useRackOrder(rack:RefObject<HTMLElement|null>,ids:string[],onReorder:(ids:string[])=>void,owner:number){
  const latest=useRef({ids,onReorder});latest.current={ids,onReorder};
  const drag=useRef<RelativeDragHandle|null>(null),moved=useRef(false);
  useEffect(()=>()=>drag.current?.cancel(),[]);
  // Cancel at the bridge event, before React's later unmount cleanup can race pointerup.
  useEffect(()=>window.deckApi?.onMessage(m=>{if(m.selected!==undefined&&m.selected!==owner)drag.current?.cancel();}),[owner]);
  const identity=ids.join('|');
  useEffect(()=>{drag.current?.cancel();},[identity]);
  return (id:string):RackDrag=>({
    moved:()=>moved.current,
    key(e){
      if(!e.ctrlKey||!['ArrowLeft','ArrowRight'].includes(e.key))return false;
      e.preventDefault();e.stopPropagation();
      const next=[...latest.current.ids],i=next.indexOf(id),j=i+(e.key==='ArrowLeft'?-1:1);
      if(i>=0&&j>=0&&j<next.length){[next[i],next[j]]=[next[j],next[i]];latest.current.onReorder(next);}
      return true;
    },
    start(e){
      if(e.button!==0||(e.target as Element).closest('button:not(.rail-open),input,select,a,[role=slider]'))return;
      drag.current?.cancel();moved.current=false;
      // Keep an ordinary rail tap owned by its button; capturing the header would swallow its click.
      const el=(e.target as Element).closest<HTMLElement>('.rail-open')??e.currentTarget,root=rack.current;if(!root)return;
      const original=[...latest.current.ids],card=el.closest<HTMLElement>('[data-panel]');
      const x0=e.clientX,y0=e.clientY,top0=root.scrollTop,left0=root.scrollLeft,home=card?.getBoundingClientRect();
      let x=x0,y=y0,next=original,marker:HTMLElement|null=null;
      const clear=()=>{
        if(card){card.removeAttribute('data-rack-dragging');card.style.removeProperty('transform');}
        marker?.removeAttribute('data-drop-side');
      };
      // The card rides under the finger, and the drop place is the card under the finger (or the nearest one when the
      // finger is in a gap): rows and columns both count, so a drag works in every direction on the FX grid (25 Nov).
      const place=()=>{
        if(card)card.style.transform='translate('+(x-x0+root.scrollLeft-left0)+'px,'+(y-y0+root.scrollTop-top0)+'px)';
        marker?.removeAttribute('data-drop-side');marker=null;next=original;
        const r=root.getBoundingClientRect();if(y<r.top-24||y>r.bottom+24||x<r.left-24||x>r.right+24)return;
        // Back over its own place: it stays where it was.
        const up=root.scrollTop-top0,left=root.scrollLeft-left0;
        if(home&&x>=home.left-left&&x<=home.right-left&&y>=home.top-up&&y<=home.bottom-up)return;
        let best:HTMLElement|null=null,bestD=Infinity;
        for(const n of Array.from(root.querySelectorAll<HTMLElement>('[data-panel]'))){
          if(n===card)continue;
          const b=n.getBoundingClientRect(),dx=Math.max(b.left-x,0,x-b.right),dy=Math.max(b.top-y,0,y-b.bottom),d=dx*dx+dy*dy;
          if(d<bestD){best=n;bestD=d;}
        }
        if(!best)return;
        const b=best.getBoundingClientRect(),other=best.dataset.panel!;
        const order=original.filter(v=>v!==id),at=order.indexOf(other);
        if(at<0)return;
        // Before or after the card under the finger: its left or right half; past its row, the side the finger is on.
        const after=y>b.bottom?true:y<b.top?false:x>=b.left+b.width/2;
        order.splice(at+(after?1:0),0,id);next=order;marker=best;best.dataset.dropSide=after?'after':'before';
      };
      // Edge autoscroll: within EDGE px of the rack's top or bottom (or the sides) it scrolls every animation frame, faster
      // nearer the edge and even while the finger rests, then re-tests the drop place so the drop lands on what scrolled in.
      const EDGE=48;let frame=0;
      const speed=(pos:number,lo:number,hi:number)=>pos>hi-EDGE?Math.ceil(2+10*Math.min(1,(pos-(hi-EDGE))/EDGE)):pos<lo+EDGE?-Math.ceil(2+10*Math.min(1,(lo+EDGE-pos)/EDGE)):0;
      const tick=()=>{frame=0;const r=root.getBoundingClientRect();
        const dy=speed(y,r.top,r.bottom),dx=speed(x,r.left,r.right);
        if(!dy&&!dx)return;
        const t=root.scrollTop,l=root.scrollLeft;root.scrollTop+=dy;root.scrollLeft+=dx;
        place();
        if(root.scrollTop!==t||root.scrollLeft!==l)frame=requestAnimationFrame(tick);};
      const kick=()=>{place();if(!frame)frame=requestAnimationFrame(tick);};
      drag.current=startRelativeDrag(el,e.nativeEvent,{
        threshold:7,pointerLock:false,
        onStart:()=>{moved.current=true;card?.setAttribute('data-rack-dragging','true');return true;},
        onMove:({dx,dy})=>{
          x+=dx;y+=dy;
          kick();
        },
        onEnd:(canceled)=>{
          cancelAnimationFrame(frame);frame=0;clear();
          if(!canceled&&latest.current.ids.join('|')===original.join('|')&&next.join('|')!==original.join('|'))latest.current.onReorder(next);
        },
      });
    },
  });
}

/** Local SOUND layout only; unknown or removed card IDs never hide a current card. */
export function readRackOrder(key:string,ids:string[]):string[]{
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(Array.isArray(saved))return [...new Set([...saved.filter((v:unknown)=>typeof v==='string'&&ids.includes(v)),...ids])];}catch{/* optional layout preference */}
  return ids;
}
