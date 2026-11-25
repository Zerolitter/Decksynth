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
 if(t.module==='sampler')return 'Sampler '+t.param.replace('_',' ');
 if(t.module==='drum'){const [pad,key]=t.param.split(':');return 'Pad '+(Number(pad)+1)+' '+key;}
 return (FX_MODULES[t.module as FxModuleId]?.name??t.module)+' '+(FX_MODULES[t.module as FxModuleId]?.params.find(p=>p.key===t.param)?.label??t.param);
}

/** Neutral values of the synth's sound keys a preset may leave out (engine PARAM_DEFAULTS, core.py), so a double-tap
 *  on any Sound knob resets it (Sir, 16 Nov). The filter envelope follows the amp envelope when it is not set. */
export const SOUND_NEUTRAL:Record<string,number>={curve:0,balance:.5,focus:0,focus_center:4,character:0,
 vcf_cutoff:.65,vcf_reso:.2,vcf_env:.3,vcf_morph:0,uni_detune:.3,formant:0,inharm:0,sub:0,
 pan:0,glide:0,pitch:0,velocity_brightness:0,velocity_cutoff:0,vcf_keytrack:.5,env_curve:0,air:0,drift:0,vel_curve:0,
 damp:0,noise:0,noise_decay:.03,noise_tone:.6,pitch_env:0,pitch_decay:.06,
 layer_level:1,layer_tune:0,layer_start:0};
export const FILTER_ENV_FROM:Record<string,string>={fenv_a:'attack',fenv_d:'decay',fenv_s:'sustain',fenv_r:'release'};
export function soundDefault(preset:Record<string,unknown>|undefined,param:string):number|undefined{
 const own=preset?.[param];if(typeof own==='number')return own;
 const amp=FILTER_ENV_FROM[param];if(amp){const v=preset?.[amp];return typeof v==='number'?v:undefined;}
 return SOUND_NEUTRAL[param];
}
