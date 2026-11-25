/* The synth's Sample layer (25 Nov): a recording under the partials. Attack plays it once on top of each note (a kick click, a rim,
   a hat tick), Body plays it at the note's pitch and follows the amp envelope. "Spectrum" is a one-off button that reads the
   sample's overtones into the 16 partials. Empty state: the card itself offers "Choose a sample". The sample is chosen in the
   library sheet (SampleLibrary.tsx, pick mode). This is a view of the Sound page's big graph, in the module look: coloured
   outline, power button and title, 44 px knobs with value boxes in the card's colour. */
import type { ReactNode } from 'react';
import { AudioLines, FolderOpen, Power } from 'lucide-react';
import { useContextTarget } from './ContextWheel';
import type { Track } from '../types';

export type LayerInfo = { status: 'ready' | 'loading' | 'missing'; name: string; seconds: number; peaks: number[] } | null | undefined;
type Params = Track['instrument'];
type Knob = (param: string, name: string, value: number, min: number, max: number, extra: { onChange: (v: number) => void; [k: string]: unknown }) => ReactNode;

export const LAYER_COLOR = 'var(--c-layer)';
const fmtSec = (s: number) => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(1) + ' s';
export const fmtTuneSt = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + ' st';

/** The sample's outline; the part before Start is dimmed. */
function Wave({ peaks, start }: { peaks: number[]; start: number }) {
  const w = 100 / Math.max(1, peaks.length);
  return <svg className="ss-layer-peaks" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="100" y1="20" y2="20" className="ss-zero" />
    {peaks.map((v, i) => <rect key={i} x={i * w + .15} y={20 - Math.max(.4, v * 19)} width={Math.max(.3, w - .3)} height={Math.max(.8, v * 38)}
      className={i / peaks.length < start ? 'skipped' : ''} />)}
  </svg>;
}

export function LayerView({ p, K, set, layer, onChoose, onSpectrum }: {
  p: Params; K: Knob; set: (key: keyof Params, value: number) => void; layer: LayerInfo; onChoose: () => void; onSpectrum: () => void;
}) {
  const has = !!p.layer_file;
  const on = !!p.layer_on && has;
  const mode = p.layer_mode ?? 1;
  const ready = layer?.status === 'ready';
  const toggle = () => { if (!has) onChoose(); else set('layer_on', on ? 0 : 1); };
  const reset = () => { set('layer_level', 1); set('layer_tune', 0); set('layer_start', 0); set('layer_mode', 1); set('layer_follow', 0); set('layer_loop', 0); };
  const context = useContextTarget(() => ({ area: 'sound', kind: 'rack.card', label: 'Sample layer', caps: { bypass: toggle, reset } }));
  const label = !has ? 'Choose a sample' : layer?.status === 'missing' ? 'File not found' : layer?.status === 'loading' || !layer ? 'Loading…' : layer.name;
  return <div {...context} className={'ss-layer' + (on ? '' : ' off')} data-panel="sound-layer" aria-label="Sample layer">
    <button type="button" role="switch" className="ss-power ss-layer-power" aria-checked={on} aria-label={'Turn sample layer ' + (on ? 'off' : 'on')} onClick={toggle}>
      <Power size={13} />{on ? 'On' : 'Off'}</button>
    <div className="ss-layer-side">
      <button type="button" className={'ss-layer-wave' + (has ? '' : ' empty')} aria-label={has ? 'Sample ' + label + ' (tap to change)' : 'Choose a sample'} onClick={onChoose}>
        {has && ready && layer ? <Wave peaks={layer.peaks} start={p.layer_start ?? 0} /> : null}
        <span className="ss-layer-name">{has ? null : <FolderOpen size={18} />}<b>{label}</b>{has && ready && layer ? <small>{fmtSec(layer.seconds)}</small> : null}</span>
      </button>
      <button type="button" className="ss-layer-action" disabled={!ready} aria-label="Write the sample's spectrum into the partials"
        title="Measure the sample and write its overtones into the 16 partials" onClick={onSpectrum}><AudioLines size={16} /><span>Spectrum → partials</span></button>
    </div>
    <div className={'ss-knobs ss-layer-knobs' + (on ? '' : ' is-off')}>
      {K('layer_level', 'Level', p.layer_level ?? 1, 0, 2, { step: .005, suffix: '%', onChange: v => set('layer_level', v),
        description: 'How loud the sample is next to the synth voice.' })}
      {K('layer_tune', 'Tune', p.layer_tune ?? 0, -24, 24, { step: .1, format: fmtTuneSt, onChange: v => set('layer_tune', v) })}
      {K('layer_start', 'Start', p.layer_start ?? 0, 0, 1, { step: .005, suffix: '%', onChange: v => set('layer_start', v),
        description: 'Where in the sample it begins: skip a soft lead-in.' })}
      <div className="ss-seg ss-layer-mode" role="radiogroup" aria-label="Sample layer mode">
        {([[1, 'Attack', 'Plays once on top of every note'], [2, 'Body', "Plays at the note's pitch and follows the amp envelope"]] as [number, string, string][]).map(([v, name, tip]) =>
          <button key={v} type="button" role="radio" aria-checked={mode === v} title={tip} onClick={() => set('layer_mode', v)}>{name}</button>)}
      </div>
      <button type="button" role="switch" className="ss-layer-toggle" aria-checked={!!p.layer_follow} title="Send the sample through the synth's filter (its cutoff and resonance)"
        onClick={() => set('layer_follow', p.layer_follow ? 0 : 1)}>Through filter</button>
      <button type="button" role="switch" className="ss-layer-toggle" aria-checked={!!p.layer_loop} disabled={mode !== 2}
        title={mode === 2 ? 'Keep the sample going while the key is held' : 'Loop works in Body mode'} onClick={() => set('layer_loop', p.layer_loop ? 0 : 1)}>Loop</button>
    </div>
  </div>;
}
