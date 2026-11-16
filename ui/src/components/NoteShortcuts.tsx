import {CircleHelp} from 'lucide-react';

/** Contextual entry into the same Help surface used by the transport's ? button. */
export function NoteShortcuts({compact=false}:{compact?:boolean}){
 // Rail tools each carry their own colour (UI rule 26); Help is yellow.
 return <button type="button" style={compact?{['--tool' as string]:'var(--t-help)'}:undefined} aria-label="Note editing help" title="Note editing help" aria-haspopup="dialog"
  onClick={e=>window.dispatchEvent(new CustomEvent('decksynth-open-help',{
   detail:{section:'notes',invoker:e.currentTarget},
  }))}>{compact?<><CircleHelp size={18}/><span>Help</span></>:'Help'}</button>;
}
