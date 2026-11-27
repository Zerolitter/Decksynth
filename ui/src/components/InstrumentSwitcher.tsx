import {AudioLines,AudioWaveform,Drum,Plug} from 'lucide-react';
/** One explicit choice; device state and ownership stay in the native worker.
 *  Each instrument has its own colour and icon (Sir, 16 Nov): the icon is always in colour, the chosen one fills. */
type Device='synth'|'drum_rack'|'sampler'|'plugin';
export const INSTRUMENT_COLORS:Record<Device,string>={synth:'#f2c46d',drum_rack:'#ff7f66',sampler:'#5fc8f0',plugin:'var(--c-plugin)'};
const ITEMS:[Device,string,typeof Drum][]=[['synth','Synth',AudioWaveform],['drum_rack','Drum Rack',Drum],['sampler','Sampler',AudioLines],['plugin','Plugin',Plug]];
export function InstrumentSwitcher({device,onChange}:{device:Device;onChange:(device:Device)=>void}){
 return <div className="instrument-switcher" role="radiogroup" aria-label="Track instrument">
  {ITEMS.map(([d,label,Icon])=><button key={d} type="button" role="radio" aria-label={label} aria-checked={device===d}
    style={{['--inst' as string]:INSTRUMENT_COLORS[d]}} onClick={()=>onChange(d)}><Icon size={17}/><span>{label}</span></button>)}
 </div>;
}
