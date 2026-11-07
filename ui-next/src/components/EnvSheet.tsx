import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Knob } from './Knob';
import { EnvEditor, type Env } from './EnvEditor';

type Props = {env:Env; color:string; accent:string; track:number; live?:Partial<Env>; container:Element|null;
  onChange(key:keyof Env, v:number):void; onClose():void};

/** The envelope's own sheet, opened from the picture on the Envelope card: a tall graph to drag, and its four knobs. */
export function EnvSheet({env, color, accent, track, live, container, onChange, onClose}:Props) {
  const opener=useRef(document.activeElement instanceof HTMLElement?document.activeElement:null);
  useEffect(()=>()=>{if(opener.current?.isConnected&&document.activeElement===document.body)opener.current.focus({preventScroll:true});},[]);
  useEffect(() => { const k = (e:KeyboardEvent) => { if (e.key==='Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  if (!container) return null;
  const knob = (key:keyof Env, name:string, min:number, max:number, suffix:string) =>
    <Knob key={key} id={'envsheet-' + track + '-' + key} name={name} value={env[key]} min={min} max={max} step={key==='sustain' ? .005 : .001}
      suffix={suffix} compact accent={color} onChange={v => onChange(key, v)}/>;
  return createPortal(<div className="mod-sheet-backdrop envelope-backdrop" onPointerDown={e => { if (e.target===e.currentTarget) onClose(); }}>
    <section className="mod-sheet env-sheet" role="dialog" aria-label="Envelope" style={{['--src' as string]:color}}>
      <header className="mod-sheet-bar">
        <i className="pe-dot"/><strong>Envelope · track {track + 1}</strong>
        <span className="pe-sub">Drag the dots. Hold still a moment before moving for fine steps.</span>
        <span className="pe-gap"/>
        <button type="button" className="mod-sheet-done" onClick={onClose}>Done</button>
      </header>
      <div className="env-sheet-body">
        <div className="env-sheet-graph"><EnvEditor env={env} color={color} onChange={onChange} live={live}/></div>
        <div className="env-sheet-knobs">
          {knob('attack', 'Attack', .001, 3, 's')}{knob('decay', 'Decay', .001, 3, 's')}
          {knob('sustain', 'Sustain', 0, 1, '%')}{knob('release', 'Release', .01, 3, 's')}
        </div>
      </div>
    </section>
  </div>, container);
}
