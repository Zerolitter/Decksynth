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
      let x=e.clientX,y=e.clientY,next=original,marker:HTMLElement|null=null;
      const clear=()=>{card?.removeAttribute('data-rack-dragging');marker?.removeAttribute('data-drop-side');};
      drag.current=startRelativeDrag(el,e.nativeEvent,{
        threshold:7,pointerLock:false,
        onStart:()=>{moved.current=true;card?.setAttribute('data-rack-dragging','true');return true;},
        onMove:({dx,dy})=>{
          x+=dx;y+=dy;marker?.removeAttribute('data-drop-side');marker=null;next=original;
          const r=root.getBoundingClientRect();if(y<r.top||y>r.bottom||x<r.left-24||x>r.right+24)return;
          if(x>r.right-24)root.scrollLeft+=12;else if(x<r.left+24)root.scrollLeft-=12;
          const cards=Array.from(root.querySelectorAll<HTMLElement>('[data-panel]')).filter(n=>n!==card);
          const target=cards.find(n=>{const b=n.getBoundingClientRect();return x>=b.left&&x<=b.right;});
          if(!target)return;
          const b=target.getBoundingClientRect(),after=x>=b.left+b.width/2,other=target.dataset.panel!;
          const order=original.filter(v=>v!==id),at=order.indexOf(other);
          if(at<0)return;
          order.splice(at+(after?1:0),0,id);next=order;marker=target;target.dataset.dropSide=after?'after':'before';
        },
        onEnd:(canceled)=>{
          clear();
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
