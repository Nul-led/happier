const invoke=window.__TAURI__.core.invoke;const listen=window.__TAURI__.event.listen;let buffer='';
// Every element is looked up explicitly. `status` is a legacy Window attribute,
// so the id-named global would be that string rather than this element.
const el=(id)=>document.querySelector('#'+id);
const heading=el('heading'),status=el('status'),detail=el('detail'),review=el('review'),reviewTitle=el('reviewTitle'),facts=el('facts'),notice=el('notice'),actions=el('actions'),polite=el('polite'),assertive=el('assertive');
const send=(value)=>invoke('runner_core_send',{line:JSON.stringify(value)});
// No label is authored here. Every visible word arrives from the core's one
// endpoint presentation owner, so changing endpoint copy never edits the signed
// shell bytes — and the same projection reaches the terminal surface.
const button=(label,run,tone='secondary')=>{const b=document.createElement('button');b.textContent=label;b.onclick=run;b.className=tone;actions.append(b);return b};
// The core owns lifecycle and content. The shell keeps only the last closed
// presentation and which question is still outstanding, so a settled decision
// returns to the ambient surface without deciding anything itself.
let presentation=null,pending=null,lastAnnouncement=null,lastFocus=null;
// Focus follows the canonical presentation: the primary recovery action on a
// failure, the heading everywhere else. Allow is never a focus target.
function applyFocus(force=false){const recovery=presentation&&presentation.focusTarget==='primary_recovery'&&actions.children[0];const target=recovery||heading;const identity=presentation?presentation.status+'\n'+(presentation.detail||'')+'\n'+presentation.focusTarget:'heading';if(force||identity!==lastFocus){lastFocus=identity;target.focus()}}
function renderPanel(title,groups,lines){reviewTitle.textContent=title||'';reviewTitle.hidden=!title;facts.replaceChildren();for(const group of groups){
 const section=document.createElement('section');section.className='fact-group';
 if(group.title){const title=document.createElement('h3');title.textContent=group.title;section.append(title)}
 const primary=document.createElement('dl'),secondary=document.createElement('dl');
 for(const entry of group.facts){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');row.className=entry.id==='prompt'?'fact-row prompt':'fact-row';dt.textContent=entry.label;dd.textContent=entry.value;row.append(dt,dd);(entry.detail?secondary:primary).append(row)}
 if(primary.children.length)section.append(primary);
 if(secondary.children.length){const disclosure=document.createElement('details'),summary=document.createElement('summary');summary.textContent=group.detailsLabel;disclosure.append(summary,secondary);section.append(disclosure)}
 facts.append(section)
 }notice.textContent=lines.join('\n');notice.hidden=lines.length===0;status.hidden=!reviewTitle.hidden&&status.textContent===reviewTitle.textContent;
 // A question can be all consequence and no facts. Hiding the panel on empty
 // groups alone would leave the endpoint deciding against a blank surface.
 review.hidden=groups.length===0&&lines.length===0}
const quietFacts=()=>presentation&&presentation.facts.length?[{title:null,facts:presentation.facts}]:[];
// The ambient surface is exactly what the core presented: its phase-appropriate
// quiet facts and the one action the shell can raise on its own.
function renderAmbient(force=false){renderPanel(null,quietFacts(),[]);actions.replaceChildren();if(presentation)for(const action of presentation.actions)if(action.id==='stop_session')button(action.label,()=>send({v:1,event:{v:1,type:'stop_session'}}),'destructive');applyFocus(force)}
// Settling removes the buttons the question owned, so focus is restored rather
// than left on a detached node that drops the endpoint onto the document body.
function settle(id,response){pending=null;send({v:1,requestId:id,response});renderAmbient(true)}
function chooseFolder(id,chooser,focusChooser){actions.replaceChildren();
 const choose=button(chooser.chooseLabel,async()=>{const directory=await invoke('runner_pick_directory',{title:chooser.dialogTitle});
  // A cancelled OS dialog decides nothing, and `directory: null` is the
  // endpoint's explicit cancel answer: sending it here would cancel the
  // activation. Return to this same creator-authorized choice instead.
  if(directory==null){chooseFolder(id,chooser,true);return}
  settle(id,{v:1,type:'directory_selected',directory})});
 button(chooser.cancelLabel,()=>settle(id,{v:1,type:'directory_selected',directory:null}));
 focusChooser?choose.focus():applyFocus()}
function handle(value){
 if(value.publication?.type==='presentation'){presentation=value.publication.presentation;document.documentElement.lang=presentation.documentLanguage;status.textContent=presentation.status;status.hidden=!reviewTitle.hidden&&status.textContent===reviewTitle.textContent;detail.textContent=presentation.detail||'';const announcement=presentation.announcement.priority+'\n'+presentation.announcement.text;if(announcement===lastAnnouncement){polite.textContent='';assertive.textContent=''}else{lastAnnouncement=announcement;polite.textContent=presentation.announcement.priority==='polite'?presentation.announcement.text:'';assertive.textContent=presentation.announcement.priority==='assertive'?presentation.announcement.text:''}
  // An outstanding question owns the action area until it is settled; ambient
  // status never removes the only decision the core is waiting for.
  if(pending===null)renderAmbient();return}
 const id=value.requestId,r=value.request;if(!r)return;pending=id;const language=r.chooser?.documentLanguage||r.registry?.documentLanguage||r.review?.documentLanguage||r.confirm?.documentLanguage||r.recovery?.documentLanguage;if(language)document.documentElement.lang=language;
 if(r.type==='choose_directory'){chooseFolder(id,r.chooser,false);return}
 // The private-registry sign-in happens before any installation review. The
 // token is typed into a masked field and leaves only as this one answer; an
 // empty field is not an answer, so Sign in keeps the question open.
 if(r.type==='registry_profile'){const g=r.registry;renderPanel(g.title,[],g.signInAgain?[g.detail,g.signInAgain]:[g.detail]);actions.replaceChildren();
  const label=document.createElement('label');label.textContent=g.tokenLabel;const token=document.createElement('input');token.type='password';token.autocomplete='off';token.spellcheck=false;label.append(token);actions.append(label);
  button(g.signInLabel,()=>{const value=(token.value||'').trim();if(!value){token.focus();return}token.value='';settle(id,{v:1,type:'registry_profile_decision',decision:'sign_in',token:value})});
  button(g.withoutTokenLabel,()=>{token.value='';settle(id,{v:1,type:'registry_profile_decision',decision:'without_token'})});
  button(g.declineLabel,()=>{token.value='';settle(id,{v:1,type:'registry_profile_decision',decision:'decline'})});token.focus();return}
 if(r.type==='review'){renderPanel(r.review.title,r.review.sections,r.review.notice);actions.replaceChildren();
  // Optional plugin access is granted only by turning its own switch on; every
  // switch starts off and Allow sends exactly these answers.
  const choices=(r.review.optionalAccess&&r.review.optionalAccess.choices)||[];const selected=new Map(choices.map((c)=>[c.accessId,false]));
  if(choices.length){const group=document.createElement('fieldset'),title=document.createElement('legend');title.textContent=r.review.optionalAccess.title;group.append(title);
   for(const choice of choices){const row=document.createElement('label'),sw=document.createElement('input'),label=document.createElement('span');row.className='access-choice';sw.type='checkbox';sw.checked=false;sw.onchange=()=>selected.set(choice.accessId,sw.checked);label.textContent=choice.label;row.append(label,sw);group.append(row)}actions.append(group)}
  button(r.review.declineLabel,()=>settle(id,{v:1,type:'consent_decision',decision:'decline'}));button(r.review.allowLabel,()=>settle(id,{v:1,type:'consent_decision',decision:'allow',...(choices.length?{optionalSelections:[...selected].map(([accessId,value])=>({accessId,selected:value}))}:{})}),'primary');heading.focus();return}
 // The close question adds its consequence above the quiet running facts; the
 // endpoint keeps seeing which Session, folder and Agent it is deciding about.
 if(r.type==='confirm_active_close'){renderPanel(r.confirm.title,quietFacts(),[r.confirm.consequence]);actions.replaceChildren();const keep=button(r.confirm.keepOpenLabel,()=>settle(id,{v:1,type:'active_close_decision',decision:'keep_open'}));button(r.confirm.stopLabel,()=>settle(id,{v:1,type:'active_close_decision',decision:'stop'}),'destructive');keep.focus();return}
 // A terminal failure offers no retry, so it must not ask a question the
 // endpoint cannot answer.
 if(r.type==='failure_recovery'){renderPanel(null,[],r.canRetry?[r.recovery.message,r.recovery.question]:[r.recovery.message]);actions.replaceChildren();if(r.canRetry)button(r.recovery.retryLabel,()=>settle(id,{v:1,type:'failure_recovery_decision',decision:'retry'}));button(r.recovery.exitLabel,()=>settle(id,{v:1,type:'failure_recovery_decision',decision:'exit'}));applyFocus(true)}
}
// Tauri delivers an event only to a listener that already exists, and the
// shell starts the core only on the readiness signal below. Both listeners are
// therefore awaited first, so the core's first question is never emitted into
// a page that cannot hear it yet.
Promise.all([
 listen('runner-core-stdout',e=>{buffer+=e.payload;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{handle(JSON.parse(line))}catch{}}}),
 listen('runner-window-close-requested',()=>send({v:1,event:{v:1,type:'close_requested'}})),
]).then(()=>invoke('runner_renderer_ready'));
