/** Focused 16-step MIDI synchronizer.
 * UI only: note starts and held regions are derived from saved/recording MIDI.
 * Clock position follows the same sample-clock beat reported to the timeline.
 * Inspired by ReplicantTr8s' lively hardware step indicators (not its drum engine).
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleDot, Radio } from 'lucide-react';
import { activeStep, patternCells } from '../pattern';
import { noteName, TRACK_COLORS, type Note, type Project } from '../types';

type Props = {
  project:Project;beat:number;playing:boolean;recording:boolean;selected:number;
  onSelect(index:number):void;compact?:boolean;
};

function stepSummary(notes:Note[], bars:number, step:number) {
  const start=step * bars * 4 / 16;
  const end=(step + 1) * bars * 4 / 16;
  const onsets=notes.filter(n=>n.start>=start&&n.start<end).map(n=>noteName(n.note));
  const unique=[...new Set(onsets)];
  return unique.length?unique.slice(0,5).join(', ')+(unique.length>5?' +more':''):'No new notes';
}

export function PatternSync({project,beat,playing,recording,selected,onSelect,compact=false}:Props) {
  const [inspected,setInspected]=useState<number|null>(null);
  const current=activeStep(beat,project.bars);
  const track=project.tracks[selected]??project.tracks[0];
  const cells=useMemo(()=>patternCells(track.notes,project.bars,16),[track.notes,project.bars]);
  const onsets=cells.reduce((sum,cell)=>sum+cell.on,0);
  // Sixteen cells cover the current loop: at four bars, each cell is one beat;
  // at one bar, each is a sixteenth note. Keep the display musically explicit.
  const beatsPerPad=project.bars*4/16;
  const resolution=beatsPerPad===.25?'1/16 NOTE':beatsPerPad===.5?'1/8 NOTE':
    beatsPerPad===1?'1 BEAT':beatsPerPad+' BEATS';
  useEffect(()=>setInspected(null),[selected,project.bars]);
  const label=inspected===null?'TAP A STEP TO INSPECT THE RECORDED MIDI':
    'STEP '+String(inspected+1).padStart(2,'0')+'  ·  '+stepSummary(track.notes,project.bars,inspected);
  return <section className={'pattern-panel hardware-sequencer'+(compact?' compact':'')}
    aria-label="16-step MIDI pattern synchronizer" data-testid="hardware-sequencer">
    <header className="pattern-header">
      <div className="pattern-heading">
        <Activity size={17}/><strong>Step view</strong>
        <span className="pattern-res">{resolution} per step</span>
      </div>
    <div className="pattern-focus-chips" role="group" aria-label="Choose the focused instrument">
        {project.tracks.map((t,i)=><button type="button" key={i}
          className={'pattern-focus-chip'+(i===selected?' selected':'')}
          style={{'--step-accent':TRACK_COLORS[i]} as React.CSSProperties}
          aria-pressed={i===selected} onClick={()=>onSelect(i)}
          title={'Show '+t.preset+' in the 16-step synchronizer'}>
          <span className="pattern-focus-dot"/>
          <span className="pattern-focus-name">{String(i+1).padStart(2,'0')} {t.preset}</span>
          <span className="pattern-note-count">{t.notes.length}</span>
        </button>)}
      </div>
      <div className="pattern-head-right">
        <span className={'sync-dot'+(playing?' active':'')}/>
        <span>{recording?'RECORD / LIVE':playing?'SAMPLE-CLOCK SYNC':'STOPPED'}</span>
        <b data-testid="pattern-live-step">{String(current+1).padStart(2,'0')} <i>/</i> 16</b>
      </div>
    </header>
    <div className="sequencer-pad-grid"
      role="group" aria-label={'16 visible steps for '+track.preset}
      style={{'--step-accent':TRACK_COLORS[selected]} as React.CSSProperties}>
      {cells.map((cell,i)=>{
        const live=playing&&current===i;
        const onset=cell.on>0;
        const tail=cell.held&&!onset;
        return <button key={i} type="button"
          data-testid={'seq-pad-'+(i+1)}
          className={'step-hardware-pad'+(onset?' has-onset':'')+
            (tail?' has-sustain':'')+(live?' is-live':'')+
            (inspected===i?' inspected':'')+(i%4===0?' bar-start':'')}
          aria-pressed={inspected===i}
          aria-current={live?'step':undefined}
          aria-label={'Step '+(i+1)+(onset?', '+cell.on+' note onset'+(cell.on===1?'':'s'):
            tail?', sustained note':', empty')+(live?', playing now':'')}
          onClick={()=>setInspected(i)}>
          <span className="step-pad-surface"/>
          <span className="step-pad-led"/>
          <span className="step-pad-number">{String(i+1).padStart(2,'0')}</span>
          {onset?<span className="step-pad-indicator" aria-hidden="true"/>:
            tail?<span className="step-pad-hold" aria-hidden="true"/>:null}
        </button>;
      })}
    </div>
    <footer className="pattern-footer">
      <span className="step-inspect-label"><CircleDot size={12}/> {label}</span>
      <span className="pattern-count"><Radio size={12}/>{resolution} / PAD · {onsets} ONSETS</span>
    </footer>
  </section>;
}
