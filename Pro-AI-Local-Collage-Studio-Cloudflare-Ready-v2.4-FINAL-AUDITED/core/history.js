import { cloneProjectForHistory } from './model.js';

export class HistoryManager {
  constructor(limit=80){ this.limit=limit; this.undoStack=[]; this.redoStack=[]; this.lastSnapshot=null; }
  seed(project){ const snap=cloneProjectForHistory(project); this.lastSnapshot=snap; this.undoStack=[]; this.redoStack=[]; }
  commit(before, after){
    const b=cloneProjectForHistory(before), a=cloneProjectForHistory(after);
    if (JSON.stringify(b)===JSON.stringify(a)) return false;
    this.undoStack.push(b); if(this.undoStack.length>this.limit) this.undoStack.shift();
    this.redoStack=[]; this.lastSnapshot=a; return true;
  }
  undo(current){ if(!this.undoStack.length) return null; const previous=this.undoStack.pop(); this.redoStack.push(cloneProjectForHistory(current)); this.lastSnapshot=cloneProjectForHistory(previous); return previous; }
  redo(current){ if(!this.redoStack.length) return null; const next=this.redoStack.pop(); this.undoStack.push(cloneProjectForHistory(current)); this.lastSnapshot=cloneProjectForHistory(next); return next; }
  canUndo(){return this.undoStack.length>0}
  canRedo(){return this.redoStack.length>0}
}
