/* Arcadia Heating Card v1.0.0 — dependency-free Home Assistant custom card.
 * Visual configuration and optional HA-side persistent boosts. No YAML required.
 * Boost installation is an explicit admin action in the visual editor.
 */
const VERSION = '1.0.0';
const OWNER = 'Managed by Arcadia Heating Card v1';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (v, fallback = NaN) => v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v);
const icon = name => `<ha-icon icon="${esc(name)}"></ha-icon>`;
const unavailable = s => !s || ['unavailable','unknown'].includes(s.state);
const call = (action, entity_id, data = {}) => ({action, target:{entity_id}, data});
const st = (entity_id, state) => ({condition:'state',entity_id,state});
const tpl = value_template => ({condition:'template', value_template});
const globals = {
  minimum:'input_number.arcadia_minimum_temperature', maximum:'input_number.arcadia_maximum_temperature',
  boost_temperature:'input_number.arcadia_boost_temperature', boost_duration:'input_number.arcadia_boost_duration', boost_limit:'input_number.arcadia_daily_boost_limit'
};
const defaults = {title:'Heating',brand:'Arcadia Home',subtitle:'Comfort. Control. Together.',minimum:16,maximum:24,boost_temperature:21,boost_duration:30,boost_limit:3,rooms:[],groups:[],show_brand:true};

export function boostIds(entity) {
  if (!/^climate\.[a-z0-9_]+$/.test(entity)) throw new Error('Select a valid climate entity.');
  const key = `arcadia_${entity.slice(8)}`;
  return {key,script:`script.${key}_boost`,automation:`automation.${key}_boost_expiry`,active:`input_boolean.${key}_boost_active`,previous:`input_number.${key}_previous_target`,target:`input_number.${key}_boost_target`,count:`input_number.${key}_boost_count`,deadline:`input_datetime.${key}_boost_until`,day:`input_datetime.${key}_boost_day`};
}

export function backendSpec(entity) {
  const b = boostIds(entity);
  const helpers = [
    {type:'input_boolean',id:b.active},
    ...[b.previous,b.target].map(id=>({type:'input_number',id,min:-50,max:150,step:0.1,mode:'box'})),
    {type:'input_number',id:b.count,min:0,max:9999,step:1,mode:'box'},
    {type:'input_datetime',id:b.deadline,has_date:true,has_time:true},
    {type:'input_datetime',id:b.day,has_date:true,has_time:false}
  ];
  const release = call('input_boolean.turn_off', b.active);
  const restore = [
    st(b.active,'on'),
    // Unavailable radios retain pending restoration; the expiry automation retries.
    tpl(`{{ has_value('${entity}') and is_number(state_attr('${entity}', 'temperature')) }}`),
    {if:[tpl(`{{ (state_attr('${entity}','temperature') | float - states('${b.target}') | float) | abs < 0.05 }}`)],then:[call('climate.set_temperature',entity,{temperature:`{{ states('${b.previous}') | float }}`})]},
    release
  ];
  const script = {
    alias:`Arcadia boost · ${entity.slice(8).replaceAll('_',' ')}`,description:`${OWNER}. Persistent deadline; retries unavailable devices; honours external target changes.`,mode:'queued',max:10,
    fields:{operation:{name:'Operation',required:true,selector:{select:{options:['start','cancel','expire','release']}}}},
    sequence:[{choose:[
      {conditions:[tpl("{{ operation == 'release' }}")],sequence:[release]},
      {conditions:[tpl("{{ operation == 'cancel' }}")],sequence:restore},
      {conditions:[tpl("{{ operation == 'expire' }}")],sequence:[tpl(`{{ as_timestamp(states('${b.deadline}'), 0) <= now().timestamp() }}`),...restore]},
      {conditions:[tpl("{{ operation == 'start' }}")],sequence:[
        {if:[{condition:'not',conditions:[st(entity,'heat')]}],then:[{stop:'Turn this radiator to Heat before starting a boost.',error:true}]},
        {if:[st(b.active,'on')],then:[{stop:'A boost is already running for this room.',error:true}]},
        {if:[tpl(`{{ not is_number(state_attr('${entity}', 'temperature')) or not (${Object.values(globals).map(id=>`has_value('${id}')`).join(' and ')}) }}`)],then:[{stop:'A temperature or boost setting is unavailable.',error:true}]},
        {if:[tpl(`{{ states('${b.day}') != now().strftime('%Y-%m-%d') }}`)],then:[call('input_number.set_value',b.count,{value:0}),call('input_datetime.set_datetime',b.day,{date:"{{ now().strftime('%Y-%m-%d') }}"})]},
        {if:[tpl(`{{ states('${b.count}') | int >= states('${globals.boost_limit}') | int }}`)],then:[{stop:'Daily boost limit reached.',error:true}]},
        {variables:{lo:`{{ [states('${globals.minimum}') | float, state_attr('${entity}','min_temp') | float(-50)] | max }}`,hi:`{{ [states('${globals.maximum}') | float, state_attr('${entity}','max_temp') | float(150)] | min }}`}},
        {if:[tpl('{{ lo > hi }}')],then:[{stop:'Minimum temperature exceeds maximum temperature.',error:true}]},
        {variables:{boost_value:`{{ [[states('${globals.boost_temperature}') | float, lo] | max, hi] | min }}`}},
        call('input_number.set_value',b.previous,{value:`{{ state_attr('${entity}', 'temperature') | float }}`}),
        call('input_number.set_value',b.target,{value:'{{ boost_value }}'}),
        call('input_datetime.set_datetime',b.deadline,{timestamp:`{{ now().timestamp() + states('${globals.boost_duration}') | float * 60 }}`}),
        call('input_boolean.turn_on',b.active),
        call('climate.set_temperature',entity,{temperature:'{{ boost_value }}'}),
        call('input_number.set_value',b.count,{value:`{{ states('${b.count}') | int(0) + 1 }}`})
      ]}
    ],default:[{stop:'Unknown boost operation.',error:true}]}]
  };
  const automation = {id:`${b.key}_boost_expiry`,alias:`Arcadia boost expiry · ${entity.slice(8).replaceAll('_',' ')}`,description:`${OWNER}. Restores expired boosts after a restart or radiator recovery.`,mode:'single',triggers:[{trigger:'time',at:b.deadline},{trigger:'homeassistant',event:'start'},{trigger:'time_pattern',minutes:'/1'}],conditions:[st(b.active,'on')],actions:[{action:b.script,data:{operation:'expire'}}]};
  return {ids:b,helpers,script,automation};
}

// Uses HA's authenticated configuration APIs, only following an explicit setup click.
// Resumable: existing helpers are reused and non-Arcadia scripts are never overwritten.
export async function installBoosts(hass, rooms, progress = ()=>{}) {
  if (!hass.user?.is_admin) throw new Error('An administrator must install boost controls.');
  const definitions = [
    {type:'input_number',id:globals.minimum,min:4,max:35,step:0.5,mode:'box',value:16},
    {type:'input_number',id:globals.maximum,min:4,max:35,step:0.5,mode:'box',value:24},
    {type:'input_number',id:globals.boost_temperature,min:4,max:35,step:0.5,mode:'box',value:21},
    {type:'input_number',id:globals.boost_duration,min:1,max:180,step:1,mode:'box',value:30},
    {type:'input_number',id:globals.boost_limit,min:0,max:20,step:1,mode:'box',value:3}
  ];
  const specs = [...new Set(rooms.map(r=>r.entity).filter(Boolean))].map(backendSpec);
  if (!specs.length) throw new Error('Select at least one radiator first.');
  const registries = {};
  for (const domain of ['input_number','input_datetime','input_boolean']) registries[domain] = await hass.callWS({type:`${domain}/list`});
  for (const d of [...definitions,...specs.flatMap(s=>s.helpers)]) {
    const id = d.id.split('.')[1];
    if (registries[d.type].some(item=>item.id===id)) continue;
    if (hass.states[d.id]) throw new Error(`Name conflict: ${d.id}. Rename the existing entity before setup.`);
    progress(`Creating ${id.replaceAll('_',' ')}…`);
    const {id:unused,value,type,...fields} = d;
    const created = await hass.callWS({type:`${type}/create`,name:id,...fields});
    if (created.id !== id) throw new Error(`Helper name conflict: expected ${id}, received ${created.id}. Setup stopped.`);
    registries[type].push(created);
    if (value !== undefined) await hass.callService(type,'set_value',{entity_id:d.id,value});
  }
  for (const spec of specs) {
    progress(`Installing boost for ${spec.ids.key.slice(8).replaceAll('_',' ')}…`);
    for (const [domain,id,config] of [['script',spec.ids.script.slice(7),spec.script],['automation',spec.automation.id,spec.automation]]) {
      let old;
      try { old = await hass.callApi('GET',`config/${domain}/config/${id}`); }
      catch(e) { if (Number(e.status_code ?? e.status) !== 404) throw e; }
      if (old && !String(old.description||'').startsWith(OWNER)) throw new Error(`Existing ${domain} ${id} belongs to another configuration.`);
      if (JSON.stringify(old)!==JSON.stringify(config)) await hass.callApi('POST',`config/${domain}/config/${id}`,config);
    }
  }
  progress('Timed boosts installed. Save this card.');
}

const styles = `
 :host{display:block;color:#edf2f4;font-family:var(--paper-font-body1_-_font-family,system-ui,-apple-system,Segoe UI,sans-serif);font-size:14px;color-scheme:dark}
 *{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;color:inherit}button:disabled,input:disabled{cursor:not-allowed;opacity:.45}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #86c8ff;outline-offset:3px}ha-icon{--mdc-icon-size:24px;display:inline-flex;flex-shrink:0}ha-card{display:block;border:1px solid #2c3943;background:linear-gradient(155deg,#101b23,#111a20 65%,#15222b);border-radius:24px;overflow:hidden;box-shadow:0 12px 36px #0003;color:inherit}
 .wrap{padding:20px;max-width:560px;margin:auto}.brand{display:flex;align-items:center;gap:10px;padding:3px 0 22px}.brand ha-icon{color:#85c6f5;--mdc-icon-size:36px}.brand strong{font-size:22px;letter-spacing:-.7px}.brand small{display:block;color:#a4b4be;font-size:12px;margin-top:2px}header{display:flex;align-items:center;gap:12px;margin:0 0 20px}h1{font-size:20px;line-height:1.3;margin:0;flex:1;font-weight:600;letter-spacing:-.3px}h2{font-size:16px;margin:0 0 12px;font-weight:600}p{line-height:1.55}.muted,small{color:#a9b8c2}small{font-size:12px;line-height:1.5}.intro{margin:0 0 13px 4px}.icon-button{display:grid;place-items:center;background:transparent;border:0;width:40px;height:40px;border-radius:12px;padding:0}.icon-button:hover{background:#ffffff0c}
 .room{width:100%;display:flex;text-align:left;align-items:center;gap:11px;border:1px solid #27353f;background:linear-gradient(105deg,#22303a,#1b2831);border-radius:16px;padding:12px 10px;margin:0 0 8px;min-height:76px;box-shadow:0 3px 9px #0002}.room:hover{border-color:#526777;background:#293a46}.tile-icon{display:grid;place-items:center;background:#ffffff06;border-radius:12px;width:43px;height:46px;flex-shrink:0}.tile-icon ha-icon{--mdc-icon-size:27px}.room .name{flex:1;min-width:0}.name strong{font-size:14px;font-weight:600;display:block;overflow-wrap:anywhere}.temps{margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;font-size:12px}.temps span{color:#aab9c2}.status{display:flex;align-items:center;gap:5px;font-size:11px;min-width:66px;justify-content:flex-end}.status ha-icon{--mdc-icon-size:20px}.heating,.boosting{color:#ffad37}.ready{color:#97ce69}.offline{color:#b6bcc2}.chev{--mdc-icon-size:17px;color:#a9b8c2}.panel{background:linear-gradient(125deg,#202d37,#1a2730);border:1px solid #263640;border-radius:18px;padding:19px;margin-bottom:13px}.hero{text-align:center;padding-top:24px;padding-bottom:25px}.hero .current{font-size:48px;font-weight:650;letter-spacing:-1.6px;margin:5px 0 12px}.hero .current ha-icon{--mdc-icon-size:33px;color:#a9b8c2;margin-right:7px}.hero .target{font-size:30px;color:#85c7fa;margin:5px 0 18px}.hero-status{display:flex;align-items:center;justify-content:center;gap:12px}.hero-status ha-icon{--mdc-icon-size:36px}.hero-status div{text-align:left}.hero-status strong{display:block;margin-bottom:3px;font-size:17px}.range-labels{display:flex;justify-content:space-between;color:#a9b8c2;font-size:12px;margin-top:18px}input[type=range]{width:100%;accent-color:#ffab32;height:30px;cursor:pointer}.stepper{display:flex;align-items:center;justify-content:space-between;margin:13px 0}.stepper button{background:#344650;border:1px solid #40545f;width:48px;height:48px;border-radius:50%;font-size:29px;line-height:1}.stepper output{font-size:36px;font-weight:600;letter-spacing:-1px}.center{text-align:center}.boost-title{display:flex;gap:12px;align-items:center;margin-bottom:18px}.bolt{background:#ff9e19;display:grid;place-items:center;border-radius:50%;width:38px;height:38px;flex-shrink:0}.boost-title h2{margin:0 0 3px}.primary{width:100%;background:linear-gradient(100deg,#ffb23c,#ff9917);border:1px solid #ffb445;border-radius:26px;color:#17212a;font-weight:650;padding:15px;min-height:48px}.primary:hover{filter:brightness(1.08)}.quiet{width:100%;padding:12px;background:#273a46;border:1px solid #3b5261;border-radius:14px;margin-top:10px}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:19px}.stat{border:1px solid #34434e;border-radius:12px;padding:12px;display:flex;gap:9px;align-items:center}.stat strong{display:block;font-size:13px;margin-bottom:3px}.stat ha-icon{--mdc-icon-size:22px;color:#bccbd4}.mode{display:flex;gap:8px;margin-top:14px}.mode button{flex:1;background:#18252e;border:1px solid #40535e;border-radius:12px;padding:10px}.mode button.selected{color:#ffb541;border-color:#bc8433;background:#ffad3210}.setting{padding:13px 0;border-top:1px solid #ffffff09;display:flex;align-items:center;gap:10px}.setting label{flex:1;font-size:13px}.setting input{width:80px;max-width:32%;padding:9px 4px;text-align:right;background:#13212a;border:1px solid #425766;border-radius:8px;color:#edf2f4}.info{border:1px solid #426d8b;background:#1c3547;border-radius:15px;padding:14px;display:flex;gap:12px;align-items:center;color:#bcdaef;font-size:12px;line-height:1.6}.info ha-icon{color:#75bffa}.error{background:#572e2e;color:#ffe0dc;padding:12px;border-radius:12px;margin-bottom:13px;overflow-wrap:anywhere}.footer{display:flex;justify-content:space-around;gap:8px;margin-top:24px;border-top:1px solid #34414a;padding-top:12px}.footer button{display:flex;flex-direction:column;align-items:center;gap:4px;border:0;background:none;padding:8px 18px;font-size:11px;color:#afbdc5}.footer .selected{color:#ffac36}.footer ha-icon{--mdc-icon-size:25px}.empty{text-align:center;padding:35px 15px;color:#b8c8d2;line-height:1.7}.success{color:#a6d99b}.editor{color:var(--primary-text-color);color-scheme:normal;padding:10px}.editor section{border:1px solid var(--divider-color,#667);border-radius:12px;padding:16px;margin:14px 0}.editor h3{margin:0 0 12px}.editor label{display:block;font-size:13px;margin:13px 0 5px}.editor input,.editor select{width:100%;padding:10px;border:1px solid var(--divider-color,#667);border-radius:8px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);min-height:43px}.editor button{padding:10px 14px;border:1px solid var(--divider-color,#667);border-radius:8px;background:var(--secondary-background-color,#ddd);color:var(--primary-text-color,#222);min-height:42px}.editor .tools{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.editor small{color:var(--secondary-text-color,#777)}.editor .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.editor p{font-size:13px}.editor .primary{background:#ffab30;color:#18212a}.editor summary{cursor:pointer;font-weight:600;padding:6px 0}
 @media(max-width:360px){.wrap{padding:12px}.room{gap:7px;padding:10px 7px}.status{min-width:55px;font-size:10px}.tile-icon{width:35px}.name strong{font-size:13px}.stats{gap:6px}.stat{padding:9px}.hero .current{font-size:42px}}`;

export class ArcadiaHeatingCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._screen='rooms';this._busy=false;this._editing=false;}
  static getConfigElement(){return document.createElement('arcadia-heating-card-editor');}
  static getStubConfig(hass){return {...defaults,rooms:Object.keys(hass?.states||{}).filter(id=>id.startsWith('climate.')&&id.includes('radiator')).map(entity=>({entity}))};}
  setConfig(config){this._config={...defaults,...structuredClone(config),rooms:(config.rooms||[]).map(r=>typeof r==='string'?{entity:r}:r)};this.render();}
  set hass(hass){this._hass=hass; if(!this._editing)this.render();}
  get hass(){return this._hass;}
  connectedCallback(){this._clock=setInterval(()=>{if(!this._editing)this.render();},30000);this.render();}
  disconnectedCallback(){clearInterval(this._clock);}
  getCardSize(){return 10;}
  getGridOptions(){return {columns:12,min_columns:6};}
  state(id){return this._hass?.states[id];}
  value(key){return number(this.state(globals[key])?.state,number(this._config[key],defaults[key]));}
  unit(){return this._hass?.config?.unit_system?.temperature||'°C';}
  temp(v){return Number.isFinite(number(v))?`${number(v).toFixed(1)}${this.unit()}`:'—';}
  name(r){return r.name||this.state(r.entity)?.attributes.friendly_name||r.entity||'Select radiator';}
  bounds(r){const a=this.state(r.entity)?.attributes||{};return {min:Math.max(this.value('minimum'),number(a.min_temp,this.value('minimum'))),max:Math.min(this.value('maximum'),number(a.max_temp,this.value('maximum'))),step:number(a.target_temp_step,0.5)};}
  boost(r){if(!/^climate\.[a-z0-9_]+$/.test(r.entity||''))return {installed:false,active:false,minutes:0,used:0};const b=boostIds(r.entity);const a=this.state(b.active)?.state==='on';const ts=number(this.state(b.deadline)?.attributes.timestamp,0);const today=new Intl.DateTimeFormat('en-CA',{timeZone:this._hass?.config?.time_zone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return {...b,installed:!!this.state(b.script),active:a,minutes:Math.max(0,Math.ceil((ts-Date.now()/1000)/60)),used:this.state(b.day)?.state===today?number(this.state(b.count)?.state,0):0};}
  status(r){const s=this.state(r.entity);if(unavailable(s))return {text:'Unavailable',icon:'mdi:cloud-off-outline',class:'offline',detail:'Check connection or batteries'};const b=this.boost(r);if(b.active)return {text:'Boosting',icon:'mdi:timer-outline',class:'boosting',detail:b.minutes?`${b.minutes} min left`:'Restoration pending'};if(s.state==='off')return {text:'Off',icon:'mdi:power',class:'offline',detail:'Radiator is switched off'};if(s.attributes.hvac_action==='heating')return {text:'Heating',icon:'mdi:fire',class:'heating',detail:'Calling for heat'};if(s.attributes.hvac_action==='idle')return {text:'Ready',icon:'mdi:leaf',class:'ready',detail:'Not calling for heat'};return {text:'Standby',icon:'mdi:thermostat',class:'offline',detail:'No reported heating demand'};}
  roomList(){return `<p class="intro muted">Choose a room</p>${this._config.rooms.map((r,i)=>{const s=this.state(r.entity),status=this.status(r);return `<button class="room" data-room="${i}"><span class="tile-icon">${icon(r.icon||'mdi:radiator')}</span><span class="name"><strong>${esc(this.name(r))}</strong><span class="temps">${unavailable(s)?'—':esc(this.temp(s.attributes.current_temperature))}<span>Target ${unavailable(s)?'—':esc(this.temp(s.attributes.temperature))}</span></span></span><span class="status ${status.class}">${icon(status.icon)}<span>${status.text}</span></span>${icon('mdi:chevron-right')}</button>`;}).join('')||'<div class="empty">Add radiators in the visual card editor to get started.</div>'}<button class="room" data-nav="settings"><span class="tile-icon">${icon('mdi:cog')}</span><span class="name"><strong>Heating Settings</strong><small>Targets, limits and boost</small></span>${icon('mdi:chevron-right')}</button>`;}
  roomDetail(){const r=this._config.rooms[this._room];if(!r)return this.roomList();const s=this.state(r.entity),a=s?.attributes||{},status=this.status(r),b=this.boost(r),bounds=this.bounds(r);const target=number(a.temperature,bounds.min),disabled=unavailable(s)||this._busy||bounds.min>bounds.max||!Number.isFinite(number(a.temperature));const dis=disabled?'disabled':'';const boostTarget=Math.min(bounds.max,Math.max(bounds.min,this.value('boost_temperature')));return `
    <section class="panel hero"><span class="muted">Current Temperature</span><div class="current">${icon('mdi:thermometer')}${unavailable(s)?'—':esc(this.temp(a.current_temperature))}</div><span class="muted">Target Temperature</span><div class="target">${unavailable(s)?'—':esc(this.temp(a.temperature))}</div><div class="hero-status ${status.class}">${icon(status.icon)}<div><strong>${status.text}</strong><small>${status.detail}</small></div></div></section>
    <section class="panel"><h2>Set Target Temperature</h2><div class="range-labels"><span>${esc(this.temp(bounds.min))}</span><span>${esc(this.temp(bounds.max))}</span></div><input aria-label="Target temperature" type="range" min="${bounds.min}" max="${bounds.max}" step="${bounds.step}" value="${Math.max(bounds.min,Math.min(bounds.max,target))}" ${dis}><div class="stepper"><button data-step="-1" aria-label="Decrease temperature" ${dis}>−</button><output>${esc(this.temp(target))}</output><button data-step="1" aria-label="Increase temperature" ${dis}>+</button></div><div class="center"><small>Allowed range: ${esc(this.temp(bounds.min))} – ${esc(this.temp(bounds.max))}</small></div><div class="mode">${(a.hvac_modes||[]).filter(m=>['off','heat','auto'].includes(m)).map(m=>`<button data-mode="${m}" class="${s.state===m?'selected':''}" ${unavailable(s)||this._busy?'disabled':''}>${m==='heat'?'Heat':m==='off'?'Off':'Auto'}</button>`).join('')}</div></section>
    <section class="panel"><div class="boost-title"><span class="bolt">${icon('mdi:lightning-bolt')}</span><div><h2>Boost</h2><small>Extra warmth for a set time.</small></div></div><button class="primary" data-boost="${b.active?'cancel':'start'}" ${disabled||!b.installed||(!b.active&&(s?.state!=='heat'||b.used>=this.value('boost_limit')))?'disabled':''}>${b.active?'Cancel boost':`Boost to ${esc(this.temp(boostTarget))}`}</button><p class="center"><small>${!b.installed?'Enable timed boosts in the visual card editor.':s?.state!=='heat'&&!b.active?'Select Heat to enable boosting.':`for ${this.value('boost_duration')} minutes`}</small></p><div class="stats"><div class="stat">${icon('mdi:chart-bar')}<div><strong>${b.used} of ${this.value('boost_limit')}</strong><small>boosts used today</small></div></div><div class="stat">${icon('mdi:clock-outline')}<div><strong>${b.active?(b.minutes?`${b.minutes} min left`:'Pending'):'Not active'}</strong><small>${b.active?'Returns to previous target':'No boost running'}</small></div></div></section>`;}
  setting(label,id,fallback,unit=''){const s=this.state(id);return `<div class="setting">${icon('mdi:thermometer')}<label>${esc(label)}</label>${id?`<input aria-label="${esc(label)}" data-helper="${esc(id)}" type="number" step="${number(s?.attributes.step,0.5)}" min="${number(s?.attributes.min,-50)}" max="${number(s?.attributes.max,150)}" value="${Number.isFinite(number(s?.state))?number(s.state):''}" ${unavailable(s)||this._busy?'disabled':''}>`:`<span>${esc(fallback)}</span>`}<small>${esc(unit)}</small></div>`;}
  settings(){return `<section class="panel"><h2>Day / Night Targets</h2><small>Linked helpers follow your existing automations. Selecting a helper here does not create a schedule.</small>${this._config.groups.map(g=>`<div style="margin-top:20px"><h2>${icon(g.icon||'mdi:home-floor-1')} ${esc(g.name||'Floor')}</h2>${g.target?this.setting('Target',g.target,'',this.unit()):''}${g.day?this.setting('☀ Day',g.day,'',this.unit()):''}${g.night?this.setting('☾ Night',g.night,'',this.unit()):''}${!g.target&&!g.day&&!g.night?'<p class="muted">Choose target helpers in the visual editor.</p>':''}</div>`).join('')||'<p class="muted">Add floors and target helpers in the visual editor.</p>'}</section><section class="panel"><h2>Global Settings</h2><small>Temperature limits apply to this card. Timed boosts use the shared Arcadia helpers.</small>${[['Minimum Temperature','minimum',this.unit()],['Maximum Temperature','maximum',this.unit()],['Boost Temperature','boost_temperature',this.unit()],['Boost Duration','boost_duration','min'],['Daily Boost Limit','boost_limit','boosts']].map(([label,key,unit])=>this.setting(label,this.state(globals[key])?globals[key]:undefined,this.value(key),unit)).join('')}<small>Unlinked values can be changed in the visual card editor.</small></section><div class="info">${icon('mdi:information')}<span>Temperatures are in ${esc(this.unit())}. A radiator marked unavailable is never shown as heating.</span></div>`;}
  render(){if(!this._config||!this._hass)return;const room=this._config.rooms[this._room];if(this._screen==='room'&&!room)this._screen='rooms';const title=this._screen==='room'?this.name(room):this._screen==='settings'?'Heating Settings':this._config.title;this.shadowRoot.innerHTML=`<style>${styles}</style><ha-card><div class="wrap">${this._config.show_brand?`<div class="brand">${icon('mdi:home-outline')}<div><strong>${esc(this._config.brand)}</strong><small>${esc(this._config.subtitle)}</small></div></div>`:''}<header>${this._screen!=='rooms'?`<button class="icon-button" data-nav="rooms" aria-label="Back to rooms">${icon('mdi:arrow-left')}</button>`:icon('mdi:fire')}<h1>${esc(title)}</h1><button class="icon-button" data-nav="settings" aria-label="Heating settings">${icon('mdi:cog-outline')}</button></header>${this._error?`<div class="error" role="alert">${esc(this._error)}</div>`:''}${this._screen==='settings'?this.settings():this._screen==='room'?this.roomDetail():this.roomList()}<nav class="footer"><button data-nav="rooms" class="${this._screen!=='settings'?'selected':''}">${icon('mdi:fire')}Heating</button><button data-nav="settings" class="${this._screen==='settings'?'selected':''}">${icon('mdi:cog-outline')}Settings</button></nav></div></ha-card>`;
    this.shadowRoot.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>{this._screen=el.dataset.nav;this._error='';this.render();});
    this.shadowRoot.querySelectorAll('[data-room]').forEach(el=>el.onclick=()=>{this._room=Number(el.dataset.room);this._screen='room';this._error='';this.render();});
    this.shadowRoot.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>{const r=this._config.rooms[this._room];this.setTemperature(number(this.state(r.entity)?.attributes.temperature)+Number(el.dataset.step)*this.bounds(r).step);});
    const range=this.shadowRoot.querySelector('input[type=range]');if(range){range.onpointerdown=()=>{this._editing=true;};range.oninput=()=>{this._editing=true;this.shadowRoot.querySelector('output').textContent=this.temp(range.value);};range.onchange=()=>{this._editing=false;this.setTemperature(number(range.value));};range.onblur=()=>{this._editing=false;};range.onpointercancel=()=>{this._editing=false;this.render();};}
    this.shadowRoot.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>this.run(async()=>{const r=this._config.rooms[this._room],b=this.boost(r);if(b.active)await this.boostCall(r,'release');await this._hass.callService('climate','set_hvac_mode',{entity_id:r.entity,hvac_mode:el.dataset.mode});}));
    this.shadowRoot.querySelector('[data-boost]')?.addEventListener('click',e=>this.run(()=>this.boostCall(this._config.rooms[this._room],e.currentTarget.dataset.boost)));
    this.shadowRoot.querySelectorAll('[data-helper]').forEach(el=>{el.onfocus=()=>{this._editing=true;};el.onblur=()=>{this._editing=false;};el.onchange=()=>{this._editing=false;this.run(async()=>{if(!el.checkValidity()||!Number.isFinite(number(el.value)))throw new Error('Enter a valid value within the allowed range.');await this._hass.callService('input_number','set_value',{entity_id:el.dataset.helper,value:number(el.value)});});};});
  }
  async run(fn){if(this._busy)return;this._busy=true;this._error='';this.render();try{await fn();}catch(e){this._error=e.message||String(e);}finally{this._busy=false;this.render();}}
  boostCall(r,operation){return this._hass.callService('script',boostIds(r.entity).script.slice(7),{operation});}
  setTemperature(value){return this.run(async()=>{const r=this._config.rooms[this._room],bounds=this.bounds(r);if(!Number.isFinite(value)||bounds.min>bounds.max)throw new Error('Invalid temperature range.');const temp=Math.max(bounds.min,Math.min(bounds.max,Math.round(value/bounds.step)*bounds.step));if(this.boost(r).active)await this.boostCall(r,'release');await this._hass.callService('climate','set_temperature',{entity_id:r.entity,temperature:Number(temp.toFixed(2))});});}
}

export class ArcadiaHeatingEditor extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  setConfig(config){this._config={...defaults,...structuredClone(config),rooms:(config.rooms||[]).map(r=>typeof r==='string'?{entity:r}:r)};this.render();}
  set hass(value){this._hass=value;if(!this.shadowRoot.firstChild)this.render();}
  emit(){this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this._config},bubbles:true,composed:true}));}
  select(value,domain,attrs){return `<select ${attrs}><option value="">— Select ${esc(domain)} entity —</option>${Object.values(this._hass?.states||{}).filter(s=>s.entity_id.startsWith(domain+'.')).sort((a,b)=>(a.attributes.friendly_name||a.entity_id).localeCompare(b.attributes.friendly_name||b.entity_id)).map(s=>`<option value="${esc(s.entity_id)}" ${s.entity_id===value?'selected':''}>${esc(s.attributes.friendly_name||s.entity_id)} · ${esc(s.entity_id)}</option>`).join('')}</select>`;}
  input(label,key,value,type='text',attrs=''){return `<label>${esc(label)}</label><input type="${type}" data-key="${key}" value="${esc(value)}" ${attrs}>`;}
  render(){if(!this._config||!this._hass)return;this.shadowRoot.innerHTML=`<style>${styles}</style><div class="editor"><h2>Arcadia Heating</h2><p>Choose radiators, arrange rooms and link settings here. No YAML needed.</p><section><h3>Appearance</h3>${this.input('Title','title',this._config.title)}${this.input('Brand name','brand',this._config.brand)}${this.input('Subtitle','subtitle',this._config.subtitle)}<label>Show brand</label><select data-key="show_brand"><option value="true" ${this._config.show_brand?'selected':''}>Yes</option><option value="false" ${!this._config.show_brand?'selected':''}>No</option></select></section><section><h3>Rooms</h3>${this._config.rooms.map((r,i)=>`<details open><summary>Room ${i+1} · ${esc(r.name||r.entity||'New room')}</summary><label>Radiator</label>${this.select(r.entity,'climate',`data-room-field="entity" data-index="${i}"`)}<label>Display name (optional)</label><input data-room-field="name" data-index="${i}" value="${esc(r.name)}"><label>Icon</label><input data-room-field="icon" data-index="${i}" placeholder="mdi:radiator" value="${esc(r.icon)}"><div class="tools"><button data-move="${i}" data-direction="-1" ${i===0?'disabled':''}>↑ Move up</button><button data-move="${i}" data-direction="1" ${i===this._config.rooms.length-1?'disabled':''}>↓ Move down</button><button data-remove="${i}">Remove room</button></div></details>`).join('<hr>')}<div class="tools"><button data-add="room">+ Add room</button></div><small>Adding a radiator to the card does not add it to your main heating-demand automation.</small></section><section><h3>Floor / day / night helpers</h3>${this._config.groups.map((g,i)=>`<details open><summary>${esc(g.name||'New floor')}</summary><label>Floor name</label><input data-group-field="name" data-index="${i}" value="${esc(g.name)}">${[['Current floor target','target'],['Day target (optional)','day'],['Night target (optional)','night']].map(([label,key])=>`<label>${label}</label>${this.select(g[key],'input_number',`data-group-field="${key}" data-index="${i}"`)}`).join('')}<div class="tools"><button data-remove-group="${i}">Remove floor</button></div></details>`).join('<hr>')}<div class="tools"><button data-add="group">+ Add floor</button></div><p>These controls edit your selected helpers. Your existing automations decide when those targets apply.</p></section><section><h3>Limits and boost settings</h3>${[['Minimum temperature','minimum'],['Maximum temperature','maximum'],['Boost temperature','boost_temperature'],['Boost duration (minutes)','boost_duration'],['Daily boost limit per room','boost_limit']].map(([label,key])=>`<label>${label} — default value</label><input type="number" step="0.5" data-key="${key}" value="${this._config[key]}"><small>${this._hass.states[globals[key]]?'Shared helper installed. Edit the live value on the card’s Settings screen.':'Used until timed boost setup creates shared settings helpers.'}</small>`).join('')}<p>Minimum and maximum constrain controls in this card; they are not a system-wide frost-protection policy.</p></section><section><h3>Reliable timed boosts</h3><p>Install persistent helpers, one boost script and one expiry automation per selected radiator. Boosts restore the previous target, survive Home Assistant restarts, and respect later manual/scheduled target changes. This also links shared global settings helpers.</p><button class="primary" data-install ${this._installing||!this._hass.user?.is_admin?'disabled':''}>${this._installing?'Installing…':'Enable timed boosts for selected rooms'}</button><p role="status" id="install-status">${esc(this._message||'Admin setup is needed once for each radiator you add.')}</p></section></div>`;
    this.shadowRoot.querySelectorAll('[data-key]').forEach(el=>el.onchange=()=>{const key=el.dataset.key;this._config[key]=key==='show_brand'?el.value==='true':el.type==='number'?number(el.value):el.value;this.emit();});
    for(const [attr,array] of [['roomField','rooms'],['groupField','groups']])this.shadowRoot.querySelectorAll(`[data-${array==='rooms'?'room':'group'}-field]`).forEach(el=>el.onchange=()=>{this._config[array][Number(el.dataset.index)][el.dataset[attr]]=el.value;this.emit();});
    this.shadowRoot.querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>{this._config[el.dataset.add==='room'?'rooms':'groups'].push({});this.emit();this.render();});
    this.shadowRoot.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{this._config.rooms.splice(Number(el.dataset.remove),1);this.emit();this.render();});
    this.shadowRoot.querySelectorAll('[data-remove-group]').forEach(el=>el.onclick=()=>{this._config.groups.splice(Number(el.dataset.removeGroup),1);this.emit();this.render();});
    this.shadowRoot.querySelectorAll('[data-move]').forEach(el=>el.onclick=()=>{const i=Number(el.dataset.move),j=i+Number(el.dataset.direction);[this._config.rooms[i],this._config.rooms[j]]=[this._config.rooms[j],this._config.rooms[i]];this.emit();this.render();});
    this.shadowRoot.querySelector('[data-install]').onclick=async()=>{this._installing=true;this._message='Starting setup…';this.render();try{await installBoosts(this._hass,this._config.rooms,msg=>{this._message=msg;this.shadowRoot.querySelector('#install-status').textContent=msg;});for(const [key,id]of Object.entries(globals))this._config[`${key}_entity`]=id;this.emit();}catch(e){this._message=`Setup stopped: ${e.message||String(e)}. You can retry; existing helpers are reused.`;}finally{this._installing=false;this.render();}};
  }
}

if(!customElements.get('arcadia-heating-card'))customElements.define('arcadia-heating-card',ArcadiaHeatingCard);
if(!customElements.get('arcadia-heating-card-editor'))customElements.define('arcadia-heating-card-editor',ArcadiaHeatingEditor);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==='arcadia-heating-card'))window.customCards.push({type:'arcadia-heating-card',name:'Arcadia Heating',description:'Room heating controls, floor targets and reliable timed boosts. Fully visual configuration.',preview:true});
console.info(`Arcadia Heating Card ${VERSION}`);

