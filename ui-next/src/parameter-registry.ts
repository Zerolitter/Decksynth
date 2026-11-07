import {FX_MODULES,SOUND_TARGETS,type FxModuleId} from './fx.ts';
export type ControlTarget={module:string;param:string};
export type MidiMapping=ControlTarget&{cc:number;channel:number};
const aliases:Record<string,string>={brightness:'filter','tone-motion':'modulation'};
/** Canonical IDs shared with controllers.py; layout/track IDs never become saved targets. */
export function knobControl(id:string,selected:number):ControlTarget|null{
 const match=/^(\d+)-(.+)$/.exec(id);if(!match||Number(match[1])!==selected)return null;
 const rest=match[2],macro=/^macro-([0-7])$/.exec(rest);if(macro)return {module:'macro',param:macro[1]};
 const fx=/^fx-([a-z]+)-(.+)$/.exec(rest);
 if(fx){const def=FX_MODULES[fx[1] as FxModuleId]?.params.find(p=>p.key===fx[2]);return def&&!def.options&&!def.hidden&&!def.editor&&def.precision!==0?{module:fx[1],param:fx[2]}:null;}
 const param=aliases[rest]??rest.replaceAll('-','_');return SOUND_TARGETS[param]?{module:'sound',param}:null;
}
export function ccForControl(target:ControlTarget,mappings:MidiMapping[]):number|null{
 const m=mappings.find(m=>m.module===target.module&&m.param===target.param);if(m)return m.cc;
 return target.module==='sound'&&target.param==='vcf_cutoff'&&!mappings.some(m=>m.cc===74)?74:null;
}
export function controlName(t:ControlTarget):string{
 if(t.module==='sound')return SOUND_TARGETS[t.param]?.label??t.param;
 if(t.module==='macro')return 'Macro '+(Number(t.param)+1);
 return (FX_MODULES[t.module as FxModuleId]?.name??t.module)+' '+(FX_MODULES[t.module as FxModuleId]?.params.find(p=>p.key===t.param)?.label??t.param);
}
