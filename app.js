// ── Shared data lives in Cloudflare D1, accessed via /api/* (see functions/api).
// There is no login: anyone who can load this page can read and write data.
const API = '/api';

const DEFAULT_CAP = {Full:400, Half:200, Leave:0};
const CAP_FALLBACK = {Full:400, Half:200, Leave:0};
const AVAIL_LABELS = {Full:'Full Day', Half:'Half Day', Leave:'Leave'};
const TASK_TYPES = [
  'Business As Usual (BAU)',
  'Service Delivery',
  'QA Team Project',
  'QA Team Initiative',
  'Non-QA Project',
  'Non-QA Team Initiative',
  'Meeting',
  'Training'
];
const CHART_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#ec4899','#84cc16'];
const WEEKLY_TARGET_PCT = 80; // reference line shown on the Weekly Utilization Trend chart

// In-memory cache of server data, refreshed after every mutation.
let _members     = [];
let _memberTasks = [];
let _logs        = [];
let _cap         = DEFAULT_CAP;
let _loaded      = false;

// ── API helpers ──────────────────────────────
async function apiGet(path){
  const res = await fetch(`${API}/${path}`);
  if(!res.ok) throw new Error((await safeJson(res))?.error || `Request failed (${res.status})`);
  return res.json();
}
async function apiSend(path, method, body){
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error((await safeJson(res))?.error || `Request failed (${res.status})`);
  return res.json();
}
async function safeJson(res){ try{ return await res.json(); }catch{ return null; } }

async function loadAllData(){
  const data = await apiGet('data');
  _members = data.members;
  _memberTasks = data.memberTasks;
  _logs = data.logs.map(l => ({...l, task:l.task||'Unknown Task', type:l.type||'Other', avail:l.avail||'Full'}));
  _cap = data.capacity && Object.keys(data.capacity).length ? data.capacity : DEFAULT_CAP;
  _loaded = true;
}

async function refreshAllAndRerender(){
  await loadAllData();
  const activeEl = document.querySelector('.app.active');
  const page = activeEl ? activeEl.id.replace('page-','') : 'logger';
  ({logger:refreshLogger, dashboard:refreshDashboard, logs:refreshLogs, settings:refreshSettings})[page]?.();
}

let _uid = Date.now();
const uid = () => ++_uid; // used only for client-side placeholder ids before a save round-trip if ever needed

// ── Helpers ──────────────────────────────────
const today = () => new Date().toISOString().slice(0,10);
const fmtMin = (min) => `${min||0} min`;
const fmtDate = d => { const dt=new Date(d+'T00:00:00'); return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); };
const sortByName = arr => [...arr].sort((a,b)=>a.name.localeCompare(b.name));

function showToast(msg, type='success'){
  const t=document.getElementById('toast');
  t.className='alert alert-'+(type==='success'?'success':'error');
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._t); t._t=setTimeout(()=>{t.style.display='none'},3000);
}

function fillSelect(id, items, vKey, lKey, prefix=''){
  const el=document.getElementById(id), cur=el.value;
  el.innerHTML=prefix+sortByName(items).map(m=>`<option value="${m[vKey]}">${m[lKey]}</option>`).join('');
  if([...el.options].some(o=>o.value===cur)) el.value=cur;
}

function capacityForLogs(logsSubset){
  const seen = new Set();
  let total = 0;
  logsSubset.forEach(l=>{
    const key = `${l.memberId}::${l.date}`;
    if(seen.has(key)) return;
    seen.add(key);
    const avail = l.avail || 'Full';
    total += _cap[avail] ?? CAP_FALLBACK[avail];
  });
  return total;
}
function utilPct(minutes, capacity){
  return capacity>0 ? Math.round((minutes/capacity)*100) : 0;
}

// ── Navigation ───────────────────────────────
function showPage(page, btn){
  document.querySelectorAll('.app').forEach(a=>a.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(!_loaded) return; // initial load will render once ready
  ({logger:refreshLogger, dashboard:refreshDashboard, logs:refreshLogs, settings:refreshSettings})[page]?.();
}

// ── Time Logger ──────────────────────────────
let _minMap = {};
let _currentTasks = [];

function refreshLogger(){
  fillSelect('logger-member', _members, 'id', 'name', '<option value="">— Select Member —</option>');
  const memEl=document.getElementById('logger-member');
  const dateEl=document.getElementById('logger-date');
  if(!dateEl.value) dateEl.value=today();
  if(!memEl.value){ clearLogger(); return; }

  const memberId=parseInt(memEl.value), date=dateEl.value;
  _currentTasks = sortByName(_memberTasks.filter(t=>t.memberId===memberId));

  const existing=_logs.filter(l=>l.memberId===memberId&&l.date===date);
  const existMap={}; existing.forEach(l=>{ if(l.taskId!=null) existMap[l.taskId]=l.minutes; });

  _minMap={};
  _currentTasks.forEach(t=>{ _minMap[t.id]=existMap[t.id]!=null?String(existMap[t.id]):''; });

  renderTaskList(memberId, date);
  renderSidebar(memberId, date, existing[0]?.avail||'Full');
}

function clearLogger(){
  document.getElementById('task-list-area').innerHTML='<p class="text-muted text-sm">Select a member and date to begin.</p>';
  document.getElementById('avail-panel').innerHTML='<p class="text-muted text-sm">Select a member</p>';
  document.getElementById('summary-panel').innerHTML='<p class="text-muted text-sm">No data yet</p>';
  document.getElementById('task-count-desc').textContent='';
  document.getElementById('save-btn').disabled=true;
  _currentTasks=[];
}

function renderTaskList(memberId, date){
  const area=document.getElementById('task-list-area');
  if(!_currentTasks.length){
    area.innerHTML='<p class="text-muted text-sm">No tasks yet for this member — click "+ Add Task" to create one. It will then show up here every day.</p>';
    document.getElementById('save-btn').disabled=true;
    updateCountDesc();
    return;
  }

  area.innerHTML=_currentTasks.map(t=>`
    <div class="task-row">
      <div>
        <div class="task-name">${t.name}</div>
        <div class="task-type-label">${t.type}</div>
      </div>
      <input type="number" class="min-input" id="min-${t.id}" min="0" max="999"
             value="${_minMap[t.id]||''}" placeholder="0"
             oninput="onMinChange(${t.id},this.value)" />
      <div class="text-sm text-muted text-center" id="hrs-${t.id}">
        ${_minMap[t.id]?fmtMin(parseInt(_minMap[t.id])||0):'—'}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteMemberTask(${t.id})" title="Remove this recurring task">✕</button>
    </div>`).join('');

  updateCountDesc();
  document.getElementById('save-btn').disabled=false;
}

function onMinChange(taskId, val){
  _minMap[taskId]=val;
  const m=parseInt(val)||0;
  const hel=document.getElementById('hrs-'+taskId);
  if(hel) hel.textContent=m>0?fmtMin(m):'—';
  updateCountDesc();
  updateSummaryLive();
}

function updateCountDesc(){
  const filled=Object.values(_minMap).filter(v=>v!=='').length;
  document.getElementById('task-count-desc').textContent=`${filled} of ${_currentTasks.length} tasks filled`;
}

async function deleteMemberTask(taskId){
  if(!confirm('Remove this task from the daily list for everyone? Minutes already logged against it will be kept in reports.')) return;
  try{
    await apiSend(`tasks/${taskId}`, 'DELETE');
    await refreshAllAndRerender();
    showToast('Task removed');
  }catch(e){
    showToast('Failed to remove task: '+e.message, 'error');
  }
}

function renderSidebar(memberId, date, currentAvail){
  document.getElementById('avail-panel').innerHTML=Object.keys(AVAIL_LABELS).map(k=>`
    <div class="avail-row">
      <label style="margin:0;cursor:pointer;display:flex;align-items:center;gap:6px">
        <input type="radio" name="avail" value="${k}" ${currentAvail===k?'checked':''} onchange="updateSummaryLive()">
        ${AVAIL_LABELS[k]}
      </label>
      <span class="badge badge-gray">${fmtMin(_cap[k]??CAP_FALLBACK[k])}</span>
    </div>`).join('');
  updateSummaryLive();
}

function updateSummaryLive(){
  const avEl=document.querySelector('input[name=avail]:checked');
  const avail=avEl?avEl.value:'Full';
  const cap=_cap[avail]??CAP_FALLBACK[avail];
  const total=Object.values(_minMap).reduce((s,v)=>s+(parseInt(v)||0),0);
  const pct=utilPct(total,cap);
  let bc='badge-green'; if(pct<60)bc='badge-amber'; if(pct>100)bc='badge-red';

  document.getElementById('summary-panel').innerHTML=`
    <div class="summary-grid">
      <div class="summary-item"><div class="summary-value">${fmtMin(total)}</div><div class="summary-label">Logged</div></div>
      <div class="summary-item"><div class="summary-value">${fmtMin(cap)}</div><div class="summary-label">Capacity (${avail})</div></div>
    </div>
    <div style="text-align:center;margin-top:12px">
      <span class="badge ${bc}" style="font-size:.875rem;padding:4px 14px">${pct}% utilised</span>
    </div>`;
}

// ── Add (recurring) Task Dialog ───────────────
function populateTaskTypeSelect(){
  const sel=document.getElementById('dialog-task-type');
  sel.innerHTML=TASK_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('');
}

function openAddTaskDialog(){
  const memberId=parseInt(document.getElementById('logger-member').value);
  if(!memberId){ showToast('Select a member first','error'); return; }

  document.getElementById('dialog-task-name').value='';
  document.getElementById('dialog-task-type').value=TASK_TYPES[0];
  document.getElementById('task-dialog-overlay').style.display='flex';
  document.getElementById('dialog-task-name').focus();
}

function closeAddTaskDialog(){
  document.getElementById('task-dialog-overlay').style.display='none';
}

async function submitAddTask(){
  const memberId=parseInt(document.getElementById('logger-member').value);
  const name=document.getElementById('dialog-task-name').value.trim();
  const type=document.getElementById('dialog-task-type').value;
  if(!memberId){ showToast('Select a member first','error'); return; }
  if(!name){ showToast('Enter a task name','error'); return; }

  try{
    await apiSend('tasks', 'POST', {memberId, name, type});
    closeAddTaskDialog();
    await refreshAllAndRerender();
    showToast('Task added — it will now show up every day');
  }catch(e){
    showToast('Failed to add task: '+e.message, 'error');
  }
}

async function saveEntries(){
  const memEl=document.getElementById('logger-member');
  const dateEl=document.getElementById('logger-date');
  const memberId=parseInt(memEl.value), date=dateEl.value;
  if(!memberId||!date){ showToast('Select a member and date','error'); return; }
  const avEl=document.querySelector('input[name=avail]:checked');
  const avail=avEl?avEl.value:'Full';

  const entries=_currentTasks.map(t=>({
    taskId:t.id, task:t.name, type:t.type, minutes:parseInt(_minMap[t.id])||0
  })).filter(e=>e.minutes>0);

  const saveBtn=document.getElementById('save-btn');
  saveBtn.disabled=true;
  try{
    await apiSend('logs/save', 'POST', {memberId, date, avail, entries});
    showToast('Saved successfully!');
    await refreshAllAndRerender();
  }catch(e){
    showToast('Failed to save: '+e.message, 'error');
    saveBtn.disabled=false;
  }
}

// ── Dashboard ────────────────────────────────
function refreshDashboard(){
  fillSelect('dash-member',_members,'id','name','<option value="">All Members</option>');
  const ds=document.getElementById('dash-start'), de=document.getElementById('dash-end');
  if(!ds.value){ const d=new Date(today()); d.setDate(d.getDate()-29); ds.value=d.toISOString().slice(0,10); }
  if(!de.value) de.value=today();

  const start=ds.value, end=de.value;
  const memId=parseInt(document.getElementById('dash-member').value)||0;
  let logs=_logs.filter(l=>l.date>=start&&l.date<=end);
  if(memId) logs=logs.filter(l=>l.memberId===memId);

  const total=logs.reduce((s,l)=>s+l.minutes,0);
  const capTotal=capacityForLogs(logs);
  const util=utilPct(total,capTotal);
  const days=[...new Set(logs.map(l=>l.date))].length;
  const avg=days>0?Math.round(total/days):0;

  const typeMins={};
  logs.forEach(l=>{ const tp=l.type||'Other'; typeMins[tp]=(typeMins[tp]||0)+l.minutes; });
  const sortedTypes=Object.entries(typeMins).sort((a,b)=>b[1]-a[1]);
  const topType=sortedTypes[0]?.[0]||'—';

  // ── KPI cards ──
  document.getElementById('kpi-grid').innerHTML=[
    {v:fmtMin(total),l:'Total Time Logged'},
    {v:util+'%',l:'Utilisation'},
    {v:logs.length,l:'Total Tasks'},
    {v:topType.length>18?topType.slice(0,17)+'…':topType,l:'Top Task Type'},
    {v:fmtMin(avg),l:'Daily Average'},
  ].map(k=>`<div class="card kpi-card"><div class="kpi-value" title="${k.v}">${k.v}</div><div class="kpi-label">${k.l}</div></div>`).join('');

  // ── Utilisation by member ──
  const members=memId?[_members.find(m=>m.id===memId)].filter(Boolean):sortByName(_members);
  const memLogs={}; _members.forEach(m=>memLogs[m.id]=[]);
  logs.forEach(l=>{ (memLogs[l.memberId]=memLogs[l.memberId]||[]).push(l); });
  document.getElementById('util-chart').innerHTML=members.length?'<div class="bar-chart">'+members.map(m=>{
    const mLogs=memLogs[m.id]||[];
    const mins=mLogs.reduce((s,l)=>s+l.minutes,0);
    const cap=capacityForLogs(mLogs);
    const upct=utilPct(mins,cap);
    return `<div class="bar-row">
      <div class="font-medium" title="${m.name}">${m.name.split(' ')[0]}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(upct,100)}%"></div></div>
      <div class="text-right text-xs text-muted">${upct}%</div></div>`;
  }).join('')+'</div>':'<p class="text-muted text-sm">No data for this period.</p>';

  // ── Top task types (bar) ──
  const maxT=Math.max(1,...sortedTypes.map(e=>e[1]));
  const cols=['','green','amber','',''];
  document.getElementById('type-chart').innerHTML=sortedTypes.length?'<div class="bar-chart">'+sortedTypes.slice(0,5).map(([tp,min],i)=>`
    <div class="bar-row">
      <div class="font-medium text-xs" title="${tp}">${tp.length>16?tp.slice(0,15)+'…':tp}</div>
      <div class="bar-track"><div class="bar-fill ${cols[i]||''}" style="width:${Math.round((min/maxT)*100)}%"></div></div>
      <div class="text-right text-xs text-muted">${fmtMin(min)}</div></div>`).join('')+'</div>'
    :'<p class="text-muted text-sm">No data for this period.</p>';

  // ── Donut: Time Spent by Task Type (%) ──
  renderDonutChart(sortedTypes, total);

  // ── Weekly Utilization Trend (rolling last 7 days, live) ──
  renderWeeklyTrend(memId);

  // ── Gauge: Time Logged vs Available ──
  renderGaugeChart(total, capTotal, util);

  // ── Monthly stacked task type chart ──
  renderMonthlyChart(logs, start, end);
}

function renderDonutChart(sortedTypes, total){
  const el=document.getElementById('type-donut-chart');
  if(!sortedTypes.length){ el.innerHTML='<p class="text-muted text-sm">No data for this period.</p>'; return; }
  let cum=0;
  const stops=sortedTypes.map(([type,min],i)=>{
    const pct=total>0?(min/total*100):0;
    const start=cum; cum+=pct;
    return `${CHART_COLORS[i%CHART_COLORS.length]} ${start}% ${cum}%`;
  }).join(', ');
  el.innerHTML=`
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${stops})">
        <div class="donut-hole">
          <div class="donut-total">${fmtMin(total)}</div>
          <div class="donut-total-label">Total</div>
        </div>
      </div>
      <div class="donut-legend-col">
        ${sortedTypes.map(([type,min],i)=>{
          const pct=total>0?Math.round(min/total*100):0;
          return `<div class="donut-legend-row">
            <span class="monthly-legend-swatch" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>
            <span class="donut-legend-name" title="${type}">${type}</span>
            <span class="donut-legend-pct text-muted">${pct}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderWeeklyTrend(memId){
  const el=document.getElementById('weekly-trend-chart');
  const days=[];
  for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }

  const points=days.map(date=>{
    let dayLogs=_logs.filter(l=>l.date===date);
    if(memId) dayLogs=dayLogs.filter(l=>l.memberId===memId);
    const dTotal=dayLogs.reduce((s,l)=>s+l.minutes,0);
    const dCap=capacityForLogs(dayLogs);
    const util=utilPct(dTotal,dCap);
    const label=new Date(date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short'});
    return {util,label};
  });

  const w=460, h=190, padTop=22, padBottom=28, padX=28;
  const innerW=w-padX*2, innerH=h-padTop-padBottom;
  const stepX=points.length>1?innerW/(points.length-1):0;
  const clamp=v=>Math.max(0,Math.min(v,130));
  const yFor=v=>padTop+innerH-(clamp(v)/130)*innerH;
  const xFor=i=>padX+stepX*i;

  const linePoints=points.map((p,i)=>`${xFor(i)},${yFor(p.util)}`).join(' ');
  const targetY=yFor(WEEKLY_TARGET_PCT);

  const circles=points.map((p,i)=>`<circle cx="${xFor(i)}" cy="${yFor(p.util)}" r="3.5" fill="var(--primary)" />`).join('');
  const valueLabels=points.map((p,i)=>`<text x="${xFor(i)}" y="${yFor(p.util)-10}" class="trend-point-label">${p.util}%</text>`).join('');
  const axisLabels=points.map((p,i)=>`<text x="${xFor(i)}" y="${h-8}" class="trend-axis-label">${p.label}</text>`).join('');

  el.innerHTML=`
    <svg viewBox="0 0 ${w} ${h}" class="trend-svg">
      <line x1="${padX}" y1="${targetY}" x2="${w-padX}" y2="${targetY}" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="4,4" />
      <text x="${w-padX}" y="${targetY-5}" text-anchor="end" class="trend-target-label">Target (${WEEKLY_TARGET_PCT}%)</text>
      <polyline points="${linePoints}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${circles}
      ${valueLabels}
      ${axisLabels}
    </svg>`;
}

function renderGaugeChart(total, cap, util){
  const el=document.getElementById('gauge-chart');
  const cx=110, cy=100, r=80;
  const pt=angleDeg=>{ const rad=angleDeg*Math.PI/180; return {x:cx+r*Math.cos(rad), y:cy-r*Math.sin(rad)}; };
  const start=pt(180), fullEnd=pt(0);
  const clampedUtil=Math.max(0,Math.min(util,100));
  const percentAngle=180*(1-clampedUtil/100);
  const end=pt(percentAngle);

  el.innerHTML=`
    <div class="gauge-wrap">
      <svg viewBox="0 0 220 120" class="gauge-svg">
        <path d="M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${fullEnd.x} ${fullEnd.y}" fill="none" stroke="var(--muted-bg)" stroke-width="16" stroke-linecap="round" />
        <path d="M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}" fill="none" stroke="var(--primary)" stroke-width="16" stroke-linecap="round" />
        <text x="${cx}" y="${cy-6}" class="gauge-percent-text">${util}%</text>
        <text x="${cx}" y="${cy+14}" class="gauge-sub-text">Utilisation</text>
      </svg>
      <div class="gauge-ticks"><span>0%</span><span>100%</span></div>
      <div class="gauge-stats">
        <span class="gauge-stat-logged">${fmtMin(total)} Logged</span>
        <span class="gauge-stat-available">${fmtMin(cap)} Available</span>
      </div>
    </div>`;
}

function renderMonthlyChart(logs, start, end){
  const monthKeys=[];
  if(start&&end){
    const cursor=new Date(start+'T00:00:00'), last=new Date(end+'T00:00:00');
    cursor.setDate(1); last.setDate(1);
    while(cursor<=last){
      monthKeys.push(cursor.toISOString().slice(0,7));
      cursor.setMonth(cursor.getMonth()+1);
    }
  }
  const monthly={};
  const taskTypes=new Set();
  logs.forEach(l=>{
    const type=l.type||'Other';
    taskTypes.add(type);
    const month=l.date.slice(0,7);
    if(!monthly[month]) monthly[month]={};
    monthly[month][type]=(monthly[month][type]||0)+l.minutes;
  });
  const monthlyTypes=[...taskTypes].sort((a,b)=>a.localeCompare(b));
  const monthlyRows=monthKeys.map(key=>{
    const d=new Date(key+'-01T00:00:00');
    return {label:d.toLocaleDateString('en-US',{month:'short',year:'numeric'}),values:monthly[key]||{}};
  });
  const maxMonthly=Math.max(1,...monthlyRows.map(row=>Object.values(row.values).reduce((sum,value)=>sum+value,0)));
  const monthlyChart=document.getElementById('monthly-type-chart');
  monthlyChart.innerHTML=monthlyTypes.length?`
    <div class="monthly-chart">
      <div style="position:relative">
        <div class="monthly-plot">
          ${monthlyRows.map(row=>{
            const total=Object.values(row.values).reduce((sum,value)=>sum+value,0);
            return `<div class="monthly-bar-group" aria-label="${row.label}: ${fmtMin(total)}">
              <div class="monthly-bar-stack ${total?'':'empty'}" style="height:${total?Math.max((total/maxMonthly)*100,2):2}%">
                ${monthlyTypes.map((type,i)=>{
                  const minutes=row.values[type];
                  if(!minutes) return '';
                  const percent=Math.round((minutes/total)*100);
                  return `<div class="monthly-segment" style="height:${percent}%;background:${CHART_COLORS[i%CHART_COLORS.length]}" title="${type}: ${fmtMin(minutes)} (${percent}%)"><span class="monthly-segment-label">${percent}%</span></div>`;
                }).join('')}
              </div>
              <div class="monthly-label">${row.label}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="monthly-axis">
          <span>${fmtMin(maxMonthly)}</span><span>${fmtMin(Math.round(maxMonthly*.75))}</span>
          <span>${fmtMin(Math.round(maxMonthly*.5))}</span><span>${fmtMin(Math.round(maxMonthly*.25))}</span><span>0 min</span>
        </div>
      </div>
      <div class="monthly-legend">
        ${monthlyTypes.map((type,i)=>`<span class="monthly-legend-item"><span class="monthly-legend-swatch" style="background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>${type}</span>`).join('')}
      </div>
    </div>`
    :'<p class="text-muted text-sm">No data for this period.</p>';
}

// ── All Logs ─────────────────────────────────
function refreshLogs(){
  fillSelect('logs-member',_members,'id','name','<option value="">All Members</option>');
  const ls=document.getElementById('logs-start'), le=document.getElementById('logs-end');
  if(!ls.value&&!le.value){ const d=new Date(today()); d.setDate(d.getDate()-29); ls.value=d.toISOString().slice(0,10); le.value=today(); }
  const start=ls.value, end=le.value;
  const memId=parseInt(document.getElementById('logs-member').value)||0;

  let logs=[..._logs].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  if(start) logs=logs.filter(l=>l.date>=start);
  if(end)   logs=logs.filter(l=>l.date<=end);
  if(memId) logs=logs.filter(l=>l.memberId===memId);

  const tbody=document.getElementById('logs-body'), tfoot=document.getElementById('logs-foot');
  if(!logs.length){ tbody.innerHTML='<tr><td colspan="5" class="empty-state">No entries found.</td></tr>'; tfoot.innerHTML=''; return; }

  tbody.innerHTML=logs.map(l=>{
    const m=_members.find(x=>x.id===l.memberId);
    return `<tr>
      <td>${fmtDate(l.date)}</td>
      <td>${m?m.name:'Unknown'}</td>
      <td>${l.task}</td>
      <td><span class="badge badge-gray">${l.type||'—'}</span></td>
      <td class="text-right font-medium">${l.minutes} <span class="text-muted text-xs">min</span></td></tr>`;
  }).join('');

  const tot=logs.reduce((s,l)=>s+l.minutes,0);
  tfoot.innerHTML=`<tr style="border-top:2px solid var(--border);background:var(--muted-bg)">
    <td colspan="4" class="font-semibold" style="padding:10px 12px">Total</td>
    <td class="text-right font-bold" style="padding:10px 12px">${tot} min</td></tr>`;
}

function exportCSV(){
  const rows=[['Date','Member','Task','Type','Minutes']];
  const ls=document.getElementById('logs-start').value, le=document.getElementById('logs-end').value;
  const mf=parseInt(document.getElementById('logs-member').value)||0;
  let logs=[..._logs].sort((a,b)=>b.date.localeCompare(a.date));
  if(ls) logs=logs.filter(l=>l.date>=ls); if(le) logs=logs.filter(l=>l.date<=le);
  if(mf) logs=logs.filter(l=>l.memberId===mf);
  logs.forEach(l=>{ const m=_members.find(x=>x.id===l.memberId);
    rows.push([l.date,m?.name||'',l.task||'',l.type||'',l.minutes]); });
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  dl('resource-planner-logs.csv','text/csv',csv);
}

// ── Settings ─────────────────────────────────
function refreshSettings(){
  document.getElementById('members-list').innerHTML=sortByName(_members).map(m=>`
    <div class="list-item"><span class="font-medium">${m.name}</span>
    <button class="btn btn-ghost btn-sm" onclick="deleteMember(${m.id})">Remove</button></div>`).join('');

  document.getElementById('avail-settings').innerHTML=Object.keys(AVAIL_LABELS).map(k=>`
    <div class="flex items-center justify-between gap-2">
      <label style="margin:0;flex:1">${AVAIL_LABELS[k]}</label>
      <input type="number" min="0" max="1440" style="width:90px;text-align:center"
             value="${_cap[k]??CAP_FALLBACK[k]}" onchange="updateCap('${k}',this.value)" />
      <span class="text-xs text-muted" style="width:50px">min/day</span>
    </div>`).join('');
}

async function addMember(){
  const inp=document.getElementById('new-member-name'), n=inp.value.trim();
  if(!n) return;
  try{
    await apiSend('members', 'POST', {name:n});
    inp.value='';
    await refreshAllAndRerender();
    showToast('Member added');
  }catch(e){
    showToast('Failed to add member: '+e.message, 'error');
  }
}
async function deleteMember(id){
  if(!confirm('Remove this member for everyone? Their logs remain in reports.')) return;
  try{
    await apiSend(`members/${id}`, 'DELETE');
    await refreshAllAndRerender();
    showToast('Member removed');
  }catch(e){
    showToast('Failed to remove member: '+e.message, 'error');
  }
}
async function updateCap(k,v){
  const minutes=parseInt(v)||0;
  try{
    await apiSend('capacity', 'PUT', {key:k, minutes});
    await refreshAllAndRerender();
  }catch(e){
    showToast('Failed to update capacity: '+e.message, 'error');
  }
}

// ── CSV download helper (used by All Logs export) ──
const dl=(name,mime,content)=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=name; a.click(); };

// ── Init ─────────────────────────────────────
async function init(){
  document.getElementById('logger-date').value = today();
  populateTaskTypeSelect();
  try{
    await loadAllData();
    refreshLogger();
  }catch(e){
    showToast('Could not load data from the server: '+e.message, 'error');
    document.getElementById('task-list-area').innerHTML =
      '<p class="text-muted text-sm">Could not connect to the database. Check that the D1 binding is set up correctly (see README), then reload.</p>';
  }
}
init();
