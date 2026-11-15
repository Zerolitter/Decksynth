import {AudioWaveform,Grid2X2,KeyboardMusic} from 'lucide-react';
/** One explicit two-way choice; device state and ownership stay in the native worker. */
type Device='synth'|'drum_rack'|'sampler';
export function InstrumentSwitcher({device,onChange}:{device:Device;onChange:(device:Device)=>void}){
 return <div className="instrument-switcher" role="radiogroup" aria-label="Track instrument">
  <button type="button" role="radio" aria-label="Synth" aria-checked={device==='synth'} onClick={()=>onChange('synth')}><AudioWaveform size={16}/><span>Synth</span></button>
  <button type="button" role="radio" aria-label="Drum Rack" aria-checked={device==='drum_rack'} onClick={()=>onChange('drum_rack')}><Grid2X2 size={16}/><span>Drum Rack</span></button>
  <button type="button" role="radio" aria-label="Sampler" aria-checked={device==='sampler'} onClick={()=>onChange('sampler')}><KeyboardMusic size={16}/><span>Sampler</span></button>
 </div>;
}
