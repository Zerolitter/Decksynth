import {CircleHelp} from 'lucide-react';

/** Contextual entry into the same Help surface used by the transport's ? button. */
export function NoteShortcuts({compact=false}:{compact?:boolean}){
 return <button type="button" aria-label="Note editing help" title="Note editing help" aria-haspopup="dialog"
  onClick={e=>window.dispatchEvent(new CustomEvent('decksynth-open-help',{
   detail:{section:'notes',invoker:e.currentTarget},
  }))}>{compact?<><CircleHelp size={18}/><span>Help</span></>:'Help'}</button>;
}
