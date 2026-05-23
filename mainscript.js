// ═══════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════
let S={rooms:[],adj:{},statuses:{},result:null,history:[],activeFloor:1,simInterval:null,animFrame:null,animPhase:0};

// Clock
setInterval(()=>{
  const t=new Date().toLocaleTimeString('en-US',{hour12:false});
  const clockEl = document.getElementById('clock');
  if(clockEl) clockEl.textContent=t;
},1000);

// ═══════════════════════════════════════════════════════════
// DATASET CONFIG
// ═══════════════════════════════════════════════════════════
const FLOOR_COUNT=3;
const STAIR_ROOMS=['LBY','ELC']; // Rooms with vertical connectivity

const THRESHOLDS={
  FIRE:{CO2_Room:3000,CO_Room:50,Temperature_Room:60,PM25_Room:150,PM_Total_Room:450},
  WARNING:{CO2_Room:1200,CO_Room:15,Temperature_Room:35,PM25_Room:55,PM_Total_Room:200},
};

const FLOOR_GRID=[
  {id:'OFF',zone:'Office',label:'Open Office',col:0,row:0},
  {id:'MTG',zone:'Office',label:'Meeting Room',col:1,row:0},
  {id:'SRV',zone:'Server Room',label:'Server Room',col:2,row:0},
  {id:'ELC',zone:'Electrical Room',label:'Electrical',col:3,row:0},
  {id:'LBY',zone:'Lobby/Corridor',label:'Lobby',col:0,row:1},
  {id:'CAF',zone:'Kitchen',label:'Cafeteria',col:1,row:1},
  {id:'STR',zone:'Storage/Utility',label:'Storage',col:2,row:1},
  {id:'LAB',zone:'Lab/Workshop',label:'Workshop',col:3,row:1},
];

const ZONE_SUPPRESSION={
  'Office':'Water Sprinkler',
  'Lobby/Corridor':'Water Sprinkler',
  'Kitchen':'Class K (Wet Chemical)',
  'Server Room':'Clean Agent (FM-200)',
  'Electrical Room':'CO₂ Gas Suppression',
  'Storage/Utility':'Water Sprinkler',
  'Lab/Workshop':'Foam + CO₂',
};

const SCENARIOS={
  none:{rooms:[],mult:1},
  elec:{rooms:['ELC'],mult:1.8},
  kitchen:{rooms:['CAF'],mult:1.6},
  chem:{rooms:['LAB'],mult:2.2},
  gas:{rooms:['CAF','STR'],mult:2.0},
  multi:{rooms:['ELC','CAF','LAB'],mult:1.5},
};

function generateAllRooms() {
  const rooms=[];
  for(let f=1;f<=FLOOR_COUNT;f++) {
    FLOOR_GRID.forEach(r=>{
      rooms.push({
        room_id: `F${f}-${r.id}`,
        floor: f, zone_type: r.zone,
        label: r.label, col: r.col, row: r.row,
        // Default safe sensor values
        CO2_Room:415+Math.random()*20, CO_Room:1+Math.random()*2,
        H2_Room:Math.random()*5, Humidity_Room:40+Math.random()*10,
        Temperature_Room:21+Math.random()*3, VOC_Room:5+Math.random()*10,
        VOC_Room_RAW:5+Math.random()*10, UV_Room:0.01+Math.random()*0.03,
        PM25_Room:2+Math.random()*4, PM40_Room:1+Math.random()*2,
        PM_Total_Room:8+Math.random()*12,
        CO2_Room_Trend:0, CO_Room_Trend:0, VOC_Room_RAW_Trend:0, PM25_Room_Trend:0,
      });
    });
  }
  return rooms;
}

// ═══════════════════════════════════════════════════════════
// ADJACENCY GRAPH (realistic building topology)
// ═══════════════════════════════════════════════════════════
function buildAdjacency(rooms) {
  const adj = {};
  rooms.forEach(r => adj[r.room_id]=[]);

  // Within each floor: rooms connect if adjacent in grid
  for(let f=1;f<=FLOOR_COUNT;f++) {
    const fr = rooms.filter(r=>r.floor===f);
    fr.forEach(a => {
      fr.forEach(b => {
        if(a===b) return;
        const dc = Math.abs(a.col-b.col), dr = Math.abs(a.row-b.row);
        // Adjacent in grid (horizontal/vertical neighbors only)
        if((dc===1&&dr===0)||(dc===0&&dr===1)) {
          if(!adj[a.room_id].includes(b.room_id)) adj[a.room_id].push(b.room_id);
        }
      });
    });
  }

  // Stairwell connections between floors (LBY and ELC connect floor to floor)
  for(let f=1;f<FLOOR_COUNT;f++) {
    STAIR_ROOMS.forEach(sid => {
      const upper = `F${f+1}-${sid}`;
      const lower = `F${f}-${sid}`;
      if(adj[upper] && adj[lower]) {
        if(!adj[upper].includes(lower)) adj[upper].push(lower);
        if(!adj[lower].includes(upper)) adj[lower].push(upper);
      }
    });
  }

  return adj;
}

// ═══════════════════════════════════════════════════════════
// DETECTION ENGINE
// ═══════════════════════════════════════════════════════════
function classifyRoom(room, mult=1) {
  let fs=0,ws=0;
  Object.keys(THRESHOLDS.FIRE).forEach(k => {
    const v = (room[k]||0)*mult;
    if(v>=THRESHOLDS.FIRE[k]) fs++;
    else if(v>=THRESHOLDS.WARNING[k]) ws++;
  });
  const tb=[room.CO2_Room_Trend>0.5,room.CO_Room_Trend>0.5,room.VOC_Room_RAW_Trend>0.5,room.PM25_Room_Trend>0.5].filter(Boolean).length;
  if(fs>=3||(fs>=2&&tb>=2)) return 'FIRE';
  if(fs>=1||ws>=3||(ws>=2&&tb>=1)) return 'WARNING';
  return 'SAFE';
}

function classifyFireType(room) {
  if(room.CO_Room>30&&room.UV_Room>0.5&&room.PM_Total_Room<200) return 'Electrical Fire';
  if(room.H2_Room>300||(room.CO_Room>40&&room.Temperature_Room>70)) return 'Gas/Oil Fire';
  if(room.VOC_Room>200&&room.H2_Room>100) return 'Chemical Fire';
  return 'Ordinary Combustible';
}

function findOrigin(rooms, statuses) {
  const fires = rooms.filter(r=>statuses[r.room_id]==='FIRE');
  if(!fires.length) return null;
  return fires.reduce((b,r)=>{
    const s=r.CO2_Room/2000+r.CO_Room/50+r.Temperature_Room/60+r.PM_Total_Room/500+(r.CO2_Room_Trend||0)+(r.CO_Room_Trend||0);
    const bs=b.CO2_Room/2000+b.CO_Room/50+b.Temperature_Room/60+b.PM_Total_Room/500+(b.CO2_Room_Trend||0)+(b.CO_Room_Trend||0);
    return s>bs?r:b;
  });
}

function bfs(start, goal, adj, statuses) {
  if(start===goal) return [start];
  const visited=new Set([start]);
  const queue=[[start]];
  while(queue.length) {
    const path=queue.shift();
    const cur=path[path.length-1];
    for(const nb of (adj[cur]||[])) {
      // Skip if already visited or if it's a FIRE room (can't go through fire)
      if(visited.has(nb) || statuses[nb]==='FIRE') continue;
      
      const np=[...path,nb];
      if(nb===goal) return np;
      
      // Add to visited and queue (WARNING rooms are passable, just risky)
      visited.add(nb);
      queue.push(np);
    }
  }
  return [];
}

function predictSpread(statuses, adj) {
  const fireRooms=Object.keys(statuses).filter(r=>statuses[r]==='FIRE');
  const nextRooms=new Set();
  fireRooms.forEach(r=>(adj[r]||[]).forEach(nb=>{
    if(statuses[nb]==='SAFE'||statuses[nb]==='WARNING')nextRooms.add(nb);
  }));
  const n=nextRooms.size;
  const risk_level=n>=4?'HIGH':n>=2?'MEDIUM':'LOW';
  return {next_rooms:[...nextRooms],risk_level};
}

function injectScenario(rooms, scenario, mult) {
  const s=SCENARIOS[scenario];
  if(!s||!s.rooms.length) return;
  rooms.forEach(r=>{
    const isTarget=s.rooms.some(sid=>r.room_id.endsWith(`-${sid}`));
    if(isTarget) {
      r.CO2_Room=2500+(Math.random()*800)*mult;
      r.CO_Room=45+(Math.random()*30)*mult;
      r.H2_Room=250+(Math.random()*200)*mult;
      r.Temperature_Room=65+(Math.random()*35)*mult;
      r.VOC_Room=180+(Math.random()*120)*mult;
      r.VOC_Room_RAW=180+(Math.random()*120)*mult;
      r.UV_Room=0.4+(Math.random()*0.4)*mult;
      r.PM25_Room=140+(Math.random()*90)*mult;
      r.PM_Total_Room=420+(Math.random()*220)*mult;
      r.CO2_Room_Trend=0.6+Math.random()*0.4;
      r.CO_Room_Trend=0.6+Math.random()*0.4;
      r.VOC_Room_RAW_Trend=0.6+Math.random()*0.4;
      r.PM25_Room_Trend=0.6+Math.random()*0.4;
    }
  });
}

// ═══════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  const runBtn = document.getElementById('runBtn');
  const resetBtn = document.getElementById('resetBtn');
  const simBtn = document.getElementById('simBtn');
  
  if(runBtn) {
    runBtn.addEventListener('click',()=>{
      const scenario=document.getElementById('scenSel')?.value || 'none';
      const mult=parseFloat(document.getElementById('intSlider')?.value || 1);
      const rooms=generateAllRooms();
      injectScenario(rooms,scenario,mult);
      S.rooms=rooms;
      S.adj=buildAdjacency(rooms);
      S.history=[];
      // Populate start room dropdown
      const sel=document.getElementById('startSel');
      if(sel) {
        sel.innerHTML=rooms.map(r=>`<option value="${r.room_id}">${r.room_id} (${r.label})</option>`).join('');
      }
      analyze();
    });
  }
  
  if(resetBtn) resetBtn.addEventListener('click',resetAll);
  if(simBtn) simBtn.addEventListener('click',toggleSim);
  
  // Initial draw
  drawFloor();
});

function analyze() {
  const {rooms,adj} = S;
  const mult=parseFloat(document.getElementById('intSlider')?.value || 1);
  const statuses={};
  rooms.forEach(r=>{ statuses[r.room_id]=classifyRoom(r,1); });
  S.statuses=statuses;

  const origin=findOrigin(rooms,statuses);
  const fireType=origin?classifyFireType(origin):'None';
  const spread=predictSpread(statuses,adj);

  const fireRoomIds=new Set(Object.keys(statuses).filter(r=>statuses[r]==='FIRE'));
  const dangerNeighbors=new Set();
  fireRoomIds.forEach(r=>(adj[r]||[]).forEach(n=>dangerNeighbors.add(n)));
  const safeRooms=rooms.filter(r=>statuses[r.room_id]==='SAFE'&&!dangerNeighbors.has(r.room_id)).map(r=>r.room_id);

  const startRoom=document.getElementById('startSel')?.value||rooms[0]?.room_id;
  // Find nearest safe room
  const recSafe=safeRooms.find(sr=>sr!==startRoom)||safeRooms[0]||null;
  const evacPath=startRoom&&recSafe?bfs(startRoom,recSafe,adj,statuses):[];

  const supActions={};
  const powerCut=[], gasCut=[];
  rooms.forEach(r=>{
    if(['FIRE','WARNING'].includes(statuses[r.room_id])) {
      supActions[r.room_id]=ZONE_SUPPRESSION[r.zone_type]||'Water Sprinkler';
      if(['Electrical Room','Server Room'].includes(r.zone_type)) powerCut.push(r.room_id);
      if(r.zone_type==='Kitchen') gasCut.push(r.room_id);
    }
  });
  const affFloors=[...new Set(rooms.filter(r=>['FIRE','WARNING'].includes(statuses[r.room_id])).map(r=>r.floor))];
  const alerts={
    fire_department:Object.values(statuses).includes('FIRE'),
    security:Object.values(statuses).some(s=>s!=='SAFE'),
    admin:true,
  };

  S.result={origin,fireType,spread,safeRooms,recSafe,evacPath,supActions,powerCut,gasCut,affFloors,alerts,startRoom};

  const sc=Object.values(statuses).filter(s=>s==='SAFE').length;
  const wc=Object.values(statuses).filter(s=>s==='WARNING').length;
  const fc=Object.values(statuses).filter(s=>s==='FIRE').length;
  S.history.push({safe:sc,warn:wc,fire:fc});

  updateUI();
  startRenderLoop();
}

// ═══════════════════════════════════════════════════════════
// UI UPDATE
// ═══════════════════════════════════════════════════════════
function updateUI() {
  const {statuses,result,rooms,history,activeFloor}=S;
  if(!result) return;
  const {origin,fireType,spread,safeRooms,recSafe,evacPath,supActions,powerCut,gasCut,affFloors,alerts,startRoom}=result;

  const sc=Object.values(statuses).filter(s=>s==='SAFE').length;
  const wc=Object.values(statuses).filter(s=>s==='WARNING').length;
  const fc=Object.values(statuses).filter(s=>s==='FIRE').length;

  const setTextSafe = (id, text) => {
    const el = document.getElementById(id);
    if(el) el.textContent = text;
  };

  setTextSafe('hSafe', `${sc} SAFE`);
  setTextSafe('hWarn', `${wc} WARN`);
  setTextSafe('hFire', `${fc} FIRE`);
  setTextSafe('stSafe', sc);
  setTextSafe('stWarn', wc);
  setTextSafe('stFire', fc);
  setTextSafe('stOrigin', origin?origin.room_id:'None');
  setTextSafe('stType', fireType);
  setTextSafe('dOrigin', origin?origin.room_id:'—');
  setTextSafe('dFloor', origin?`Floor ${origin.floor}`:'—');
  setTextSafe('dType', fireType);
  setTextSafe('dFloors', affFloors.length?affFloors.map(f=>`F${f}`).join(', '):'—');

  // Risk
  const riskEl=document.getElementById('rlbl');
  if(riskEl) {
    riskEl.textContent=spread.risk_level;
    riskEl.className=`rlbl risk-${spread.risk_level}`;
  }
  const rbarEl=document.getElementById('rbar');
  if(rbarEl) rbarEl.className=`rbar risk-${spread.risk_level}`;
  
  const dRiskEl=document.getElementById('dRisk');
  if(dRiskEl) {
    dRiskEl.textContent=spread.risk_level;
    dRiskEl.className='ival '+(spread.risk_level==='HIGH'?'c-fire':spread.risk_level==='MEDIUM'?'c-warn':'c-safe');
  }
  
  const spreadChipsEl=document.getElementById('spreadChips');
  if(spreadChipsEl) {
    spreadChipsEl.innerHTML=spread.next_rooms.slice(0,8).map(r=>`<span class="chip">${r}</span>`).join('')||'<span style="font-size:0.68rem;color:var(--safe)">Contained</span>';
  }

  // Evac
  setTextSafe('dStart', startRoom||'—');
  setTextSafe('dDest', recSafe||'None');
  
  const ep=document.getElementById('evacPath');
  if(ep) {
    ep.innerHTML=evacPath.length
      ?evacPath.map((r,i)=>`<div class="evac-step"><div class="evac-num">${i+1}</div><span class="evac-rm${i===evacPath.length-1?' is-dest':''}">${r}</span>${i<evacPath.length-1?'<span class="evac-arr">→</span>':'<span style="color:var(--safe);font-size:0.6rem;margin-left:auto">✓SAFE</span>'}</div>`).join('')
      :'<span style="font-size:0.7rem;color:var(--fire)">No safe path found!</span>';
  }

  // Suppression
  const sl=document.getElementById('supList');
  if(sl) {
    const se=Object.entries(supActions);
    sl.innerHTML=se.length?se.slice(0,6).map(([r,a])=>`<div class="irow"><span class="ikey">${r}</span><span class="ival c-accent">${a}</span></div>`).join('')
      :'<div class="irow"><span class="ikey" style="color:var(--safe)">None needed</span></div>';
  }
  
  const cd=document.getElementById('cutoffs');
  if(cd && (powerCut.length||gasCut.length)){
    cd.style.display='block';
    setTextSafe('dPower', powerCut.slice(0,3).join(', ')||'None');
    setTextSafe('dGas', gasCut.slice(0,3).join(', ')||'None');
  }

  // Safe rooms
  setTextSafe('dRecSafe', recSafe||'None');
  const safeChipsEl=document.getElementById('safeChips');
  if(safeChipsEl) {
    safeChipsEl.innerHTML=safeRooms.slice(0,10).map(r=>`<span class="safe-chip">${r}</span>`).join('');
  }

  // Services
  const ss=(id,on)=>{
    const el=document.getElementById(id);
    if(el) {
      el.textContent=on?'ALERTED':'STANDBY';
      el.className='svc-badge '+(on?'svc-ON':'svc-OFF');
    }
  };
  ss('svcFire',alerts.fire_department);
  ss('svcSec',alerts.security);
  ss('svcAdmin',alerts.admin);

  // Floor tabs
  const floors=[...Array(FLOOR_COUNT)].map((_,i)=>i+1);
  const floorTabsEl=document.getElementById('floorTabs');
  if(floorTabsEl) {
    floorTabsEl.innerHTML=floors.map(f=>{
      const fr=rooms.filter(r=>r.floor===f);
      const hasFire=fr.some(r=>statuses[r.room_id]==='FIRE');
      const hasWarn=fr.some(r=>statuses[r.room_id]==='WARNING');
      return `<button class="ftab${f===S.activeFloor?' active':''}${hasFire?' has-fire':hasWarn?' has-warn':''}" onclick="setFloor(${f})">F${f}</button>`;
    }).join('');
  }
  
  const floorLabelEl=document.getElementById('floorLabel');
  if(floorLabelEl) floorLabelEl.textContent=`Floor ${S.activeFloor} — Floor Plan`;

  // Alerts
  if(fc>0) addAlert('fire',`🔴 ${fc} room(s) FIRE — Origin: ${origin?.room_id||'?'}`);
  else if(wc>0) addAlert('warn',`${wc} room(s) WARNING`);
  else addAlert('safe','All rooms SAFE');
  if(evacPath.length) addAlert('evac',`🚶 Escape: ${evacPath.join(' → ')}`);

  drawTrend();
}

function setFloor(f) {
  S.activeFloor=f;
  document.querySelectorAll('.ftab').forEach(t=>{
    t.classList.toggle('active',t.textContent===`F${f}`);
  });
  const floorLabelEl=document.getElementById('floorLabel');
  if(floorLabelEl) floorLabelEl.textContent=`Floor ${f} — Floor Plan`;
}

// ═══════════════════════════════════════════════════════════
// CANVAS FLOOR MAP — rich 2D plan view
// ═══════════════════════════════════════════════════════════
const COLS=4, GRID_ROWS=2;

function startRenderLoop() {
  if(S.animFrame) cancelAnimationFrame(S.animFrame);
  function loop(t) {
    S.animPhase=t;
    drawFloor();
    S.animFrame=requestAnimationFrame(loop);
  }
  S.animFrame=requestAnimationFrame(loop);
}

function drawFloor() {
  const canvas=document.getElementById('floorCanvas');
  if(!canvas) return;
  
  const wrap=canvas.parentElement;
  if(!wrap) return;
  
  const W=wrap.clientWidth, H=wrap.clientHeight;
  if(canvas.width!==W*devicePixelRatio||canvas.height!==H*devicePixelRatio){
    canvas.width=W*devicePixelRatio; 
    canvas.height=H*devicePixelRatio;
    canvas.style.width=W+'px'; 
    canvas.style.height=H+'px';
  }
  const ctx=canvas.getContext('2d');
  ctx.scale(devicePixelRatio,devicePixelRatio);
  ctx.clearRect(0,0,W,H);

  if(!S.rooms.length){
    ctx.fillStyle='rgba(74,96,128,0.3)';
    ctx.font='14px "Share Tech Mono", monospace';
    ctx.textAlign='center';
    ctx.fillText('Click  ▶ Analyze Building  to load the floor plan',W/2,H/2);
    ctx.setTransform(1,0,0,1,0,0);
    return;
  }

  const {statuses,result,activeFloor,animPhase}=S;
  const evacSet=new Set(result?.evacPath||[]);
  const originId=result?.origin?.room_id;
  const startId=result?.startRoom;

  const floorRooms=S.rooms.filter(r=>r.floor===activeFloor);

  // Layout
  const pad=40, corridorH=30;
  const cols=COLS, rows=GRID_ROWS;
  const availW=W-pad*2, availH=H-pad*2-corridorH;
  const cellW=availW/cols, cellH=availH/rows;
  const margin=8;

  // Corridor strip
  ctx.fillStyle='rgba(20,35,65,0.15)';
  ctx.beginPath();
  if(ctx.roundRect) {
    ctx.roundRect(pad,pad+cellH,availW,corridorH,4);
  } else {
    ctx.rect(pad,pad+cellH,availW,corridorH);
  }
  ctx.fill();
  ctx.strokeStyle='rgba(26,64,100,0.4)';
  ctx.lineWidth=1;
  ctx.stroke();

  // Corridor label
  ctx.fillStyle='rgba(90,114,153,0.5)';
  ctx.font='10px "Share Tech Mono", monospace';
  ctx.textAlign='center';
  ctx.fillText('CORRIDOR',W/2,pad+cellH+corridorH/2+4);

  // Pulse for animations
  const pulse=Math.sin(animPhase/500)*0.5+0.5;

  // Draw rooms
  floorRooms.forEach(room=>{
    const status=statuses[room.room_id]||'SAFE';
    const isOrigin=room.room_id===originId;
    const isStart=room.room_id===startId;
    const inEvac=evacSet.has(room.room_id);

    const corrOffset=room.row===1?corridorH:0;
    const rx=pad+room.col*cellW+margin;
    const ry=pad+room.row*cellH+margin+corrOffset;
    const rw=cellW-margin*2, rh=cellH-margin*2;

    // Base
    ctx.fillStyle='rgba(12,18,32,0.95)';
    ctx.strokeStyle='rgba(30,60,120,0.3)';
    ctx.lineWidth=1;
    ctx.beginPath();
    if(ctx.roundRect) {
      ctx.roundRect(rx,ry,rw,rh,4);
    } else {
      ctx.rect(rx,ry,rw,rh);
    }
    ctx.fill();
    ctx.stroke();

    // Border glow based on status
    if(status!=='SAFE') {
      const colors={WARNING:'rgba(255,171,0,0.4)',FIRE:'rgba(255,61,0,0.6)'};
      ctx.strokeStyle=colors[status];
      ctx.lineWidth=2;
      ctx.shadowBlur=8;
      ctx.shadowColor=colors[status];
      ctx.stroke();
      ctx.shadowBlur=0;
    }

    // Fire flicker overlay
    if(status==='FIRE') {
      const flicker=Math.random()*0.15;
      ctx.fillStyle=`rgba(255,${40+Math.random()*60},0,${0.05+flicker})`;
      ctx.beginPath(); 
      if(ctx.roundRect) {
        ctx.roundRect(rx,ry,rw,rh,4);
      } else {
        ctx.rect(rx,ry,rw,rh);
      }
      ctx.fill();
    }

    // Evac path overlay
    if(inEvac) {
      ctx.fillStyle=`rgba(123,97,255,${0.06+pulse*0.04})`;
      ctx.beginPath(); 
      if(ctx.roundRect) {
        ctx.roundRect(rx,ry,rw,rh,4);
      } else {
        ctx.rect(rx,ry,rw,rh);
      }
      ctx.fill();
    }

    // Room ID
    ctx.fillStyle='rgba(200,220,240,0.9)';
    ctx.font=`bold 9px Rajdhani, sans-serif`;
    ctx.textAlign='left';
    ctx.fillText(room.room_id, rx+8, ry+16);

    // Room label
    ctx.fillStyle={SAFE:'rgba(0,230,118,0.8)',WARNING:'rgba(255,171,0,0.9)',FIRE:'rgba(255,120,60,0.95)'}[status];
    ctx.font=`600 11px "Exo 2", sans-serif`;
    ctx.fillText(room.label, rx+8, ry+30);

    // Zone type
    ctx.fillStyle='rgba(90,114,153,0.8)';
    ctx.font=`8px "Share Tech Mono", monospace`;
    ctx.fillText(room.zone_type, rx+8, ry+42);

    // Status badge
    const badgeColors={SAFE:'#00e676',WARNING:'#ffab00',FIRE:'#ff3d00'};
    ctx.fillStyle=badgeColors[status];
    ctx.font='bold 9px "Share Tech Mono", monospace';
    ctx.textAlign='right';
    ctx.fillText(status, rx+rw-8, ry+16);

    // ORIGIN badge
    if(isOrigin) {
      ctx.fillStyle=`rgba(255,255,255,${0.8+pulse*0.2})`;
      ctx.font='bold 9px "Share Tech Mono", monospace';
      ctx.textAlign='center';
      ctx.fillText('◈ FIRE ORIGIN', rx+rw/2, ry+rh-12);
    }

    // START badge
    if(isStart&&!isOrigin) {
      ctx.fillStyle='rgba(123,97,255,0.9)';
      ctx.font='bold 8px "Share Tech Mono", monospace';
      ctx.textAlign='center';
      ctx.fillText('YOU ARE HERE', rx+rw/2, ry+rh-12);
    }

    // Evac path step number
    if(inEvac && result?.evacPath) {
      const stepIdx=result.evacPath.indexOf(room.room_id);
      if(stepIdx >= 0) {
        ctx.fillStyle='rgba(123,97,255,0.9)';
        ctx.font='bold 10px "Share Tech Mono", monospace';
        ctx.textAlign='right';
        ctx.fillText(`#${stepIdx+1}`, rx+rw-8, ry+rh-12);
      }
    }

    // Temperature sensor bar
    const temp=room.Temperature_Room||22;
    const tempPct=Math.min(temp/120,1);
    const tempColor=tempPct>0.5?'#ff3d00':tempPct>0.25?'#ffab00':'#00e676';
    ctx.fillStyle='rgba(20,35,65,0.6)';
    ctx.beginPath();
    if(ctx.roundRect) {
      ctx.roundRect(rx+8,ry+rh-24,rw-16,4,2);
    } else {
      ctx.rect(rx+8,ry+rh-24,rw-16,4);
    }
    ctx.fill();
    ctx.fillStyle=tempColor;
    ctx.beginPath();
    if(ctx.roundRect) {
      ctx.roundRect(rx+8,ry+rh-24,(rw-16)*tempPct,4,2);
    } else {
      ctx.rect(rx+8,ry+rh-24,(rw-16)*tempPct,4);
    }
    ctx.fill();
    ctx.fillStyle='rgba(90,114,153,0.7)';
    ctx.font='7px "Share Tech Mono", monospace';
    ctx.textAlign='left';
    ctx.fillText(`${temp.toFixed(0)}°C`,rx+8,ry+rh-28);

    // CO sensor dot
    const co=room.CO_Room||0;
    const coPct=Math.min(co/100,1);
    const coColor=coPct>0.5?'#ff3d00':coPct>0.15?'#ffab00':'#00e676';
    ctx.fillStyle=coColor;
    ctx.beginPath();
    ctx.arc(rx+rw-10,ry+rh-18,3,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.4)';
    ctx.lineWidth=1;
    ctx.stroke();
  });

  // ── EVAC PATH ARROWS ────────────────────────────────────────
  if(result?.evacPath && result.evacPath.length>1) {
    const path=result.evacPath;
    for(let i=0;i<path.length-1;i++) {
      const a=floorRooms.find(r=>r.room_id===path[i]);
      const b=floorRooms.find(r=>r.room_id===path[i+1]);
      if(!a||!b) continue;
      const corrA=a.row===1?corridorH:0, corrB=b.row===1?corridorH:0;
      const ca={x:pad+a.col*cellW+cellW/2,y:pad+a.row*cellH+corrA+cellH/2};
      const cb={x:pad+b.col*cellW+cellW/2,y:pad+b.row*cellH+corrB+cellH/2};

      const t3=animPhase/1000;
      const p3=0.3+0.15*Math.sin(t3*3);
      ctx.strokeStyle=`rgba(123,97,255,${p3})`;
      ctx.lineWidth=3;
      ctx.shadowBlur=10;
      ctx.shadowColor='rgba(123,97,255,0.5)';
      ctx.setLineDash([8,6]);
      ctx.beginPath();
      ctx.moveTo(ca.x,ca.y);
      ctx.lineTo(cb.x,cb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur=0;

      // Arrowhead
      const angle=Math.atan2(cb.y-ca.y,cb.x-ca.x);
      const aLen=10;
      ctx.beginPath();
      ctx.fillStyle='rgba(123,97,255,0.9)';
      ctx.moveTo(cb.x,cb.y);
      ctx.lineTo(cb.x-aLen*Math.cos(angle-0.4),cb.y-aLen*Math.sin(angle-0.4));
      ctx.lineTo(cb.x-aLen*Math.cos(angle+0.4),cb.y-aLen*Math.sin(angle+0.4));
      ctx.closePath();
      ctx.fill();
    }
  }

  // ── FLOOR FIRE SPREAD GLOW ──────────────────────────────────
  // Draw heat haze between adjacent fire rooms
  const fireRoomsOnFloor=floorRooms.filter(r=>statuses[r.room_id]==='FIRE');
  fireRoomsOnFloor.forEach(r=>{
    const adjIds=S.adj[r.room_id]||[];
    adjIds.forEach(nId=>{
      const n=floorRooms.find(x=>x.room_id===nId);
      if(!n) return;
      const corrR=r.row===1?corridorH:0, corrN=n.row===1?corridorH:0;
      const cx1=pad+r.col*cellW+cellW/2, cy1=pad+r.row*cellH+corrR+cellH/2;
      const cx2=pad+n.col*cellW+cellW/2, cy2=pad+n.row*cellH+corrN+cellH/2;
      const t4=animPhase/1000;
      const p4=0.2+0.2*Math.sin(t4*5);
      const grad=ctx.createLinearGradient(cx1,cy1,cx2,cy2);
      grad.addColorStop(0,`rgba(255,61,0,${p4})`);
      grad.addColorStop(1,'rgba(255,61,0,0)');
      ctx.strokeStyle=grad; 
      ctx.lineWidth=4; 
      ctx.globalAlpha=0.5;
      ctx.beginPath(); 
      ctx.moveTo(cx1,cy1); 
      ctx.lineTo(cx2,cy2); 
      ctx.stroke();
      ctx.globalAlpha=1;
    });
  });

  ctx.setTransform(1,0,0,1,0,0);
}

// Canvas click → room modal
document.addEventListener('DOMContentLoaded', function() {
  const canvas = document.getElementById('floorCanvas');
  if(canvas) {
    canvas.addEventListener('click',(e)=>{
      if(!S.rooms.length) return;
      const rect=canvas.getBoundingClientRect();
      const mx=e.clientX-rect.left, my=e.clientY-rect.top;
      const W=rect.width, H=rect.height;
      const pad=40, corridorH=30;
      const availW=W-pad*2, availH=H-pad*2-corridorH;
      const cellW=availW/COLS, cellH=availH/GRID_ROWS;
      const margin=8;

      const floorRooms=S.rooms.filter(r=>r.floor===S.activeFloor);
      for(const room of floorRooms) {
        const corrOffset=room.row===1?corridorH:0;
        const rx=pad+room.col*cellW+margin;
        const ry=pad+room.row*cellH+margin+corrOffset;
        const rw=cellW-margin*2, rh=cellH-margin*2;
        if(mx>=rx&&mx<=rx+rw&&my>=ry&&my<=ry+rh){
          showModal(room.room_id); 
          break;
        }
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════
function toggleSim() {
  if(!S.rooms.length){
    addAlert('warn','Run analysis first.');
    return;
  }
  const btn=document.getElementById('simBtn');
  if(!btn) return;
  
  if(S.simInterval){
    clearInterval(S.simInterval); 
    S.simInterval=null;
    btn.textContent='⚡  Simulate Fire Spread';
    btn.classList.remove('active');
    addAlert('info','Simulation stopped.');
  } else {
    btn.textContent='■  Stop Simulation';
    btn.classList.add('active');
    addAlert('warn','🔥 Spread simulation started...');
    S.simInterval=setInterval(spreadStep,2000);
  }
}

function spreadStep() {
  const {rooms,statuses,adj}=S;
  const ns={...statuses};
  let changed=false;
  Object.keys(statuses).forEach(id=>{
    if(statuses[id]==='FIRE'){
      (adj[id]||[]).forEach(nb=>{
        if(ns[nb]==='SAFE'&&Math.random()<0.45){
          ns[nb]='WARNING';
          changed=true;
          addAlert('warn',`${nb} → WARNING (spread)`);
        }
        else if(ns[nb]==='WARNING'&&Math.random()<0.35){
          ns[nb]='FIRE';
          changed=true;
          addAlert('fire',`🔴 ${nb} → FIRE!`);
          const r=rooms.find(x=>x.room_id===nb);
          if(r){
            r.Temperature_Room=68+Math.random()*25;
            r.CO_Room=55+Math.random()*20;
            r.PM25_Room=160+Math.random()*60;
            r.PM_Total_Room=520+Math.random()*120;
          }
        }
      });
    }
  });
  S.statuses=ns;
  if(changed) analyze();
}

// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════
function showModal(roomId) {
  const room=S.rooms.find(r=>r.room_id===roomId);
  if(!room) return;
  const status=S.statuses[roomId]||'SAFE';
  const sc={SAFE:'var(--safe)',WARNING:'var(--warn)',FIRE:'var(--fire)'};
  
  const mTitle=document.getElementById('mTitle');
  const mSub=document.getElementById('mSub');
  const mBody=document.getElementById('mBody');
  const modalBg=document.getElementById('modalBg');
  
  if(!mTitle || !mSub || !mBody || !modalBg) return;
  
  mTitle.textContent=roomId;
  mTitle.style.color=sc[status];
  mSub.textContent=`${room.label} · ${room.zone_type} · Floor ${room.floor} · ${status}`;
  
  const sensors=[
    {n:'CO₂',v:room.CO2_Room,u:'ppm',mx:3000},
    {n:'CO',v:room.CO_Room,u:'ppm',mx:100},
    {n:'H₂',v:room.H2_Room,u:'ppm',mx:700},
    {n:'Humidity',v:room.Humidity_Room,u:'%',mx:100},
    {n:'Temperature',v:room.Temperature_Room,u:'°C',mx:120},
    {n:'VOC',v:room.VOC_Room,u:'',mx:500},
    {n:'PM₂.₅',v:room.PM25_Room,u:'µg',mx:300},
    {n:'PM Total',v:room.PM_Total_Room,u:'',mx:800},
    {n:'UV',v:room.UV_Room,u:'',mx:1},
  ];
  
  mBody.innerHTML=`
    <div class="sensor-grid">${sensors.map(s=>{
      const p=Math.min((s.v/s.mx)*100,100);
      const col=p>66?'#ff3d00':p>33?'#ffab00':'#00e676';
      return `<div class="sensor-item">
        <div class="sensor-nm">${s.n}</div>
        <div class="sensor-val ${p>66?'danger':p>33?'caution':''}">${s.v.toFixed(1)} ${s.u}</div>
        <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${p}%;background:${col}"></div></div>
      </div>`;
    }).join('')}</div>
    <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
      <div style="font-size:0.65rem;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Trend Indicators</div>
      ${[{n:'CO₂ Trend',v:room.CO2_Room_Trend},{n:'CO Trend',v:room.CO_Room_Trend},{n:'VOC Trend',v:room.VOC_Room_RAW_Trend},{n:'PM₂.₅ Trend',v:room.PM25_Room_Trend}].map(t=>{
        const p=Math.min(Math.abs(t.v)*100,100);
        const col=p>60?'#ff3d00':p>30?'#ffab00':'#00e676';
        return `<div style="margin-bottom:7px;">
          <div style="display:flex;justify-content:space-between;font-size:0.65rem;margin-bottom:3px;"><span style="color:var(--text-dim)">${t.n}</span><span style="color:${col};font-family:'Share Tech Mono',monospace">${t.v.toFixed(3)}</span></div>
          <div class="sensor-bar"><div class="sensor-bar-fill" style="width:${p}%;background:${col}"></div></div>
        </div>`;
      }).join('')}
    </div>`;
  modalBg.classList.add('show');
}

document.addEventListener('DOMContentLoaded', function() {
  const mClose = document.getElementById('mClose');
  const modalBg = document.getElementById('modalBg');
  
  if(mClose) {
    mClose.addEventListener('click',()=>{
      if(modalBg) modalBg.classList.remove('show');
    });
  }
  
  if(modalBg) {
    modalBg.addEventListener('click',e=>{
      if(e.target===e.currentTarget) modalBg.classList.remove('show');
    });
  }
});

// ═══════════════════════════════════════════════════════════
// TREND CHART
// ═══════════════════════════════════════════════════════════
function drawTrend() {
  const canvas=document.getElementById('trendCanvas');
  if(!canvas) return;
  
  const W=canvas.offsetWidth, H=56;
  canvas.width=W*devicePixelRatio; 
  canvas.height=H*devicePixelRatio;
  canvas.style.width=W+'px'; 
  canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(devicePixelRatio,devicePixelRatio);
  
  const hist=S.history;
  if(hist.length<2){
    ctx.fillStyle='rgba(74,96,128,0.3)';
    ctx.font='9px "Share Tech Mono", monospace';
    ctx.textAlign='center';
    ctx.fillText('Run analysis multiple times to see trend',W/2,H/2+4);
    ctx.setTransform(1,0,0,1,0,0);
    return;
  }
  
  const mx=Math.max(...hist.map(h=>h.safe+h.warn+h.fire),1);
  const pad=4,W2=W-pad*2,H2=H-pad*2;
  
  const line=(key,color)=>{
    ctx.beginPath();
    ctx.strokeStyle=color;
    ctx.lineWidth=1.5;
    ctx.shadowBlur=5;
    ctx.shadowColor=color;
    hist.forEach((d,i)=>{
      const x=pad+i/(hist.length-1)*W2;
      const y=pad+H2-(d[key]/mx)*H2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.shadowBlur=0;
  };
  
  line('safe','#00e676');
  line('warn','#ffab00');
  line('fire','#ff3d00');
  ctx.setTransform(1,0,0,1,0,0);
}

// ═══════════════════════════════════════════════════════════
// ALERT LOG
// ═══════════════════════════════════════════════════════════
function addAlert(type,msg) {
  const log=document.getElementById('alertLog');
  if(!log) return;
  
  const e=document.createElement('div');
  e.className=`aentry a-${type}`;
  const t=new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
  e.innerHTML=`<span class="atime">${t}</span><span class="amsg">${msg}</span>`;
  log.insertBefore(e,log.firstChild);
  while(log.children.length>60) log.removeChild(log.lastChild);
}

// ═══════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════
function resetAll() {
  if(S.simInterval){
    clearInterval(S.simInterval);
    S.simInterval=null;
  }
  if(S.animFrame){
    cancelAnimationFrame(S.animFrame);
    S.animFrame=null;
  }
  S={rooms:[],adj:{},statuses:{},result:null,history:[],activeFloor:1,simInterval:null,animFrame:null,animPhase:0};
  
  const alertLog=document.getElementById('alertLog');
  if(alertLog) {
    alertLog.innerHTML='<div class="aentry a-info"><span class="atime">SYS</span><span class="amsg">Reset. Ready.</span></div>';
  }
  
  const simBtn=document.getElementById('simBtn');
  if(simBtn) {
    simBtn.textContent='⚡  Simulate Fire Spread';
    simBtn.classList.remove('active');
  }
  
  const floorTabs=document.getElementById('floorTabs');
  if(floorTabs) floorTabs.innerHTML='';
  
  const floorLabel=document.getElementById('floorLabel');
  if(floorLabel) floorLabel.textContent='Building Overview';
  
  ['stSafe','stWarn','stFire','stOrigin','stType','dOrigin','dFloor','dType','dFloors','dRisk','dStart','dDest','dRecSafe'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent='—';
  });
  
  ['hSafe','hWarn','hFire'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(el) el.textContent=['0 SAFE','0 WARN','0 FIRE'][i];
  });
  
  const canvas=document.getElementById('floorCanvas');
  if(canvas) {
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  
  drawFloor();
}

// Make setFloor globally accessible
window.setFloor = setFloor;
